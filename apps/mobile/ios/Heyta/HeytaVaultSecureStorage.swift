import CryptoKit
import Foundation
import React
import Security

/**
 * Explicit opt-in storage for an unlocked vault root key.
 *
 * Keychain is the secure store on iOS; the item is protected with
 * `WhenUnlockedThisDeviceOnly`, so it is unavailable before first unlock and
 * is not migrated to another device. The app never writes the root key to a
 * file, UserDefaults, or the widget's keychain service.
 */
@objc(HeytaVaultSecureStorage)
final class HeytaVaultSecureStorage: NSObject {
  private static let service = "com.heyta.vault.secure-storage.v1"
  private static let rootKeyBytes = 32

  @objc static func moduleName() -> String! { "HeytaVaultSecureStorage" }
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(load:accountId:resolve:reject:)
  func load(
    _ serverOrigin: String,
    accountId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let scope = try Self.scope(serverOrigin: serverOrigin, accountId: accountId)
      var query = Self.baseQuery(account: scope.account)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      if status == errSecItemNotFound {
        resolve(nil)
        return
      }
      guard status == errSecSuccess else {
        throw Self.keychainError(status, operation: "读取")
      }
      guard let data = result as? Data, data.count == Self.rootKeyBytes else {
        throw NSError(domain: "HeytaVaultSecureStorage", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "Keychain 中的 vault root key 长度无效"])
      }
      resolve(data.base64EncodedString())
    } catch {
      reject("E_VAULT_SECURE_LOAD", error.localizedDescription, error)
    }
  }

  @objc(save:accountId:rootKeyBase64:resolve:reject:)
  func save(
    _ serverOrigin: String,
    accountId: String,
    rootKeyBase64: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let scope = try Self.scope(serverOrigin: serverOrigin, accountId: accountId)
      guard let data = Data(base64Encoded: rootKeyBase64), data.count == Self.rootKeyBytes else {
        throw NSError(domain: "HeytaVaultSecureStorage", code: 4,
                      userInfo: [NSLocalizedDescriptionKey: "vault root key 必须是 32 字节 Base64"])
      }

      var item = Self.baseQuery(account: scope.account)
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      var status = SecItemAdd(item as CFDictionary, nil)
      if status == errSecDuplicateItem {
        // Update only the value. A failed update leaves the old item intact;
        // this path never deletes first and never runs on sync failure.
        let query = Self.baseQuery(account: scope.account)
        status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      }
      guard status == errSecSuccess else {
        throw Self.keychainError(status, operation: "写入")
      }
      resolve(true)
    } catch {
      reject("E_VAULT_SECURE_SAVE", error.localizedDescription, error)
    }
  }

  @objc(remove:accountId:resolve:reject:)
  func remove(
    _ serverOrigin: String,
    accountId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let scope = try Self.scope(serverOrigin: serverOrigin, accountId: accountId)
      let status = SecItemDelete(Self.baseQuery(account: scope.account) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw Self.keychainError(status, operation: "清除")
      }
      resolve(true)
    } catch {
      reject("E_VAULT_SECURE_REMOVE", error.localizedDescription, error)
    }
  }

  private struct Scope {
    let account: String
  }

  private static func scope(serverOrigin: String, accountId: String) throws -> Scope {
    let origin = serverOrigin.trimmingCharacters(in: .whitespacesAndNewlines)
    let account = accountId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !origin.isEmpty else { throw invalidScope("serverOrigin 不能为空") }
    guard !account.isEmpty else { throw invalidScope("accountId 不能为空") }
    guard !origin.unicodeScalars.contains(where: { $0.value < 0x20 }),
          !account.unicodeScalars.contains(where: { $0.value < 0x20 }) else {
      throw invalidScope("安全存储作用域不能包含控制字符")
    }

    let canonical = "\(origin.utf8.count):\(origin)\(account.utf8.count):\(account)"
    let digest = SHA256.hash(data: Data(canonical.utf8))
    let accountDigest = digest.map { String(format: "%02x", $0) }.joined()
    return Scope(account: accountDigest)
  }

  private static func baseQuery(account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func invalidScope(_ message: String) -> NSError {
    NSError(domain: "HeytaVaultSecureStorage", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message])
  }

  private static func keychainError(_ status: OSStatus, operation: String) -> NSError {
    NSError(domain: NSOSStatusErrorDomain, code: Int(status),
            userInfo: [NSLocalizedDescriptionKey: "Keychain \(operation)失败（OSStatus \(status)）"])
  }

