# r140 · iOS 个人资料/设置面装机态四格（中文×浅 · 中文×暗 · 英文×浅 · 英文×暗）

台账那句「个人资料/账号/AI/帮助的剩余交互回归」里，**个人资料**这一面此前只有 r131 的中文两档，
而且拿的是旧件。这一趟把它补成与账号面（r139）、AI/帮助面（r139）同一形状的**四格**，
用的是同一枚装机件。

## 1. 出处

| 项 | 值 |
|---|---|
| 被测物 | 隔离载体 `/Users/rocalight/heyta-carriers/head-r128` 打出的包，装进设备的 `Info.plist` mtime `2026-10-19 11:23:59`（与 r139 两面同一枚件） |
| 装置 | `scripts/qa/profile-settings-ios.py`（**本趟改过**，见 §5；改后版本才跑出这四格） |
| 设备 | 模拟器 `heyta-iphone-17pro` / `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，截图 1206×2622 |
| 四格 | `current-source/`（中文×浅）· `dark/`（中文×暗）· `english/`（英文×浅）· `english-dark/`（英文×暗） |
| 反臂 | `mutation-arm-en-on-zh/` · `mutation-arm-zh-on-en/`（两向都红，见 §3）· 拒写臂 `mutation-arm-claim-dark`（**没有落点**，见 §4） |

旅程（只读）：首页 → 「我的」→ 设置目录 → 常规 → 返回 → 同步与隐私 → 返回 → 数据管理 → 备份与迁移 →
返回×2 → 关闭设置 → 查看完整成长 → 返回 → 滚到「清单」→ 清单 → 返回。

## 2. 读数

| 格 | 步数 | 结果 | `startedAt`→`finishedAt` | 语言由什么立住（AX 树命中的标签） |
|---|---|---|---|---|
| `current-source/` | 23 | passed | 1792388810.70 → 1792388846.18 | 「设置, 个人资料、偏好、同步与安全」/「常规」/「同步与隐私」/「数据管理」/「账号安全」 |
| `dark/` | 23 | passed | 1792388749.75 → 1792388777.39 | 同上（中文整组） |
| `english/` | 23 | passed | 1792387235.99 → 1792387266.00 | "Settings, Profile, preferences, sync and security" / "General" / "Sync and privacy" / "Data management" / "Account security" |
| `english-dark/` | 23 | passed | 1792388251.23 → 1792388285.60 | 同上（英文整组） |

每一格的 `settings directory` 那一步在 JSON 里带 `language` + `expected`（五枚分组标题）+
`otherLanguageAlsoComplete`（四格全为 `[]` ⇒ 屏幕上另一档**整组不齐**，不是"两档混着都看得见"）。

## 3. 语言维：这一格第一次由装置自己守（陷阱 #488 的续）

判据形状：`--language` 声明哪一档，就要求 `DIRECTORY_GROUPS[那一档]` **五枚分组标题整组在场**，
整组不齐就红，且失败文本回读**哪一档整组在场**。以前这里是写死的中文候选（注释说"单语才 fail-closed"），
后果不是"英文档判得松"，而是**英文档整条旅程在设置目录那一步就断** ⇒ 这一面从来没有装机态英文读数。

两枚反臂证明这把尺两头都能红（不是恒绿）：

| 反臂 | 设备实际语态 | 声明 | 结果 | 失败文本里的关键一段 |
|---|---|---|---|---|
| `mutation-arm-en-on-zh/` | 中文 | `--language en` | `rc=1`，5 步后红 | `missing 'en' group labels [...]; languages whose whole group IS visible on screen=['zh']` |
| `mutation-arm-zh-on-en/` | 英文 | `--language zh` | `rc=1`，5 步后红 | `missing 'zh' group labels [...]; languages whose whole group IS visible on screen=['en']` |

⇒ 系统域 `AppleLanguages` 说什么**不参与判定**；这一条与 #488 同源，但现在钉在装置里而不是靠人记得去看 AX 树。

## 4. 深浅维：两把尺，其中一把这趟扩了牙

`require_appearance`（住在 `ai-face-ios.py`，三面共用一份）以前只在末级名**恰好**等于 `light`/`dark` 时才有牙，
于是 `english-dark/` 这种"语言×档"合一的目录名没有判据。本趟把它扩成 **`*-dark` 结尾也算声称暗档**：

| 格 | 目录名声称 | 装置回读的档 | 五张图的 `modalLuminance`（按文件名 general/growth/my/settings-directory/sync） |
|---|---|---|---|
| `current-source/` | 不点档 | light | 252 / 252 / 252 / 252 / 252 |
| `english/` | 不点档 | light | 252 / 252 / 252 / 252 / 252 |
| `dark/` | `dark`（有牙） | dark | 28 / **12** / 28 / **12** / **12** |
| `english-dark/` | `-dark`（本趟起有牙） | dark | 28 / **12** / 28 / **12** / **12** |

`dark` 两档里 `growth.png`/`settings-directory.png`/`sync.png` 是 12（模态底更黑），另两张 28 —— 两档各自内部逐张一致
（中文档与英文档同一枚件、同一屏，五张读数完全同值），且与不点档的两格（全 252）分开得清清楚楚 ⇒ 像素那把独立尺与目录名那把尺同向。
**拒写臂**：`--evidence-dir .../mutation-arm-claim-dark` 在设备为 light 时 `rc=1`，
文本 `refusing to write: evidence dir says 'dark' but the device is 'light'`，
且**该目录根本没被创建**（一行旅程都没走）—— 这一格是"红在没有落点"，取证就是这条命令本身。

设深走 #471 那条（`shutdown`→`boot`→`simctl ui … appearance dark`），收尾已还原 `light`。

## 5. 装置这一趟改了什么（四处，全在真跑里被逼出来）

1. **`--language` + 整组语态断言**（§3）。
2. **`scroll_to` 以前只吃第一枚候选** —— `AX.scroll_into_view(..., wanted[0], ...)` 写死，
   所以英文屏上「清单」不在树里，量具回 `found=False / scrollRc=element-left-tree`，
   而旅程 22 步全绿、只有这一步红。那是**装置的病**，不是界面的病：双语候选列表在滚动这一位上
   静默退化成单语。改成逐枚试滚，`scroll lists entry` 现在记 `target=['Lists'] tried=['清单','Lists']`。
3. **起跳点以前不重启 app** —— 三面里只有这一面漏了 `terminate`+`launch`：上一趟红在设置模态里，
   手就留在那一屏，下一趟死在"等首屏标签"（实测红过一次）。补成与 `ai-face-ios.py`／`account-face-ios.py` 同一形状。
4. **两处单语断言补齐双语**：`then` 槽「隐私同意」/`Privacy consent`、`absent` 槽「整理与记录」/`Organize and capture`；
   引导那两下的 `then` 槽同样补齐。`absent` 那一处以前是**永远不咬的空判据**
   （英文屏上禁的是中文那行字，屏幕上写的是 "Organize and capture"），它当时安全的前提是
   "英文档走不到这一行" —— 前提被第 1 条取消了，所以必须补。
5. 读数补 `startedAt`/`finishedAt`/`language`/`appearance` 四枚字段（#486 同一件事）。

`check:locator-labels` 现量 `rc=0`，`profile-settings-ios.py` 读到 90 组（含中文 51 ≥ 基线 44）。
它披露的那 1 条"组内整片单语"就是 `DIRECTORY_GROUPS["zh"]` 那一组：门把每枚元组当一个组，
两档**必须**分开写（合写会让「常规」去配 "Sync and privacy" 而红），所以这条披露是形状不是欠项，已写在代码注释里。

## 6. 人看图（20 张里看 5 张，其余按像素）

| 图 | 看到什么 |
|---|---|
| `current-source/settings-directory.png` | 浅底：段头「偏好与账号」+「选择要调整的内容。」，五枚蓝色分组标题（常规/同步与隐私/AI 与集成/数据管理/账号安全），图标齐全 |
| `dark/settings-directory.png` | 同一屏深底：五枚标题蓝字在白底黑字段头下仍清晰，卡片边界在深底上可见 |
| `english/settings-directory.png` | "Preferences and account" / "Choose what to adjust." / General / Sync and privacy / AI and integrations / Data management / Account security —— 与 AX 命中的标签逐字相同 |
| `english-dark/my.png` | 深底「我的」：Account 段、"Not signed in"、主按钮 "Sign in or register" 浅蓝底深字、Settings 行副文案 "Profile, preferences, sync and security"、Recent activity 三行读数、tab 栏 Tasks/Calendar/Focus/Categories/Profile |
| `english/growth.png` | "My growth"：Streaks 空态插画 + "No habits yet. Create one in Profile → Habits to start tracking." + 蓝色 "Habits" 主按钮 |

## 7. 不证（别把这一格读成这些）

1. **这一面不证任何写入路径**：旅程只读，不改设置、不导出、不清理数据、不登录。
2. **英文档的 tab 栏标签与 `ai-face-ios.py` 的 `TABS` 常量不一致**：设备上渲染的是
   `Categories`/`Profile`，那枚常量写的是 `Lists`/`Me`。今天不影响 `tab_top()` 的 `min()`
   （同一行里 `Tasks`/`Calendar`/`Focus` 三枚命中），但那是**候选表里的两枚死字** —— 登记，本线未裁决，
   没有顺手改（改它要重跑 AI 面四格才不算"改了判据没取读数"）。
3. **四端不等于四端**：这一趟只跑 iOS 模拟器。windows / android 两端仍堵在打包主机不可达
   （本轮四端真实状态见台账 r139 续那一格）。
4. 反臂那两趟的 `my.png` 是**红趟留下的**（它们在第 5 步红，之前已经截了一张「我的」），
   按像素是 252 —— 这两张不参与深浅档判定，只是别把它们读成"又一格亮档读数"。
5. 载体在构建后不干净（`Info.plist` ×2 与 `Podfile.lock` 被 pod install 重写），**本线没有提交那三枚**（读法见 #489）。

## 8. 复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
D=apps/mobile/evidence/ux-final-20261018/ios-profile-face-r140
# 中文×浅（装置自己 terminate+launch，起跳点不用手工摆）
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir $D/current-source --language zh
# 英文两档
python3 scripts/qa/ios-app-language.py --udid $U --to en
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir $D/english --language en
# 暗档（#471：设深要放在 shutdown+boot 之后）
xcrun simctl shutdown $U && xcrun simctl boot $U && sleep 6
xcrun simctl ui $U appearance dark
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir $D/english-dark --language en
python3 scripts/qa/ios-app-language.py --udid $U --to zh
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir $D/dark --language zh
xcrun simctl shutdown $U && xcrun simctl boot $U && sleep 6
xcrun simctl ui $U appearance light                         # 收尾还原
# 反臂（两向都必须红）
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir $D/mutation-arm-en-on-zh --language en
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir $D/mutation-arm-zh-on-en --language zh
# 拒写臂（设备在 light 时必须 rc=1 且不建目录）
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir $D/mutation-arm-claim-dark --language zh
```

设备当前状态（本趟收工时现读）：`appearance = light`、应用内语言 = 中文（`--to zh` 8 步 `rc=0` 且回读通过）、
**没收任何 companion**。
