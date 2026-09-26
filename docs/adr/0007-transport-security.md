# ADR-0007：传输安全 —— 允许明文 HTTP，但绝不静默

- **状态**：已接受（**iOS 一节已实测**：私有 IP 字面量明文可用，**与 ATS 无关** —— 归因曾被反证推翻，见 §6）
- **日期**：2026-09-25
- **决策者**：产品负责人（指示："从产品的角度去分析" + "启用 Goal 模式来实施"）
- **影响层**：`apps/mobile`（Android 清单 / iOS ATS / 「我的」界面）、`packages/sync-client`（错误分类、地址判定）
- **相关**：ADR-0006（自备与托管并存）—— 本 ADR 是它在**传输层**的直接后果

---

## 1. 背景：一个让自建用户完全不可用的默认值

heyta 是**自建优先**的（ADR-0006）。目标用户会把服务端跑在 NAS、
树莓派、家里的小主机、局域网的容器里 —— 这些场景**就是明文 HTTP**。

而 React Native 的 Gradle 插件默认把**非 debuggable** 变体的
`android:usesCleartextTraffic` 设成 `false`。实测确认：

```
$ aapt2 dump xmltree --file AndroidManifest.xml app-release.apk
  A: android:usesCleartextTraffic(0x010104ec)=false
```

后果不是"提示用户改用 HTTPS"，而是**这个应用在他们的环境里根本连不上**。

### 实测症状（两个 bug 叠在一起，互相掩盖）

在 Android 模拟器上，把服务器地址填成 `http://10.0.2.2:3000`（宿主机上的真服务端，
`curl` 一切正常）、填好 227 字符令牌与口令、点「立即同步」：

| 观察点 | 结果 |
|---|---|
| 应用进程 | 存活，界面正常 |
| 状态区 | 「**当前离线**」 |
| 服务端 `operations` 表 | **0 行** |
| 服务端 `sync_devices` 表 | **0 行** |

也就是说：**服务端就在那里，应用却告诉用户"你没网"**。

第二个 bug 让第一个无法被诊断：

```ts
// packages/sync-client/src/client.ts（修复前）
return /failed to fetch|network|offline|ECONNREFUSED/i.test(message);
```

Android 实际抛的是

```
CLEARTEXT communication to 10.0.2.2 not permitted by network security policy
```

里面的裸子串 **`network`** 命中了 `network security policy` —— 于是
**"平台不允许这个协议"被分类成"没有网络"**。用户看到「当前离线」，
只会去查 WiFi，永远不会想到是协议被系统拦了。

> 一般规律：**一个正则里的裸子串，可以把两类完全无关的故障合并成一个，而且合并错方向。**
> 这和第 4、7、19 条是同一形状 —— 词表/语义只有一份，就不该在第二个地方再近似一次。

---

## 2. 关键事实：E2EE 改变了这个权衡

不能把"明文 HTTP"简单当成"不安全"就禁掉，也不能因为"反正加密了"就无所谓。
准确的说法是：

| 数据 | 明文信道上是否暴露 |
|---|---|
| 任务标题/内容/清单等**载荷** | ✅ **不暴露** —— 始终是 AES-256-GCM 密文，密钥由口令在本地派生，服务端看不到明文 |
| **访问令牌**（JWT） | 🔴 **暴露** |
| 元数据（op 数量、时间、体积、实体类型） | 🔴 暴露 |

拿到令牌的攻击者可以：读写密文、观察元数据、**删光用户的数据**。
但**读不到任何任务内容**。

所以这不是"能省则省"，也不是"绝对禁止"，而是一个**需要用户知情**的取舍。

---

## 3. 选项

| 选项 | 结果 | 判断 |
|---|---|---|
| **A. 继续禁明文**（保持 RN 默认） | 自建用户在局域网直接用不了；只能上 HTTPS（域名 + 证书 + 端口，对 NAS 用户是不小的门槛） | ❌ 与 ADR-0006 的定位冲突 |
| **B. 放开明文 + 界面明确警告** | 自建可用；公网用户被明确告知风险 | ✅ **采纳** |
| **C. 放开明文 + 静默** | 可用，但公网明文用户会以为自己安全 | ❌ 静默降级，最坏的一种 |
| **D. 只允许私有网段明文** | 最精确 | ❌ Android 的 `network-security-config` **不支持 CIDR**，只能逐个列 host；而 host 是用户运行时输入的，无法在构建期枚举 |

