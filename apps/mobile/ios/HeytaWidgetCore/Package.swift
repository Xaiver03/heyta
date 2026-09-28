// swift-tools-version: 6.0
import PackageDescription

/**
 heyta 小组件的 **Swift 侧**（W2）。
 ====================================

 ## 🔴 为什么核心逻辑在**独立 SwiftPM 包**里，而不是直接写进 Xcode target

 因为**独立包能在本机跑 `swift test`** —— 不需要模拟器、不需要 iOS 开发者账号、
 不需要签名。而这恰好是 W2 里最大的一类风险所在：

 | 这一层的错误 | 在 Xcode target 里的后果 | 在这里的后果 |
 |---|---|---|
 | AES-GCM 的 AAD 拼错 | 要装到真机、加组件、看到"没有数据"才可能发现 | **一条单测就红** |
 | 信封/载荷解析与 TS 分叉 | 同上 | **读同一份黄金夹具，一条单测就红** |
 | 过期判定写反 | 组件显示昨天的任务，**看起来是对的** | **一条单测就红** |

 所以：**平台无关的判断全部放进这个包**，`HeytaWidgetExtension` 只是薄薄一层
 SwiftUI + WidgetKit 的接线。这与 Android 侧 "判断全在 `*ModelBuilder`、
 视图层只做照着抄" 是同一条纪律 —— 只不过 Android 那边 `RemoteViews` 在 JVM 上是桩，
 只能在**单元测试**里覆盖判断；这边 SwiftUI 能编译，判断仍然放这里。

 ## 三个 target

 | target | 依赖 | 能在本机验证吗 |
 |---|---|---|
 | `HeytaWidgetCore` | Foundation + CryptoKit | ✅ `swift test` |
 | `HeytaWidgetUI` | SwiftUI | ✅ `swift build`（**编译**，不是运行） |
 | `HeytaWidgetExtension` | WidgetKit + SwiftUI | ✅ `swift build`（**编译**，不是运行） |

 ⚠️ `swift build` 通过**不等于**组件在设备上能显示。它证明的是"类型与 API 用法成立"，
 不证明 `NSExtension` 配置、App Group 授权、时间线刷新策略、真机渲染。
 那条界线与本仓库 §7「构建成功 ≠ 产物是新的」是同一种谨慎：**把"证明了什么"说清楚**。

 ⚠️ 平台版本：iOS 17 / macOS 14。iOS 17 是**交互式组件**（`Button(intent:)` / App Intent）
 的最低版本；app 本身保持 15.1（见 W2 计划）。
 本机是 macOS 27，所以两个平台的编译都能跑。
 */
let package = Package(
    name: "HeytaWidgetCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
        // W5-1 · watchOS 10 是 `containerBackground(for: .widget)` 的最低版本。
        // ⚠️ 只加平台**不会**让代码自动能跑 —— `HeytaWidgetWatch` 里仍然要
        //    按 watch 的家族（只有 accessory 系）另写配置，见那里的文件头。
        .watchOS(.v10),
    ],
    products: [
        .library(name: "HeytaWidgetCore", targets: ["HeytaWidgetCore"]),
        .library(name: "HeytaWidgetUI", targets: ["HeytaWidgetUI"]),
        .library(name: "HeytaWidgetKit", targets: ["HeytaWidgetKit"]),
        .library(name: "HeytaWidgetBridge", targets: ["HeytaWidgetBridge"]),
        .library(name: "HeytaWidgetWatch", targets: ["HeytaWidgetWatch"]),
    ],
    targets: [
        // 平台无关：解析、解密、过期判定、四款组件的渲染模型。**零第三方依赖。**
        .target(name: "HeytaWidgetCore"),

        // 四款组件的 SwiftUI 视图。
        .target(name: "HeytaWidgetUI", dependencies: ["HeytaWidgetCore"]),

        // WidgetKit 接线：`@main` bundle、TimelineProvider、App Group 读取。
        .target(name: "HeytaWidgetKit", dependencies: ["HeytaWidgetCore", "HeytaWidgetUI"]),

        // W5-1 · watchOS 的组件接线。**复用 `HeytaWidgetUI` 与 `HeytaWidgetCore`** ——
        // 手表上没有"另一套 UI"，只有另一套**家族与其约束**。
        .target(
            name: "HeytaWidgetWatch",
            dependencies: ["HeytaWidgetCore", "HeytaWidgetUI"],
            // watchOS 上 `WidgetKit` 是系统框架，不需要显式链接声明，
            // 但 `swift build` 需要知道这个 target 只在 watch 上编。
            // SwiftPM 按 `platforms` 决定，这里不用再写。
        ),

        // RN 桥接的**逻辑**。刻意不依赖 WidgetKit / React ——
        // 这样它能在 `swift test` 里跑，而 app target 里只剩十行转发。
        .target(name: "HeytaWidgetBridge", dependencies: ["HeytaWidgetCore"]),

        .testTarget(name: "HeytaWidgetCoreTests", dependencies: ["HeytaWidgetCore", "HeytaWidgetBridge"]),
    ]
)
