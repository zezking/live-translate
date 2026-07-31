import Foundation
import Observation

/// Where translation audio comes from.
enum InputMode: String, CaseIterable, Identifiable {
    case mic
    case browser
    var id: String { rawValue }
    var label: String { self == .mic ? "Microphone / USB" : "Browser / App" }
}

/// User-tunable settings, persisted to UserDefaults.
@Observable
final class AppSettings {
    private let defaults = UserDefaults.standard

    var sourceLanguage: String {
        didSet { defaults.set(sourceLanguage, forKey: "srcLang") }
    }
    var targetLanguage: String {
        didSet { defaults.set(targetLanguage, forKey: "tgtLang") }
    }
    var voiceOver: Bool {
        didSet { defaults.set(voiceOver, forKey: "voiceOver") }
    }
    var inputMode: InputMode {
        didSet { defaults.set(inputMode.rawValue, forKey: "inputMode") }
    }
    /// UID of the input device the user picked (stable across reconnects;
    /// AudioDeviceIDs are not). Nil = system default input.
    var inputDeviceUID: String? {
        didSet { defaults.set(inputDeviceUID, forKey: "inputDeviceUID") }
    }

    init() {
        let d = UserDefaults.standard
        sourceLanguage = d.string(forKey: "srcLang") ?? "en"
        targetLanguage = d.string(forKey: "tgtLang") ?? "ko"
        voiceOver = d.object(forKey: "voiceOver") as? Bool ?? true
        inputMode = InputMode(rawValue: d.string(forKey: "inputMode") ?? "") ?? .mic
        inputDeviceUID = d.string(forKey: "inputDeviceUID")
    }
}
