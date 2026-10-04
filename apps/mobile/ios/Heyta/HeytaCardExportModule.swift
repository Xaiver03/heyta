import Foundation
import React

/**
 * 把一段 base64 PNG 写进沙盒的临时目录，回一个 `file://` URI（W7 成品图落盘）。
 *
 * ## 为什么需要它（与 Android 那份 `CardExportModule.kt` 同一个理由）
 *
 * `react-native-svg` 的原生 `toDataURL` 能出图，但交回来的是 base64 字符串，
 * 而 `Share` 的 `url` 分支要**真实文件 URI**。RN 核心里没有 `FileSystem`。
 * 取证见 `docs/plans/countdown-w7-device-export.md` §2.3。
 *
 * ## 🔴 零新增权限
 *
 * 写**自己沙盒**的临时目录不需要任何权限声明，所以
 * `packages/legal/src/documents/permissions.ts` 那句"heyta 不申请 … 照片 … 权限"
 * 继续逐字为真。这条路刻意**不**走相册（`PHPhotoLibrary`）—— 那要加权限，
 * 而加权限就是把对外承诺改掉。
 *
 * ## 与 JS / Android 两侧的对账
 *
 * | 对 | 必须一致的地方 |
 * |---|---|
 * | JS `card-export-native.ts` | `moduleName()` 的返回值 == JS 的 `MODULE_NAME` == `'HeytaCardExport'`；选择器 `writePngBase64:base64:resolve:reject:` == `.m` 里那行 `RCT_EXTERN_METHOD` |
 * | Android `CardExportModule.kt` | 语义一致（同码同因），但**URI 形态允许不同**：Android 是 `content://`（FileProvider），iOS 是 `file://`（沙盒临时目录）。`Share` 两端各认各的，所以这不要求逐字相同 |
 *
 * ⚠️ 这三份对不上时的症状是本仓最熟的那种：JS 拿到 `undefined` 或"方法不存在"，
 * 界面显示"这台设备导不出图" —— 而**真正的原因是接线忘了**。所以 JS 侧那一档
 * 是响亮的一句话，不是一句"不支持"。
 *
 * ⚠️ 另有一条会静默的：这两个文件必须**加进 `Heyta` target 的 Compile Sources**，
 * 忘了不会报编译错，只会让模块不存在（账本 W2-2 / U10 记的就是小组件那一格）。
 * `scripts/check-card-export.mjs` 里有一条专门数 pbxproj。
 */
/// 与 Android 那份 `DIR_NAME`、`card_export_paths.xml` 里的 `path` 同名，
/// 但**不要求逐字相同**：Android 那个名字要进 FileProvider 白名单，这个只是沙盒里的子目录。
/// 写成文件级私有常量而不是 `static let`：实例方法里不带类型名引用静态成员会被编译器拦下。
private let kHeytaCardExportDirName = "card-export"

@objc(HeytaCardExportModule)
final class HeytaCardExportModule: NSObject {

  @objc
  static func moduleName() -> String! { "HeytaCardExport" }

  @objc
  static func requiresMainQueueSetup() -> Bool { false }

  /// 文件名字节都留在 JS 侧决定（那标题是用户起的，规则是产品语义）；
  /// 这里只做一件事：不许逃出沙盒。
  @objc(writePngBase64:base64:resolve:reject:)
  func writePngBase64(_ fileName: String, base64: String,
                      resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    let leaf = (fileName as NSString).lastPathComponent
    if leaf.isEmpty || leaf == "." || leaf == ".." || leaf.contains("..") {
      reject("BAD_NAME", "非法文件名：\(fileName)", nil)
      return
    }
    guard let data = Data(base64Encoded: base64, options: []) else {
      reject("BAD_BASE64", "base64 解不开", nil)
      return
    }
    if data.isEmpty {
      reject("EMPTY_BYTES", "栅格化返回了零字节", nil)
      return
    }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(kHeytaCardExportDirName)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let file = dir.appendingPathComponent(leaf)
      try data.write(to: file, options: .atomic)
      resolve(file.absoluteString)
    } catch {
      reject("WRITE_FAILED", error.localizedDescription, error)
    }
  }

}
