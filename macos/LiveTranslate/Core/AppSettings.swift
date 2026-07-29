import Foundation
import Observation

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

    init() {
        let d = UserDefaults.standard
        sourceLanguage = d.string(forKey: "srcLang") ?? "en"
        targetLanguage = d.string(forKey: "tgtLang") ?? "ko"
        voiceOver = d.object(forKey: "voiceOver") as? Bool ?? true
    }
}
