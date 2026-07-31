import Foundation
import Observation
import SwiftUI   // withAnimation for slice-commit insertion

/// One-way, always-on live translation: continuously captures the audio source
/// and streams it to a single Qwen session (source → target). There is **no
/// push-to-talk** — the source is assumed to be a continuous stream (a mic, a USB
/// interface, or a browser/app window).
///
/// The transcript is a **river**: the server VAD closes a slice on a pause
/// (`input_audio_transcription.completed` / `response.*.done`), the slice scrolls
/// up into history, and a new live slice starts at the bottom. Nothing ever
/// disappears mid-session. Within a slice, text fields REPLACE on every delta,
/// because Qwen revises its ASR hypothesis mid-utterance and appending would
/// duplicate words.
@MainActor
@Observable
final class StreamTranslator {
    enum Phase: Equatable { case idle, connecting, ready, ended }

    /// One slice of the conversation. `live` marks the slice currently being
    /// captured; older slices stay visible above it.
    struct RiverEntry: Identifiable, Equatable {
        let id: Int
        var original: String
        var translation: String
        var live: Bool
    }

    private let apiKey: String
    let sourceLanguage: String
    let targetLanguage: String
    let voiceOver: Bool
    let voiceClone: Bool
    let sourceLabel: String      // shown in the UI so the user knows what's feeding the river

    /// Committed slices plus the live one at the end.
    private(set) var entries: [RiverEntry] = []
    var phase: Phase = .idle
    var lastError: String?
    var level: Float = 0

    private var session: QwenRealtimeSession?
    private var ready = false
    private let capture: AudioSource
    private var playback: PlaybackEngine?

    // River bookkeeping. Input and translation run on independent pointers:
    // the translation of a slice routinely finishes AFTER the next slice has
    // already started, so deltas can't simply go to the tail.
    private var liveIndex: Int?          // entry receiving original text
    private var translatingIndex = 0     // entry receiving translation text
    private var responseHadText = false  // current response carried non-empty text
    private var nextEntryID = 0
    private let maxEntries = 300

    init(apiKey: String,
         sourceLanguage: String,
         targetLanguage: String,
         voiceOver: Bool,
         voiceClone: Bool,
         source: AudioSource,
         sourceLabel: String = "Microphone") {
        self.apiKey = apiKey
        self.sourceLanguage = sourceLanguage
        self.targetLanguage = targetLanguage
        self.voiceOver = voiceOver
        self.voiceClone = voiceClone
        self.capture = source
        self.sourceLabel = sourceLabel
    }

    var sourceName: String { Language.name(for: sourceLanguage) }
    var targetName: String { Language.name(for: targetLanguage) }

    // MARK: - Lifecycle

    func begin() async {
        guard phase == .idle || phase == .ended else { return }
        phase = .connecting
        lastError = nil
        entries = []
        liveIndex = nil
        translatingIndex = 0
        responseHadText = false
        nextEntryID = 0
        LTLog.log("[lt] begin — source=\(sourceLabel) \(sourceName) → \(targetName) voice=\(voiceOver)")

        // The source is a continuous stream: every captured chunk goes straight
        // to the session. sendAudio() is a no-op until the session reports ready,
        // so audio captured before connect is simply dropped.
        var sentChunks = 0
        capture.onChunk = { [weak self] data in
            sentChunks += 1
            if sentChunks % 20 == 0 { LTLog.log("[lt] captured \(sentChunks) chunks so far") }
            Task { @MainActor in self?.session?.sendAudio(data) }
        }
        capture.onLevel = { [weak self] lv in
            Task { @MainActor in self?.level = lv }
        }
        capture.onError = { [weak self] message in
            Task { @MainActor in self?.lastError = message }
        }

        do {
            try capture.start()
        } catch {
            lastError = "Audio source unavailable: \(error.localizedDescription)"
            phase = .idle
            return
        }

        if voiceOver {
            let pb = PlaybackEngine()
            pb.start()
            playback = pb
        }

        let voice = QwenVoiceConfig(voiceOver: voiceOver, voiceClone: voiceClone)
        let s = QwenRealtimeSession(apiKey: apiKey,
                                    sourceLanguage: sourceLanguage,
                                    targetLanguage: targetLanguage,
                                    voiceConfig: voice)
        wire(s)
        session = s
        s.connect()
    }

    func end() async {
        capture.stop()
        playback?.stop()
        playback = nil
        ready = false
        await session?.disconnect()
        session = nil
        phase = .ended
    }

    // MARK: - Wiring

    private func wire(_ session: QwenRealtimeSession) {
        session.onReady = { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.ready = true
                self.phase = .ready
                LTLog.log("[lt] session ready — now streaming")
            }
        }
        session.onInputTranscription = { [weak self] text in
            Task { @MainActor in self?.appendOriginal(text) }
        }
        session.onInputFinalized = { [weak self] in
            Task { @MainActor in self?.commitSlice() }
        }
        session.onResponseCreated = { [weak self] in
            Task { @MainActor in self?.responseHadText = false }
        }
        session.onOutputTranscription = { [weak self] text in
            Task { @MainActor in self?.appendTranslation(text) }
        }
        session.onOutputFinalized = { [weak self] in
            Task { @MainActor in self?.advanceTranslationPointer() }
        }
        session.onAudio = { [weak self] data in
            Task { @MainActor in self?.playback?.enqueue(data) }
        }
        session.onError = { [weak self] message in
            Task { @MainActor in self?.lastError = message }
        }
        session.onClosed = { _ in /* reconnect handled in a later phase */ }
    }

    // MARK: - River

    /// REPLACE the live slice's original (Qwen revises mid-utterance), starting
    /// a new slice when the previous one was finalized.
    private func appendOriginal(_ text: String) {
        if let i = liveIndex, entries.indices.contains(i) {
            entries[i].original = text
        } else {
            let entry = RiverEntry(id: nextEntryID, original: text, translation: "", live: true)
            nextEntryID += 1
            withAnimation(.easeOut(duration: 0.25)) {
                entries.append(entry)
            }
            liveIndex = entries.count - 1
            trimRiverIfNeeded()
        }
    }

    /// Server VAD closed the current slice — it becomes history; the next delta
    /// opens a fresh one.
    private func commitSlice() {
        guard let i = liveIndex, entries.indices.contains(i) else { return }
        entries[i].live = false
        liveIndex = nil
        LTLog.log("[lt] slice #\(entries[i].id) committed (\(entries[i].original.count) chars)")
    }

    /// Translation deltas target the slice the current response belongs to —
    /// which may lag behind the live slice (translation trails the source).
    private func appendTranslation(_ text: String) {
        guard !text.isEmpty, !entries.isEmpty else { return }
        responseHadText = true
        let i = min(translatingIndex, entries.count - 1)
        entries[i].translation = text
    }

    /// The current response's translation is final — the next response belongs
    /// to the next slice. Responses that carried no text at all (VAD blips)
    /// don't move the pointer, so a noise-triggered response can't desync the
    /// 1:1 slice↔response mapping.
    private func advanceTranslationPointer() {
        if responseHadText {
            translatingIndex += 1
        }
        responseHadText = false
    }

    private func trimRiverIfNeeded() {
        guard entries.count > maxEntries else { return }
        let drop = entries.count - maxEntries / 2
        entries.removeFirst(drop)
        liveIndex = liveIndex.map { $0 - drop }.flatMap { $0 >= 0 ? $0 : nil }
        translatingIndex = max(0, translatingIndex - drop)
    }
}
