# r133 · iOS **AI 面 + 帮助面**装机态深浅两档（10 张，全部人眼看过）

## 一、出处

| 项 | 值 | 怎么现量 |
|---|---|---|
| 载体 | `/Users/rocalight/heyta-carriers/head-r128` @ `f8d7155e`（detached） | `git worktree list` |
| 装机件 | `Heyta.app` version `1.0 (2)`，bundle 落盘 **2026-10-18 18:11** —— **与 r132 同一枚件**，本趟没有重装，所以两趟读数可直接对照 | `simctl get_app_container … app` + `PlistBuddy` + `stat -f %Sm` |
| 设备 | 模拟器 `heyta-iphone-17pro` = `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，屏 `[402,874]`，「我的」那一屏 tab 栏顶 y=776 | `simctl list devices booted` + AX 树 |
| companion | pid **31182**，全程未被收（共享进程，禁止按名字 kill） | `ps -p 31182` |
| 装置 | 新增常驻脚本 `scripts/qa/ai-face-ios.py`（复用 `profile-settings-ios.py` 的 `Probe`），**只读** | — |
| 亮档 | `startedAt 1792344638`（本地 01:30:38），**20 步全 passed**，图 mtime 01:30–01:31 | `light/ai-face-journey.json` |
| 暗档 | `startedAt 1792344719`（本地 01:31:59），**20 步全 passed**，图 mtime 01:31 | `dark/ai-face-journey.json` |
| 深怎么上的 | `simctl ui … appearance dark` → **`shutdown` → `boot`** 一次（#471：不重启这一档到不了包里）；跑完已还原 light 并回读 | 见 §六 |
| 语言 | 中文（系统语言与应用内开关都没动） | JSON 里的 `labels` 全中文 |

> ⚠️ 这一趟**有过一次自我污染**：暗档跑完没还原就把两版"亮档"重跑写进了 `light/`，
> 而 JSON 里的 `appearance` 一直诚实地写着 `dark`。那两趟是**失败**的（没落图），
> 所以入库的 10 张里没有暗档混件；但这件事本身是 #472 的第二半，已把守卫写进装置（§五）。
> 调试期的 `_diag/` 废件（00:21–00:29 五张）已随本趟删除，不属于任何一档。

## 二、这一格在判什么

台账那句「个人资料/账号/**AI**/**帮助**的剩余交互回归」里，iOS 装机态此前只有
r131 的**设置面五屏**和 r132 的**提醒块**。这一趟补两块：

**AI 面（两个入口、一个目的地）**
1. 「我的」tab → **AI 助手**入口 → 助手页（未配置态）；
2. 助手页 `配置 AI` → **AI 设置**面板；
3. 退出面板 → 回「我的」→ 设置 → **AI 与集成**段 → 同一个 AI 设置面板；
4. 两条路径各自截图，同档对照（§四·尺二）。

**帮助面** —— iOS 的帮助面**存在**，是 设置 › 常规 › **「帮助与反馈」** 那一节
（`mobile.settings.feedback.section`，里面一行 `投诉与举报` + 受理邮箱说明）。
本趟滚到那一节并截图。⚠️ 我一度判成"iOS 没有帮助面"，成因见 **#479**。

装置全程**只读**：不点任何开关、不发任何消息、不建任何任务、**没有**按 `投诉与举报`
（那一下会唤起系统邮件撰写页，属于跳出本 app 的状态改动）。

## 三、两档 × 五屏，逐张看过（AGENTS §6.2 规定一）

| 屏 | 亮 | 暗 | 看过之后的结论 |
|---|---|---|---|
| `profile.png` | ✅ | ✅ | 「我的」整页两档完整；暗档主 CTA `注册 / 登录` 是浅蓝底 + 深色字，不是反相白块 |
| `assistant.png` | ✅ | ✅ | 页头 `AI 助手` + `+` + 返回；横幅 `可以直接查询本机任务。配置 AI 后，还能整理想法和安排计划。` + `配置 AI`；`历史 / 只读 / 执行`；`今天想先完成什么？` + `把想法变成下一步。`；四枚 chip；输入框 + `AI 可能出错，请核对重要信息。` 两档全在 |
| `ai-settings-via-assistant.png` | ✅ | ✅ | 三枚闸（`启用 AI 功能`/`允许远程端点`/`让 AI 记住我的偏好`）+ `heyta 托管` 卡（含 ⚠️ 明文提示）+ `端点` 段 + `添加 本机 Ollama`/`添加 本机 LM Studio` |
| `ai-settings-group.png` | ✅ | ✅ | 从设置段进的同一面板 —— 与上一行**逐像素相同**（§四·尺二） |
| `help-feedback.png` | ✅ | ✅ | 常规滚到底：`桌面小组件` + `如何添加` 四条 + `语言` 两枚 chip + **`帮助与反馈` / `投诉与举报` / `打开邮件应用，把情况发到我们的受理邮箱`** 全部整枚在屏上，**没有被裁**（这一屏是模态，本来就没有 tab 栏 —— 见 #477 ⑶） |

暗档无"半暗"痕迹：助手页整屏深底（`modalLum` 12），其余四屏是卡片底（28）。

## 四、两把尺

**尺一 · 这一档到底是不是那一档**（`scripts/screenshots/png-stats.mjs` 的 `modalLuminance`）：

```
light  profile / assistant / ai-settings-via-assistant / ai-settings-group / help-feedback = 252 252 252 252 252
dark   profile / assistant / ai-settings-via-assistant / ai-settings-group / help-feedback =  28  12  28  28  28
```

**尺二 · 两条入口到的是不是同一个目的地**：同一档内两张面板图 **sha256 相同**
（亮档 `e6657591…`；暗档差字节数 `0`）。截图走 `idb screenshot`，每次都是**独立重拍**
（`Probe.screenshot` 每调一次起一个 `idb … screenshot` 进程），不是同一份文件写两遍
⇒ 这条读数是"两个入口渲染同一屏"的证据。

**步级配对**：两档 20 步同序同判据；`help section` 那一步的 `reveal` frame 两档**逐位相同**
`[32, 797, 338, 44]`（底边 841 ≤ 屏高 874 − 8）。

## 五、装置这一趟学到的四件事（都已入库）

1. **#476 目录层退出键是「关闭」** —— 第一版 14 步全绿、最后一步等「返回」超时。
2. **#477 `scroll_to` 不能用来做"这节看得见吗"** —— 它给节标题回 `found: False`，
   给整句名的行回 `found: True / visible: False / swipes: 10` 而位置一动不动（画面本来就在末尾）。
   🔴 `visible: False` 不是新机制，是 **#273** 那条已知定义的直接推论：shim 的"可见"= `中心 y < 屏高-120 且 底边 > 0`，
   这里中心 `y = 764 + 44/2 = 786 > 874-120 = 754` ⇒ 必然 False —— **`scroll_to` 天生够不到屏幕最下面那 120pt**，
   而"这一节看得见吗"恰恰常要问那一条。本趟改成自带的 `settle_in_viewport()`：有界滚动 + 「行底 ≤ 视口下界」+ 停稳容差 ≤12pt，
   **视口下界按这一屏有没有 tab 栏现算**（模态没有 ⇒ 用屏高，屏高从树里 `Application` 节点量）。
   ⚠️ 这里的 `屏高-8` 与 shim 的 `屏高-120` 是**有意不同的两把尺**（前者答"像素在不在屏上"，后者给"敢不敢按下去"留手指余量），
   别为了"和 shim 一致"把它改回去。这条守卫有牙：写死 776 的旧版把明明整枚在屏上的 `投诉与举报` 判成看不见（实测红过一次）。
3. **#478 单行 docstring 会被 `check-locator-labels` 当界面标签** —— 门红过一次，改成 `#` 注释后绿。
4. **档名守卫（#472 的第二半）** —— `--evidence-dir` 末级目录名是 `light`/`dark` 时，
   装置先读 `simctl ui … appearance` 比对，不符就拒写。
   **变异验证**：设备在 dark 时往 `light/` 跑 ⇒ `rc=1`，正文
   `refusing to write: evidence dir says 'light' but the device is 'dark' …`。

