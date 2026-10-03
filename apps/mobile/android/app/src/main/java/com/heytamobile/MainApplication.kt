package com.heytamobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.heytamobile.fs.LocalFsPackage
import com.heytamobile.widget.WidgetPackage
import com.heytamobile.reminder.ReminderPackage
import com.heytamobile.vault.VaultSecureStoragePackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          //
          // 小组件的原生模块（W1-2）。它必须手动注册：本模块在 app 工程内，
          // 不是 node_modules 里的库，autolinking 看不到它。
          // ⚠️ 忘了这一行的症状是 JS 侧 `NativeModules.HeytaWidget` 为 undefined ——
          //    而 `widget-bridge.ts` 会**安静地降级**，表现为"小组件永远不更新"，
          //    不会有任何红。
          add(WidgetPackage())
          // 本机文件读取（备份还原的"选文件"这条路）。同样在 app 工程内，
          // autolinking 看不到它。⚠️ 忘了这一行时 JS 侧拿到 undefined，
          // 界面会显示"这台设备读不了本地文件" —— 是响亮的，不会静默。
          add(LocalFsPackage())
          add(ReminderPackage())
          // Vault root keys are opt-in persisted only through OS secure storage.
          // This module is separate from the widget's device-key alias/cache.
          add(VaultSecureStoragePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
