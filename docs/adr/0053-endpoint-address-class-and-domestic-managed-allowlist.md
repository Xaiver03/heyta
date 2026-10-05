# ADR-0053：目的地判定补上**地址类别**这一维，托管档只接**境内**供应商（白名单是表，不是形容词）

> 🔴 2026-10-05：本文里"`managed` 整体被保留策略未定案挡着 / `assertEnableable` 抛 `retention-undecided`"
> 那两处措辞记的是**开工时的现量**，同日已被 [ADR-0054](0054-managed-ai-retention-and-selling-preconditions.md) 撤除
> （保留策略定案、计量已实现、该 reason 已从代码删除）。
> **本 ADR 自己的两条结论都不受影响**：地址类别这一维仍然成立，
> "托管只接境内白名单"现在反而是**唯一还在挡境外端点的那道判据**。

> 状态：**已接受**
> 日期：2026-10-05
> 取代：无。**延伸** [ADR-0006](0006-supply-modes.md) §2.4（只信字面回环那条先例）、
> **收窄** [ADR-0013](0013-cloud-ai-and-maas.md) 的开放条件（托管档除了保留策略定案，还**必须**只接境内供应商），
> **不改变** [ADR-0010](0010-ai-config-routing.md) 的三道闸、[ADR-0021](0021-managed-ai-model-deepseek-flash.md) 的选型、
> [ADR-0023](0023-managed-ai-quota-not-implemented.md) 的「计量存在之前不得售卖」。
> 它**关闭** `BLOCKED.md` 的 **B34** 里隐私那一半的提问资格（见 §3.2 末段）。

**先说清一个词。** 本仓库沿用代码里已有的名字（`egress`、出境闸门、出境授权）。
它指的是**数据离开这台设备之后去了哪儿**，**不是**监管意义上的"数据出境"——
heyta 的部署没有跨境传输（服务端与客户端都在境内）。
所以本 ADR 里凡出现"离开本机 / 交给第三方处理"，说的是同一个判定的实质；
凡出现"出境"这个字，都是那个模块名的沿用，不是新的一层含义。

---

## 1. 背景与约束

heyta 是本地优先 + 端到端加密的。**只有 AI 那一条路径**是明文离开设备的例外，
所以那个例外必须被说得准、判得准。判定住在 `packages/ai/src/supply.ts`。

本轮开工时的现量（全部逐行读过）：

| 事实 | 位置 |
|---|---|
| 目的地只有两个输入：`mode` 与 `endpoint` 字符串 | `packages/ai/src/supply.ts:91-101` |
| 回环判定只认字面 `localhost` / `::1` / `[::1]` / `127.0.0.0/8`，解析失败即判远端 | `packages/ai/src/supply.ts:73-88` |
| 「宁可多问一次、不做 DNS 解析」是**写下来的取舍**，不是漏 | `packages/ai/src/supply.ts:50-71` |
| `mode === 'managed'` **无条件**返回 `heyta-cloud`，**一眼都不看端点** | `packages/ai/src/supply.ts:96` |
| `managed` 整体被保留策略未定案挡着（`assertEnableable` 抛 `retention-undecided`）（2026-10-05 更正：该 reason 已随 [ADR-0054](0054-managed-ai-retention-and-selling-preconditions.md) 删除，现在挡境外的是白名单校验 `managed-endpoint-not-domestic`，没填端点则抛 `endpoint-required`） | `packages/ai/src/supply.ts:290-322`，门禁 `scripts/check-ai-coverage.mjs:513-528` 在运行时钉住这条 |
| URL 校验在**保存与发送两个点**都执行（从 SSOS 抄来的那条纪律） | `packages/ai/src/routing.ts:553`、`:856`，规则体 `:387-459` |

两条约束在推着这个决定：

1. **`BLOCKED.md` B34** 记的是一条**类型上的缺口**，不是一句待办：
   「`classifyDestination` 只看端点 URL，**网络接口不在模型里** ⇒"蜂窝算不算远程"
   在类型上目前无法表达。」当时的处理是只挑做不依赖裁决的那半件（门禁按端枚举，已落地）。
   这句话的准确含义是：**问句里的主语在模型里不存在**，所以它既不能被回答，也不能被否决。
