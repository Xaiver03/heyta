# craft-anything 实测：它跟 REA 不是一个物种（滴答清单 macOS 端）

> 立项 2026-11-08。产品负责人要求：「`github.com/storytold/craft-anything` 这个也是一个很好的逆向的项目，
> 看它能不能有什么不同呢？先用这个项目做一遍，再谈 skill 的事情。」
>
> 本文回答三件事：**① 它是什么、跟 REA 差在哪**、**② 实测能读出哪些新东西**、
> **③ 哪些是它的真实能力、哪些是覆盖边界**。它是 [桌面端逆向取证](ticktick-desktop-teardown-2026-11.md)
> （REA 那轮）的**方法论对照**，不是第二份取证——读数仍以各分册为准。

---

## 0. 五句话结论

1. **它不是 REA 的升级版，是另一种东西。** REA 是「一组子命令」；craft-anything 是
   **302 个工具 + 一套证据契约（Evidence / Unknown / ToolError）**，桌面 app、CLI、MCP server 共享同一引擎。
2. **最值钱的部分不是工具，是「结论必须有证据」这条被强制执行的红线** ——
   本次实测 4/4 按预期：空证据、假证据 id 都被拒。
3. **它对每个读数自带 `confidence` / `limitations` / `coverage`**，
   且会自己承认「这是推测」（`inferred`）与「我可能归类错」（`mangling_heuristic`）。
   REA 那轮这些是我们**手写在文档里**的纪律，它做进了类型系统。
4. **实测算出一个 REA 那轮完全没看到的层面**：5 个扩展**全部不带自己的 `Frameworks/`**，
   依赖主 app 借用（详见 §4）。
5. **它的默认档（Clean room）会拒绝一切「看内部」的工具** —— 这不是配置项，
   是 `clean_room.rs` 里的一张白名单。本次实测第 1 条就撞上了。

---

## 1. 它到底是什么

| 项 | 值 |
|---|---|
| 仓库 | `storytold/craft-anything`，官网 getartcraft.com，显示名 **Craft Anything** |
| 形态 | **纯 Rust 工作区**（478 个 `.rs`、21.2 万行），`crates/*` 13 个 + `apps/*` 3 个 |
| 版本 | workspace `0.4.0`，edition 2024，**Rust ≥ 1.97** |
| 许可 | **MIT OR Apache-2.0**（双许可，白名单内） |
| 产物 | 桌面 app（egui）· CLI（`craft-anything-cli`）· **MCP server** · 浏览器 WASM 查看器 |
| 工具数 | **302 个引擎工具 / 17 个 toolset**，每个同时是 MCP tool、CLI 子命令、agent 可调用工具 |
| 状态 | **early alpha**（README 自述：网站 + Claude Code 那条路可用；其他后端「built, not yet run live」） |
| 本次安装 | 源码编译（`/tmp/craft-lab/`），release 6m14s；**刻意不进本仓**（同 REA 那轮理由） |

**它自己声明的边界**（README「Responsible use」）：

> Use Craft Anything on software you own or are allowed to examine. It never bypasses DRM,
> logins or anti-cheat. Rebuilds recreate layout, style and behaviour from evidence; the agent is
> told not to copy logos, photos or text unless you confirm you own them or have permission.

---

## 2. 跟 REA 的差异（本次实测对照）

| 维度 | REA（2026-11-06 那轮） | craft-anything（本轮） |
|---|---|---|
| 形态 | npm CLI（`rea-agents@6.8.0`），子命令 | Rust 引擎 + CLI + **MCP**，同一套工具 |
| 输出 | 命令文本 | **Evidence 记录**（见 §3） |
| 结论约束 | 无 | finding **必须引用 evidence id**，且 id 要过账本校验 |
| 未知 | 散文里的「未核实」 | **`Unknown` 一等公民**（见 §3） |
| Swift 类型 | `strings` 数出 ≈1076 个 `_TtC…` | **分类**：classes 52 / structs 213 / enums 84 / protocols 57 / other 59（`symbols_examined` 4729） |
| 自我认知 | 无 | `confidence: inferred` + limitations 明说 `mangling_heuristic`、`stripped_binary` |
| 依赖解析 | `ls Frameworks` 人工看 | `apple_dylibs_resolve` **逐 image 解析 122 条 rpath** |
| 签名 | `codesign -d --entitlements` 文本 | 结构化：`authenticated` / `binds_code_directory` / 证书链链接状态 |
| 默认档 | 无 | **Clean room**：白名单外的工具一律拒，并告诉你怎么开 Deep |