## 六、新发现：未选中的勾选框边界两档都不达 3:1，而且现有门看不见它

**现象**：AI 设置面板里三枚闸未选中时只有一个细圆环，两档下都**很 faint**。

**它不是 AI 面独有的** —— 圆环来自共享控件 `Checkbox`
（`apps/mobile/src/ui/kit.tsx:488`，`borderColor: t['color.border-strong']`），
**任务行勾选框就是同一枚**。

**token 层实测**（`_measure/token-contrast.mjs`，公式与设计系统同一套 WCAG 相对亮度）：

```
正对照   color.foreground-subtle on color.surface   dark = 7.11:1   ← tokens.css 注释里公布的就是 7.11 ⇒ 解析器对上了
待判     color.border-strong     on color.surface   light = 1.48:1   dark = 1.63:1
门已覆盖 color.border            on color.surface   light = 1.23:1   dark = 1.29:1  （分隔线，声明下限 1.2 ⇒ 通过）
```

**屏幕上的第二把尺**：暗档截图里圆环像素实测 `rgb(43,59,92)` = `#2b3b5c` = 暗色
`--ht-color-border-strong`，卡片底 `rgb(13,21,38)` = `#0d1526` = `--ht-color-surface`，
算出来同样是 **1.63:1** —— 两把尺同值，不是抗锯齿造出来的。