2. 产品要开 `mode: 'managed'`（目的地 `heyta-cloud`）这一档，红线是
   **托管路径只能接境内的模型供应商**。而"境内"如果只写成文档里的一句形容词，
   `supply.ts:96` 那个"不看端点"的形状会让这句话**没有任何一层能验证** ——
   把一家境外 API 的 URL 填进 `managed` 配置，界面上照样显示"数据到了 heyta 的服务器"。

授权来自产品负责人 2026-10-05 的任务分工（要求"裁决 + 实现"这两件事），
其中"托管档何时真的可以打开"仍归 ADR-0013 / ADR-0023 那条线，**本 ADR 不放开它**。

---

## 2. 选项

### 2.1 「蜂窝算不算远程」这一问怎么办

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 给目的地判定补"地址类别"这一维，免授权规则**只**收紧不放宽**（选了）** | 类别成为可问可答的事实；蜂窝那条被消解成"私网/未定性都照旧要授权"，不需要按网络类型加闸 | 表要维护；`private` 会被误读成"可信"，必须靠判据挡住那种读法 | `packages/ai/src/endpoint-address.ts`；§3.2 那张冻住旧算法的样本表 |
| B. 加第四道**按网络类型**收紧的闸（蜂窝 = 远程） | 直觉上正是 B34 那句话的字面意思 | 判定时机不对：网络类型在**发请求的那一刻**才已知，而授权必须在**之前**；接口类型还会在一次会话中途变化，于是同一个配置先后得到两个结论 —— **隐私判定不可复现** | 对照 ADR-0010 的 `fallback-needs-consent`：本产品的纪律是"停下来问人"，不是"跟着环境偷偷改判" |
| C. 什么都不加，把 B34 留着 | 零成本 | "无法表达"不会因为登记着就变成"已回答"；而移动端一旦接 AI，界面上会出现一个**没有主语**的开关 | B34 原文 |

**B 被否决的理由值得单独留一行**：它不是"更难实现"，是**问错了对象**。
需要被定性的从来不是"我现在挂在哪张网上"，而是"我把明文交给了谁"——
后者完全写在配置的字面量里，前者只有操作系统知道且每分钟都在变。

### 2.2 要不要在库里解析域名

| 选项 | 结论 | 理由 |
|---|---|---|
| 解析后再定性 | 🔴 **否决** | 见 §3.4 三条 |
| 只判字面量，域名一律"未定性 ⇒ 最严"（选了） | ✅ | 与 ADR-0006 §2.4 记下的 Joplin 先例同一条线 |

### 2.3 `.local` / `.lan` 这类局域网名字落在哪一档

| 选项 | 结论 | 理由 |
|---|---|---|
| 归进 `private`（已定性，像局域网） | 🔴 **否决** | "可命名的局域网形态"说的是**它像哪儿**，不是**它是谁**。mDNS 名字可以指向当前网络里**任意一台**主机（ADR-0006 §2.4 记的正是这条），归进 `private` 会让下一轮"私网免授权"那次提交看起来顺理成章 |
| 归进 `unknown`，但用一个专门的 `reason: 'lan-name'` 把"它是局域网命名形态"这件事**写进返回形状**（选了） | ✅ | 结论仍然最严，信息一条没丢；B34 那一问从此有主语 |

### 2.4 「境内」怎么落成判据

| 选项 | 结论 | 理由 |
|---|---|---|
| 文档里写一句"托管只接境内模型" | 🔴 **否决** | `supply.ts:96` 不看端点，这句话永远不会变红 |
| 按注册域后缀匹配（`endsWith('deepseek.com')`） | 🔴 **否决** | `api.deepseek.com.evil.cn` 直接过关；而"取后两段"等于把判断交给**任何人都能注册**的名字 |
| **封闭主机名白名单（逐字相等）+ 保存与发送两点 + 一条运行时门禁**（选了） | ✅ | 每加一个子域都要多登记一行，这个成本是刻意的 |

---

## 3. 结论

### 3.1 地址类别的形状：一个**可判别联合**，不是一句 `boolean`