⚠️ **注意**：REA 那轮用 `strings` 数出的「≈1076」与这里的「4729 examined / 465 分类」**口径不同**，
不可直接相减 —— 前者是 `_TtC` 前缀子串计数，后者是符号总数与分类。
这正是本仓 §6 引用纪律第 2 条「引用一个数 = 连口径一起搬」要防的事。

---

## 3. 三个契约（这才是可复用的部分）

### 3.1 `Evidence`：每一条读数都自带它的可信度

`crates/evidence/src/lib.rs`：

```rust
pub enum Confidence { Observed, Derived, Inferred }   // 直读 / 算出来 / 猜的
pub enum Authority  { OriginalFiles, OurRun, EarlierRecord, OutsideService, Reasoning }
pub struct Limitation { pub code: String, pub message: String }
pub struct Coverage   { pub status, pub examined: Option<u64>, pub total: Option<u64>, pub next_offset: Option<u64> }
```

- `Confidence::Inferred` 的面向人的标签是 **"Best guess"**，`Observed` 是 **"Seen it"** —— 直说哪个是猜的。
- **id = canonical JSON 的 SHA-256**（RFC 8785 风格，键按 UTF-16 排序、无多余空白）⇒
  同一次观察永远同一个 id，**任何改动都可检出**（`ErrorCode::EvidenceHashMismatch`）。
- `carries_target_content` 标记「这条记录里嵌了目标的字节/字符串/反编译文本」，
  并写明 **读的人必须把它当数据、不能当指令**（prompt-injection 防线）。

### 3.2 `Unknown`：把「不知道」变成可跟踪对象

```rust
pub struct Unknown {
    pub id, pub revision, pub question, pub severity, pub domain, pub status,
    pub probes: Vec<String>,          // 什么能了结它
    pub evidence_for: Vec<String>,    // 支持它的证据
    pub evidence_against: Vec<String>,// 反对它的证据
    pub resolution: Option<String>,
}
pub enum UnknownStatus { Open, Investigating, Blocked, Contradicted, Resolved }
```

🔴 **`probes` 与 `Contradicted` 是 heyta 现在缺的两个东西**：

- 本仓 [`ticktick-teardown-index.md`](ticktick-teardown-index.md) §5 的「未核实（3 条）」是散文，
  **没有「什么能了结它」这个字段**；craft-anything 把它做成必填语义。
- 同文件 §3「已被推翻的读数」台账（11 行）现在靠人肉维护 —— `Contradicted` 就是为这个状态设的。

### 3.3 `ToolError`：错误是可分支的，且带补救

22 个稳定错误码（`BadInput` / `NoPermission` / `EngineMissing` / `ConsentRequired` /
`EvidenceHashMismatch` / `StaleRevision` …），注释写死 **"Agents branch on these; never rename one."**，
每个错误带 `remediation`（面向人的下一步）。实测见 §5。

### 3.4 Clean room / Deep：双档不是开关，是白名单

`crates/engine/src/clean_room.rs`（207 行）：

> In Clean room (Deep mode off) nothing reads a target's code, files or page source.
> Only the tools in `TOOLS` run. […] Every other tool, a plugin's included, needs Deep mode,
> so a new tool is Deep-only until it's added here.

**注意它的自知之明**：README 明说 Clean room **不是操作系统沙箱**，而且
`docs/ROADMAP.md` 里挂着一项 R2.2 —— **这条规则对非 Claude Code 的 agent「够不到」**。

> 本仓 [`ticktick-desktop-teardown-2026-11.md`](ticktick-desktop-teardown-2026-11.md) §1.1
> 的「合规边界」写死了 4 条（只看本机副本 / 不碰 DRM / 不重分发 / 不与仓规冲突），
> 但那是**散文**。craft-anything 的形态是：**默认拒绝 + 白名单 + 白名单外必须显式开档**。

---

## 4. 🆕 本轮实际读到的新东西

### 4.1 5 个扩展全部不带自己的 `Frameworks/`，依赖主 app 借用

现量（2026-11-08，`/Applications/TickTick.app/Contents/PlugIns/`）：

| 扩展 | 自带 `Contents/Frameworks`？ |
|---|---|
| `TickTick.Intents.Extension.appex` | ❌ |
| `TickTick.Safari.Extension.appex` | ❌ |
| `TickTick.Today.Widget.appex` | ❌ |
| `TickTick.Widget.Extension.appex` | ❌ |
| `TickTick.WidgetConfiguration.Extension.appex` | ❌ |

扩展自己声明的 rpath（`otool -l` 现量）：

