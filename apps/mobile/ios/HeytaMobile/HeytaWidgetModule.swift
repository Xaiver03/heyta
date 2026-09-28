import Foundation
import React
import WidgetKit

import HeytaWidgetBridge
// W5-3 · `FocusActivityRefresh` 在 Core 里（W5-1 时把共用件搬了过去）
import HeytaWidgetCore

/**
 小组件的 RN 原生模块（iOS）—— **只有转发，没有逻辑**。
 ==========================================================

 ## 🔴 为什么这里没有逻辑

 逻辑全在 `HeytaWidgetBridge`（SwiftPM 包，**81 条单测覆盖**）。
 这个文件之所以只剩转发，是因为它**测不了**：
 `import React` 需要 CocoaPods 的 Pod，而 Pod 不是 SwiftPM 依赖 ——
 所以"能被 `swift test` 跑"和"能 `import React`"是互斥的。

 于是切法是：**逻辑进 SwiftPM（可测），转发留在这里（十行、没有逻辑可错）**。

 ⚠️ 这是"可验证性驱动结构"的第三次应用（前两次是核心包本身、以及
 把 `getOrCreate` 放进 Bridge target 让扩展在**类型层面**写不出这个调用）。
 每次都是同一个判断：**如果一个东西写错了没有测试能发现，就不要让它承载逻辑。**

 ## 🔴 错误码与 Android **逐字符相同**

 `E_WIDGET_NOT_JSON` / `E_WIDGET_INVALID_ENVELOPE` / `E_WIDGET_WRITE_FAILED` /
 `E_WIDGET_READ_FAILED` —— 与 `WidgetModule.kt` 的常量一一对应。

 理由：JS 侧的错误处理是**共享的**（`widget-bridge.ts` 的 `callNativeSafely`）。
 两个平台给不同的码，JS 侧就必须按平台分支 —— 而那种分支**没有任何测试**，
 因为 JS 测试跑在 Node 上、两个原生模块都不存在。

 ## 方法名与 Android 完全一致（5 个）

 | 方法 | 谁用 |
 |---|---|
 | `setWidgetSnapshot` | 应用写快照 |
 | `drainIntentQueue` | 应用读 + 清 |
 | `mergeIntentQueue` | 应用写回失败的意图 |
 | `clearWidgetState` | 登出 |
 | `sealWidgetSnapshot` | 应用加密（**密钥不穿桥**） |

 ⚠️ `moduleName` 必须是 `HeytaWidget` —— JS 侧 `NativeModules.HeytaWidget`。
 改了它 JS 就找不到模块，而症状是"小组件功能全部静默失效"
 （`widget-bridge.ts` 把"模块不存在"降级成"没有小组件支持"）。
 */
@objc(HeytaWidgetModule)
final class HeytaWidgetModule: NSObject {

  private static let errNotJson = "E_WIDGET_NOT_JSON"
  private static let errInvalidEnvelope = "E_WIDGET_INVALID_ENVELOPE"
  private static let errWriteFailed = "E_WIDGET_WRITE_FAILED"

  /**
   懒加载 —— `WidgetCenter` 与 `UserDefaults(suiteName:)` 在模块构造期
   可能还没准备好（RN 会在启动早期实例化模块）。

   ⚠️ `push` 用 `reloadAllTimelines()` 而不是 `reloadTimelines(ofKind:)`：
   应用侧一轮刷新会换掉**全部四款**的快照，所以四款都该重画。
   （对比：组件上的**点击**只影响一款，那边用的是 `ofKind:`。）
   */
  private lazy var service = WidgetBridgeService(
    store: AppGroupWidgetStore(),
    keyStore: WidgetDeviceKeyStore(),
    push: { WidgetCenter.shared.reloadAllTimelines() }
  )

  @objc
  static func moduleName() -> String! { "HeytaWidget" }

  /// 模块的方法**不在**主队列上跑：写文件是 IO，不该阻塞 UI。
  /// 但 `WidgetCenter` 是线程安全的，所以这个选择是安全的。
  @objc
  static func requiresMainQueueSetup() -> Bool { false }

  // ─────────────────────────────────────────────────────────────
  // 五个方法
  // ─────────────────────────────────────────────────────────────

  @objc(setWidgetSnapshot:resolve:reject:)
  func setWidgetSnapshot(
    _ envelopeJson: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    do {
      try service.setWidgetSnapshot(envelopeJson)
      resolve(true)
    } catch let failure as WidgetBridgeService.Failure {
      let (code, message) = Self.classify(failure)
      reject(code, message, nil)
    } catch {
      reject(Self.errWriteFailed, "\(error)", error)
    }
  }