**为什么门不会红**：`MASTER.md` §3 写的是「大字/图形 ≥ 3:1」，但
`GRAPHIC_PAIRS`（`packages/design-system/src/tokens.ts:451`）
只有三族：`color.border`/`color.surface` 下限 **1.2**（注释明写"分隔线，可见即可，非 3:1"）、
`color.ring`/`color.background` 下限 3（焦点环）、分类色槽位。
`border-strong` **一处都不在** —— 它只出现在 `TOKEN_GROUPS` 的名字登记里
（现量：`grep -n "border-strong" packages/design-system/src/tokens.ts` 只有一行，在 40 行的名字表里）。
⇒ 一枚**承担"这里有个控件"这一信息**的边界，用的是按"分隔线"标准放行的色，且没有任何一层在守。

**顺带把 r131 §四.2 那枚"只登记不裁决"的观察量出来了**：那条说的是常规页
`如何添加` 四条列表的分隔线在暗档几乎看不见。它走的是 `Divider`
（`apps/mobile/src/ui/kit.tsx:853`，`backgroundColor: t['color.border']`）⇒ **1.29:1（暗）/ 1.23:1（亮）**，
而设计系统给分隔线**声明的下限就是 1.2**。所以那条**不是违例**，是"下限取值本身合不合适"的问题，
归设计侧。r131 当时说"要判它得另开一把尺" —— 那把尺现在在 `_measure/` 里。

**设计系统自己有过先例**：`tokens.css` 暗色段那条注释就是同一件事的处理办法 ——
`foreground-subtle` 在 `#0d1526` 上只有 3.83:1，于是"梯子上移一级"到 slate-400 = 7.11。

**没有当场改，两条理由**：
1. 改法要动 `GRAPHIC_PAIRS`（**判据口径**）与/或 `--ht-color-border-strong` 的取值
   （设计变量唯一事实源），本轮边界明写**不代改判据口径**；
2. `border-strong` 的源码头像有 **14 个文件**在消费（其中 `packages/design-system/src/{tokens.css,tokens.ts,generated/tokens.native.ts}`
   是定义与生成件，`apps/desktop/renderer-dist/**` 是构建产物）⇒ **真正的消费方 9 处**：
   mobile `ui/kit.tsx`（就是这枚 Checkbox）+ `FocusScreen`、`packages/ui` 的 `EmptyState`/`StateIllustration`(+1 枚测试)、
   web `controls.css`/`inbox.css`、landing `landing.css`/`mockup.css`、`reset.css`。
   提亮一档会同时改到四端**所有**强边框 —— 这是设计决定，不是取证决定。
   现量：`grep -rl "border-strong\|borderStrong\|border\.strong" apps packages design-system --include="*.tsx" --include="*.ts" --include="*.css" --include="*.swift" --include="*.ets" | grep -v node_modules | grep -v '\.worktrees' | grep -v '/dist/' | wc -l`
   ⚠️ `--include` **必须加引号**（#479：不加引号 zsh 会让整条 grep 不执行而管道仍回 0）。

