#import <React/RCTBridgeModule.h>

/**
 Swift 类在这个工程里**不能**只靠 `@objc` 被 RN 发现。
 ==========================================================

 ## 🔴 为什么必须有这个 `.m` 文件

 `RCT_EXPORT_MODULE()` 是一个 **C 宏**，而 Swift 里没有宏 ——
 所以纯 Swift 的 `RCTBridgeModule` 实现**不会**被 `RCTBridge` 找到。

 官方的 Swift 配方就是用一对文件：
 - `.swift` 里写实现，类加上 `@objc(HeytaWidgetModule)` 让它有稳定的 ObjC 名字；
 - `.m` 里用 `RCT_EXTERN_MODULE` / `RCT_EXTERN_METHOD` **声明**它。

 ## ⚠️ 两边的选择器必须逐字符对齐

 `.m` 里的 `RCT_EXTERN_METHOD(setWidgetSnapshot:(NSString *)envelopeJson resolve:...)`
 对应 Swift 的 `@objc(setWidgetSnapshot:resolve:reject:)`。

 **对不上的后果不是编译错误**（两者各自都合法），而是运行时
 `NativeModules.HeytaWidget.setWidgetSnapshot` 是 `undefined` ——
 而 JS 侧把"模块/方法不存在"降级成了"没有小组件支持"，
 所以症状是**小组件功能静默失效**，连一条日志都没有。

 ⚠️ 这也是为什么这个文件**只声明转发**：声明错了没有编译器帮你，
 所以这里的东西越少越好。（逻辑全在 `HeytaWidgetBridge`，81 条单测覆盖。）

 ## 未接线

 这个文件与 `HeytaWidgetModule.swift` **还没有加进 Xcode target**（见账本 W2-2 / U10）：
 需要
 1. 把两个文件加入 `Heyta` target 的 Compile Sources；
 2. 让 `Heyta` target 链接本地的 `HeytaWidgetCore` SwiftPM 包；
 3. 两个 target 都开 App Group 能力，bundle id 改成 `com.heyta.mobile[.WidgetExtension]`。
 */

/*
 * 🔴 必须是 `REMAP`，不能是 `RCT_EXTERN_MODULE`。
 *
 * `RCT_EXTERN_MODULE(HeytaWidgetModule, …)` 把 **JS 侧的名字**也定成了
 * `HeytaWidgetModule`，而 `widget-bridge.ts` 取的是 `NativeModules.HeytaWidget` ——
 * 于是那个属性恒为 `undefined`，而 JS 把"模块不存在"降级成"这台设备没有小组件支持"，
 * 症状是**静默失效**（仅一条 warn）。Swift 的 `moduleName()` 也救不了：
 * `RCT_EXTERN_MODULE` 生成的 `+moduleName` 分类会盖掉 Swift 那一版。
 * `REMAP(js_name, objc_class, parent)` 才是"类名与 JS 名分开"的那条通道
 * （与 `HeytaReminderModuleBridge.m` 同一个修法，见计划 W7-G8）。
 */
@interface RCT_EXTERN_REMAP_MODULE(HeytaWidget, HeytaWidgetModule, NSObject)

RCT_EXTERN_METHOD(setWidgetSnapshot:(NSString *)envelopeJson
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(drainIntentQueue:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(ackIntentQueue:(NSString *)processedJson
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(mergeIntentQueue:(NSString *)pendingJson
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearWidgetState:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sealWidgetSnapshot:(NSString *)payloadJson
                  dayStr:(NSString *)dayStr
                  validUntil:(double)validUntil
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setWidgetLocale:(NSString *)locale
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
