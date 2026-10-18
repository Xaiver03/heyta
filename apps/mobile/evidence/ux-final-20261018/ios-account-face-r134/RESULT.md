# r134 · iOS 账号面（注册 / 登录）装机态深浅两档

> 台账那一格的原话是「个人资料/账号/AI/帮助的剩余交互回归」。
> 个人资料 = r131，AI 面 + 帮助面 = r133，**账号面此前一次装机态读数都没有**（只有浏览器读数）。
> 这一格补的就是那一面。

## 1. 出处（读这一趟之前要知道它是哪棵树、哪枚件）

| 项 | 现量 |
|---|---|
| 取数时仓库 tip | `git rev-parse --short HEAD` = `601ae89f`（共享工作树，取数期间仍在被别人推进） |
| **装机件**来自哪棵树 | 载体 `/Users/rocalight/heyta-carriers/head-r128` @ `f8d7155e`（第八趟四端重装那一枚） |
| 装机件时间戳 / 版本 | `…/Heyta.app/Info.plist` mtime `2026-10-18 18:11`，`CFBundleShortVersionString` `1.0` |
| 与 r131/r132/r133 的关系 | **同一枚件**（那一列 mtime 逐字相同）⇒ 本趟不主张"当前源码的界面"，只主张"这台机上那枚件的界面" |
| 设备 | 模拟器 `heyta-iphone-17pro` / `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，屏 `[402, 874]` |
| `idb_companion` | pid `31182`，**未收**（收掉它会让下一趟读回空树） |
| 深/浅档怎么设的 | `xcrun simctl ui <udid> appearance dark` 之后 **`shutdown` + `boot` 一次**才到达那枚件（陷阱 #471） |
| 落点 | `ios-account-face-r134/{light,dark}/` 各一枚目录（陷阱 #472：同目录 + 固定文件名 ⇒ 后一趟静默吃掉前一档） |
| 装置 | `scripts/qa/account-face-ios.py`（本趟新建，**只读**），复用 `scripts/qa/ai-face-ios.py` 的 `tap_in_viewport` / `reveal_in_viewport` / `require_appearance` |

⚠️ 本趟**没有**重装任何端。"从最终源码四端构建重装"那一格的状态见台账与交接，windows/android 两条腿仍卡在打包机不可达。

## 2. 这一格判什么、不判什么

判：从「我的」进注册/登录这条路**在装机件上走不走得通**，以及登录表单在**收起 / 展开**两态下渲染出什么、深浅两档下渲染得对不对。

不判（清单在第 7 节）：不登录、不发邮件、不唤起系统通行密钥面板，因此**不主张**任何一种凭证流转可用。

## 3. 旅程与读数（11 步，两档各一次，均 `rc=0`）

```
「我的」tab → 注册 / 登录 → 登录表单（收起态）→ 展开「或者用别的方式」→ 收起 → 「返回」回「我的」
```

| 步 | 关键读数（两档一致） |
|---|---|
| `open sign-in` | 目标 `注册 / 登录` 帧 `[16, 283, 370, 44]`；到达判据用 `用邮箱和密码登录` **配 `absent=PROFILE_ROWS`** —— 因为登录页顶栏标题与入口按钮**同字**（都叫「注册 / 登录」），单靠标题会把"还停在「我的」"判成到达 |
| `auth form state` | 邮箱框在场（标签或占位符任一命中）、`collapsedToggle=true`；`用邮件链接登录`/`用通行密钥登录`/条款勾选 **三枚都 false**（收起态本就不渲染，见第 5 节） |
| `reveal other-ways toggle` | 开关帧 `[16, 612, 370, 31]`（两档逐字相同） |
| `expand other ways` | 到达判据 = 「用邮件链接登录」∨「用通行密钥登录」 |
| `expanded state` | `magicLink=true`、`passkey=true`、`headerNow=[]`（见第 5 节那条被否证的缺陷）、`toggleNode.AXValue="expanded"` |
| `collapse other ways` | 反向判据：`expandedGone=true` |
| `auth back to profile` | 目标 `返回` 帧 `[342, 68, 44, 44]`；回到「我的」段（`设置, 个人资料、偏好、同步与安全` 在场、`用邮箱和密码登录` 缺席） |

## 4. 两把尺（都不靠"我看着像"）

**尺一 · 档**：`scripts/screenshots/png-stats.mjs` 的 `modalLuminance`

| 图 | light | dark |
|---|---|---|
| `auth-sign-in.png` | 252 | 28 |
| `auth-other-ways-expanded.png` | 252 | 28 |

**尺二 · 同屏**：同趟内两条路径到达同一屏的两张图逐字节相同（r133 用过、本趟复跑再次成立）；**跨趟**不许用哈希 —— 见第 6 节。

## 5. 四条读数本身（不是缺陷的那四条）

1. **条款勾选在装机态的登录档不渲染**。`apps/mobile/src/screens/AuthScreen.tsx:782` 那枚 `Checkbox` 整块包在 `mode === 'register' ?` 里，从「我的」进来默认落登录档 ⇒ AX 树里读不到 `mobile.auth.terms.label`（`:790`）是**设计如此**，不是无障碍缺失。要证它得走注册档，而注册档要点「还没有这个邮箱的账号？创建一个」——那会真发请求，本趟按只读纪律没点。
2. **「其他登录方式 / 收起其他登录方式」两枚标题在整棵 AX 树里 0 命中，但这不是一条缺陷**（差点登记成缺陷，见环境陷阱 #481）。视觉两态确实换了字（两张截图为证），代码在 `apps/mobile/src/screens/AuthScreen.tsx:865`–`:872` 把它做成带 `accessibilityLabel` 的 `Pressable` 的子 `Text` ⇒ 被父节点合成掉。把**整份节点字典**记进读数后看到 `aria-expanded` 落成 `AXValue: null → "expanded"`（两档 × 两态四份读数一致）⇒ 展开态对读屏**有**信号。
3. **通行密钥在这台模拟器上不可用，而界面把原因说了**：展开态 AX 里有 `这台设备暂不支持通行密钥，请使用账号密码或邮件链接登录。`（`apps/mobile/src/screens/AuthScreen.tsx:901`–`:905`，`passkeyProvider === undefined` 那一支）。这条与"按钮不禁用"是配套的，符合代码注释里那条规范。
4. **服务器地址预填 `https://heyta.waytofuture.cn`，且它排在口令之后的最后一栏**（`apps/mobile/src/screens/AuthScreen.tsx:769`–`:777`，注释写明是产品负责人定的硬排序）。它下面那行提示 `模拟器填 10.0.2.2（指向这台电脑）；真机填局域网地址。` 在**装机态**里对普通用户没有意义 —— 这是一句**文案候选项**，不是缺陷裁决；本线不代改文案口径，登记在此供界面那一线取。

