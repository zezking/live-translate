import Foundation
import Observation

/// One-way, always-on live translation: continuously captures the audio source
/// and streams it to a single Qwen session (source → target). There is **no
/// push-to-talk** — the source is assumed to be a continuous stream (a mic, a USB
/// interface, or a browser/app window). Transcript fields REPLACE on every delta,
/// because Qwen revises its ASR hypothesis mid-utterance and appending would
/// duplicate words.
@MainActor
@Observable
final class StreamTranslator {
    enum Phase: Equatable { case idle, connecting, ready, ended }

    private let apiKey: String
    let sourceLanguage: String
    let targetLanguage: String
    let voiceOver: Bool
    let voiceClone: Bool
    let sourceLabel: String      // shown in the UI so the user knows what's feeding the river

    /// Cumulative original text (replace-on-delta — never append).
    var original: String = ""
    /// Cumulative translation text (replace-on-delta — never append).
    var translation: String = ""
    var phase: Phase = .idle
    var lastError: String?
    var level: Float = 0

    private var session: QwenRealtimeSession?
    private var ready = false
    private let capture: AudioSource
    private var playback: PlaybackEngine?

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
        original = ""
        translation = ""
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
            Task { @MainActor in self?.original = text }
        }
        session.onOutputTranscription = { [weak self] text in
            Task { @MainActor in self?.translation = text }
        }
        session.onAudio = { [weak self] data in
            Task { @MainActor in self?.playback?.enqueue(data) }
        }
        session.onError = { [weak self] message in
            Task { @MainActor in self?.lastError = message }
        }
        session.onClosed = { _ in /* reconnect handled in a later phase */ }
    }
}
