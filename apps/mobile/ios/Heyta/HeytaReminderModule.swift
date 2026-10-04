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

  /// Read the local ledger without acknowledging, scheduling, or cancelling anything.
  /// This is intentionally separate from `update`: the Release reminder probe must be
  /// observational even when it runs while the JS reconcile pass is in flight.
  static func readOnly() throws -> State {
    lock.lock()
    defer { lock.unlock() }
    let url = try file()
    guard FileManager.default.fileExists(atPath: url.path) else { return State() }
    return try JSONDecoder().decode(State.self, from: Data(contentsOf: url))
  }
}

#if HEYTA_REMINDER_PROBE
/// Release-build, opt-in diagnostic for the iOS notification-center boundary.
///
/// The probe is enabled only by passing `SWIFT_ACTIVE_COMPILATION_CONDITIONS=...
/// HEYTA_REMINDER_PROBE` to a dedicated xcodebuild invocation and is triggered by
/// `-HEYTA_REMINDER_PROBE [delayMs]`. It never calls `add`, `remove`, or
/// `HeytaReminderReceipts.update`; its JSON is a read-only observation of the OS
/// lists plus the local receipt ledger. This keeps the probe useful for permission,
/// restart, uncertain-delivery, and the iOS 64-request window without making a
/// diagnostic run manufacture a product event.
enum HeytaReminderProbe {
  static func run(after delayMs: Int) {
    let delay = max(0, delayMs)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(delay)) {
      let center = UNUserNotificationCenter.current()
      center.getNotificationSettings { settings in
        center.getPendingNotificationRequests { pending in
          center.getDeliveredNotifications { delivered in
            var result: [String: Any] = [
              "schema": 1,
              "process": ProcessInfo.processInfo.processIdentifier,
              "delayMs": delay,
              "authorization": authorization(settings.authorizationStatus),
              "pending": pending
                .filter { $0.content.categoryIdentifier == HeytaReminderReceipts.category }
                .map { request in
                  [
                    "id": request.identifier,
                    "triggerDate": triggerDate(request.trigger) ?? NSNull(),
                  ] as [String: Any]
                },
              "delivered": delivered
                .filter { $0.request.content.categoryIdentifier == HeytaReminderReceipts.category }
                .map { notification in notification.request.identifier },
            ]
            do {
              let ledger = try HeytaReminderReceipts.readOnly()
              result["ledger"] = [
                "scheduled": ledger.scheduled.keys.sorted(),
                "posted": ledger.posted.sorted(),
                "receipts": ledger.receipts.sorted(),
              ]
            } catch {
              result["ledgerError"] = error.localizedDescription
            }
            write(result)
          }
        }
      }
    }
  }

  private static func authorization(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "default"
    case .denied: return "denied"
    case .authorized: return "granted"
    case .provisional: return "provisional"
    case .ephemeral: return "ephemeral"
    @unknown default: return "unknown"
    }
  }

  private static func triggerDate(_ trigger: UNNotificationTrigger?) -> String? {
    guard let trigger else { return nil }
    let date: Date?
    if let interval = trigger as? UNTimeIntervalNotificationTrigger {
      date = interval.nextTriggerDate()
    } else if let calendar = trigger as? UNCalendarNotificationTrigger {
      date = calendar.nextTriggerDate()
    } else {
      date = nil
    }
    guard let date else { return nil }
    return ISO8601DateFormatter().string(from: date)
  }

  private static func write(_ result: [String: Any]) {
    do {
      let url = try FileManager.default.url(for: .applicationSupportDirectory,
        in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("heyta-reminder-probe.json")
      let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      NSLog("[reminder-probe] %@", String(data: data, encoding: .utf8) ?? "{}")
    } catch {
      NSLog("[reminder-probe] write failed: %@", error.localizedDescription)
    }
  }
}
#endif

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
          // A request that was scheduled before a force-stop or device
          // shutdown may be due by the time startup reconciliation runs.  The
          // JS planner deliberately converts that missed occurrence into an
          // immediate delivery attempt while keeping the original occurrence
          // id.  An expired ledger entry is therefore not evidence that the
          // OS delivered it; only a still-future entry suppresses a duplicate
          // while the request is being restored in the notification center.
          if let acceptedAt = state.scheduled[identifier],
            acceptedAt > Date().timeIntervalSince1970 * 1000 {
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