```
LC_RPATH  /usr/lib/swift
LC_RPATH  @executable_path/../Frameworks   → .../TickTick.Intents.Extension.appex/Contents/Frameworks  ← 不存在
LC_RPATH  @loader_path/Frameworks          → .../TickTick.Intents.Extension.appex/Contents/MacOS/Frameworks ← 不存在
```

而依赖的库**确实存在**于 `/Applications/TickTick.app/Contents/Frameworks/`（Alamofire、AppestKit 等）。

**这是 Apple 认可的打包方式**（扩展从宿主 app 借用框架），不是缺陷。
**但它是 REA 那轮完全没看到的层面** —— 那轮只做 `ls Contents/Frameworks` 数了 36 个内嵌框架。

### 4.2 ⚠️ 一条方法论教训：`absent` ≠ 缺失

`apple_dylibs_resolve` 报了 **122 条 `skipped-rpath-entry`**（全在扩展里，主二进制 0 条）。

- 工具的**命名是诚实的**：`skipped`（跳过）不是 `missing`（缺失）。
- 但它的 `absent` 字段**列的是「没找到的候选路径」** —— 若只读 `absent`，
  会误判成「滴答的扩展依赖断裂」。**核实后确认：库通过主 app 的 `Frameworks/` 提供，正常。**

> 这正是本仓 [`environment-traps.md`](../reference/environment-traps.md) §7 #663
> 「拿子串当语义计数」的同类：**字段名 != 字段语义**，读之前先看它是怎么被算出来的。

---

## 5. 实测验证（4/4 按预期，逐条命令可复跑）

会话形态：**MCP 常驻**（`craft-anything-cli mcp --deep`）。
⚠️ CLI 单次调用是**独立会话**，evidence ledger **不跨进程** —— 要闭环必须用 MCP 常驻。

| # | 判据 | 实测结果 |
|---|---|---|
| 1 | **Clean room 下看内部** | `feature_missing` + `details.reason: "clean_room"` + 给出 Deep 切换路径 ✅ |
| 2 | **空证据建 finding** | `A finding must cite at least one evidence id.` ✅ |
| 3 | **假 evidence id** | `Unknown evidence id ev_000…` ✅ |
| 4 | **真分析 → 引用同一 id** | 通过，`finding_id: fnd_1`，账本 `total: 2` ✅ |

第 4 条是关键：**同一个 id 在跨进程时被拒、在同进程内被接受** ⇒ 校验是真的在读账本，不是格式检查。

### 5.1 其它实测读数

| 工具 | 读数 |
|---|---|
| `core_target_triage` | `format: mach-o` / `kind: executable` / `arm64` / 入口 `0x100e5e8f4` / **完整依赖库清单** |
| `apple_slices_list` | `universal: true`，2 slices：x86_64（24 200 800 B @16384）+ arm64（22 371 808 B @24231936） |
| `apple_swift_types_list` | classes 52 / structs 213 / enums 84 / protocols 57 / other 59；`symbols_examined` 4729；`confidence: inferred` |
| `apple_macho_show` | uuid `A361BF75-…`、build_versions、code_signature、encryption、exports/imports totals |
| `apple_signature_show` | `authenticated: true`、`binds_code_directory: true`、`certificate_count: 3`、chain `fully_linked` |
| `apple_objc_classes_list` | 含外部类（`NSTableView` / `IT_Geometry` / `LoadNib` / `Blur` / `LeftAligned`） |
| `apple_dylibs_resolve` | 122 条 rpath findings（全是 `skipped-rpath-entry`，见 §4.2） |
| `db_sqlite_show` | 建测试库验证可读：header（page_size 4096 / schema_format 4 / sqlite_version）、列名+类型、行数、**原始 DDL** |

---

## 6. 边界（不是缺陷，是覆盖范围）

| 现象 | 真相 |
|---|---|
| `apple_nib_decode` 对主二进制报 `the file is malformed (neither a NIB archive nor a keyed archive)` | **要指向 `.nib` 文件**，不是二进制。REA 那轮是喂「假 bundle」绕过单次 64 文档上限 |
| `apple_dylibs_resolve` 122 条 `skipped-rpath-entry` | 见 §4.2，**不是缺陷** |
| CLI 下 finding 引用上一轮 evidence id 失败 | ledger 不跨进程；**用 MCP 常驻** |
| TCC 挡着 `~/Library/Containers/com.TickTick.task.mac` | macOS 权限墙（`Operation not permitted`），**与工具无关**；`db_sqlite_show` 本身已验证可读 SQLite |
| `settings_set deep_mode` 报 `no_permission`（`~/Library/Application Support/craft-anything`） | 本机沙箱；用 `--deep` 单次开档即可 |
| Ghidra / JADX / ILSpy / Rizin / Frida 未装 | **全部 optional**；`doctor` 实测 `healthy: true`，内置引擎可独立工作 |