#if DEBUG
  /// Test-only probe invoked by `verify-ios-vault-keychain.sh`. It exercises
  /// the same scope hashing, Keychain service, accessibility attribute, and
  /// query shape as the production bridge without adding a second store.
  static func runProbe(stage: String) {
    let scopes = ["probe-a@example", "probe-b@example"]
    let values = [Data(repeating: 0x11, count: rootKeyBytes), Data(repeating: 0x22, count: rootKeyBytes)]
    var result: [String: Any] = ["stage": stage, "process": ProcessInfo.processInfo.processIdentifier]
    do {
      let accounts = try scopes.map { try scope(serverOrigin: "https://probe.invalid", accountId: $0).account }
      let instance = HeytaVaultSecureStorage()
      func bridgeError(_ message: String?) -> NSError {
        NSError(domain: "HeytaVaultSecureStorageProbe", code: 1,
                userInfo: [NSLocalizedDescriptionKey: message ?? "native bridge operation failed"])
      }
      func save(_ accountId: String, _ value: Data) throws {
        let done = DispatchSemaphore(value: 0)
        var failure: Error?
        var success = false
        instance.save("https://probe.invalid", accountId: accountId, rootKeyBase64: value.base64EncodedString(),
          resolve: { value in success = (value as? Bool) == true; done.signal() },
          reject: { _, message, error in failure = error ?? bridgeError(message); done.signal() })
        done.wait()
        if let failure { throw failure }
        guard success else { throw bridgeError("native save returned false") }
      }
      func read(_ accountId: String) throws -> Data? {
        let done = DispatchSemaphore(value: 0)
        var failure: Error?
        var encoded: String?
        instance.load("https://probe.invalid", accountId: accountId,
          resolve: { value in encoded = value as? String; done.signal() },
          reject: { _, message, error in failure = error ?? bridgeError(message); done.signal() })
        done.wait()
        if let failure { throw failure }
        guard let encoded else { return nil }
        guard let data = Data(base64Encoded: encoded) else { throw bridgeError("native load returned invalid Base64") }
        return data
      }
      func remove(_ accountId: String) throws {
        let done = DispatchSemaphore(value: 0)
        var failure: Error?
        var success = false
        instance.remove("https://probe.invalid", accountId: accountId,
          resolve: { value in success = (value as? Bool) == true; done.signal() },
          reject: { _, message, error in failure = error ?? bridgeError(message); done.signal() })
        done.wait()
        if let failure { throw failure }
        guard success else { throw bridgeError("native remove returned false") }
      }
      if stage == "invalid" {
        do {
          try save(scopes[0], Data(repeating: 0x33, count: rootKeyBytes - 1))
          result["invalidSaveRejected"] = false
        } catch {
          result["invalidSaveRejected"] = true
          result["invalidSaveError"] = error.localizedDescription
        }
      }
      func readAttributes(_ account: String) throws -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnAttributes as String] = true
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let attrs = value as? [String: Any] else { throw keychainError(status, operation: "探针属性读取") }
        return attrs[kSecAttrAccessible as String] as? String
      }
      if stage == "clean" {
        for account in scopes { try remove(account) }
        for (account, value) in zip(scopes, values) { try save(account, value) }
      } else if stage == "remove" {
        try remove(scopes[0])
      }
      let loaded = try scopes.map(read)
      let access = try accounts.map(readAttributes)
      result["loadLengths"] = loaded.map { $0?.count ?? 0 }
      result["loadMatches"] = loaded.enumerated().map { $0.element == values[$0.offset] }
      result["accessible"] = access
      result["scopeIsolated"] = loaded[0] != loaded[1]
      result["aMissingAfterRemove"] = loaded[0] == nil
      result["bRetainedAfterRemove"] = loaded[1] == values[1]
      if stage == "remove" { try remove(scopes[1]) }
      result["cleanAfterRemove"] = try scopes.map(read).allSatisfy { $0 == nil }
    } catch { result["error"] = error.localizedDescription }
    do {
      let url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("heyta-keychain-probe.json")
      let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      try data.write(to: url, options: .atomic)
      NSLog("[keychain-probe] stage=%@ result=%@", stage, String(data: data, encoding: .utf8) ?? "{}")
    } catch { NSLog("[keychain-probe] write failed: %@", error.localizedDescription) }
  }
#endif
}