---

## 4. 结论

**采纳 B。三件事同时做，缺一不可：**

### 4.1 平台层：放开明文（Android）

`apps/mobile/android/app/build.gradle` 末尾注册一个**更晚的** `finalizeDsl`：

```gradle
androidComponents {
    finalizeDsl { ext ->
        ext.buildTypes.getByName("release").manifestPlaceholders["usesCleartextTraffic"] = "true"
    }
}
```

🔴 **为什么不能写在 `android { }` 里** —— 这是我第一次写错、并且被产物抓出来的地方。
`@react-native/gradle-plugin` 的实现（`AgpConfiguratorUtils.kt`）本身就是：

```kotlin
.finalizeDsl { ext ->
  ext.buildTypes {
    getByName("release").apply { manifestPlaceholders["usesCleartextTraffic"] = "false" }
  }
}
```

`finalizeDsl` 在 build script 求值**之后**执行，所以写在 `android { }`、
甚至写在 `buildTypes.release` 里的值，**一定会被它覆盖**。
而 AGP 是按**注册顺序**回调的：插件在 `apply plugin: "com.facebook.react"` 时就注册了，
比 build script 里的晚注册者更早 —— 因此上面这段后跑、后写，才是我要的值。

实测教训：**加错位置时 Gradle 退出码 0、日志全绿**，只有从产物里读才看得见真相。
**构建成功不等于配置生效，必须验证产物：**

```bash
aapt2 dump xmltree --file AndroidManifest.xml app-release.apk | grep usesCleartextTraffic
# 期望 =true（写错位置时实测 =false，而那次构建同样"成功"）
```

### 4.2 分类层：策略拦截不再算"离线"

`packages/sync-client/src/client.ts` 的 `isNetworkError` 先排除策略类错误，
再判网络类，并且把裸 `network` 换成更具体的模式：

```ts
const TRANSPORT_POLICY_ERROR = /cleartext|app transport security|network security policy/i;
// 顺序不能换：先策略，后 TypeError
```

**顺序是这条修复的全部要点** —— 两个分支拿到的都是 `TypeError`，差别只在消息。
先判 `instanceof TypeError` 就会把它归成离线。

已加 7 条测试（`packages/sync-client/tests/sync.spec.ts`），
并用"把策略早退短路掉"注入验证过**会红 3 条**。

### 4.3 界面层：明文连接必须被说出来

判定逻辑放在 `packages/sync-client/src/server-url.ts`（**不是** `apps/*`）——
"这个地址算不算危险"是三个宿主必须给出同一个答案的**产品规则**（AGENTS.md §3.5）。

```ts
classifyTransportSecurity(url) → 'secure' | 'plaintext-local' | 'plaintext'
```

「我的」界面在 `plaintext` / `plaintext-local` 时各显示一条警告，
说明**任务内容仍是加密的、但令牌是明文的**。

> 刻意**不是**一句笼统的"不安全"。笼统的警告会让人当成噪音；
> 说清"什么暴露了、什么没暴露"，用户才能做判断。
> 也刻意**不用 emoji** 当图标（AGENTS.md §5）。

---

## 5. 为什么警告文案要区分两档

`10.0.2.2`（模拟器默认值）、`192.168.x.x`（家里 NAS）与 `http://example.com`（公网）
风险**不同**：

- 前者攻击者要在同一个局域网里；后者是**任何**路径上的中间设备。
- 如果默认配置一打开就报最高级警告，用户会对警告脱敏 —— 真正危险时也看不见。

所以 `plaintext-local` 与 `plaintext` 用不同文案，且边界由测试钉住
（`172.16/12` 的上界是 31 不是 255、CGNAT 只到 `100.127`、`10.0.2.2` 必须落在私有段里）。

---

## 6. ✅ 已实测：iOS 明文 HTTP —— **私有网段放行、公网被 ATS 拦死**

> 🔴 **本节在 2026-09-26 有一次结论级修正。** 原标题写的是"与 ATS 无关"，而"公网 IP / 普通域名"
> 那一格是空的。现在那一格**已经用真服务端实测填上**，结果**推翻了"与 ATS 无关"这个归因**。
> 下面保留错误归因的完整记录 —— 它比结论本身更值钱。

