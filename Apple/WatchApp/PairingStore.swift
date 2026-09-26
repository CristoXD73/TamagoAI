// PairingStore.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (pair → relaunch → still paired, see
// docs/HANDOFF_LOG.md). Not DEVICE_VERIFIED.
//
// D-109's storage rule, applied to D-116's pairing: the bearer token — the
// only secret — lives in the Keychain as a generic password (service
// `<bundle id>.gateway`, account `token`), readable only by this app, only on
// this device (`AfterFirstUnlockThisDeviceOnly`, never synchronized). The
// non-secret rest (gateway URL, id, name) lives in UserDefaults. Nothing is
// logged. Every OSStatus is checked and returned, never swallowed.

import Foundation
import Security

struct PairingRecord: Codable, Equatable {
    var baseURL: URL
    var token: String
    var gatewayId: String
    var gatewayName: String
    var pairedAt: Date
}

enum PairingStore {
    private struct Metadata: Codable {
        var baseURL: URL
        var gatewayId: String
        var gatewayName: String
        var pairedAt: Date
    }

    private static let metadataKey = "tamago.pairing"
    private static var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "\(Bundle.main.bundleIdentifier ?? "ai.tamago.watch").gateway",
         kSecAttrAccount as String: "token",
         kSecAttrSynchronizable as String: false]
    }

    /// A record only when both halves exist — a token without metadata (or
    /// the reverse) means "not paired", never a half-configured link.
    static func load() -> PairingRecord? {
        guard let data = UserDefaults.standard.data(forKey: metadataKey),
              let meta = try? JSONDecoder().decode(Metadata.self, from: data) else { return nil }
        var q = keychainQuery
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let tokenData = item as? Data,
              let token = String(data: tokenData, encoding: .utf8) else { return nil }
        return PairingRecord(baseURL: meta.baseURL, token: token, gatewayId: meta.gatewayId,
                             gatewayName: meta.gatewayName, pairedAt: meta.pairedAt)
    }

    @discardableResult
    static func save(_ record: PairingRecord) -> OSStatus {
        SecItemDelete(keychainQuery as CFDictionary)
        var q = keychainQuery
        q[kSecValueData as String] = Data(record.token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { return status }
        let meta = Metadata(baseURL: record.baseURL, gatewayId: record.gatewayId,
                            gatewayName: record.gatewayName, pairedAt: record.pairedAt)
        UserDefaults.standard.set(try? JSONEncoder().encode(meta), forKey: metadataKey)
        return status
    }

    static func clear() {
        SecItemDelete(keychainQuery as CFDictionary)
        UserDefaults.standard.removeObject(forKey: metadataKey)
    }
}
