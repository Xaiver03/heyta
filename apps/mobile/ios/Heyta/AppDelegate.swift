import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current().setNotificationCategories([
      UNNotificationCategory(identifier: HeytaReminderReceipts.category, actions: [],
        intentIdentifiers: [], options: [.customDismissAction])
    ])
#if DEBUG
    if let stage = ProcessInfo.processInfo.arguments.drop(while: { $0 != "-HEYTA_KEYCHAIN_PROBE" }).dropFirst().first {
      HeytaVaultSecureStorage.runProbe(stage: stage)
    }
#endif
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if notification.request.content.categoryIdentifier == HeytaReminderReceipts.category {
      do { try HeytaReminderReceipts.observe([notification.request.identifier]) }
      catch { NSLog("[reminder] Failed to persist foreground receipt") }
    }
    completionHandler([.banner, .sound, .badge])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if response.notification.request.content.categoryIdentifier == HeytaReminderReceipts.category {
      do { try HeytaReminderReceipts.observe([response.notification.request.identifier]) }
      catch { NSLog("[reminder] Failed to persist interaction receipt") }
    }
    completionHandler()
  }

  /// 🔴 iOS 26+ SDK 构建强制 UIScene 生命周期（见 SceneDelegate.swift 文件头）。
  /// 场景配置在这里发，窗口的创建与 RN 的挂载在 SceneDelegate 里做。
  func application(
    _ application: UIApplication,
    configurationForConnecting sceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Default", sessionRole: sceneSession.role)
    config.delegateClass = SceneDelegate.self
    return config
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