```ts
type EndpointAddressCategory = 'loopback' | 'link-local' | 'private' | 'public' | 'unknown';

type EndpointAddressClass =
  | { known: true;  host: string; category: 'loopback'|'link-local'|'private'|'public'; decidedBy: 'ip-literal'|'localhost-literal' }
  | { known: false; category: 'unknown'; reason: UnknownAddressReason; host?: string };
```

`unknown` 的原因是一张**封闭词表**，每一条都是一个真实的判定缺口：
`empty` / `unparseable` / `domain` / `lan-name` / `unqualified-name` / `reserved` / `ipv4-mapped-ipv6`。

逐档的落点（完整正反样本在 `packages/ai/tests/endpoint-address.spec.ts`）：

| 类别 | 覆盖 | 免授权？ |
|---|---|---|
| `loopback` | 精确字面量 `localhost`、`127.0.0.0/8`、`::1` | ✅ 唯一免授权的一档 |
| `link-local` | `169.254.0.0/16`、`fe80::/10` | 🔴 不免 |
| `private` | RFC 1918 三段、CGNAT `100.64.0.0/10`、ULA `fd00::/8` | 🔴 不免 |
| `public` | 公网**字面量** IP（已定性，不需要解析） | 🔴 不免 |
| `unknown` | 域名、`.local`/`.lan`/`.home.arpa`/`.internal`/`.home`、单标签名、保留段、坏写法 | 🔴 按最严 |

用可判别联合而不是一个枚举加一个布尔，是因为这条规则**必须写不进错**：
`known: false` 那个分支上**不存在**具体类别，所以"把未定性当成本机"这类代码过不了编译，
而不是靠读注释。

### 3.2 🔴 只紧不松，而且由一条判据钉住

补进类别维度**不改变任何一次判定的强度**：免授权的条件仍然只有
「字面量已定性 **且** 是回环」。`private` 与 `link-local` 是**描述**，不是通行证。

这条不是靠注释写的。`packages/ai/tests/endpoint-address.spec.ts` 里冻着一份
**改动前旧算法的逐字副本**（`legacyIsLoopback`），对一张现量 50+ 条的样本表断言：

- 新版说是本机、旧版说不是 ⇒ **红**（这就是"放宽"，本轮明令禁止的方向）；
- 旧版说是本机、新版说不是 ⇒ **红**（这是反向的意外收窄；`e2e/tests/ai-*.spec.ts`
  与 `scripts/verify-ai-*.mjs` 正靠 `127.0.0.1` 免授权跑，把它改掉就是拆自己的载体）；
- `classifyDestination({mode:'own'})` 的目的地逐条等于旧算法的结论 ⇒ 否则红。

样本表刻意包含**攻击形状**：`a.localhost`、`localhost.`、`localhost.evil.com`、
`user:pw@127.0.0.1`、`127.0.0.1:80@evil.com`、`[::ffff:127.0.0.1]`（IPv4 映射，
它其实连得到回环，但字面量看不穿 ⇒ 故意按最严处理，那一档**唯一一个"类别更宽而拒不采纳"的取值**）。

**B34 那一问在这一节之后被消解**：设备挂在蜂窝网络上时，配置里的私网/链路本地/域名
端点没有一格会变成"免授权"，所以"蜂窝算不算远程"不再需要第四道闸 ——
答案是**这个问题没有后果**，而"没有后果"现在是从形状里推出来的，不是从沉默里读出来的。

### 3.3 托管档：目的地**也**从端点推导，而"境内"是一张表

- `classifyDestination({ mode: 'managed', endpoint })` 不再无条件返回 `heyta-cloud`。
  端点必须落在 `packages/ai/src/managed-endpoints.ts` 的 `MANAGED_MODEL_HOSTS` 上，
  否则推导出 `user-endpoint`。`heyta-cloud` 这个值**本身就是一句陈述**（"明文到了 heyta 的服务器上"），
  所以它只能由那张表来作证，不能由 `mode` 字段来作证。
  旧代码 `supply.ts:96` 那句「不看端点」是本轮点名的洞。
- **匹配是主机名逐字相等**。理由见 §2.4。
- 表里每一项必须带 `jurisdiction` 与 `evidence`；`evidence` 要指向一份 ADR、一份仓库文档或一个 URL。
  今天是两行：`api.deepseek.com`（ADR-0021 选定那家）与 `heyta.waytofuture.cn`（自家那台已备案的服务器）。
