# 移动端证据目录

> 这份 README 是**索引**，不是规则。它只回答一个问题：
> **这张图是在为哪条结论作证？**
> 答不出来的图，就是该删的图。

产品负责人 2026-11-14 的要求（原文）：

> 「这个证据主要是用来找差距的。可以持续用来找差距的页面就应该持续保存；
>  找完之后，如果这张图片真的已经被使用完了，就应该删掉。」

所以这里的判断标准不是"这图拍得好看/难看"，而是**还有没有人拿它对照**。

---

## 1. 怎么用（读数不接受目测）

一张读数证据是**成对**的，同名不同后缀：

```
heyta-task-detail.png   ← 人看的
heyta-task-detail.xml   ← 机器可校验的 bounds
```

只有 png 没有 xml 的那张，只能证明"长这样"，不能证明"行高是 44dp"——
写文档时它就是一句没法反驳的空话。取数只有一种：

```sh
adb shell uiautomator dump /sdcard/w.xml && adb pull /sdcard/w.xml heyta-task-detail.xml
```

**bounds ÷ density = dp。** 本机密度 480 ⇒ **÷3**（density 420 ⇒ ÷2.625，320 ⇒ ÷2）。
写进文档时**同时写 px 与 dp**，例如 `156px = 52dp` —— 只写一个的话，
换台机器复核的人没法复算。

同一屏的截图与 dump 必须来自**同一次** dump。分两次取的 bounds 与图对不上，
比没有证据更糟。

---

## 2. 什么时候留、什么时候删

| 情形 | 处置 |
|---|---|
| 被文档 / 计划 / 脚本按路径引用（`apps/mobile/evidence/<目录>/…`） | **留**。它正在为某条结论作证 |
| 只在测试代码里同名（命中的是功能名 `card-export`，不是证据路径） | 不算引用，但**不据此删**——先人工确认那条线是否还活着 |
| 工作已关闭、零引用、mtime 超过 24h | **可删**（规程见 §5，必须先归档） |
| 🔴 目录名带今天日期，或 24h 内有文件变动 | **不删**。别的会话正在写，先问 |
| 目录里有 `.log` / `.txt` / `.json` 读数，且该读数结论已被引用 | 留读数、删冗余截图 |

**判据只认路径，不认"看起来像"。** 一个目录被 200 处裸名提到但没一处写成
`evidence/<目录>/`，它仍然可能是死重 —— 那种情况不自动删，列给人判断。

---

## 3. 子目录 → 它服务的那份文档

现量（2026-11-14）：107 个一级子目录 / 3082 个文件 / 548 MB。
下面按体积列前 16 个；**全量映射由 §4 的命令现算**，不要手抄这张表。

| 子目录 | 体积 / 文件 | 服务的关键文档（括号内是命中处数） |
|---|---|---|
| `profile-center/` | 55 MB / 391 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(23); [`product-ux-optimization-handoff.md`](../../../docs/plans/product-ux-optimization-handoff.md)(5); [`profile-center-optimization.md`](../../../docs/plans/profile-center-optimization.md)(3) |
| `ux-final-20261018/` | 44 MB / 269 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(18); [`product-ux-optimization-handoff.md`](../../../docs/plans/product-ux-optimization-handoff.md)(12); `PROGRESS.md`(10) |
| `ux-final-20261017/` | 42 MB / 318 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(13); [`product-ux-optimization-handoff.md`](../../../docs/plans/product-ux-optimization-handoff.md)(11); `PROGRESS.md`(7) |
| `ux-final-20261016/` | 38 MB / 223 | `PROGRESS.md`(5); [`product-ux-optimization-handoff.md`](../../../docs/plans/product-ux-optimization-handoff.md)(4); `BLOCKED.md`(3) |
| `ux-round5/` | 34 MB / 36 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(3) |
| `ux-final-20261020/` | 28 MB / 173 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(10); [`product-ux-optimization-handoff.md`](../../../docs/plans/product-ux-optimization-handoff.md)(5) |
| `ux-round8/` | 23 MB / 109 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(8) |
| `ux-round6/` | 20 MB / 79 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(9); `e2e/tests/ai-assistant-atomic-tools.spec.ts`(1) |
| `ux-s9-95/` | 17 MB / 83 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(9) |
| `ux-final-20261008/` | 13 MB / 66 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(17); `scripts/check-android-gradle-remote.mjs`(4) |
| `ux-final-s9-82/` | 13 MB / 74 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(8) |
| `settings-finish-release/` | 13 MB / 69 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(5); `scripts/qa/windows-installed-ux.mjs`(2) |
| `ux-final-20261015/` | 9 MB / 17 | [`product-ux-optimization-handoff.md`](../../../docs/plans/product-ux-optimization-handoff.md)(7); `PROGRESS.md`(5) |
| `state-artwork-release/` | 9 MB / 45 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(1) |
| `ux-round4/` | 6 MB / 9 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(5) |
| **`ux-parity-20261114/`** | **3.4 MB / 26** | 🔴 **活目录**：[`ux-parity-checklist.md`](../../../docs/plans/ux-parity-checklist.md) —— 本轮 UX 逐模块对照正在写入，**任何时候都不要删** |

---

## 4. 全量映射怎么重算（别手抄，会漂）

