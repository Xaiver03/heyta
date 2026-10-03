package com.heytamobile.vault

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Manual registration is required because this module lives in the app project. */
class VaultSecureStoragePackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == VaultSecureStorageModule.NAME) VaultSecureStorageModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            VaultSecureStorageModule.NAME to ReactModuleInfo(
                VaultSecureStorageModule.NAME,
                VaultSecureStorageModule::class.java.name,
                false,
                false,
                false,
                false,
            ),
        )
    }
}
