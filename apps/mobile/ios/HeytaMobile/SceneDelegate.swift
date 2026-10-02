/**
 * UIScene 生命周期（2026-10-02 补）。
 *
 * 🔴 iOS 26+ SDK 构建的应用在 UIKit 27 运行时上**必须**采用场景生命周期，
 * 否则启动即被拒（实测日志：
 * `Application failed to launch: UIScene life cycle is required for apps
 * built with this SDK`），症状是纯黑屏、进程活着 —— 界面级判据全红而构建全绿。
 * 单场景 iPhone 应用：窗口仍只有一个，只是把"创建 UIWindow + 喂给 RN 工厂"
 * 这两步从 AppDelegate 挪进场景代理。
 */
import UIKit
import React_RCTAppDelegate

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard
      let app = UIApplication.shared.delegate as? AppDelegate,
      let factory = app.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    window.makeKeyAndVisible()
    // launchOptions 传 nil：场景化后冷启动信息在 connectionOptions 里，
    // RN 0.84 的工厂签名只吃 app 级 launchOptions（可空），深链冷启动
    // 由 RN 自己的 Linking 事件路径覆盖。
    factory.startReactNative(withModuleName: "heyta", in: window, launchOptions: nil)
  }
}
