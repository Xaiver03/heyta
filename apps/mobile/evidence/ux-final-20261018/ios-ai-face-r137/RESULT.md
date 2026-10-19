# r137 · iOS「英文 × 暗档」那一格（AI 面 / 帮助面 / 账号面，同一趟）

> r136 §5 第 1 条与 r134 的对应那一格都写着同一句话：**英文档只跑了浅档**。
> 外观档与语态是两维，交叉那一格一直没取。这一趟把两维同时立起来：
> 应用内语言开关切 `en` + `simctl ui … appearance dark`（设完必须重启一次模拟器才到达这枚包，#471），
> 然后在**同一次开机**里跑完 AI/帮助面与账号面两条只读旅程。

## 1. 出处

| 项 | 现量 |
|---|---|
| 取数时仓库 tip | 起跳前 `git rev-parse --short HEAD` = `2080cef1`；收笔时已被别线推进到 `b612ba36` ⇒ 共享工作树，本趟读数**只属于起跳那一枚 tip** |
| **装机件** | `Heyta.app` bundle mtime `2026-10-18 18:11:07`（`xcrun simctl get_app_container … app` + `stat -f "%Sm"`）⇒ 与 r131–r136 **同一枚件**，本趟没有重装 |
| 设备 | `heyta-iphone-17pro` / `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，屏 `[402, 874]` |
| 外观 | `xcrun simctl ui $U appearance dark` → `shutdown` → `boot`（#471 那条重启纪律）→ 两条旅程都在这一趟开机里跑 |
| 语态 | `scripts/qa/ios-app-language.py --to en`（9 步 `rc=0`，`language after (en)` 那一步的目录层断言命中 `General/Sync and privacy/Data management/Account security` 四枚，中文那四枚 `otherLanguageMarksLeft=[]`） |
| 装置 | `scripts/qa/ai-face-ios.py` + `scripts/qa/account-face-ios.py`（两枚**未改动**，与 r133/r134/r136 同一版本）+ r135 那枚语言开关 |
| 落点 | `ios-ai-face-r137/english-dark/`（5 图 + `ai-face-journey.json`）、`ios-account-face-r137/english-dark/`（2 图 + `account-face-journey.json`）—— 都是新目录，不覆盖任何已提交证据（#472） |

## 2. 两维各自有独立证据（不是"目录名叫 dark 就算 dark"）

`require_appearance` 只在末级目录名**恰好是** `light`/`dark` 时才对账；本趟落点末级是 `english-dark`，
它不判 ⇒ 所以这两维各补了一把独立的尺：

**暗档那一维（像素层）**：`scripts/screenshots/png-stats.mjs` 的 `modalLuminance` 逐张量 ——
**7/7 全 dark**（`28` 六张、`12` 一张即助手屏），没有一张落回 `252`。
两枚 JSON 的 `appearance` 字段也都是 `dark`（读的是 `simctl ui`，不是目录名）。

**英文那一维（无障碍树层）**：整条 AI 旅程 20 步、账号旅程 11 步里回到的**每一屏**标签都是英文
（`Profile / Not signed in / Sign in or register / AI assistant / Set up AI / AI and integrations /`
`General / Home screen widgets / Help and feedback / Complaints and reports / Or use another way /`
`Sign in with an email link / Sign in with a passkey`）。两枚 JSON 里 CJK 字符串叶子一共只有 **5 枚**，逐枚点名：

| JSON | 叶子 | 为什么它是中文 |
|---|---|---|
| ai | `steps[10].afterLabels[17]`、`steps[12].labels[17]`、`steps[14].beforeLabels[17]` = `中文` | 语言 chip 的标签**在两档目录里都是「中文」**（`common.lang.zh`），这是设计如此，不是没翻 |
| ai | `steps[11].target[0]` = `投诉与举报` | 那是双语候选列表的**第一项**（装置自己带的候选，不是界面回读） |
| acct | `steps[4].target[0]` = `或者用别的方式` | 同上 |

⇒ 界面回读里**零枚**中文标签。账号面那一步的 8 枚 marks 更直接：四枚中文键全 `false`、
`Sign in with email and password` 为 `true`。

## 3. 读数

**AI 面 + 帮助面 20 步全 passed；账号面 11 步全 passed。** 与中文档同一枚装置、同一步数。

| 步 | 英文×暗档命中的帧 | 与 r136（英文×浅档）对照 |
|---|---|---|
| `open assistant` | `[16, 441, 370, 60]` | 浅档 `[16, 446, 370, 60]` ⇒ 位移 5px，同一枚行高 |
| `assistant -> ai settings` | `[287, 134, 98, 44]` | 逐字相同 |
| `open settings` | `[16, 343, 370, 44]` | 逐字相同 |
| `open general group` | `[32, 207, 338, 44]` | 逐字相同 |
| `scroll to help section` | `[32, 748, 338, 60]` ⇒ 底边 `808 ≤ 866` | 逐字相同（#477 那条有界滚到位） |

**两条入口到同一屏这把尺在交叉格里同样成立**：`ai-settings-group.png` 与 `ai-settings-via-assistant.png`
sha256 **逐字节相同**（`7e8958d0001b…`）。

**账号面的展开态**：`expanded state` 那一步 `magicLink=true`、`passkey=true`、
`toggleNode.AXValue="expanded"`，收起后 `expandedGone=true` —— 与 r134/r135 同一形状，
英文档没有把状态位弄丢。

## 4. 逐张人眼看过（7 张）

| 图 | 看过之后 |
|---|---|
| `profile.png` | 全英全暗：`Account / Not signed in / Sign in or register / Settings / Recent activity / Not synced yet / Notifications / My growth`；`Sign in or register` 那枚蓝底深字在暗档下仍读得清 |
| `assistant.png` | 助手屏底色是这七张里最深的（`modalLuminance=12`）；`History` `Read only` `Execute` 三枚里 `Execute` 蓝、其余白 —— 选中态在暗档可辨；四枚建议 chip 无截断 |
| `ai-settings-via-assistant.png` / `ai-settings-group.png` | 同一屏（见 §3 的哈希）；三枚未选中圆环 + 托管卡一枚 —— r133 §六那枚**对比度候选缺陷在交叉格里同样在场**，它是 token 层的，与语态/外观档无关 ⇒ 不新增缺陷条目 |
| `help-feedback.png` | `Language` 段：`中文` 未选 / `English` 选中（蓝底胶囊）⇒ 语言开关的**选中态**在暗档也是画出来的，不是只写在 traits 里；`Help and feedback` + `Complaints and reports` 完整在场。顶部那行被切一半是滚动位置，不是布局缺陷 |
| `auth-sign-in.png` | 全英全暗；`Server address` 默认值 `https://heyta.waytofuture.cn` 完整未截；底部段头 `⋯ Other ways to sign in` |
| `auth-other-ways-expanded.png` | 段头换成 `⋯ Hide other ways to sign in`，其下 `Sign in with an email link` / `Sign in with a passkey` 两枚按钮**文字完整、左右不裁**（英文比中文长，这一格本来最可能裁，实测没有） |

