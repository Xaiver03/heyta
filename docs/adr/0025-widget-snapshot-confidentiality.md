# ADR-0025：小组件快照的机密性 = **设备密钥加密**；锁屏默认**不暴露**

> 状态：**已接受**
> 日期：2026-09-27
> 决定：**共享容器里放「设备密钥加密」的快照，组件内只做一次对称 AES（AES-GCM-256）；
> 密钥由应用侧原生模块预派生好、放进共享 Keychain / Keystore，组件里永不跑 Argon2id。
> 锁屏侧取一组正交的「不暴露」默认值：首版不做锁屏组件、Android 显式 `not_keyguard`、
> iOS 默认脱敏且内容需显式 opt-in。清单颜色在快照里传已解析的 `{ light, dark }` 十六进制。**
> 依据：[ADR-0024](0024-desktop-shell-and-ui-convergence.md)（小组件不纳入 UI 收敛）、
> [多端选型：小组件的证据](../research/multi-platform-selection-evidence.md)、
> [原生小组件调研](../research/native-widgets.md)、
> [E2EE 产品怎么把数据放进系统组件](../research/e2ee-widget-key-handling.md)

---

## 1. 背景与约束

### 1.1 这道题的全部难度来自一句话

**系统组件跑在应用的私有容器之外。**

组件是独立进程（iOS 是 app extension、Android 是另一个进程、鸿蒙是 FormExtensionAbility），
它读不到应用沙箱里的 SQLite。所以要让组件显示任何东西，就必须把数据
**搬到应用私有容器之外**的某个共享位置（iOS App Group、Android 共享 `SharedPreferences`、
鸿蒙 `preferences`）。

**这一步是整道题的成本所在**：数据一旦出了私有容器，静态保护等级就由平台的共享容器默认值决定，
而那个默认值**不是**"锁着就不可读"。

### 1.2 三条不能违反的既有约束

