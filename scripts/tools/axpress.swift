// axpress — 在 macOS 进程的 AX 树里找元素，然后 AXPress / AXSetValue。
// ============================================================================
//
// 为什么需要它（这是 iOS 输入侧验收能存在的前提）
// ------------------------------------------------
// iOS 模拟器把「模拟设备里那个 App」的无障碍节点**桥接进了宿主的 AX 树**。
// 于是那个 App 的按钮/输入框在宿主这边是**真实的 AX 元素**，可以 AXPress。
//
// 这条路径解决了三个用别的手段解决不了的问题：
//
//   1. **全局事件流点击会被上层窗口吃掉。** 实测：目标窗口
//      `iPhone 17 Pro – iOS 26.5`（456x972 @ (636,43)）被另一个项目的
//      `Litopia-Gate-Duo-Final`（1696x992 @ (14,47)）整块盖住，
//      而且屏幕上还叠着七八个同样盖满屏幕的 Simulator 窗口。
//      `mac clickin` 的遮挡闸直接拒绝（BLOCK）。
//   2. **AXRaise 掀不动它。** `perform action "AXRaise"`（含完整标题）返回成功、
//      激活 Simulator 为前台 app 之后再 raise 也返回成功 —— 但遮挡关系不变
//      （Xcode 27 的 Simulator 用 window set，菜单里就有 `Arrange in Front` /
//      `Remove Window from Set`）。**"工具返回成功"在这里是假的。**
//   3. **`mac type` 的 postToPid 投递不到模拟设备的输入框。** 它返回
//      `typed 9 chars`，但截图回读里 placeholder 还在、提交按钮仍是禁用色。
//      工具自己也警告"返回值不代表生效，必须回读"。
//
// 走 AX 之后这三点全部消失：不需要坐标、不需要 z-order、不需要焦点。
// 实测同一条链路在**没有**把 Simulator 提到前台的情况下也能点开 Composer。
//
// ⚠️ 但 AX 也不是万能的：它只证明**控件被激活了**。控件激活之后有没有真的
//    写进数据，必须靠**回读状态指示器**（提交按钮由灰变亮 = `--enabled`）与
//    **副作用**（SQLite 里真的多一条 op）来证明。见 scripts/verify-mobile-ios.sh。
//
// 用法
// ----
//   axpress <pid> <描述文本> [--press]           默认动作：AXPress
//   axpress <pid> <描述文本> --set <文本>         AXSetValue 并回读
//   axpress <pid> - --field --set <文本>         按「文本类控件」选中再设值
//   axpress <pid> - --fields                     列出所有文本类控件
//   axpress <pid> <描述> --list                  只列出命中，不动作
//
//   通用修饰：
//     --wait <秒>        轮询直到命中（默认 0 = 只查一次）
//     --json             机器可读输出（脚本断言用）
//     --role <AXRole>    只接受该角色的命中（如 AXTextField）
//     --pressable        只接受支持 AXPress 的元素 —— 筛可点元素**应该用这个**，
//                        不要用 --role AXButton（role 会变，见 isPressable 注释）
//     --in <x> <y> <w> <h>  只接受落在该矩形内的命中
//                           🔴 必须传：同一台机器上可能有两个模拟器都开着同一个 App，
//                           它们的按钮描述完全一样，不限定就会点到**另一个设备的界面**上。
import ApplicationServices
import Foundation

// ── 参数解析 ────────────────────────────────────────────────────────────────
let args = CommandLine.arguments
guard args.count >= 3, let pid = pid_t(args[1]) else {
  FileHandle.standardError.write("用法: axpress <pid> <描述|-> [--set <文本>|--field|--fields|--list] [--wait 秒] [--json] [--in x y w h]\n".data(using: .utf8)!)
  exit(2)
}
let needle = args[2]

var waitSeconds = 0.0
var jsonOut = false
var inRect: CGRect? = nil
var setValue: String? = nil
var roleFilter: String? = nil
var pressableOnly = false
let listOnly = args.contains("--list")
let fieldsOnly = args.contains("--fields")
let fieldMode = args.contains("--field")
// 🔴 `--dump` 是取证兜底：把**所有**带文字的元素打出来。
// 界面上的错误文案常常落在折叠线以下，而"按已知文案去找"只在已经知道文案时才有用。
let dumpMode = args.contains("--dump")

if let i = args.firstIndex(of: "--wait"), i + 1 < args.count { waitSeconds = Double(args[i + 1]) ?? 0 }
if let i = args.firstIndex(of: "--set"), i + 1 < args.count { setValue = args[i + 1] }
// 🔴 必须能按 role 过滤：Composer 打开后「新建任务」同时是底部的 FAB（AXButton）
//    和面板标题（AXStaticText），只按描述匹配会选错，而且"最靠下"恰好选中标题。
if let i = args.firstIndex(of: "--role"), i + 1 < args.count { roleFilter = args[i + 1] }
// 🔴 用「支持 AXPress」而不是 role 来筛可点元素，理由见 isPressable 的注释。
if args.contains("--pressable") { pressableOnly = true }
if args.contains("--json") { jsonOut = true }
if let i = args.firstIndex(of: "--in"), i + 4 < args.count,
   let x = Double(args[i + 1]), let y = Double(args[i + 2]),
   let w = Double(args[i + 3]), let h = Double(args[i + 4]) {
  inRect = CGRect(x: x, y: y, width: w, height: h)
}