## 5. 这一趟量出来的一枚**新缺陷**（账号面那枚展开按钮：可及名称 ≠ 可见文字）

`auth-other-ways-expanded.png` 上看得见的是 **`Hide other ways to sign in`**，
而同一步的无障碍树里那枚控件的名字是 **`Or use another way`**（`toggleNode.AXLabel`，
且收起/展开两态**都**是这个值）。回源码：

- `apps/mobile/src/screens/AuthScreen.tsx:865-872` ——
  `Pressable` 上写死 `accessibilityLabel={t('common.auth.form.otherWays')}`，
  子节点 `<SectionHeader title={open ? t('…otherWaysClose') : t('…otherWaysOpen')}>` 才是屏幕上那行。
  RN 里容器一旦有 `accessibilityLabel`，子树不再单独暴露 ⇒ **可见文字永远进不了无障碍树**
  （这正是 r134/r135 那两次"标签不在场"假缺陷的同一枚成因，见 #481）。
- 目录里三枚 key 各自不同句：`otherWays`=「或者用别的方式 / Or use another way」、
  `otherWaysOpen`=「其他登录方式 / Other ways to sign in」、`otherWaysClose`=「收起其他登录方式 / Hide other ways to sign in」。
- **web 端不同形**：`packages/ui/src/auth/AuthForm.tsx:1225-1240`
  把 open/close 文案**直接**当按钮文字渲染 ⇒ 名称=可见文字。同一份表单，移动端读出来的是另一句。

