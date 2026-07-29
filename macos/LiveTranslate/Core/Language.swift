import Foundation

enum Language {
    struct Def: Identifiable, Hashable {
        let code: String
        let name: String
        var id: String { code }
    }

    /// Languages Qwen's realtime endpoint accepts. Codes are the short BCP-47
    /// forms Qwen expects (zh-Hans -> zh, pt-BR -> pt are mapped in QwenRealtimeSession).
    static let all: [Def] = [
        .init(code: "en", name: "English"),
        .init(code: "ko", name: "한국어 (Korean)"),
        .init(code: "zh", name: "中文 (Mandarin)"),
        .init(code: "es", name: "Español"),
        .init(code: "pt", name: "Português"),
        .init(code: "ja", name: "日本語"),
        .init(code: "fa", name: "فارسی (Farsi)"),
    ]

    static func name(for code: String) -> String {
        all.first(where: { $0.code == code })?.name ?? code
    }
}
