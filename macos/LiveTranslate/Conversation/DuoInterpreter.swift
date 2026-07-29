import Foundation
import Observation

/// A single finalized or in-progress turn in the transcript river.
struct Turn: Identifiable, Hashable {
    let id = UUID()
    let lang: String          // BCP-47-ish source language code for this turn
    var original: String
    var translation: String
    var isActive: Bool
}

/// The interpreter mode: two warm directional Qwen sessions (A->B, B->A).
/// Push-to-talk picks the active direction; audio is routed to that session.
/// Transcript deltas REPLACE the active turn's text (never append), which is what
/// keeps the on-screen text duplicate-free even as Qwen revises mid-utterance.
@MainActor
@Observable
final class DuoInterpreter {
    enum Direction: Hashable { case a, b }
    enum Phase: Equatable { case idle, connecting, ready, ended }

    private let apiKey: String
    let sourceLanguage: String
    let targetLanguage: String
    let voiceOver: Bool
    let voiceClone: Bool

    var turns: [Turn] = []
    var phase: Phase = .idle
    var lastError: String?
    var level: Float = 0
    private(set) var activeDirection: Direction?

    private var sessionA: QwenRealtimeSession?
    private var sessionB: QwenRealtimeSession?
    private var readyA = false
    private var readyB = false
    private var routing: Direction?          // decoupled from activeDirection for release-linger
    private let capture = AudioCaptureEngine()
    private var playback: PlaybackEngine?
    private var linger: Task<Void, Never>?
    private var preRoll: [Data] = []
    private let preRollChunks = 3             // ~300 ms lead-in so first words aren't clipped

    init(apiKey: String, sourceLanguage: String, targetLanguage: String, voiceOver: Bool, voiceClone: Bool) {
        self.apiKey = apiKey
        self.sourceLanguage = sourceLanguage
        self.targetLanguage = targetLanguage
        self.voiceOver = voiceOver
        self.voiceClone = voiceClone
    }

    var sourceName: String { Language.name(for: sourceLanguage) }
    var targetName: String { Language.name(for: targetLanguage) }

    // MARK: - Lifecycle

    func begin() async {
        guard phase == .idle || phase == .ended else { return }
        phase = .connecting
        lastError = nil
        turns.removeAll()

        capture.onChunk = { [weak self] data in
            Task { @MainActor in self?.handleChunk(data) }
        }
        capture.onLevel = { [weak self] lv in
            Task { @MainActor in self?.level = lv }
        }

        do {
            try capture.start()
        } catch {
            lastError = "Microphone unavailable: \(error.localizedDescription)"
            phase = .idle
            return
        }

        if voiceOver {
            let pb = PlaybackEngine()
            pb.start()
            playback = pb
        }

        let voice = QwenVoiceConfig(voiceOver: voiceOver, voiceClone: voiceClone)
        let a = QwenRealtimeSession(apiKey: apiKey, sourceLanguage: sourceLanguage, targetLanguage: targetLanguage, voiceConfig: voice)
        let b = QwenRealtimeSession(apiKey: apiKey, sourceLanguage: targetLanguage, targetLanguage: sourceLanguage, voiceConfig: voice)
        wire(a, direction: .a)
        wire(b, direction: .b)
        sessionA = a
        sessionB = b
        a.connect()
        b.connect()
    }

    func end() async {
        linger?.cancel()
        linger = nil
        capture.stop()
        playback?.stop()
        playback = nil
        readyA = false
        readyB = false
        routing = nil
        activeDirection = nil
        await sessionA?.disconnect()
        await sessionB?.disconnect()
        sessionA = nil
        sessionB = nil
        phase = .ended
    }

    // MARK: - Wiring

    private func wire(_ session: QwenRealtimeSession, direction: Direction) {
        session.onReady = { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                if direction == .a { self.readyA = true } else { self.readyB = true }
                if self.readyA && self.readyB { self.phase = .ready }
            }
        }
        session.onInputTranscription = { [weak self] text in
            Task { @MainActor in self?.update(direction: direction, original: text) }
        }
        session.onOutputTranscription = { [weak self] text in
            Task { @MainActor in self?.update(direction: direction, translation: text) }
        }
        session.onAudio = { [weak self] data in
            Task { @MainActor in self?.playback?.enqueue(data) }
        }
        session.onError = { [weak self] message in
            Task { @MainActor in self?.lastError = message }
        }
        session.onClosed = { _ in /* reconnect handled in a later phase */ }
    }

    // MARK: - Audio routing

    private func handleChunk(_ data: Data) {
        // Keep a small rolling pre-roll so lead-in words on press are captured.
        preRoll.append(data)
        while preRoll.count > preRollChunks { preRoll.removeFirst() }

        guard phase == .ready, let routing else { return }
        sendTo(routing, data)
    }

    private func sendTo(_ direction: Direction, _ data: Data) {
        switch direction {
        case .a: sessionA?.sendAudio(data)
        case .b: sessionB?.sendAudio(data)
        }
    }

    // MARK: - Push to talk

    func press(_ direction: Direction) {
        linger?.cancel()
        linger = nil
        if routing == direction { return }
        if let previous = routing { finalize(direction: previous) }
        routing = direction
        activeDirection = direction
        ensureTurn(direction: direction)
        // Flush the pre-roll so words spoken just before the press are captured.
        for chunk in preRoll { sendTo(direction, chunk) }
        preRoll.removeAll()
    }

    func release() {
        guard let direction = routing, linger == nil else { return }
        // Release the UI immediately; keep routing briefly so trailing words land.
        activeDirection = nil
        linger = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            await MainActor.run {
                guard let self else { return }
                self.linger = nil
                self.finalize(direction: direction)
                self.routing = nil
            }
        }
    }

    // MARK: - Transcript

    private func ensureTurn(direction: Direction) {
        let lang = language(for: direction)
        if turns.last(where: { $0.lang == lang && $0.isActive }) != nil { return }
        turns.append(Turn(lang: lang, original: "", translation: "", isActive: true))
    }

    private func update(direction: Direction, original: String? = nil, translation: String? = nil) {
        let lang = language(for: direction)
        guard let index = turns.lastIndex(where: { $0.lang == lang }) else {
            var turn = Turn(lang: lang, original: "", translation: "", isActive: false)
            if let o = original { turn.original = o }
            if let t = translation { turn.translation = t }
            turns.append(turn)
            return
        }
        if let o = original { turns[index].original = o }
        if let t = translation { turns[index].translation = t }
    }

    private func finalize(direction: Direction) {
        let lang = language(for: direction)
        if let index = turns.lastIndex(where: { $0.lang == lang }) {
            turns[index].isActive = false
        }
    }

    private func language(for direction: Direction) -> String {
        direction == .a ? sourceLanguage : targetLanguage
    }
}