违背的是 WCAG 2.5.3「Label in Name」，且**双语两档四格全中**（中文浅档 r134 就已经是这形状，
只是这一趟才把它读准）。修法与同类范围见台账 r137 那一格与陷阱 #487。

## 6. 顺带修掉本线装置自己的一枚命名谎（陷阱 #486）

两枚 JSON 里 `startedAt` **比它自己的 `steps[*].at` 还晚**（ai：`10:40:32` vs 最晚一步 `10:40:21`）。
成因：`"startedAt": time.time()` 写在**收笔那个 dict 字面量**里
（`scripts/qa/ai-face-ios.py`（`out.write_text(json.dumps({…}))` 那一处）、
`scripts/qa/account-face-ios.py`（同上那一处）），
量到的是收笔时刻。已改成起跳前取 `started_at` 并另加 `finishedAt`，
**改完用一次真跑验序**（`~/.qoder-cn/tmp/heyta-r137/rig-check/`，`rc=0`）：
`startedAt 1792378337.94 ≤ min(step.at) 1792378346.78` 且 `finishedAt 1792378359.23 ≥ max(step.at) 1792378359.23`。
⇒ **本文件与这两枚已落盘 JSON 里的 `startedAt` 仍是旧口径**（证据件不回写），
真实时间线以 PNG 的 mtime 为准：`10:39:56 → 10:41:12`。

## 7. 这一趟**不证**什么

1. **不证已配置态** —— 这台模拟器没有 AI 端点、也没登录，走的仍是 `notConfigured` 与未登录那一支。
2. **不证注册档** —— `我同意服务条款与隐私政策…` 那枚 `Checkbox` 只在注册档渲染，本趟 marks 里它是 `false`（**因为不在场**，不是因为翻成英文就丢了）。
3. **不证任何写入** —— 三枚闸门、端点新增、`Complaints and reports` 那一下真的拉起邮件页，一律没按（只读纪律）。
4. **不证 iPad / 窄屏 / 大字体 / 系统英文（iOS 语言）** —— 本趟翻的是**应用内**语态，`simctl` 的系统语言没动。
5. **不证当前源码** —— 装机件仍是 `head-r128` 那一枚（`2026-10-18 18:11`）。§5 那枚缺陷是**读源码 + 读无障碍树**定的，不是"新构建已修好"。

## 8. 设备状态与复跑

**已还原**：`appearance light`（`simctl ui` 回读 `light`，且还原前 `shutdown`+`boot` 过一次）、
语态 `--to zh`（9 步 `rc=0`，`常规/同步与隐私/数据管理/账号安全` 四枚回读命中）。
通知授权仍是「不允许」（r132 那处未还原状态）。
**载体状态变化要记一笔**：本趟起跳前发现上一会话那台模拟器已被**别处**关机、
companion pid 31182 不在了（`ps` 现量为空）—— 本趟是自己 `boot` 起来的，
装置各自另起了 companion，**没有按名字收任何进程**。

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
B=apps/mobile/evidence/ux-final-20261018
python3 scripts/qa/ios-app-language.py --udid $U --to en
xcrun simctl ui $U appearance dark && xcrun simctl shutdown $U && xcrun simctl boot $U   # #471
python3 scripts/qa/ai-face-ios.py      --udid $U --evidence-dir $B/ios-ai-face-r137/english-dark
python3 scripts/qa/account-face-ios.py --udid $U --evidence-dir $B/ios-account-face-r137/english-dark
xcrun simctl ui $U appearance light && xcrun simctl shutdown $U && xcrun simctl boot $U   # 收尾两维都要还原
python3 scripts/qa/ios-app-language.py --udid $U --to zh
```