- **两点都校验**：
  - 保存/启用点 —— `assertEnableable()`：非境内端点当场以 `managed-endpoint-not-domestic` 被拒；
  - 发送点 —— `provider.invoke()` 在任何网络动作之前**复算目的地**，
    与构造时不一致就一个请求都不发（这条同时挡住了"配置对象被构造后改写"那一族）。
  发送点**刻意没有第二支 `if`**：白名单已经通过 `classifyDestination` 站在那条复算里，
  再写一支就是一条**今天写不出可达用例**的判据（`managed` 在工厂里就被保留策略挡住，
  构造不出 provider），而一条测不到的判据比没有判据更坏（AGENTS §7 元规则 2）。
- **两支 `if` 的顺序是判据**：境内那条排在保留策略那条**之前**。
  理由不是风格：一条今天就能确定的拒绝，不该被一句"还没定案"盖住 ——
  两者的**用户修复动作**不同（该换端点 vs 该等产品）。
  而 `assertEnableable({ mode: 'managed' })`（没端点）**仍然**抛 `retention-undecided`，
  因为 `scripts/check-ai-coverage.mjs` 8b 钉的就是那个取值；**本 ADR 没有、也不许**打开那扇门
  （ADR-0013 / ADR-0023 的结论照旧：`managed` 今天整体不可启用）。
  （2026-10-05 更正：该 reason 已随 [ADR-0054](0054-managed-ai-retention-and-selling-preconditions.md) 删除，
  现在挡境外的是白名单校验 `managed-endpoint-not-domestic`；**"本 ADR 不放开那扇门"这一句仍然为真** ——
  放开它的是 0054，不是本文。）

### 3.4 为什么不解析 DNS（三条，缺一不可）

1. **不可复现**：同一份配置在咖啡店、家里、蜂窝网络上会得到不同答案，而这是隐私判定。
   判据必须能"同一个输入永远同一个结论"，否则 §3.2 那张表根本没法写。
2. **会把"未知"悄悄变成"可信"**：一旦解析，"解析出来是 127.0.0.1"就成了免授权的理由，
   而 DNS 那端是**对方**控制的。今天 `localhost.evil.com` 不被当成本机，
   靠的正是"字面量相等"而不是"看起来像"。
3. **顺序**：授权必须在**发请求之前**索取，而"解析后落在哪"要到发请求那一刻才知道。
   拿一个可能后来才成立的宽松判断去换"少问用户一次"，换到的是
   **"以为数据没离开设备，其实离开了"** —— 那正是这个模块存在的理由要防的事。

### 3.5 落点（唯一事实源与执行点）

| 东西 | 住在哪 | 谁在执行 |
|---|---|---|
| 地址类别判定 | `packages/ai/src/endpoint-address.ts`（**唯一**一份） | `supply.ts` 的 `classifyDestination`；`diagnose.ts` 用它的兼容谓词 |
| 境内白名单表 | `packages/ai/src/managed-endpoints.ts` 的 `MANAGED_MODEL_HOSTS` | `assertEnableable`（保存/启用）+ `provider.invoke` 的目的地复算（发送） |
| 只紧不松 | `packages/ai/tests/endpoint-address.spec.ts`（冻着旧算法的表） | 单测 |
| 白名单形状 + 洞没复发 | `packages/ai/tests/managed-allowlist.spec.ts`（src） | 单测 |
| 同上，**对构建产物** | `scripts/check-ai-coverage.mjs` 第 8d / 8e / 8f 段 | `pnpm check` 链 |

---

## 4. 后果

1. `EgressDestination` 的词表**一个成员都没加**（`none` / `user-endpoint` / `heyta-cloud`），
   所以授权记录、持久化配置、法务里那张"发给谁"的表**都不必改** ——
   类别是**加在推导之前的信息**，不是新的目的地取值。
2. 法务文档里那句"判定只看地址是不是字面上的回环，不做域名解析"
   （`packages/legal/src/documents/third-parties.ts` 中英两处）**仍然逐字为真**：
   免授权面一格都没扩。本 ADR **不改法务正文**（那条线在动）。