**建议（留给设计侧拍）**：给"未选中控制件边界"单开一枚语义 token（不复用边框族），
按 `MASTER.md` §3 的 3:1 在两档各配一值；`GRAPHIC_PAIRS` 加这一对，门槛 3。
这样任务行勾选框和 AI 三枚闸一起受益，且不会碰到分隔线。

## 七、这一趟**不证**什么

1. ~~**不证英文档**~~ —— 本趟两档都在中文下跑。**这一条已被 r136 部分划掉**：
   应用内语言开关的通道在 r135 补上（`scripts/qa/ios-app-language.py`）后，同一枚装置在**英文 × 浅档**跑过一趟 20 步全绿、
   每枚双语定位符都在英文档命中过（见 `../ios-ai-face-r136/RESULT.md`）。
   ~~**仍然不证的是"英文 × 暗档"那一格**~~ —— **已由 r137 取到**（外观与语态是两维，r136 只取了浅档那一行，r137 在同一次开机里把两维同时立起来）：读数与逐张人眼记录见 [`../ios-ai-face-r137/RESULT.md`](../ios-ai-face-r137/RESULT.md)。
   （本条原文那句"定位符是双语的（`check:locator-labels` 守）但没真的在英文装机态跑过"在 r133 当时是准确的。）
2. **不证已配置态** —— 这台模拟器没有 AI 端点，助手页走的是 `mobile.ai.notConfigured` 那一支。
   `hostFailed` / `privacyBlocked` 两张卡、端点表单、能力清单、托管档的订阅入口**一律没进**。
3. **不证发送链路** —— 只读装置，没输入过一句话，`执行` 档的实际写入没验。
4. **不证 `投诉与举报` 那一下真的把邮件撰写页拉起来** —— 那是跳出本 app 的状态改动，本趟故意没按。
   （macOS 上"外链在浏览器里真的渲染"那一格另有读数，见台账 #44 那格。）
5. **不证 Windows / Android 的 AI 面与帮助面** —— 与打包机同一前提（四枚 ssh 别名逐枚现量全不可达）。
6. **不证"暗档下所有面都对"** —— 这一趟只覆盖它走到的那五屏。

## 八、收尾与设备状态

- 装置**只读**：没有新建/删除任务，没有改任何开关；旅程结束后 app 停在「我的」tab。
- **通知授权仍是「不允许」**（r132 留下的那处未还原状态，`…-handoff.md` 头部有交代），本趟没有改变它。
- 外观档是**我**为这一趟改的（light→dark→light，中间各重启一次）；
  跑完已**还原成 light**，回读 `xcrun simctl ui … appearance` = `light`。
- 语言 / 数据 / 任务列表（r132 清完为空）都没动。

## 九、复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
E=apps/mobile/evidence/ux-final-20261018/ios-ai-face-r133

python3 scripts/qa/ai-face-ios.py --udid $U --evidence-dir $E/light      # 设备必须是 light，否则拒写
xcrun simctl ui $U appearance dark && xcrun simctl shutdown $U && xcrun simctl boot $U
python3 scripts/qa/ai-face-ios.py --udid $U --evidence-dir $E/dark
xcrun simctl ui $U appearance light                                     # 还原

# 尺一
node --input-type=module -e "import {inspectPng} from './scripts/screenshots/png-stats.mjs';
  for (const d of ['light','dark']) for (const f of ['profile','assistant','ai-settings-via-assistant','ai-settings-group','help-feedback'])
    console.log(d, f, inspectPng(`$E/${d}/${f}.png`).modalLuminance)"
# 尺二
shasum -a 256 $E/light/ai-settings-via-assistant.png $E/light/ai-settings-group.png

# 对比度那三行（第一条必须回 dark 7.11，否则这份解析坏了，读数作废）
node $E/_measure/token-contrast.mjs color.foreground-subtle color.surface
node $E/_measure/token-contrast.mjs color.border-strong     color.surface
node $E/_measure/token-contrast.mjs color.border            color.surface
```
