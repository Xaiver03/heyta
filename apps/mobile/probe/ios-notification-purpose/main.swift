// iOS 通知**目的串**取证探针（交付项 4）。
//
// 要回答的问题只有一个：`Info.plist` 里那枚 `NSUserNotificationsUsageDescription`
// 到底会不会被系统读进授权弹窗。Apple 的 Info.plist 键表里没有这一枚
//（它有 `NSContactsUsageDescription` 那一族，却没有通知的对应物），
// 而"文档没写"不等于"系统不读" —— 所以这里不靠记忆下结论，靠屏幕上那一帧。
//
// 🔴 判据的形状：把那一枚键的值设成一枚**唯一、可逐字辨认的暗号**
//（`PURPOSE_MARKER`），弹窗起来后截图。
// ⚠️ 但**一轮截图只配得上"出现过"这个断言**：同一台模拟器、同一枚二进制、同一份 plist，
//    2026-10-24 实测到弹窗正文**两种形态都出现过** —— 一轮逐字是暗号，另一轮是 Apple 的
//    固定句式（"通知可能包括提醒、声音和图标标记…"）。
//    所以这套装置的合法结论只有"这枚键**有时**会被渲染成正文"，
//    不许写成"iOS 会显示我们的目的说明"。详见 §7 #547、#548 与
//    `apps/mobile/evidence/ios-notification-purpose-20261024/README.md`。
// ⚠️ 不许用"应用自己的句子"当暗号 —— 那会在弹窗里被认成 app 名而假绿。
import UIKit
import UserNotifications

/// 读数**同时**写标准输出和沙盒 `Documents/heyta-probe.txt`。
///
/// 🔴 为什么要落文件：取证跑法原先只能靠 `simctl launch --stdout=<file>` 拿读数，
///    而那条命令在装置里稳定报 `FBSOpenApplicationServiceErrorDomain code=3`
///    "Process failed to launch"（同一枚包在 shell 里手敲同样的参数却能起 ——
///    也就是说**失败原因没定论**，但这条通道已经证明不可靠）。
///    读数改走容器文件后，起应用不再需要任何重定向参数，"读不到日志"和
///    "应用没起来"不再是同一个失败形状。
///    文件在应用容器里，`uninstall` 会连带清掉 ⇒ 每轮天然从空文件开始，读不到上一轮。
func report(_ line: String) {
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    if let url = documents?.appendingPathComponent("heyta-probe.txt") {
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write((line + "\n").data(using: .utf8)!)
            try? handle.close()
        } else {
            try? (line + "\n").data(using: .utf8)?.write(to: url)
        }
    }
}

func requestAuthorizationOnce() {
    // 🔴 先落一发**不依赖任何异步服务**的读数：`getNotificationSettings` 走的是
    //    usernoted，全新冷启的设备上它可能几十秒都不应答（2026-10-24 实测：
    //    新建设备上 scene 跑了、文件写得进，`PROBE_STATUS_BEFORE` 却一直没来）。
    //    原先把申请套在这次读回的**回调里**，于是"服务没应答"直接变成"没有弹窗"，
    //    会被读成"系统不读那枚键" —— 一枚会造假结论的装置比没有装置更糟。
    report("PROBE_SCENE_RAN=1")

    // 申请**不等**前置读回，直接发；前置状态改成并行尽力读，读到就记，读不到也只是缺一项。
    UNUserNotificationCenter.current().getNotificationSettings { settings in
        report("PROBE_STATUS_BEFORE=\(settings.authorizationStatus.rawValue)")
    }
    let options: UNAuthorizationOptions = [.alert, .sound]
    UNUserNotificationCenter.current().requestAuthorization(options: options) { granted, error in
        report("PROBE_AUTH_GRANTED=\(granted) PROBE_ERROR=\(error?.localizedDescription ?? "none")")
        UNUserNotificationCenter.current().getNotificationSettings { after in
            report("PROBE_STATUS_AFTER=\(after.authorizationStatus.rawValue)")
        }
    }
}

/// 🔴 这枚 scene 是**取证装置的一部分**，不是模板冗余：
/// 没有 scene 生命周期的应用在这台 iOS 27.1 模拟器上起来 1.4 秒就被系统判成
/// 非活跃（`log show` 里是 UIKit:Application 的 `Deactivation reason added: 10`
/// → 1024，随后 backboardd `connection invalidated`），屏幕停在桌面 ⇒
/// 授权弹窗根本没机会渲染。那种"截图里没有那串"会被误读成"系统不读这枚键"，
/// 是一枚会造**假结论**的装置，比没有装置更糟。
@objc(SceneDelegate)
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let root = UIViewController()
        root.view.backgroundColor = .systemBackground
        window.rootViewController = root
        window.makeKeyAndVisible()
        self.window = window
        requestAuthorizationOnce()
    }
}

@objc(AppDelegate)
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "heyta-probe", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