`apps/mobile/ios/HeytaMobile/Info.plist` 当前是：

```xml
<key>NSAllowsArbitraryLoads</key><false/>
<key>NSAllowsLocalNetworking</key><true/>
```

**结论（产品口径）**：heyta 在 iOS 上**能连局域网内的自建服务端**（`http://192.168.1.5:3000`
这类地址）。这是自建优先定位的底线能力，**已用真模拟器 + 真服务端 + 真另一台设备实测**。

### 🔴 但归因曾经是错的 —— 记在这里，因为它比结论本身更值钱

本节第一版写的是"**ATS** 覆盖私有 IP 字面量"，并把功劳记在 `NSAllowsLocalNetworking` 上。
**这两句都不成立。**

反证方式：把 `NSAllowsLocalNetworking` 改成 `false`（`NSAllowsArbitraryLoads` 保持 `false`），
**重装**该 bundle，再跑同一个验收 —— **依然成功**。

而"成功"本身还不足以定位，因为当时的对照组有个洞：错端口那一步只能证明应用**用了配置的端口**，
**不能**证明它用了配置的**主机** —— "偷偷回落 `127.0.0.1:3000`"这条假设完全能伪造出同样的绿。
所以补了一个**只绑在 `192.168.1.5:3100`**（不绑 `0.0.0.0`、不绑 `127.0.0.1`）的监听器，
把应用指过去，抓到了：

```
GET /api/sync/ops?sinceSeq=17&limit=200&excludeClient=muhmhxil-1-n6fnf68i
    client=192.168.1.5:65102  host_header=192.168.1.5:3100
    ua=HeytaMobile/1 CFNetwork/3860.600.12 Darw…
```

**主机是真的。** 于是当时写下了：

> ~~私有 IP 字面量的明文 HTTP 本来就不受 ATS 拦 —— 与 `NSAllowsLocalNetworking` 的取值无关。~~
> ~~那个键对 `.local` / 无限定主机名 / 链路本地地址可能仍然有用，但没有验证过。~~

**这句话的第一半在 2026-09-26 被证伪了。** 见下一小节：换成**公网** IP 之后，ATS 拦得很干净。
正确的表述是：

> **ATS 拦不拦，取决于目标是"本地网络"还是"公网"，不取决于它是不是 IP 字面量。**
> 私有网段被豁免（且这个豁免**不受** `NSAllowsLocalNetworking` 取值影响 —— 置 `false` 也照样通，
> 这是实测过的）；**公网 IP 字面量与普通域名一样会被拦**。

`NSAllowsLocalNetworking = true` **保留**：它不是承重的那一项，但也没有代价，
且对 `.local` / 无限定主机名**大概率**有用（仍未验证）。**不要**因此以为它是"让局域网能用"的开关。

### 6.1 ✅ 公网明文 HTTP 已实测：**iOS 侧被 ATS 拦死（-1022）**

2026-09-26，用一台真实公网服务端（`http://124.223.13.226`，腾讯云，nginx 转发到 heyta 容器）
把这条空白补上了。**服务端本身完全正常** —— 三台不同来源的 `curl` 都拿到 200：

```
GET http://124.223.13.226/health                    → 200 {"status":"ok","db":"connected"}
GET http://124.223.13.226/api/sync/ops?sinceSeq=0   → 200 {"ops":[],"latestSeq":0,...}   # 带 Bearer
```

而 **iOS 模拟器里的 App 同步到同一个地址 → 界面「当前离线」，且服务端 nginx 访问日志里
一条来自 App 的请求都没有**（日志里只有那三台 curl 的来源 IP）。也就是说请求**根本没离开设备**。

模拟器日志给出了确切原因：

```
Cannot start load of Task <…> since it does not conform to ATS policy
NSURLErrorDomain Code=-1022
"The resource could not be loaded because the App Transport Security policy requires the use of a secure connection."
NSErrorFailingURLStringKey=http://124.223.13.226/api/sync/ops?sinceSeq=0&limit=200&excludeClient=…
```

**这是单变量对照的教科书形状**：同一份 App、同一套凭据、同一份服务端代码，
**只有目标地址的网段变了**（私有 → 公网），结果从「通」变成「被 ATS 拦」。

### 6.2 🔴 这条结论对"自托管免费"这条路是硬伤：两端都堵

