package com.heytamobile.widget

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * 把 [WidgetModule] 注册进 RN。
 *
 * ## 为什么继承 `BaseReactPackage` 而不是实现 `ReactPackage`
 *
 * 本工程 `newArchEnabled=true`（见 `gradle.properties`），`MainApplication` 用的是
 * `getDefaultReactHost` + `PackageList`。在 RN 0.84 上：
 *
 *   - `ReactPackage.createNativeModules` 已被标记 **deprecated**；
 *   - `BaseReactPackage` **直接把它 override 成抛 `UnsupportedOperationException`**
 *     （"Use getModule() method instead"）。
 *
 * 所以走 `getModule` + `getReactModuleInfoProvider` 这条。下面 `isTurboModule = false`
 * 是刻意的：本模块**不接 codegen**，靠旧式 interop 工作。要做成真 TurboModule
 * 就得加 `codegenConfig`、生成 spec 并让 JS 侧也生成 —— 对三个方法来说是纯粹的负担，
 * 而且**任何一个平台的 codegen 漂移都会变成"模块找不到"**这种很难查的症状。
 */
class WidgetPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == WidgetModule.NAME) WidgetModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            WidgetModule.NAME to ReactModuleInfo(
                /* name = */ WidgetModule.NAME,
                /* className = */ WidgetModule::class.java.name,
                /* canOverrideExistingModule = */ false,
                /* needsEagerInit = */ false,
                /* isCxxModule = */ false,
                /* isTurboModule = */ false,
            )
        )
    }
}
