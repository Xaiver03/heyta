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
 * `apps/mobile/tests/card-export.spec.ts` 有一条把"这三处名字对齐"钉住
 * （JS 的 `MODULE_NAME` / Swift 的 `moduleName()` / 这里的 JS 名）。
 *
 * ## 🔴 为什么这里是 `REMAP` 而不是 `RCT_EXTERN_MODULE`（04 10:0x 真机量出来的）
 *
 * `RCT_EXTERN_MODULE(a, b)` 展开成 `RCT_EXTERN_REMAP_MODULE(, a, b)` ——
 * **第一个参数（JS 名）是空的**，而 `RCT_EXPORT_MODULE_NO_LOAD` 里那句
 * `+moduleName { return @#js_name; }` 于是拿到一个空串。
 * 结果：JS 侧 `NativeModules.HeytaCardExport` 是 `undefined`，
 * 而 Swift 自己那个 `moduleName()` 被这条分类方法**盖掉**（ObjC 分类优先于类方法）。
 *
 * 现场读数（`heyta-batch2-closeout` 模拟器，载体 `198603f5` 的 app + 只换 bundle 的 JS）：
 * 在 `useCardExporter` 挂载处直接调 `writeCardPng('dbg-M-ios.txt', …)`，
 * **不经过任何点击、不经过 react-native-svg**，30 秒后沙盒 `tmp/card-export/` 仍是空的；
 * 而同一次运行里界面上出现了 `倒数纪念日·DIAG` ⇒ 换进去的 bundle 确实在跑。
 * ⇒ 落不了盘的原因在我们这条桥的名字上，不在 RNSVG。
 *
 * 同仓四座 iOS 桥里只有 `HeytaVaultSecureStorage` 侥幸对得上（JS 名 == 类名）；
 * `HeytaWidget` / `HeytaReminder` 与这里原来是同一个形状（已按编号登记，见计划 §8.4）。
 *
 * ## 这个文件必须真的进 target
 *
 * ⚠️ 忘了加进 Compile Sources 不会有任何编译错误，只会让模块不存在 ——
 * 小组件那一格踩过（账本 W2-2 / U10），所以 `scripts/check-card-export.mjs` 数这一条。
 */
@interface RCT_EXTERN_REMAP_MODULE(HeytaCardExport, HeytaCardExportModule, NSObject)

RCT_EXTERN_METHOD(writePngBase64:(NSString *)fileName
                  base64:(NSString *)base64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
