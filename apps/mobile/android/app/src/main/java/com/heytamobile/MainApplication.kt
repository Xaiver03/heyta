package com.heytamobile

import android.app.Application
import android.content.res.Configuration
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.heytamobile.fs.CardExportPackage
import com.heytamobile.fs.LocalFsPackage
import com.heytamobile.widget.WidgetPackage
import com.heytamobile.widget.WidgetRefresh
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
          // 成品图落盘（W7 设备出图）。栅格化由 react-native-svg 的原生模块做，
          // 这里补的是"base64 → 能被分享的文件"那一环。
          // ⚠️ 忘了这一行时 `NativeModules.HeytaCardExport` 是 undefined，
          //    JS 侧必须把它当成**会显示的失败**（"这台设备导不出图"），不许静默。
          add(CardExportPackage())
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

  /**
   * 小组件颜色资源由 `values/` 与 `values-night/` 提供。
   *
   * Android 官方说明见 `https://developer.android.com/reference/android/content/Intent#ACTION_CONFIGURATION_CHANGED`：
   * 这是只能由系统发送的受保护 intent，不能把它当成 manifest receiver 的可靠刷新入口。
   * Application 配置回调的官方契约见
   * `https://developer.android.com/reference/android/app/Application#onConfigurationChanged(android.content.res.Configuration)`：
   * Application 的配置
   * 回调是应用进程已经存活时的可靠入口；组件本身则在宿主重新充气 RemoteViews
   * 时按宿主当前 configuration 重新解析应用资源。两条路径合起来覆盖：
   *   1. heyta 进程存活：这里立即把四款现有实例重画；
   *   2. 进程未存活：宿主重充气 RemoteViews 时直接选 values-night 资源。
   *
   * 这里不把业务数据或 op 写入小组件，只复用已有的 WidgetRefresh 渲染管线。
   */
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    try {
      WidgetRefresh.pushAll(this)
    } catch (_: Throwable) {
      // 配置变化不能让应用进程因为小组件刷新失败而崩溃；下一次应用写入或宿主刷新会重试。
    }
  }
}
