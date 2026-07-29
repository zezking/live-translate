import Foundation
import Security
import Observation

/// Stores the DashScope (Qwen) API key in the macOS Keychain.
/// Nothing secrets-related is ever written to disk in cleartext.
@Observable
final class KeychainStore {
    private let service = "app.livetranslate"
    private let account = "dashscope-api-key"

    /// Whether a key is currently stored. Tracked so SwiftUI re-renders on change.
    private(set) var hasKey = false

    init() {
        hasKey = (rawValue() ?? "").isEmpty == false
    }

    /// Returns the stored key, or an empty string if none.
    var apiKey: String { rawValue() ?? "" }

    func setKey(_ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        save(trimmed)
        hasKey = true
    }

    func clearKey() {
        delete()
        hasKey = false
    }

    // MARK: - Keychain

    private func rawValue() -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func save(_ value: String) {
        let data = Data(value.utf8)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        SecItemAdd(add as CFDictionary, nil)
    }

    private func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
