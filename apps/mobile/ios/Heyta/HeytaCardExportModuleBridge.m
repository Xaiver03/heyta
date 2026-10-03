#import <React/RCTBridgeModule.h>

/**
 * `HeytaCardExportModule` 的 ObjC 声明（W7 成品图落盘）。
 *
 * ## 为什么必须有这个 `.m`（道理与 `HeytaWidgetModuleBridge.m` 完全一样）
 *
 * `RCT_EXPORT_MODULE()` 是 C 宏，Swift 里没有宏 —— 纯 Swift 的
 * `RCTBridgeModule` 实现**不会**被 `RCTBridge` 找到，所以要在这里
 * `RCT_EXTERN_MODULE` + 逐方法 `RCT_EXTERN_METHOD` 声明一遍。
 *
 * ## 🔴 两边的选择器必须逐字符对齐
 *
 * 下面这一行对应 Swift 的
 * `@objc(writePngBase64:base64:resolve:reject:)`。
 *
 * **对不上的后果不是编译错** —— 两边各自都合法。症状是
 * `NativeModules.HeytaCardExport.writePngBase64` 是 `undefined`，
 * 而 JS 那一层把它归成一档 `no-module`，界面说"这台设备导不出图"。
 * 那句话在这个形状下是**误导**：设备能导，是接线错了。
 * `scripts/check-card-export.mjs` 有一条把"这三处名字对齐"钉住
 * （JS 的 `MODULE_NAME` / Swift 的 `moduleName()` / 这里的第一个参数）。
 *
 * ## 这个文件必须真的进 target
 *
 * ⚠️ 忘了加进 Compile Sources 不会有任何编译错误，只会让模块不存在 ——
 * 小组件那一格踩过（账本 W2-2 / U10），所以门禁也数这一条。
 */
@interface RCT_EXTERN_MODULE(HeytaCardExportModule, NSObject)

RCT_EXTERN_METHOD(writePngBase64:(NSString *)fileName
                  base64:(NSString *)base64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