| 约束 | 出处 | 对本 ADR 的影响 |
|---|---|---|
| 系统小组件**不纳入** UI 收敛（3 份原生 UI + 1 个 JSON 模板） | [ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2 | 所以共享的只有**数据契约**；本 ADR 只管"数据怎么落"，不管"界面怎么写" |
| 组件**不得构造 op**（一次用户意图 = 一条 op，op 构造只在 `packages/app-host`） | `AGENTS.md` §3.4 / §3.5，由 `scripts/check-widgets.mjs` 钉住 | 组件只能写**意图队列**，应用下次启动时 drain 成 op |
| 默认端到端加密；托管/云端是**显式例外**，必须单独披露与授权 | [ADR-0006](0006-supply-modes.md)、[ADR-0013](0013-cloud-ai-and-maas.md) | 小组件是**又一个**"数据离开私有容器"的出口，不能默认明文 |

### 1.3 一个决定了选项空间的硬前提

**组件的进程跑不了应用的完整运行时**（Hermes / Node 起不来，跨端框架的渲染层也进不去）。
这条由 [多端选型的证据](../research/multi-platform-selection-evidence.md) 用上游一手工程记录证明，
也是 ADR-0024 禁掉 headless-JS 组件库的同一个理由。

它的直接后果是：**凡是需要"重"计算的方案都不能选** —— 其中最先被排除掉的就是 **KDF（Argon2id）**。

---

## 2. 决策

### 2.1 决策一（D1）：**设备密钥加密的快照**

**共享容器里放一个密文快照 + 一把由应用预先派生好的对称密钥。**

| 环节 | 谁做 | 做什么 |
|---|---|---|
| 派生密钥 | **应用**（有完整运行时） | 用主密钥解开/派生出**设备密钥** |
| 存密钥 | **应用**的原生模块 | 写进共享 Keychain（iOS）/ Keystore（Android） |
| 写快照 | **应用** | 把投影出的载荷加密后写进共享容器 |
| 读快照 | **组件** | **只做一次** AES-GCM-256 解密 |
| 判断过期 | **组件** | 只比 `now >= validUntil`（信封是明文，见 §2.1.3） |

#### 2.1.1 为什么不是明文快照

调研把已上线 E2EE 产品的实际做法归纳成四种模式
（[E2EE 组件调研](../research/e2ee-widget-key-handling.md) §0）：

| 模式 | 真实先例 | 为什么不选 |
|---|---|---|
| A 纯入口型（不显示内容） | Bitwarden、Signal、Element、Obsidian | 不符合本项目的产品目标（组件要显示今日任务） |
| **B 明文快照** | Notesnook **Android**（唯一一例） | 🔴 **放弃静态加密**。它是"加密笔记"产品里唯一走明文的，不是正面参照 |
| **C 组件内解密** | Proton Calendar iOS、Tuta Calendar Android | ✅ **选这个**：两个做内容组件的 E2EE 产品都走了它 |
| D 明确不做 | 1Password、Joplin、Anytype | —— |

**做内容组件的 E2EE 产品只有两个先例，而两个都是模式 C。** 这是本决策最直接的依据。

#### 2.1.2 `Argon2id` 永不进组件

调研明确核实：**四个做内容组件的实现没有一个在组件进程里跑 KDF**
（[E2EE 组件调研](../research/e2ee-widget-key-handling.md) §0）。要么应用侧预先解密好（B），
要么共享容器里预置一把**现成的**密钥（C）。

所以这不是"KDF 在组件里难做"，而是**所有人都没这么做**。本 ADR 把这条写成硬约束：
**组件里只允许出现一次对称解密，不允许出现任何 KDF。**

#### 2.1.3 契约形状（已实现，见 `packages/widget-core`）

| 项 | 值 |
|---|---|
| 契约版本 | `WIDGET_CONTRACT_VERSION = 1`，未知 `v` **fail-closed** |
| 算法 | `WIDGET_ALG = 'AES-GCM-256'` —— **只有一个取值，没有明文选项**；`parseEnvelope` 对任何其它值直接以 `unsupported-alg` 拒绝（有测试钉住）。`contract.ts` 里唯一一处 `'none'` 是**注释**，写的是"将来有人想加明文模式，他会不得不来这里加一个" |
| 信封（明文） | `{ v, dayStr, validUntil, alg, nonce, ciphertext }` |
| AAD | `` `${v}\|${dayStr}\|${validUntil}` `` —— 信封字段被**密码学绑定**，改一个字节就解不开 |
| 载荷（密文内） | 今日任务 / 四象限 / 习惯 / 专注 / 清单颜色 |

**为什么信封是明文的**：组件要在**拿不到密钥**的情况下也能判断"这份快照过期了"。
`v` / `dayStr` / `validUntil` 不泄露任务内容，但足够让组件在锁屏或重启后
显示正确的占位状态而不是过期数据。

#### 2.1.4 密钥的 accessibility：默认 `WhenUnlockedThisDeviceOnly`

| 平台 | 选择 | 理由 |
|---|---|---|
| iOS | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` | 锁屏时组件读不到密钥 → 顺带得到"锁屏无内容"；不改密码即可随设备迁移的问题被 `ThisDeviceOnly` 关掉 |
| Android | Keystore，**不用** device encrypted storage | Google 官方明确劝阻为组件把密钥搬进 device encrypted storage（[E2EE 组件调研](../research/e2ee-widget-key-handling.md) §3）；**建议不做 `directBootAware`** |

⚠️ **这条选择有代价，如实记**：锁屏期间组件**刷新会失败**，必须优雅降级到占位符
（Proton 的 `makeLoggedOutTimeline()` 就是这个形状）。
另一条路 `AfterFirstUnlockThisDeviceOnly`（Proton 的选择）刷新更稳，但静态暴露窗口更大。
**本 ADR 选前者**，因为首版没有锁屏组件（§2.2），刷新失败只是"锁屏时看到旧内容/占位符"，
而静态暴露是永久的。

### 2.2 决策二（D6）：锁屏默认**不暴露**

🔴 **本 ADR 最想让人记住的一条：加密快照解决不了锁屏可见性，这是两件正交的事。**

模式 C 的先例恰好证明了这一点：**Proton Calendar 的密钥是"设备锁着也能读"的**
（`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`），它没泄露是因为**它不做锁屏组件**；
Day One 的锁屏组件**不含内容**。加密快照管的是**静态泄露**
（设备备份、越狱后翻容器、取证镜像），**不管**"锁屏上能被看到"。

所以锁屏侧要单独取一组默认值，首版**全部选"不暴露"**：

| 措施 | 具体做法 | 状态 |
|---|---|---|
| **首版不做锁屏组件** | 只做桌面 / 主屏组件 | 本 ADR 决定 |
| Android 主动退出锁屏 | manifest 声明 `"not_keyguard"` | W1 落地 |
| iOS 默认脱敏 | 默认只显示"今天 N 条"，**内容需显式 opt-in** | W2 落地 |
| 登出 / 换账号清空快照与密钥 | fail-closed | W1/W2 落地 |
| 组件安全清单 | 配置 Activity 不 `exported`、组件 id 不当会话凭据、不因组件 id 命中就自动登录 | W1 落地 |

最后一条来自一个真实的组件侧 CVE：**CVE-2026-44965 / GHSA-p6pw-xx6v-j4hh（Datadog Android）** ——
`android:exported="true"` 的配置 Activity + 可枚举的 `EXTRA_APPWIDGET_ID` → **自动登录**
（[E2EE 组件调研](../research/e2ee-widget-key-handling.md) §4.4）。
这类漏洞与"快照加不加密"无关，**必须单独防**。

### 2.3 ⚠️ 一个已知的强制取舍：Continuity ↔ `NSFileProtectionComplete`

Apple 提供了一条官方的"锁屏即隐藏"机制：给 widget extension 加 Data Protection capability、
设成 `NSFileProtectionComplete`。官方原文说，这样设置后
*"WidgetKit hides these widgets' content when the device is passcode locked and displays a
placeholder until a user authenticates after they restart their device."*

**代价**：这类组件**不能**再作为"Mac 上的 iPhone 组件"使用（Continuity）。
也就是说 **`NSFileProtectionComplete` 与 Continuity 互斥，二者只能选一。**

**本 ADR 的选择：首版不设这个 capability。**

理由：
1. 首版**没有锁屏组件**（§2.2），所以锁屏上**没有任何东西需要被隐藏** —— 这个开关此刻无事可做；
2. "锁屏拿不到内容"这个性质在首版由**密钥层**提供（§2.1.4 的 `WhenUnlockedThisDeviceOnly`），
   而那是一个更单一、更可审计的开关；
3. 设了它就等于**单方面关掉** macOS 端的一条路径，而那条路径还没有被评估过。

🔴 **一旦将来要做锁屏组件，这个选择立刻变成强制的**，不能再拖：
那时必须在「锁屏隐藏内容」与「Mac 上的 iPhone 组件」之间明确选一个。
本条一并约束 **W2**（iOS 落地）与未来的 macOS 决策。

### 2.4 决策三（D7）：清单颜色传**已解析的** `{ light, dark }`

快照里的 `projectColors` 是 `Record<projectId, { light: string; dark: string }>`，
两份都是 `#rrggbb`。

**理由不是"原生做不到"，而是"不该让四端各做一遍"。**
`Project.color` 存的是**槽位号字符串**（`"3"`，见 `packages/app-host/src/project-actions.ts`），
要把 `"3"` 变成颜色必须有人做「槽位 → 颜色」的映射。放进快照 = 应用做**一次**；
传槽位号 = **四个平台各写一份 `switch(slot)` 并各认一次明暗** ——
而这类复制**不会报错**，症状是"某端颜色不对，且只有那端不对"。

另外 `{ light, dark }` **不是新概念**：它就是
`packages/design-system/generated/HeytaTokens.swift` 自己的形状
（`enum Light { colorCategory1..8 }` + `enum Dark { colorCategory1..8 }`）。

#### ⚠️ 这条决策的证据被更正过一次（2026-09-27）

原证据写着"生成的原生 token 文件里一个类别色都没有（`grep -c category HeytaTokens.swift` = 0），
**所以原生无法解析**" —— **那是错的**。`grep -c` **大小写敏感**，而原生标识符是
`colorCategory1`（**大写 C**），所以那条命令返回 0 只证明**我用错了大小写**。
换成 `grep -ci` 得到 **16**（明暗各 8 个），**原生一直都有这些色**。

**结论不变，理由换了**：从"原生做不到"（技术不可行）改成
"不该让四端各做一遍"（单一真源）。这个更正已同步到
`packages/widget-core/src/contract.ts`，并在两处都保留了作废原文以防照着旧结论推理。

**同时补记一个原来漏掉的代价**：换调色板后**已生成的快照仍带旧色**，直到应用再跑一次刷新。
传槽位号则会立刻变新色。可接受 —— 快照有 `validUntil` 且每次应用启动都重算，陈旧时间**有界**。

---

## 3. 后果

### 正面

- 共享容器里**没有明文任务内容**，静态泄露面收敛到"一个密文文件 + 一把密钥"，且密钥的
  accessibility 是**显式、可审计**的一个开关；
- 组件侧的实现被压到最小：**一次对称解密**，没有 KDF、没有业务逻辑、没有 op 构造；
- 锁屏侧的三个默认值都是"不暴露"，与 Proton / Day One / Obsidian 的外部证据一致；
- 契约只有一个版本号且未知版本 fail-closed，四端可以各自独立实现、对着同一份 golden fixture 测。

### 负面 / 必须接受的成本

| 代价 | 说明 |
|---|---|
| **每端多一个原生模块** | 两端本来就没有任何自定义原生模块；(b) 在此之上**多要**一条"生成/存取设备密钥"的桥 |
| **设备密钥的生命周期需要单独设计** | 谁生成、如何被主包裹、登出/改密码/多账号时如何轮换与销毁 —— 这是一个**独立的设计**，本 ADR 只定边界，不代替它 |
| **锁屏期间组件刷新会失败** | `WhenUnlockedThisDeviceOnly` 的直接后果 → 必须降级到占位符，不能显示过期内容 |
| 🔴 **重启后、应用首次运行前，组件只能显示占位符** | 这是 (b) 的**固有代价**，也正是**明文方案唯一真正赢的地方**（明文在重启后立刻能显示）。**必须写进验收预期**，否则会被当成 bug 报回来 |

### 需要靠规范兜住的

1. **组件里出现 KDF = 违规**（§2.1.2）。这条要进 W1/W2/W4 的验收清单。
2. **登出必须清空快照与密钥** —— 否则上一个账号的内容会残留在组件里。
3. **`check:widgets` 已钉住的三条边界**（不得 import `app-host`、不得构造 op、夹具不得手改）
   在四个平台的原生实现里**没有对应的自动门禁**（现有门禁只扫 TS）；
   原生的正确性靠"对着 golden fixture 写测试"，这需要在 W1–W4 各自落地。

---

## 4. 与既有 ADR 的关系

| ADR | 关系 |
|---|---|
| [ADR-0024](0024-desktop-shell-and-ui-convergence.md) | **本 ADR 是它的下游**。0024 §2.1 已写明"系统小组件不纳入 UI 收敛"，本 ADR 不再重复那条，只处理"数据怎么落" |
| [ADR-0003](0003-multi-platform-strategy.md) | 沿用"业务逻辑全在 `packages/`"；小组件的共享层是 `packages/widget-core` |
| [ADR-0006](0006-supply-modes.md) / [ADR-0013](0013-cloud-ai-and-maas.md) | 沿用"默认 E2EE、托管是显式例外"。本 ADR **不**为小组件开任何例外 |
| [ADR-0010](0010-ai-config-routing.md) | D7 引用了它 §3.10.1 的形状（同一件事有两个实现就会漂移） |

---

## 5. 🔴 未核实项（在确认前不得当作已成立）

| # | 未核实 | 影响 |
|---|---|---|
| 1 | **Apple 是否对 App Group 容器有单独的 Data Protection 默认值** —— Apple 只写 "all third-party app data not otherwise assigned"；"App Group 因此默认 Class C" 是**基于措辞的推断**，未找到逐字表述 | §1.1 与 §2.2 的背景陈述 |
| 2 | **iOS 桌面组件在锁屏 Today View 的可见性边界** —— "Lock Screen Widgets" 与 "Today View and Search" 是两个独立开关，确切组合行为**需真机验证** | §2.2 的"不做锁屏组件"是否足够 |
| 3 | **Continuity 组件在 iPhone 不在身边时的行为**，以及它与 `ThisDeviceOnly` 密钥的相容性（`ThisDeviceOnly` 的密钥按定义不离开设备，而 Continuity 的数据路径本 ADR 未核实） | §2.3 的取舍可能比现在更受限 |
| 4 | **2FAS 的密钥存储机制** —— 官方支持页只描述了现象（重启后组件拿不到密钥），未说明机制 | §2.1.4 的"重启后占位符"预期 |
| 5 | **是否存在针对 E2EE 产品锁屏组件泄露的审计发现** —— 本次**未找到**，按"未找到"记录，**不等于"不存在"** | §2.2 的风险判断 |
| 6 | **`@bacons/apple-targets` 的授权凭证只在 npm 包内** | W2 是否能自动生成 widget target |
| 7 | **鸿蒙是否存在 iOS App Group 等价的共享容器** —— 鸿蒙卡片进程不能 `getContext`，FormExtensionAbility 能读 `preferences`，但"应用与卡片是否共享同一个 `preferences` 命名空间"未实测 | §2.1 在鸿蒙上的可行性 |

> ⚠️ 第 1、2、3 条直接影响本 ADR 的**安全性叙述**（而不是它的方向）。
> 如果第 1 条被推翻（App Group 不是 Class C），§2.2 的紧迫性上升；
> 如果第 3 条成立（`ThisDeviceOnly` 与 Continuity 不兼容），§2.3 的取舍要从"以后再说"提前。

---

## 6. 决策摘要（一句话）

> **走设备密钥加密**（组件内只做一次 AES，永不跑 KDF），
> **锁屏默认不暴露**（首版不做锁屏组件 + Android `not_keyguard` + iOS 默认脱敏），
> **首版不设 `NSFileProtectionComplete`** 以保留 Continuity 这条路 ——
> 但要记住这两者**互斥**，一旦做锁屏组件就必须二选一；
> **颜色传已解析的 `{ light, dark }`**，理由是"槽位→颜色只该解析一次"，
> **不是**"原生做不到"（那条原始证据已被更正，见 §2.4）。
