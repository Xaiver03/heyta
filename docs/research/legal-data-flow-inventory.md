# 法务事实索引与可追溯矩阵

> **这份文件不含事实，只含指针。**
>
> 事实住在下面三份代码考古文件里，它们才是被引用的一方：
>
> | 文件 | 管什么 | 章节 | 结尾的"政策撰写提示" |
> |---|---|---|---|
> | [`legal-dataflow-server.md`](legal-dataflow-server.md) | 服务端每列存什么、每次对外请求发什么、留多久 | A1–A10 | ✅ |
> | [`legal-dataflow-client.md`](legal-dataflow-client.md) | 各端本地存什么、明文还是密文、权限与依赖清单 | B11–B18、E | ✅ |
> | [`legal-dataflow-ai-rights.md`](legal-dataflow-ai-rights.md) | AI 逐字段出境、本机 API、权利逐项核对、保留与备份 | C19–C23、D24–D25 | ✅ |
>
> 建立于 2026-10-01。**建立原因**：这三份原先是同一次考古的一个骨架（本文件的前身），
> 拆开后各自长到几百行 —— 而写政策的人需要的是反过来的东西：**从"我要对外说的这句话"
> 找到"证据在哪一节"**。所以本文件只做那一本映射表。
>
> 🔴 **纪律（三份文件与 `packages/legal` 都受它约束）**：政策里写的每一项断言
> 必须能指回这三份里的某一节；这里没有证据的，政策里不许出现。
> 否定结论（"我们不收集 X""没有接入 Y"）**也是断言**，同样要有给出该否定的代码位置。

---

## 阅读约定

- ✅ **已证实** —— 给出了 `文件:行号`，且该行就是结论的主体。
- ⚠️ **推断** —— 由若干条已证实事实推出，代码里没有一个直接说这件事的地方。政策引用它时必须换一种说法。
- ❌ **未发现** —— 按要求搜过关键词，结果为空。搜索词列在给出该结论的那一节里。

---

## 一句话概览：heyta 的数据面只有四条通道

| 通道 | 方向 | 明文可达性 | 默认 | 证据 |
|---|---|---|---|---|
| 同步（op-log） | 客户端 → 服务端 | 服务端只见密文，**但同步元数据是明文** | 需用户配置服务端地址 | server A2 |
| 账号与计费 HTTP | 客户端 ↔ 服务端 | 明文（邮箱、令牌、订单与设备计数） | 需用户注册 | server A1、A3、A4、A7 |
| 出站 AI | 客户端 → **用户自己填的**端点 | 明文，按功能逐字段出境 | **全关**（多道闸） | ai-rights C19、C20、C21 |
| 入站本机 API / MCP | 本机其他程序 → 客户端 | 本机，受逐工具授权约束 | **全关** | ai-rights C22 |

激励体系、四象限、日历、番茄钟、记忆偏好层的推断**全部在端上算**，服务端不参与
（server A10 的"未发现"检索 + ai-rights C23）。

---

## 可追溯矩阵：从"要对外说的话"到"证据在哪一节"

### 存储与可见性

| 对外要说的那句话 | 真相的口径（只能说到这个程度） | 证据 | 用它的文本 |
|---|---|---|---|
| "端到端加密" | 🔴 **只覆盖同步通道**；本地库是明文 | client B12 | privacy s2 / terms s4 |
| "我们看不到你的任务内容" | 成立，但**同一句里必须给出**：服务端保存 11 项明文同步元数据 | server A2 | privacy s2 / personal-info-list 表 C |
| "本地数据不外传" | 成立；例外只有小组件那份**加密**快照与用户主动的导出 | client B15、B16 | privacy s2 / permissions s3 |
| "凭据怎么存的" | 口令：Argon2id（19 MiB / t=2 / p=1）+ pepper，不可逆；同步令牌落本机 `localStorage` **明文** | server A3；client B13 | personal-info-list 表 B、表 D |
| "日志里有我的 IP 吗" | 没有：Fastify 以 `logger: false` 创建，IP 不入库 | server A9 | privacy s11 / s12 |

### 对外流动