## 6. 一次自己造的事故，和它换来的三条陷阱

- **#483**：为了往 `package.json` 的 `check:locator-labels` 那行追加一枚脚本，跑了一条 `node -e` 的 `JSON.parse`→改一键→`stringify` 往返。它把 `scripts` 的 210 个键**摊到顶层**并抹掉 `name`/`version`/`private`/`packageManager`/`engines`/`devDependencies`/`license` —— `git diff --stat` 现量 `+210 / −229`。已按 `git show HEAD:package.json` 还原（坏件另存），再用逐行编辑补那一行，现量 `package.json | 2 +-`。**共享工作树里这差点被别人带走。**
- **#482**：装置提交后改过（抽出 `require_appearance()`），复跑回归时先按 r133 那把尺比 sha256 ⇒ 10/10 张全 DIFF，看着像"改动改变了渲染"。把差异按行投影后**全部落在 `y=0`–`152`**（状态栏时钟/电量），内容区零差异 ⇒ 跨趟比同屏要用**逐行差异带**，哈希只配管同趟。
- **#481**：见第 5 节第 2 条。

**门的变异臂**（判据要能红）：`CJK_GROUP_FLOOR["account-face-ios.py"]` 从 22 抬到 23 ⇒ `rc=1` 且报「从基线 23 掉到 22」；改回 22 ⇒ `rc=0`。现量命令在最后一节。

## 7. 不证（这一趟**不**主张的事）

1. 任何**登录/注册成功**路径：没输入、没提交、没联网。
2. **魔法链接**收信与「粘贴邮件里的链接或令牌 → 验证并登录」那条出口：按只读纪律没按。
3. **通行密钥**真实可用性：只读到"这台设备不支持"那句提示。
4. **注册档**的条款勾选与两份法务文档链接：需要切档（会发请求），未做。
5. ~~**英文语态**下的这一面~~ —— **本文件 §10（r135 追加）已把它从"不证"里划掉**：应用内语言开关那条通道现在有装置了
   （`scripts/qa/ios-app-language.py`），账号面英文档 11 步全绿，双语定位符第一次在装机件上被**跑**过
   （此前只被 `check:locator-labels` 对过词条表；组数现量 `python3 scripts/qa/check-locator-labels.py scripts/qa/account-face-ios.py`）。