// ── AX 访问辅助 ─────────────────────────────────────────────────────────────
func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
  var v: CFTypeRef?
  return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func str(_ el: AXUIElement, _ name: String) -> String { (attr(el, name) as? String) ?? "" }
func point(_ el: AXUIElement) -> CGPoint {
  guard let p = attr(el, kAXPositionAttribute as String) else { return .zero }
  var v = CGPoint.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &v)
  return v
}
func size(_ el: AXUIElement) -> CGSize {
  guard let s = attr(el, kAXSizeAttribute as String) else { return .zero }
  var v = CGSize.zero
  AXValueGetValue(s as! AXValue, .cgSize, &v)
  return v
}
func enabled(_ el: AXUIElement) -> Bool? {
  guard let e = attr(el, kAXEnabledAttribute as String) else { return nil }
  return (e as? Bool)
}
/// 该元素支持的 AX 动作。
func actions(_ el: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyActionNames(el, &names) == .success else { return [] }
  return (names as? [String]) ?? []
}
/// 🔴 能不能按 —— **不要**按 role 判断。实测同一个「添加」按钮的角色会在
/// `AXButton` 与 `AXGenericElement` 之间变（同一台设备、同一个 Composer，只是
/// 输入框的内容不同），按 role 过滤会**时灵时不灵**，而症状是"找不到按钮"，
/// 看上去像界面没渲染出来。用「支持 AXPress 动作」这个语义判据才是稳的：
/// 实测「添加」(AXGenericElement) 与「取消」(AXButton) 的动作列表都含 AXPress。
func isPressable(_ el: AXUIElement) -> Bool {
  actions(el).contains(kAXPressAction as String)
}
func children(_ el: AXUIElement) -> [AXUIElement] {
  (attr(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

let TEXT_ROLES: Set<String> = ["AXTextField", "AXTextArea", "AXSecureTextField", "AXComboBox"]

struct Hit {
  let el: AXUIElement
  let role: String, desc: String, title: String, value: String
  let p: CGPoint, s: CGSize
  let enabled: Bool?
  let actions: [String]
}

/// 走一遍 AX 树，按当前模式收集命中。每次轮询都重新走（界面会变）。
func scan() -> (hits: [Hit], wildcardTexts: [Hit], visited: Int) {
  var visited = 0
  var hits: [Hit] = []
  var wildcard: [Hit] = []

  func consider(_ el: AXUIElement, _ role: String, _ desc: String, _ title: String) {
    let p = point(el), s = size(el)
    // --in 过滤：元素左上角必须落在目标窗口矩形内
    if let r = inRect, !r.contains(p) { return }
    if let rf = roleFilter, role != rf { return }
    if pressableOnly, !isPressable(el) { return }
    let h = Hit(el: el, role: role, desc: desc, title: title,
                value: str(el, kAXValueAttribute as String), p: p, s: s, enabled: enabled(el),
                actions: actions(el))
    if fieldsOnly || fieldMode {
      if TEXT_ROLES.contains(role) { hits.append(h) }
    } else if title == needle || desc == needle {
      hits.append(h)
    }
  }

  // 先收集所有文本控件（--fields 用；同时用于报错时提示"现在屏幕上有哪些输入框"）
  var allTexts: [Hit] = []

  func walk(_ el: AXUIElement, _ depth: Int) {
    if visited > 500_000 || depth > 80 { return }
    visited += 1
    let role = str(el, kAXRoleAttribute as String)
    let desc = str(el, kAXDescriptionAttribute as String)
    let title = str(el, kAXTitleAttribute as String)
    if TEXT_ROLES.contains(role) {
      let p = point(el), s = size(el)
      if inRect == nil || inRect!.contains(p) {
        allTexts.append(Hit(el: el, role: role, desc: desc, title: title,
                            value: str(el, kAXValueAttribute as String), p: p, s: s, enabled: enabled(el),
                            actions: actions(el)))
      }
    }
    if dumpMode {
      let p = point(el), s = size(el)
      let value = str(el, kAXValueAttribute as String)
      if (!desc.isEmpty || !title.isEmpty || !value.isEmpty), (inRect == nil || inRect!.contains(p)) {
        print("role=\(role) desc=「\(desc)」 title=「\(title)」 value=「\(value)」 pos=(\(Int(p.x)),\(Int(p.y)))")
      }
    }
    consider(el, role, desc, title)
    for c in children(el) { walk(c, depth + 1) }
  }

  walk(AXUIElementCreateApplication(pid), 0)
  wildcard = allTexts
  return (hits, wildcard, visited)
}

// ── 轮询 ────────────────────────────────────────────────────────────────────
let deadline = Date().addingTimeInterval(waitSeconds)
var hits: [Hit] = []
var wildcardTexts: [Hit] = []
var visited = 0
while true {
  let r = scan()
  hits = r.hits; wildcardTexts = r.wildcardTexts; visited = r.visited
  if !hits.isEmpty || Date() >= deadline { break }
  usleep(300_000)
}

func emitJSON(found: Bool, hit: Hit?, action: String, actionResult: String, extra: String = "") -> Never {
  var d: [String: Any] = ["found": found, "action": action, "result": actionResult, "visited": visited]
  if let h = hit {
    d["role"] = h.role; d["desc"] = h.desc; d["title"] = h.title; d["value"] = h.value
    d["x"] = Int(h.p.x); d["y"] = Int(h.p.y)
    d["width"] = Int(h.s.width); d["height"] = Int(h.s.height)
    if let e = h.enabled { d["enabled"] = e }
    d["canPress"] = isPressable(h.el)
    d["actions"] = h.actions
  }
  if !extra.isEmpty { d["detail"] = extra }
  let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
  exit(found ? 0 : 1)
}

if dumpMode {
  print("   （共访问 \(visited) 个节点）")
  exit(0)
}

if fieldsOnly {
  if jsonOut {
    var d: [String: Any] = ["found": !wildcardTexts.isEmpty, "visited": visited]
    d["fields"] = wildcardTexts.map { ["desc": $0.desc, "value": $0.value, "x": Int($0.p.x), "y": Int($0.p.y)] }
    let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
  } else {
    for f in wildcardTexts {
      print("role=\(f.role) desc=「\(f.desc)」 value=「\(f.value)」 pos=(\(Int(f.p.x)),\(Int(f.p.y))) enabled=\(f.enabled.map(String.init) ?? "?")")
    }
    print("（共访问 \(visited) 个节点，\(wildcardTexts.count) 个文本控件）")
  }
  exit(wildcardTexts.isEmpty ? 1 : 0)
}

guard !hits.isEmpty else {
  if jsonOut { emitJSON(found: false, hit: nil, action: "none", actionResult: "not_found") }
  let names = wildcardTexts.map { "「\($0.value.isEmpty ? $0.desc : $0.value)」" }.joined(separator: " ")
  FileHandle.standardError.write("未找到标题/描述为「\(needle)」的元素（访问 \(visited) 个节点）\(inRect.map { "，已限定在矩形 \($0)" } ?? "")\n".data(using: .utf8)!)
  if !names.isEmpty { FileHandle.standardError.write("当前可见输入框：\(names)\n".data(using: .utf8)!) }
  exit(1)
}

// 多个命中时取最靠下、再最靠右的（同名元素可能来自另一个模拟器窗口）
var best = hits[0]
for h in hits where h.p.y > best.p.y || (h.p.y == best.p.y && h.p.x > best.p.x) { best = h }

if listOnly {
  if jsonOut { emitJSON(found: true, hit: best, action: "list", actionResult: "success") }
  for h in hits {
    print("命中 role=\(h.role) title=「\(h.title)」 desc=「\(h.desc)」 value=「\(h.value)」 pos=(\(Int(h.p.x)),\(Int(h.p.y))) size=(\(Int(h.s.width))x\(Int(h.s.height))) enabled=\(h.enabled.map(String.init) ?? "?") canPress=\(isPressable(h.el))")
  }
  exit(0)
}

if let text = setValue {
  let err = AXUIElementSetAttributeValue(best.el, kAXValueAttribute as CFString, text as CFTypeRef)
  usleep(200_000)
  let readBack = str(best.el, kAXValueAttribute as String)
  if jsonOut { emitJSON(found: true, hit: best, action: "set", actionResult: err == .success ? "success" : "error_\(err.rawValue)", extra: readBack) }
  print("AXSetValue「\(needle)」@(\(Int(best.p.x)),\(Int(best.p.y))) → \(err == .success ? "success" : "错误码 \(err.rawValue)") 回读=「\(readBack)」")
  exit(err == .success ? 0 : 1)
}

let err = AXUIElementPerformAction(best.el, kAXPressAction as CFString)
if jsonOut { emitJSON(found: true, hit: best, action: "press", actionResult: err == .success ? "success" : "error_\(err.rawValue)") }
print("AXPress「\(needle)」@(\(Int(best.p.x)),\(Int(best.p.y))) → \(err == .success ? "success" : "错误码 \(err.rawValue)")（访问 \(visited) 个节点，命中 \(hits.count) 个）")
exit(err == .success ? 0 : 1)
