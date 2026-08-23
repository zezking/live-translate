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

    // River bookkeeping. Input and translation run on independent pipelines
    // (the translation of a slice routinely finishes AFTER the next slice has
    // started — verified against the live endpoint), so a translation can't
    // simply target the tail. Instead each translation response is BOUND to a
    // slice at response.created time — the slice being captured right then,
    // or the just-committed one during the inter-slice gap — and all of that
    // response's text lands on the bound slice. Unlike a counter, this cannot
    // drift: the endpoint occasionally skips or empties a response (and ASR/
    // response ordering is loose), which would permanently shift a counter and
    // strand every later slice at "Translating…".
    private var liveIndex: Int?          // entry receiving original text
    private var responseIndex: Int?      // entry bound to the current response
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
        responseIndex = nil
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
        session.onInputFinalized = { [weak self] finalText in
            Task { @MainActor in self?.commitSlice(finalText: finalText) }
        }
        session.onResponseCreated = { [weak self] in
            Task { @MainActor in self?.bindResponse() }
        }
        session.onOutputTranscription = { [weak self] text in
            Task { @MainActor in self?.appendTranslation(text) }
        }
        session.onOutputFinalized = { [weak self] finalText in
            Task { @MainActor in self?.finishResponse(finalText: finalText) }
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
    /// opens a fresh one. `completed` carries the authoritative final ASR text,
    /// which can be fuller than the last partial.
    private func commitSlice(finalText: String) {
        guard let i = liveIndex, entries.indices.contains(i) else { return }
        if !finalText.isEmpty { entries[i].original = finalText }
        entries[i].live = false
        liveIndex = nil
        LTLog.log("[lt] slice #\(entries[i].id) committed (\(entries[i].original.count) chars)")
    }

    /// A translation response started — bind it to the slice being captured
    /// right now, or the just-committed one if the gap has already begun (the
    /// endpoint's response pipeline can lag or lead the ASR pipeline slightly;
    /// both orders bind correctly this way).
    private func bindResponse() {
        responseIndex = liveIndex ?? entries.indices.last
        if let i = responseIndex {
            LTLog.log("[lt] response bound to slice #\(entries[i].id)")
        }
    }

    /// Translation deltas REPLACE the bound slice's text. If response.created
    /// wasn't observed, late-bind to the current slice.
    private func appendTranslation(_ text: String) {
        guard !text.isEmpty, !entries.isEmpty else { return }
        let i = responseIndex ?? liveIndex ?? entries.count - 1
        entries[i].translation = text
    }

    /// The response finished — `response.*.done` carries the final full
    /// translation, authoritative over the last delta (revisions can land
    /// between the last delta and done). Unbind so the next response starts
    /// fresh.
    private func finishResponse(finalText: String) {
        let i = responseIndex ?? (entries.isEmpty ? nil : entries.count - 1)
        if !finalText.isEmpty, let i {
            entries[i].translation = finalText
        }
        if let i {
            LTLog.log("[lt] translation done → slice #\(entries[i].id) (\(finalText.count) chars)")
        }
        responseIndex = nil
    }

    private func trimRiverIfNeeded() {
        guard entries.count > maxEntries else { return }
        let drop = entries.count - maxEntries / 2
        entries.removeFirst(drop)
        liveIndex = liveIndex.map { $0 - drop }.flatMap { $0 >= 0 ? $0 : nil }
        responseIndex = responseIndex.map { $0 - drop }.flatMap { $0 >= 0 ? $0 : nil }
    }
}
