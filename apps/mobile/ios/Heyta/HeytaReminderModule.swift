import Foundation
import UserNotifications
import React

/// Local evidence only. OS submission is not proof that the user saw a banner.
/// Atomic file replacement precedes receipt acknowledgement across the JS bridge.
enum HeytaReminderReceipts {
  static let category = "heyta.reminder"
  private static let lock = NSRecursiveLock()
  struct State: Codable {
    var scheduled: [String: Double] = [:]
    var posted: Set<String> = []
    var receipts: Set<String> = []
  }
  private static func file() throws -> URL {
    let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
      appropriateFor: nil, create: true)
    return directory.appendingPathComponent("heyta-reminder-receipts.json")
  }
  static func update<T>(_ body: (inout State) throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    let url = try file()
    var state = FileManager.default.fileExists(atPath: url.path)
      ? try JSONDecoder().decode(State.self, from: Data(contentsOf: url)) : State()
    let result = try body(&state)
    try JSONEncoder().encode(state).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    return result
  }
  static func observe(_ ids: [String]) throws {
    try update { state in
      for id in ids where !state.posted.contains(id) {
        state.posted.insert(id)
        state.receipts.insert(id)
        state.scheduled.removeValue(forKey: id)
      }
    }
  }
}

@objc(HeytaReminderModule)
final class HeytaReminderModule: NSObject {
  private let center = UNUserNotificationCenter.current()

  @objc static func moduleName() -> String! { "HeytaReminder" }
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(authorizationStatus:reject:)
  func authorizationStatus(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    center.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral: resolve("granted")
      case .denied: resolve("denied")
      case .notDetermined: resolve("default")
      @unknown default: resolve("denied")
      }
    }
  }

  @objc(requestAuthorization:reject:)
  func requestAuthorization(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
      if let error { reject("E_REMINDER_AUTH", error.localizedDescription, error) }
      else { resolve(granted ? "granted" : "denied") }
    }
  }

  @objc(schedule:atMs:title:body:resolve:reject:)
  func schedule(_ identifier: String, atMs: Double, title: String, body: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard !identifier.isEmpty, atMs.isFinite, atMs > 0 else {
      reject("E_REMINDER_SCHEDULE", "Invalid reminder request", nil)
      return
    }
    center.getPendingNotificationRequests { pending in
      do {
        // Stable identifiers make reconcile idempotent. If the OS no longer
        // lists an accepted, due request, delivery is uncertain (e.g. the user
        // cleared it before launch). Retain it locally without inventing a
        // firedAt fact or repeatedly publishing the same occurrence.
        let shouldSchedule = try HeytaReminderReceipts.update { state -> Bool in
          if state.posted.contains(identifier) { return false }
          if pending.contains(where: { $0.identifier == identifier }) { return false }
          if let acceptedAt = state.scheduled[identifier], acceptedAt <= Date().timeIntervalSince1970 * 1000 {
            return false
          }
          return true
        }
        if !shouldSchedule { resolve(false); return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = HeytaReminderReceipts.category
        let request = UNNotificationRequest(identifier: identifier, content: content,
          trigger: UNTimeIntervalNotificationTrigger(
            timeInterval: max(1.0, atMs / 1000 - Date().timeIntervalSince1970), repeats: false))
        self.center.add(request) { error in
          if let error { reject("E_REMINDER_SCHEDULE", error.localizedDescription, error); return }
          do {
            try HeytaReminderReceipts.update { state in state.scheduled[identifier] = atMs }
            resolve(true)
          } catch { reject("E_REMINDER_STORAGE", error.localizedDescription, error) }
        }
      } catch { reject("E_REMINDER_STORAGE", error.localizedDescription, error) }
    }
  }

  @objc(cancel:resolve:reject:)
  func cancel(_ identifier: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    center.removePendingNotificationRequests(withIdentifiers: [identifier])
    center.removeDeliveredNotifications(withIdentifiers: [identifier])
    do {
      try HeytaReminderReceipts.update { state in
        state.scheduled.removeValue(forKey: identifier)
        state.posted.remove(identifier)
        state.receipts.remove(identifier)
      }
      resolve(true)
    } catch { reject("E_REMINDER_STORAGE", error.localizedDescription, error) }
  }

  @objc(cancelStale:pendingIdentifiers:resolve:reject:)
  func cancelStale(_ keepIdentifiers: [String], pendingIdentifiers: [String], resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock) {
    center.getPendingNotificationRequests { requests in
      self.center.getDeliveredNotifications { delivered in
        do {
          let keep = Set(keepIdentifiers)
          let pendingKeep = Set(pendingIdentifiers)
          let ownedRequests = requests.filter { $0.content.categoryIdentifier == HeytaReminderReceipts.category }
          let ownedDelivered = delivered.filter { $0.request.content.categoryIdentifier == HeytaReminderReceipts.category }
          let outsideWindow = Set(ownedRequests.map(\.identifier)).subtracting(pendingKeep)
          let stale = try HeytaReminderReceipts.update { state -> Set<String> in
            let known = Set(state.scheduled.keys).union(state.posted).union(state.receipts)
              .union(ownedRequests.map(\.identifier)).union(ownedDelivered.map(\.request.identifier))
            let stale = known.subtracting(keep)
            state.scheduled = state.scheduled.filter { keep.contains($0.key) && !outsideWindow.contains($0.key) }
            state.posted.formIntersection(keep)
            state.receipts.formIntersection(keep)
            return stale
          }
          self.center.removePendingNotificationRequests(withIdentifiers: Array(stale.union(outsideWindow)))
          self.center.removeDeliveredNotifications(withIdentifiers: Array(stale))
          resolve(true)
        } catch { reject("E_REMINDER_STORAGE", error.localizedDescription, error) }
      }
    }
  }

  @objc(peekDelivered:reject:)
  func peekDelivered(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    center.getDeliveredNotifications { notifications in
      do {
        let ids = notifications.filter { $0.request.content.categoryIdentifier == HeytaReminderReceipts.category }
          .map(\.request.identifier)
        try HeytaReminderReceipts.observe(ids)
        let receipts = try HeytaReminderReceipts.update { Array($0.receipts) }
        resolve(receipts)
      } catch { reject("E_REMINDER_STORAGE", error.localizedDescription, error) }
    }
  }

  /// A due request absent from both OS lists has no reliable delivery receipt.
  /// This local diagnostic must never create a synced firedAt fact.
  @objc(peekUncertain:reject:)
  func peekUncertain(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    center.getPendingNotificationRequests { pending in
      self.center.getDeliveredNotifications { delivered in
        do {
          let known = Set(pending.map(\.identifier)).union(delivered.map(\.request.identifier))
          let now = Date().timeIntervalSince1970 * 1000
          let ids = try HeytaReminderReceipts.update { state in
            state.scheduled.filter { id, at in
              at <= now && !known.contains(id) && !state.posted.contains(id)
            }.map(\.key).sorted()
          }
          resolve(ids)
        } catch { reject("E_REMINDER_STORAGE", error.localizedDescription, error) }
      }
    }
  }

  @objc(acknowledgeDelivered:resolve:reject:)
  func acknowledgeDelivered(_ identifiers: [String], resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock) {
    do {
      try HeytaReminderReceipts.update { state in state.receipts.subtract(identifiers) }
      // Do not remove visible notifications as a side effect of recording an op.
      resolve(true)
    } catch { reject("E_REMINDER_STORAGE", error.localizedDescription, error) }
  }
}