| 端 | 明文 HTTP 的行为 | 证据 |
|---|---|---|
| **iOS 客户端** | ATS 直接拦截（-1022），请求不发出 | 模拟器 CFNetwork 日志 + 服务端零请求 |
| **服务端** | `NODE_ENV=production` 且 `PUBLIC_URL` 非 `https://` → **拒绝启动**，**没有开关** | `server/src/config.ts:220` 实测抛出 |

所以"自托管完全免费"这个承诺，**事实上要求自托管者有域名 + 证书**。这不是文档问题，
是两端各有一道硬门。见 ADR-0011（自托管传输策略）——那里才是"怎么办"。

### ⚠️ 仍未验证的（不要外推）

- **`.local` / 无限定主机名 / 链路本地地址**没测 —— 那才是 `NSAllowsLocalNetworking` 真正管的范围。
- **真机没测过**，只有模拟器。真实设备上策略一致，但**这是推断，不是观测**。
- 未测**明文接口在移动网络/热点下的表现**（与 ATS 无关，属网络可达性）。
- 未测**普通域名 + 明文 HTTP**：由 6.1 推断必然被拦（域名比 IP 字面量更不"本地"），
  但**没有直接观测**。要观测需要一个域名指向该服务端。

### 单变量对照（现在的验收就是这个形状，`pnpm verify:ios-lan-http`）

| | 服务器地址 | 期望 | 实测 |
|---|---|---|---|
| **2a 对照** | `http://192.168.1.5:3007`（对的**主机**、错的端口） | 失败 | **当前离线**，`上次成功同步` 不前进 |
| **2b 对照** | `http://192.168.1.99:3000`（错的**主机**、对的端口） | 失败 | **当前离线**，`上次成功同步` 不前进 |
| **3 实验** | `http://192.168.1.5:3000`（都对） | 成功 | **已是最新**，`上次成功同步` 前进 |

🔴 **2a 与 2b 缺一不可**，它们排除的是两种不同的假绿（忽略端口 / 忽略主机）。
第一版只写了 2a —— 那正是归因错误的另一半原因。

⚠️ **诚实记录**：上表第 3 行（局域网实验应当成功）在**最近一次运行里没有复现** ——
`pnpm verify:ios-lan-http` 停在「正在上传…」，脚本自报 `通过 13 项，失败 1 项`。
但**同一轮里 App 打公网明文**是干净利落地被 ATS 拦（6.1），所以这两件事不是同一个原因。
局域网那一格需要重新跑绿之后才能当作承重结论 —— **在那之前，它是"曾经观测到过"，不是"现在成立"。**

> 结论（2026-09-26 修正后）：**iOS 连局域网自建服务端可用**；**连公网明文服务端不可用（ATS 拦）**。
> `NSAllowsArbitraryLoads` 保持 `false` —— 所以"App Store 审核层面的取舍"目前**没有发生**，
> 但它是 ADR-0011 里那个待决问题的核心。

### ⚠️ 仍未证明的（不要外推）

- ~~**公网 IP 字面量 / 普通域名 + 明文 HTTP，仍未实测。**~~
  → **公网 IP 字面量已在 6.1 实测：被 ATS 拦（-1022）。** 普通域名仍未直接观测，但由 6.1 推断同拦。
- **`.local` / 无限定主机名 / 链路本地地址**没测 —— 那才是 `NSAllowsLocalNetworking` 真正管的范围。
- **真机没测过**，只有模拟器。真实设备上策略一致，但**这是推断，不是观测**。
- 未测**明文接口在移动网络/热点下的表现**（与 ATS 无关，属网络可达性）。
- **Android 侧的公网明文**没测（Android 是 `usesCleartextTraffic`，机制与 ATS 完全不同，**不能互推**）。

---

## 7. 这个决策**没有**做什么

- 没有降低 E2EE 强度，也没有引入任何"明文回退"的载荷路径。服务端仍然强制 E2EE 且无开关。
- 没有把令牌落盘。凭据仍然只在内存（见 `apps/mobile/src/sync/config.ts`）。
- 没有因为"反正加密了"就静默放行 —— 三处改动里有两处是**为了把话说清楚**，
  而不是为了让请求通过。**让功能能用**和**让用户知道自己在选什么**是两件事，都要做。
