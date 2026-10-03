package com.heytamobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.heytamobile.fs.CardExportPackage
import com.heytamobile.fs.LocalFsPackage
import com.heytamobile.widget.WidgetPackage

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
          // 成品图落盘（W7 设备出图）。栅格化由 react-native-svg 的原生模块做，
          // 这里补的是"base64 → 能被分享的文件"那一环。
          // ⚠️ 忘了这一行时 `NativeModules.HeytaCardExport` 是 undefined，
          //    JS 侧必须把它当成**会显示的失败**（"这台设备导不出图"），不许静默。
          add(CardExportPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