在仓库根跑：

```sh
# 每个一级子目录被哪些文档按路径引用（输出按命中数降序）
for d in apps/mobile/evidence/*/; do
  n=$(basename "$d")
  c=$(grep -rlF "evidence/$n" docs scripts e2e PROGRESS.md BLOCKED.md 2>/dev/null | wc -l | tr -d ' ')
  printf '%-6s %s\n' "$c" "$n"
done | sort -rn

# 零引用集（体积 + 文件数），这是 §5 的输入
for d in apps/mobile/evidence/*/; do
  n=$(basename "$d")
  grep -rqF "evidence/$n" docs scripts e2e PROGRESS.md BLOCKED.md 2>/dev/null || \
    printf '%s\t%s\t%s\n' "$(du -sm "$d" | cut -f1)" "$(find "$d" -type f | wc -l | tr -d ' ')" "$n"
done | sort -rn
```

⚠️ 命令里的 `grep -rqF` 只搜**路径形态**。裸名命中（`card-export` 出现在测试文件名里）
会让 `-F` 也命中 —— 那是"偏保守"的方向（多算在用、少删），符合本目录的删除纪律。

---

## 5. 删除规程（🔴 必须可恢复）

**本目录不入库。** `.gitignore` 的 `apps/*/evidence/` 从 2026-11-09（`e760da75`）
起把整个目录挡在库外，当时那 824 MB 已用 `git filter-repo` 清出历史。

后果必须认清：

- `git rm -r <路径>` 会直接 `fatal: pathspec '<路径>' did not match any files`；
- `git log --all -- apps/mobile/evidence/<目录>` 的**提交数是 0**；
- 也就是说 **git 历史里没有这份文件，删了不能从 git 恢复。**

所以删除**只能**这样做：

```sh
# 1) 先量一份清单（§4 的第二条命令），核对体积与文件数
# 2) 归档到仓库外 —— 这是唯一的恢复路径，不要放在 $TMPDIR（重启即清）
mkdir -p ~/heyta-evidence-archive-$(date +%Y%m%d)
tar -czf ~/heyta-evidence-archive-$(date +%Y%m%d)/evidence-removed.tar.gz -T <清单文件>
tar -tzf ~/heyta-evidence-archive-*/evidence-removed.tar.gz | wc -l   # 必须等于清单行数
# 3) 归档验证通过后才删
# 4) 把「删了哪些 + 多少 MB」写进提交信息（README 入库，截图不入库）
```

🔴 **不要用 `git add -f` 把证据塞回库里换取"可恢复"** —— 那正是 2026-11-09
花一次历史重写才清掉的东西，重来一次是同一个错第二次。

### 本轮（2026-11-14）零引用候选

现量：**51 个目录 / 422 文件 / 65.5 MB**（含下面这行必须排除的活目录）。
体积前 15：

| 子目录 | MB | 文件 | 备注 |
|---|---|---|---|
| `ux-s9-94/` | 11.5 | 66 | 最大一枚，无任何文档提到 |
| `collab-ios-10270213/` | 4.8 | 34 | 一次性协同取证，工作已关 |
| `collab-ios-10270136/` | 4.6 | 30 | 同上 |
| `collab-ios-10270120/` | 4.5 | 31 | 同上 |
| `collab-ios-10270149/` | 4.4 | 30 | 同上 |
| `collab-ios-10262151/` | 4.2 | 28 | 同上 |
| `collab-ios-10260102/` | 2.6 | 16 | 同上 |
| `collab-ios-10260113/` | 2.6 | 15 | 同上 |
| 🔴 `ux-parity-20261114/` | 2.2 | 26 | **不删**：本轮活目录，见 §3 末行 |
| `collab-ios-10250945/` | 1.9 | 9 | 同上 |
| `collab-ios-10250936/` | 1.7 | 8 | 同上 |
| `collab-ios-10251713/` | 1.7 | 10 | 同上 |
| `collab-ios-10251542/` | 1.7 | 9 | 同上 |
| `collab-ios-10252138/` | 1.5 | 9 | 同上 |
| `collab-ios-10251529/` | 1.5 | 7 | 同上 |

其余 36 个都是 `collab-ios-<MMDDhhmm>/` 形状的一次性取证目录（多数连文件都没有），
单个体积在 0.0–1.4 MB 之间，用 §4 的命令一键取全量。

**为什么这些能删**：`collab-ios-*` 是协同共享清单那条线逐轮拍的现场图，结论早已写进
[`collaboration-shared-lists.md`](../../../docs/plans/collaboration-shared-lists.md)
正文（该文档只引用其中 20 个目录），剩下的是同一轮的中间重拍 —— 同一屏拍了七八遍，
留下一张能复算的就够了。

---

## 6. 相邻目录

| 位置 | 内容 |
|---|---|
| [`apps/web/evidence/`](../../web/evidence/README.md) | Web 端证据，同一套规则 |
| [`docs/plans/ux-parity-checklist.md`](../../../docs/plans/ux-parity-checklist.md) | 本轮 UX 对照清单，本目录 `ux-parity-20261114/` 为它供图 |
| `docs/agents/ui-acceptance.md` | 界面验收硬性规定（Playwright 必须真跑真看） |
