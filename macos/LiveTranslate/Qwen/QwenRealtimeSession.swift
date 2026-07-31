import Foundation

/// One directional Qwen realtime translation session (source -> target).
///
/// Faithful port of the TypeScript `qwen-translation-session.ts`: connects to the
/// realtime WebSocket, sends `session.update`, streams 16 kHz Int16 PCM, and parses
/// the JSON event stream. Transcripts use REPLACE semantics — the full current
/// value is emitted on every delta, never appended — because Qwen revises its ASR
/// hypothesis mid-utterance and appending deltas would duplicate words.
final class QwenRealtimeSession: @unchecked Sendable {
    static let endpoint = URL(string: "wss://ws-r7nxaponiv4jkf1t.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-livetranslate-flash-realtime")!

    private let apiKey: String
    private let sourceLanguage: String
    private let targetLanguage: String
    private let voiceConfig: QwenVoiceConfig

    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private(set) var isActive = false

    private var lastInputText = ""
    private var lastOutputText = ""
    private var sendAudioWhileInactiveLogged = false

    // Callbacks (invoked from the URLSession delegate queue — hop to MainActor at the call site).
    var onReady: (() -> Void)?
    var onInputTranscription: ((String) -> Void)?   // full current original text
    var onInputFinalized: (() -> Void)?             // server VAD closed the current slice
    var onOutputTranscription: ((String) -> Void)?  // full current translation text
    var onResponseCreated: (() -> Void)?            // a new translation response started
    var onOutputFinalized: (() -> Void)?            // the current response's translation is final
    var onAudio: ((Data) -> Void)?                  // 24 kHz Int16 PCM
    var onError: ((String) -> Void)?
    var onClosed: ((String) -> Void)?

    init(apiKey: String, sourceLanguage: String, targetLanguage: String, voiceConfig: QwenVoiceConfig) {
        self.apiKey = apiKey
        self.sourceLanguage = Self.mapLang(sourceLanguage)
        self.targetLanguage = Self.mapLang(targetLanguage)
        self.voiceConfig = voiceConfig
    }

    private static func mapLang(_ code: String) -> String {
        switch code {
        case "zh-Hans", "zh-Hant": return "zh"
        case "pt-BR", "pt-PT": return "pt"
        default: return code
        }
    }

    // MARK: - Lifecycle

    func connect() {
        guard task == nil else { return }
        var request = URLRequest(url: Self.endpoint)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        let urlSession = URLSession(configuration: config)
        self.session = urlSession

        let ws = urlSession.webSocketTask(with: request)
        self.task = ws
        ws.resume()

        sendSessionUpdate()

        receiveTask = Task { [weak self, ws] in
            while !Task.isCancelled {
                do {
                    let message = try await ws.receive()
                    self?.handle(message)
                } catch {
                    self?.isActive = false
                    self?.onError?(error.localizedDescription)
                    self?.onClosed?(error.localizedDescription)
                    break
                }
            }
        }
    }

    func sendAudio(_ pcm: Data) {
        guard isActive else {
            if !sendAudioWhileInactiveLogged {
                sendAudioWhileInactiveLogged = true
                LTLog.log("[qwen] dropping audio — session not active yet")
            }
            return
        }
        let payload: [String: Any] = [
            "type": "input_audio_buffer.append",
            "audio": pcm.base64EncodedString(),
        ]
        send(payload)
    }

    func disconnect() async {
        receiveTask?.cancel()
        receiveTask = nil
        if let task {
            if task.closeCode == .invalid {
                try? await task.send(.string(#"{"type":"session.finish"}"#))
            }
            task.cancel(with: .goingAway, reason: nil)
        }
        task = nil
        session?.invalidateAndCancel()
        session = nil
        isActive = false
    }

    // MARK: - Session config

    private func sendSessionUpdate() {
        var sessionConfig: [String: Any] = [
            "modalities": voiceConfig.voiceOver ? ["text", "audio"] : ["text"],
            "input_audio_transcription": [
                "language": sourceLanguage,
                "model": "qwen3-asr-flash-realtime",
            ],
            "translation": ["language": targetLanguage],
            // Server VAD: only cut a slice after ~1.2 s of silence (default is
            // much shorter, which made the transcript reset mid-thought).
            // Accepted by the livetranslate endpoint (verified against the live
            // API — unknown keys are NOT rejected silently by all models, so
            // keep this shape in sync with what was tested).
            "turn_detection": [
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 1200,
            ],
        ]
        if voiceConfig.voiceOver && voiceConfig.voiceClone {
            sessionConfig["voice"] = "default"
            sessionConfig["enable_voice_clone"] = true
            sessionConfig["voice_clone_options"] = ["frequency": "once"]
        } else if voiceConfig.voiceOver {
            sessionConfig["voice"] = "Tina"
            sessionConfig["enable_voice_clone"] = false
        }
        send(["type": "session.update", "session": sessionConfig])
    }

    private func send(_ message: [String: Any]) {
        guard let task,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let string = String(data: data, encoding: .utf8) else { return }
        Task { try? await task.send(.string(string)) }
    }

    // MARK: - Incoming

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let text: String
        switch message {
        case .string(let s): text = s
        case .data(let d): text = (String(data: d, encoding: .utf8)) ?? ""
        @unknown default: return
        }
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return }

        switch type {
        case "session.created", "session.updated":
            isActive = true
            onReady?()

        case "conversation.item.input_audio_transcription.text":
            // `stash` holds the live cumulative partial; `text` is empty until finalize.
            let combined = (object["text"] as? String ?? "") + (object["stash"] as? String ?? "")
            if combined != lastInputText {
                lastInputText = combined
                onInputTranscription?(combined)
            }

        case "conversation.item.input_audio_transcription.completed":
            // Server VAD closed the current slice. Carries no text — the final
            // original is whatever the last `.text` event held.
            onInputFinalized?()

        case "response.created":
            onResponseCreated?()

        case "response.audio_transcript.text", "response.text.text":
            let out = object["text"] as? String ?? ""
            if out != lastOutputText {
                lastOutputText = out
                onOutputTranscription?(out)
            }

        case "response.audio_transcript.done", "response.text.done":
            onOutputFinalized?()

        case "response.done":
            break

        case "response.audio.delta":
            if let b64 = object["delta"] as? String, let audio = Data(base64Encoded: b64) {
                onAudio?(audio)
            }

        case "error":
            let message = (object["error"] as? [String: Any])?["message"] as? String ?? text
            onError?(message)

        case "session.finished":
            isActive = false

        default:
            break
        }
    }
}

struct QwenVoiceConfig: Equatable {
    var voiceOver: Bool
    var voiceClone: Bool
}