6. **iPad / 窄屏 / 大字体**下的账号面：只有 iPhone 17 Pro 一档。
7. **当前源码**的账号面：装机件是 `head-r128` 那一枚，`601ae89f` 之后若有界面改动不在这张图里。

## 8. 设备状态（结束时）

- 外观已还原 **light**（`xcrun simctl ui … appearance` 回读 = `light`，并 `shutdown`+`boot` 过一次）。
- app 停在「我的」tab，登录面板**已退回**（旅程最后一步 `返回`）。
- **通知授权仍是「不允许」** —— 这是 r132 那趟留下的未还原状态，本趟没有改变它，也没有新的系统弹窗（陷阱 #475：`simctl privacy reset notifications` 在这台模拟器回 `rc=1`，没有复位通道）。
- `idb_companion` pid `31182` 未收。

## 9. 复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
# 浅档
xcrun simctl ui $U appearance light
python3 scripts/qa/account-face-ios.py --udid $U \
  --evidence-dir apps/mobile/evidence/ux-final-20261018/ios-account-face-r134/light
# 深档（设完必须重启一次才到达那枚件 —— 陷阱 #471）
xcrun simctl ui $U appearance dark && xcrun simctl shutdown $U && xcrun simctl boot $U
python3 scripts/qa/account-face-ios.py --udid $U \
  --evidence-dir apps/mobile/evidence/ux-final-20261018/ios-account-face-r134/dark
# 门的变异臂：把 CJK_GROUP_FLOOR 里那行抬 1 ⇒ rc=1；改回 ⇒ rc=0
python3 scripts/qa/check-locator-labels.py scripts/qa/account-face-ios.py
```

---

## 10. 追加（r135）· 英文档 —— 把上面第 5 条"不证"划掉的那一趟

**为什么能划掉**：这台机上应用内语言开关此前没有任何装置走过（陷阱 #469 说清了三条系统语言通道都动不了这枚包），
本趟补了 `scripts/qa/ios-app-language.py`（「我的」→ 设置 → 常规 → 语言那两枚 chip），于是双语定位符第一次被**跑**而不是被**对表**。

| 步 | 读数 |
|---|---|
| 切到 en（9 步全 passed） | 到达判据用**目标档独有**的目录层标签；`otherLanguageMarksLeft: []` ⇒ 整片界面跟着翻了，不只是那一栏标题 |
| 账号面英文档（11 步全 passed） | 每一枚定位符都在英文档命中：入口 `Sign in or register` 帧 `[16, 283, 370, 44]`（与中文档**同帧**），开关 `Or use another way` 帧 `[16, 648, 370, 31]`（比中文档低 36pt —— 英文那段说明多折了一行，不是裁切） |
| 切回 zh（8 步全 passed） | `常规` 那组标签回到树上，`otherLanguageMarksLeft: []`；**设备已还原中文** |

**英文档整屏渲染逐张人眼看过**（`english/language-en.png`、`english/auth-sign-in.png`、`english/auth-other-ways-expanded.png`）：
无截断、无中英混排残留（唯一保留的 CJK 是那枚 `中文` chip —— 两份词条表里同字，`en.ts` 的注释自己写明它是英文表里唯一合法的 CJK 值）。
读到的英文件包括 `This device does not support passkeys yet. Sign in with your password or an email link.` 与
`On an emulator use 10.0.2.2 (pointing at this computer); on a real device use your LAN address.`（第 5 节第 4 条那句文案候选在英文档同样在场）。

**这一趟换来的两枚探针坑（不是产品坑）**：

* **#484** —— 语言那两枚 chip 的**选中态住在 `traits` 里**（`"Selected"` 会跟着切换从一枚挪到另一枚，四份读数两向一致），
  而 `AXValue` 恒 `null`。第一版装置只记 `AXValue`，四份读数正好是"选中态对读屏没有信号"这条**假缺陷**的形状。
  改成记整条节点后与截图（实心蓝底那枚 = 选中）三层对上 ⇒ **不是缺陷**。
* **#485** —— 第 5 节第 2 条那枚 `AXValue="expanded"` 在英文档第一次读回 `null`，成因是我自己的 `toggle_node()`
  写成 `AX.find(tree, OTHER_WAYS[0])`（只拿中文那枚）。改成遍历两枚候选后英文档同样读到 `"expanded"`。
  ⇒ 双语装置的**读数**路径没有 `wait_for(candidates)` 那种兜底，`X[0]` 会悄悄把"我这把尺没量到"写成"产品没有"。

**仍然不证**（英文档这一趟没扩到的）：注册档、任何凭证流转、iPad/窄屏/大字体、以及**当前源码**（装机件仍是 `head-r128` 那一枚）。
