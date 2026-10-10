// swift-tools-version:6.0
import PackageDescription

// macOS 原生壳（SwiftUI）。分层与 Windows 那边**刻意同构**：
//
//   HeytaShellCore/  跨平台可测的核心：同步 SqliteDriver + JS 引擎宿主 + 窄 API
//   heyta-smoke/     无头冒烟：不开窗，只验"跨语言那一层 + 真的落盘"
//   HeytaMac/        SwiftUI 窗口（只有它需要图形会话）
//
// 🔴 为什么 macOS 这条路比 Windows 那条**更省**：
//    JavaScriptCore 与 libsqlite3 都是 **macOS 自带**的 —— 不需要引第三方依赖，
//    也不需要像 Jint/Microsoft.Data.Sqlite 那样进 NuGet 许可证清单。
//    而且它加载的是**同一个** bridge-bundle/native-bridge.js，
//    所以"业务与存储只有一份"这条约束在 macOS 上自动成立。
let package = Package(
    name: "HeytaMac",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "../mobile/ios/HeytaWidgetCore")],
    targets: [
        .target(
            name: "HeytaShellCore",
            linkerSettings: [
                .linkedFramework("JavaScriptCore"),
                .linkedLibrary("sqlite3"),
            ]
        ),
        .executableTarget(
            name: "heyta-smoke",
            dependencies: ["HeytaShellCore"]
        ),
        // SwiftUI 窗口。只有它需要图形会话 —— 所以核心与冒烟都不依赖它。
        // ⚠️ UI 的适配与统一**不在这里**（那是另一条线在做）。这个窗口只负责
        //    "证明原生壳搭起来了、数据真的从共享 TS 那一侧过来了"。
        .executableTarget(
            name: "HeytaMac",
            dependencies: ["HeytaShellCore", .product(name: "HeytaWidgetBridge", package: "HeytaWidgetCore")]
        ),
    ]
)