3. `AiConfigError.reason` 多了一个成员（`managed-endpoint-not-domestic`）。
   它不是死成员：有构造点、今天可达（`{mode:'managed', endpoint:'https://api.openai.com/v1'}`
   当场被拒）、有单测。`apps/web` 里那份手工镜像的 `EndpointRejectionReason`
   （`validateEndpointUrl` 的四条）**没被碰** —— 本 ADR 刻意不给它加第五个取值，
   那会连带牵动 i18n 两份词条表与 `check:ui-language`，属于另一件事。
4. **加一家境内供应商从此是一个对外承诺**：要新增一行 `MANAGED_MODEL_HOSTS`，
   必须同时带可核对的出处，否则门禁 8d 红。这和 `check:legal-tools` 把工具目录与法务表
   对账是同一类约束（AGENTS §9 那条"封闭句式必须有对账门禁"）。
5. 想放宽任何一格（私网免授权、`.local` 免授权、解析后再定性、按网络类型加闸）
   都要**新写一份 ADR**，并先删掉 §3.2 那张表里的对应反向断言 —— 那会是一次响亮的红，不是顺手改一行。
6. `BLOCKED.md` B34 的隐私那一半从此有答案（§3.2）；剩下的是**移动端界面接线**，
   那条已经不是裁决问题而是排期问题，`scripts/check-ai-coverage.mjs` 里那句登记理由已就地更正。

---

## 5. 未核实项与未闭合的边界

1. 🔴 **托管档接进 `invokeRouted` 那条路时，这套判定会失配。**
   `AiRoutingConfig` 没有 `mode` 字段，所以自家服务器上的托管端点会被推导成
   `user-endpoint`，于是披露变成"该端点由你提供、heyta 不参与" —— **那句是假的**。
   今天不可达（`managed` 整体不可启用），但它是**下一单必须处理的事**，
   要动的是目的地词表与路由配置的对齐，不是在 `routing.ts` 里加一个特例。
2. **白名单两行的"境内"依据是登记制的，不是本轮实测的。**
   `heyta.waytofuture.cn` 一侧有仓库内的部署证据（已备案主域 + 境内 IP + 证书）；
   `api.deepseek.com` 一侧的出处是 ADR-0021 §1 从官方定价页取证的记录，
   **机房所在地没有独立核验**。门禁 8d 判的是形状（有没有出处、是不是 `cn`、能不能匹配上），
   **不判出处本身的真假** —— 那是人的判断，本 ADR 不许把它说成机器已经做过。
3. **`evidence` 的阈值是形状判据**（长度 > 20 且指向 ADR / `docs/` / URL）。
   它能拦住"它是国内的"这类形容词，拦不住一句**很长但同样没有指向**的漂亮话。
   这一条要说破，否则后来者会以为门禁已经保证了出处质量。
4. **IPv6 的两类写法本轮没有覆盖**：zone id（`[fe80::1%25en0]`）与非压缩写法
   （`[0:0:0:0:0:0:1]`）在 `new URL()` 阶段就抛，因此落进 `unparseable` ⇒ 未定性 ⇒ 最严。
   方向安全，但它们**不是**被定性成了回环。NAT64 的 `64:ff9b::/96` 目前会被判成 `public`
   （仍是远端，方向安全）—— 没有为它单独建档，因为手上没有它会被用到的场景。
5. **实测过的事实（写在这里，免得下一个会话重新试一遍）**：
   WHATWG 的 URL 会把 `127.1`、`2130706433`、`0177.0.0.1` 折叠成点分十进制，
   所以那些非规范写法**在旧实现里就已经**被判成本机（不是本轮学到的东西）；
   而 `[::ffff:127.0.0.1]` 被规范化成 `[::ffff:7f00:1]`、**不会**折回 IPv4，
   所以它在旧实现里是远端、在本轮之后是 `unknown + ipv4-mapped-ipv6` —— 两版都要授权。
   取证方式：`node -e "console.log(new URL('http://2130706433/').hostname)"` 一类的一次性探针。
6. **"境内"这个词在本 ADR 里没有监管含义**（见开头那段词表说明）。
   如果将来产品真的做跨境部署，本 ADR 的白名单判据**不足以**支撑任何监管结论，
   要另立一份并先问法务 —— 不要拿这张表去回答它没被设计来回答的问题。