| 对外要说的那句话 | 真相的口径 | 证据 | 用它的文本 |
|---|---|---|---|
| "不与第三方共享" | 🔴 **这句是假的**，只能逐项列（四类对外请求） | server A2、A3、A5、A7 | third-parties s2 |
| "不发营销邮件" | 成立；全站只有 **5 封功能性邮件** | server A5 | privacy s4 / third-parties |
| "没有统计/广告/崩溃 SDK" | 成立（否定结论，附检索词与零命中） | server A10；client B18 | third-parties s3 |
| "AI 数据会脱敏后再发" | 🔴 **假的**：代码里不存在脱敏、匿名化或摘要环节 | ai-rights C20 | ai-and-transfer s3 |
| "AI 数据发给 heyta 服务器" | 假的：设备直发**用户自己填的**端点，官方服务端不做代理 | ai-rights C21 | ai-and-transfer s4 |
| "我们提供云端 AI 订阅" | 🔴 当前**结构性不可达**，不得写成可购买项 | ai-rights C19；`packages/legal` 的 `subscription-refund` s8 | ai-and-transfer / subscription-refund |

### 生命周期与权利

| 对外要说的那句话 | 真相的口径 | 证据 | 用它的文本 |
|---|---|---|---|
| "存多久" | ~~同步 op 与设备统一 **45 天** + 每日清理~~ ⚠️ **2026-10-03 更正**：设备行确实按 45 天每日清扫；**同步 op 那条清理对我们的数据一条都不命中**（候选集要求因果全量 op，客户端从不产 —— 见 legal-dataflow-server.md 第 10 条）。备份 `pg_dump` 本机 **14 天** | server 末「政策撰写提示」附表；ai-rights D25 | privacy s7 / personal-info-list s7（三处文案已同步改写，判据 `packages/legal/tests/retention-claim.spec.ts`） |
| "能从备份里删掉我吗" | 🔴 没有"从既有备份单点删除"的能力 —— 不许写"X 日内于备份中完成" | ai-rights D25 | data-rights s4 |
| "可以注销" | 服务端 `DELETE /api/account` 是真实硬删除（~~18 处级联~~ 🔴 **2026-10-03 更正：引用 `users` 且 `ON DELETE CASCADE` 的外键 16 条、覆盖 15 张表**；"18/19" 是两种错误口径的抄件 —— 它们数的是全部迁移里 `ON DELETE CASCADE` 的出现次数，含与账号无关的级联并把历史重建重复计入。真值由 `packages/legal/tests/structure.spec.ts` 从 `server/prisma/migrations` 现量对账），🔴 **界面上没有入口** ⇒ 文本只能写"邮件申请"；🔴 而且**注销不清除你其它设备上的本地明文库**（批次 E 的 E2/E3 未落地前这就是事实） | server A1；ai-rights D24 | data-rights s5（缺口 G-08） |
| "可以改邮箱" | ✅ 能，走**双侧确认**的自助换绑（当前邮箱与新邮箱各点一次，24 小时有效，生效即全设备登出）；残余限制：当前邮箱已经收不到信时没有自助通道 | ai-rights D24 | personal-info-list s3 / data-rights s3 / 帮助中心 `site.docs.account.s6` |
| "彻底删除就是删干净了" | 打的是 `purgedAt` **标记**，~~物理回收靠 45 天清理~~ ⚠️ **2026-10-03 更正**：那条清理当前对我们的数据不命中，所以真的消失只有**注销账号** | client E；ai-rights D24 | data-rights s4 |
| "可以导出我的数据" | 导出三端都有；🔴 **导入只有 Web 与 CLI** | client B16 | data-rights s2（缺口 G-09） |
| "我们申请了 X 权限" | 🔴 **逐字抄 manifest，不概括不补**：Android 只有 `INTERNET`；iOS 零 `NS…UsageDescription`；移动端不产生系统通知，系统通知只有 Web 有 | client B17 | permissions s2 |

---

## 三条最容易写成虚假陈述的地方（每份文本都撞过一次）

1. **把"同步通道加密"说成"数据始终加密"** —— 本地是明文（client B12）。
2. **把"看不到内容"说成"看不到任何数据"** —— 元数据明文（server A2）。
3. **把"没有第三方 SDK"误写成"没有任何第三方"** —— 四类对外请求真实存在（server A2/A5/A7）。

🔴 这三条不需要靠自觉守：`packages/legal/tests/structure.spec.ts` 管形态（中英对齐、
标记平衡、`docRef` 目标存在、不出现别人的主体名与未核准的备案号），
而**内容真假**只能靠本表 + 撰写时的逐条指回。结构测试挡不住一个结构完整、中英对齐、
但内容编造的文件 —— 它压根没这个能力。

---

## 下游

执行计划与缺口登记：[`../plans/legal-compliance-before-filing.md`](../plans/legal-compliance-before-filing.md)
（九份文本 × 法定出处 × 放置位置 × 缺口 G-01…G-20）。
