// ocr —— 把一张 PNG 里的文字读出来。
//
// 为什么需要它：
//   macOS 的 **AX 只能看见「当前 Space」上的窗口**（AGENTS §7 第 37 条）。
//   模拟器窗口一到别的桌面，AX 树里就只剩菜单栏 —— 而 `mac shot` 截那个窗口**照样能截到**。
//   所以后台验收的读路径是 **截图 → OCR**，写路径是 **postToPid**（`mac op` / `mac click ... bg`）。
//   全程不需要窗口可见、不需要焦点、不需要辅助功能权限。
//
// 用 Vision（系统框架），不引第三方依赖 —— 许可证那道门直接不用走。
//
// 用法：
//   ocr <图片路径>              每行一条识别结果（按自上而下、自左而右排序）
//   ocr <图片路径> --json       带文字的坐标与置信度
//   ocr <图片路径> --min-conf 0.5
//
// 退出码：0 = 读到了至少一行；1 = 一行都没读到；2 = 用法/图片读不出来。
//
// 🔴 "一行都没读到" 必须与 "图片里本来就没字" 区分得开：那两种情况的排查方向完全不同。
//    所以这里把「图片能不能解码」和「解码了但没字」分成两个退出码。

import Foundation
import Vision
import CoreGraphics
import ImageIO
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("用法: ocr <图片路径> [--json] [--min-conf 0.0]\n".data(using: .utf8)!)
    exit(2)
}
let path = args[1]
var asJSON = false
var minConf: Float = 0.0
var i = 2
while i < args.count {
    switch args[i] {
    case "--json": asJSON = true
    case "--min-conf":
        i += 1
        if i < args.count { minConf = Float(args[i]) ?? 0.0 }
    default:
        FileHandle.standardError.write("未知参数: \(args[i])\n".data(using: .utf8)!)
        exit(2)
    }
    i += 1
}

let url = URL(fileURLWithPath: path)
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    // 图片本身就读不出来 —— 和"图里没字"不是一回事
    FileHandle.standardError.write("图片无法解码: \(path)\n".data(using: .utf8)!)
    exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
// 关掉语言纠正：界面上的「已是最新」「当前离线」这类短语不能被"纠"成别的词
request.usesLanguageCorrection = false
// 中文简体优先，英文兜底（地址栏、令牌那类）
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("OCR 执行失败: \(error)\n".data(using: .utf8)!)
    exit(2)
}

struct Line { let text: String; let conf: Float; let x: Double; let y: Double; let w: Double; let h: Double }

var lines: [Line] = []
for obs in (request.results ?? []) {
    guard let top = obs.topCandidates(1).first else { continue }
    if top.confidence < minConf { continue }
    let b = obs.boundingBox   // 归一化，原点在左下角
    lines.append(Line(text: top.string, conf: top.confidence,
                      x: Double(b.minX), y: Double(b.minY),
                      w: Double(b.width), h: Double(b.height)))
}

if lines.isEmpty {
    // 解码成功但一个字都没有
    exit(1)
}

// Vision 的原点在左下角，屏幕坐标原点在左上角 —— y 要翻过来再排，才是"从上往下"
lines.sort { a, b in
    let ay = 1.0 - a.y, by = 1.0 - b.y
    if abs(ay - by) > 0.012 { return ay < by }   // 同一行的容差
    return a.x < b.x
}

let out = FileHandle.standardOutput
if asJSON {
    let objs: [[String: Any]] = lines.map {
        ["text": $0.text, "conf": Double($0.conf), "x": $0.x, "y": 1.0 - $0.y, "w": $0.w, "h": $0.h]
    }
    let data = try! JSONSerialization.data(withJSONObject: objs, options: [.prettyPrinted, .sortedKeys])
    out.write(data)
    out.write("\n".data(using: .utf8)!)
} else {
    for l in lines { out.write("\(l.text)\n".data(using: .utf8)!) }
}
exit(0)