  @objc(drainIntentQueue:reject:)
  func drainIntentQueue(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // ⚠️ `nil` 而不是 `"[]"` —— "没有点击"与"有零条点击"在 JS 侧走不同分支。
    //    RN 会把 Swift 的 `nil` 映射成 JS 的 `null`。
    resolve(service.drainIntentQueue())
  }

  @objc(mergeIntentQueue:resolve:reject:)
  func mergeIntentQueue(
    _ pendingJson: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    do {
      resolve(try service.mergeIntentQueue(pendingJson))
    } catch {
      reject(Self.errWriteFailed, "\(error)", error)
    }
  }

  /// W5-2 · 读锁屏隐私偏好。⚠️ 返回 `nil` = 从来没设过（JS 侧归一成 `null`）。
  @objc(readWidgetPrivacy:reject:)
  func readWidgetPrivacy(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // 把 `Any?` 收成 `Bool?`：**只有真正的布尔才算数**。
    // 坏值（字符串 / 数字 / 整个对象不是字典）一律给 `nil`，让 JS 侧走"没设过"那条路，
    // 与 `WidgetPrivacyPreference.parse` 的处置一致 —— 那里也是**回落默认**，
    // 而不是"藏起来"。
    let raw = service.readPrivacyRaw() as? [String: Any]
    resolve(raw?["alwaysHideTitles"] as? Bool)
  }

  /// W5-2 · 写锁屏隐私偏好。
  @objc(setWidgetPrivacy:resolve:reject:)
  func setWidgetPrivacy(
    _ alwaysHideTitles: Bool,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    do {
      try service.setWidgetPrivacy(alwaysHideTitles: alwaysHideTitles)
      resolve(true)
    } catch {
      reject(Self.errWriteFailed, "\(error)", error)
    }
  }

  /// W5-3 · 推进灵动岛。返回结局字符串（见 `FocusActivityRefresh`）。
  @objc(syncFocusActivity:reject:)
  // 🔴 `resolve` 必须标 `@escaping`：下面 `Task { }` 的闭包是**逃逸**的
  //    （它在 `syncFocusActivity` 返回之后才跑），而 Swift 默认把函数参数
  //    当成非逃逸。不标就编译不过：
  //      `escaping closure captures non-escaping parameter 'resolve'`
  //    ⚠️ **这个错误此前一直没暴露** —— 因为只构建过 widget **扩展**（`HeytaWidgetCore`），
  //    而本文件在 **App target** 里，App 从来没被编译过。
  //    "扩展能构建"与"App 能构建"是两件事，这个桥在后者里。
  func syncFocusActivity(resolve: @escaping RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // ⚠️ `Task` 因为 `FocusActivityRefresh.syncNow()` 是 `async`。
    //    这里**不 reject** 任何东西 —— 那个函数契约是"永不抛"，
    //    拿不到结局就是 `"none"`，不该把一个附属功能变成红屏。
    Task {
      let outcome = await FocusActivityRefresh.syncNow()
      resolve(outcome.map(String.init(describing:)) ?? "none")
    }
  }

  @objc(clearWidgetState:reject:)
  func clearWidgetState(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    service.clearWidgetState()
    resolve(true)
  }

  @objc(sealWidgetSnapshot:dayStr:validUntil:resolve:reject:)
  func sealWidgetSnapshot(
    _ payloadJson: String,
    dayStr: String,
    validUntil: Double,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    do {
      resolve(try service.sealWidgetSnapshot(
        payloadJson: payloadJson,
        dayStr: dayStr,
        validUntil: validUntil
      ))
    } catch let failure as WidgetBridgeService.Failure {
      let (code, message) = Self.classify(failure)
      reject(code, message, nil)
    } catch {
      reject(Self.errWriteFailed, "\(error)", error)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 错误码映射
  // ─────────────────────────────────────────────────────────────

  /// 把桥接层的失败映射成**与 Android 同一套**错误码。
  ///
  /// ⚠️ 这个映射本身没有测试（它在这个 target 里）—— 所以它被写成了
  /// **穷尽 switch**：加了新的 `Failure` case 会**编译不过**，
  /// 而不是悄悄落进 `default` 变成一个含糊的码。
  private static func classify(_ failure: WidgetBridgeService.Failure) -> (String, String) {
    switch failure {
    case .notJson(let detail):
      return (errNotJson, detail)
    case .invalidEnvelope(let reason, let detail):
      // 契约的拒绝原因**原样**带出去（`unknown-version` / `null-project-id` …），
      // 这样应用侧日志里的词与 TS 侧、与组件侧是同一套。
      return (errInvalidEnvelope, "\(reason): \(detail)")
    case .writeFailed(let detail):
      return (errWriteFailed, detail)
    case .sealFailed(let detail):
      return (errWriteFailed, detail)
    }
  }
}