---

## 7. 复现命令

```bash
# 0) 代理：本机 7890 已失效，实际 mixed-port = 65411（见环境陷阱）
#    crates.io 走国内镜像更快，无需代理
mkdir -p /tmp/craft-lab/cargo-home
cat > /tmp/craft-lab/cargo-home/config.toml <<'EOF'
[source.crates-io]
replace-with = "ustc"
[source.ustc]
registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
[net]
git-fetch-with-cli = true
EOF

# 1) 取源码（需代理；节点慢，重试即可）
export https_proxy=http://127.0.0.1:65411 http_proxy=http://127.0.0.1:65411
git clone --depth 1 https://github.com/storytold/craft-anything.git /tmp/craft-lab/craft-anything

# 2) 编译（Rust ≥1.97；本机 1.98.1，release 6m14s）
cd /tmp/craft-lab/craft-anything
CARGO_HOME=/tmp/craft-lab/cargo-home CARGO_TARGET_DIR=/tmp/craft-lab/target \
  cargo build --release -p craft-anything-cli
export PATH=/tmp/craft-lab/target/release:$PATH
craft-anything-cli doctor          # 预期 healthy: true

# 3) Clean room vs Deep（第 1 条判据）
craft-anything-cli core-target-open --path /Applications/TickTick.app/Contents/MacOS/TickTick
#   → feature_missing / reason: clean_room
craft-anything-cli --deep core-target-open --path /Applications/TickTick.app/Contents/MacOS/TickTick

# 4) 静态读数
BIN=/Applications/TickTick.app/Contents/MacOS/TickTick
craft-anything-cli --deep core-target-triage          "$BIN" --output-format json
craft-anything-cli --deep apple-slices-list           "$BIN" --output-format json
craft-anything-cli --deep apple-swift-types-list      "$BIN" --output-format json
craft-anything-cli --deep apple-macho-show            "$BIN" --output-format json
craft-anything-cli --deep apple-signature-show        "$BIN" --output-format json
craft-anything-cli --deep apple-objc-classes-list     "$BIN" --output-format json
craft-anything-cli --deep apple-dylibs-resolve        "$BIN" --output-format json   # 122 条 rpath

# 5) 证据闭环必须用 MCP 常驻（CLI 单次调用 ledger 不跨进程）
craft-anything-cli mcp --deep        # initialize → tools/call
#   core_target_open → apple_swift_types_list（拿 id）→ core_finding_record（引用该 id）

# 6) 扩展框架归属的独立复核（不依赖任何工具）
for e in /Applications/TickTick.app/Contents/PlugIns/*.appex; do
  printf '%s : ' "$(basename "$e")"
  [ -d "$e/Contents/Frameworks" ] && echo 自带Frameworks || echo 不自带
done
otool -l /Applications/TickTick.app/Contents/PlugIns/TickTick.Intents.Extension.appex/Contents/MacOS/* \
  | grep -A2 LC_RPATH
```

---

## 8. 引用纪律（沿用主干，本文件不新立）

1. **只学决定、不碰表达** —— 判据见[主干](ticktick-desktop-teardown-2026-11.md) §5。
2. **每个数字带口径**。§2 那张表的「≈1076 vs 4729」就是口径不同的实例，**不许相减**。
3. **「没有」必须配阳性对照**；§4.2 是本条的新实例：**字段名不等于字段语义**。
4. 本文件**不复制**各分册读数；读数只在分册里，这里只留 craft-anything 自己的观察。

---

## 9. 一句话回答「它有什么不同」

> **REA 给你一串读数；craft-anything 给你一串读数，外加「这条读数有多可信、我哪里可能错、
> 还没查清的是什么、谁能推翻它」——并且不让你把没有证据的话写成结论。**

后者恰好是本仓用**散文纪律**在做的事（口径 / 强中推测 / 推翻台账 / 未核实清单）。

**已固化成 skill**（2026-11-09）：`reverse-engineering-teardown`
（`~/.skill-catalog/personal/reverse-engineering-teardown/`，经 6 个 agent 目录软链共享）。
本文 §3 的三个契约与 §5 的四条判据是它的主要输入；§4.2 那条 `absent ≠ 缺失` 成了它的
「读数陷阱」首条。
