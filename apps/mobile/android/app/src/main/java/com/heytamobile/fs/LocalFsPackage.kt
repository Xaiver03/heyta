package com.heytamobile.fs

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * 把 [LocalFsModule] 注册进 RN。
 *
 * 与 `WidgetPackage` 同一个形状、同样的理由：本工程 `newArchEnabled=true`，
 * `ReactPackage.createNativeModules` 已被 `BaseReactPackage` override 成抛异常，
 * 所以走 `getModule` + `getReactModuleInfoProvider`。
 * `isTurboModule = false` 是刻意的 —— 不接 codegen，靠旧式 interop，
 * 一个方法不值得为此多一条会漂移的生成链。
 */
class LocalFsPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == LocalFsModule.NAME) LocalFsModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            LocalFsModule.NAME to ReactModuleInfo(
                /* name = */ LocalFsModule.NAME,
                /* className = */ LocalFsModule::class.java.name,
                /* canOverrideExistingModule = */ false,
                /* needsEagerInit = */ false,
                /* isCxxModule = */ false,
                /* isTurboModule = */ false,
            )
        )
    }
}
