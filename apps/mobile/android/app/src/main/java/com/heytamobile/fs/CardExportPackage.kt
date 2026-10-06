package com.heytamobile.fs

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * 把 [CardExportModule] 注册进 RN。
 *
 * 与 `LocalFsPackage` / `WidgetPackage` 同一个形状、同样的理由：本工程
 * `newArchEnabled=true`，`ReactPackage.createNativeModules` 已被 `BaseReactPackage`
 * override 成抛异常，所以走 `getModule` + `getReactModuleInfoProvider`。
 *
 * ⚠️ 忘了在 `MainApplication` 里 `add(CardExportPackage())` 的症状与那两个模块一样：
 * JS 侧 `NativeModules.HeytaCardExport` 是 `undefined`。JS 侧因此**必须**把它
 * 当成一个会显示的失败（"这台设备导不出图"），不许降级成"点了没反应"。
 */
class CardExportPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == CardExportModule.NAME) CardExportModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            CardExportModule.NAME to ReactModuleInfo(
                /* name = */ CardExportModule.NAME,
                /* className = */ CardExportModule::class.java.name,
                /* canOverrideExistingModule = */ false,
                /* needsEagerInit = */ false,
                /* isCxxModule = */ false,
                /* isTurboModule = */ false,
            )
        )
    }
}
