# 多语言（中英双语）实施计划

> 状态：**进行中**

本文只回答一件事：**heyta 三个外壳的界面文案怎么变成中英双语，以及"怎么证明它真的双语了"。**
架构决策的结论在 [ADR-0003](../adr/0003-multi-platform-strategy.md)（业务逻辑在 `packages/`，`apps/*` 只做壳）
与 [ADR-0004](../adr/0004-ui-stack.md)；本文是执行计划，**会随进度改**。

---

## 一、目标与验收

`apps/landing`、`apps/web`、`apps/mobile` 的全部**用户可见文案**抽进 `packages/i18n` 的类型化词条表，
中英两套都必须是**真的翻译**，而不是回退到另一种语言。

验收是三条**机器可查**的硬标准：

1. `pnpm check` 全绿，其中 `check:ui-language` 用新契约（见 §4）；
2. **漏翻译 = 编译错误**。`en.ts` 用 `satisfies Record<MessageKey, string>`，少一条 `tsc` 就红；
3. 落地页两个语言版本**各有独立地址**（`/` 与 `/en/`），可分别被收录与分享。

---

## 二、为什么自己写，而不引 i18next / react-intl

结论：**零依赖 + 类型化词条表**，实现在 `packages/i18n`（约 4 个源文件 + 1 份测试）。

理由是**第一条验收标准所要求的性质，运行时库给不了**：

- 这类库的默认行为是「查不到 key → 回退到 fallback 语言 / 打印 key」。
  也就是说**漏翻译在运行期是静默降级**：英文用户看到中文，没有任何一处报错，
  测试也是绿的。而我们要的是**编译期就红**。
- 我们目前的词条形态是「一条字符串 + 少量 `{name}` 占位」，
  **还没有**复数（plural）、ICU MessageFormat、日期/数字本地化这些需求。
  为不存在的需求引入一整套依赖树与它自己的生态，是负收益（AGENTS.md §3.1 的可维护性门）。
- 许可证与体积：自己写没有许可证问题，也不必为门禁 `check:licenses` 增加登记项。

**将来真需要复数/ICU 时**：替换点是 `packages/i18n/src/translate.ts` **一个文件**，
调用方签名 `t(key, vars)` 不变。这就是把它单独做成包而不是散在三个壳里的原因。

### "漏翻译 = 编译错误" 是验过的，不是声明

`en.ts` 末尾那行 `satisfies Record<MessageKey, string>` 撑起了这条承诺。在 `/tmp` 的副本上
（把 `src/locales` 与 `types.ts` / `translate.ts` 复制过去，用仓库自己的 `tsc` 编译）逐条注入：

| 注入 | `tsc` 退出码 | 报错 |
|---|---|---|
| 基线（原样） | `0` | —— |
| 删掉一条 en 词条 | `2` | `TS1360`（不满足 `Record<MessageKey, string>`）+ `TS2741`（`Property '"mobile.sync.error"' is missing`） |
| en 里多一条 zh 没有的 key | `2` | `TS2353`（`Object literal may only specify known properties`） |
| **反向证据**：用 `...spread` 拼装后再加一个 key | `0` ⚠️ | **没抓到** |

最后一行就是 `zh-CN.ts` / `en.ts` 文件头那句"**不要用 `...spread`**"的**具体后果**：
展开出来的是一个新对象，TypeScript 的多余属性检查对它不生效，
于是"多出来的 key"会静默通过。**那条禁令不是风格偏好，是这条类型保证的前提。**

> ⚠️ 顺带一个诚实的边界：`tsc` 只能保证**词条表内部**一致。它保证不了
> "组件里 `t('x.y')` 的 key 真的存在" —— 那一条由 `MessageKey` 传给 `t()` 的签名来保证
> （所以 `apps/mobile/src/i18n/translate.ts` 刻意把类型取自 `I18nValue['t']`
> 而不是自己写 `(key: string) => string`）。

> ⚠️ 语言**不是**用 `localStorage` 切、也不是 `Accept-Language` 自动跳转 —— 见 §3。

---

## 三、语言从哪来：落地页看 URL，应用看偏好

两类的答案**故意不同**，因为约束不同：

| | 落地页 `apps/landing` | 应用 `apps/web` / `apps/mobile` |
|---|---|---|
| 来源 | **URL 路径**：`/` = 中文，`/en/` = 英文 | **运行时偏好** |
| 为什么 | SEO 是这一版存在的理由：两个地址才能分别被收录，也才能被分享给指定语言的用户 | 应用在登录/本地存储后面，没有 SEO 需求；`apps/web` 也没有路由，用 URL 表达语言会凭空引入一套路由 |
| 具体做法 | 两个静态 HTML 入口（`index.html` / `en/index.html`），共用同一个 JS bundle；`src/lib/locale.ts` 从 `location.pathname` 判定 | `apps/web`：`localStorage`，与 `src/lib/theme.ts` 同一套「用户已选 > 系统偏好」；`apps/mobile`：设备语言 + **仅内存**的手动覆盖 |

**刻意不做 `Accept-Language` 自动跳转。** 理由：自动跳转会让"用户分享出去的 URL"和"接收者看到的语言"不一致，
而且搜索引擎抓到的内容会依赖它自己发的头 —— 两边都变成不确定的。语言选择显式放在导航里（落地页）与设置里（应用）。

### 两个入口的 head 是被测试钉住的，不是靠自觉

`/en/` 存在的全部理由是"有独立地址可被收录"，而这件事**只在 head 写对时成立** ——
canonical 指错、hreflang 只声明一边、或把中文入口复制过去忘了改 title，
后果都是**静默**的：页面照常打开，只是不再算多语言版本，而爬虫看到的是中文标题。

所以 `apps/landing/tests/seo-head.spec.ts`（14 条）把这些钉住：两个入口的 `<html lang>`、
canonical 自指、三种 hreflang 声明**成对且逐条互指**（含自指 —— 这是规范要求）、
title/description 两边不同、中文入口含汉字而**英文入口不含**（与词条表规则 2/3 同一套判据）、
以及**两个入口的主题引导脚本逐字相同**。

最后一条补的是 `theme-contract.spec.ts` 的盲区：那个文件只读中文入口，
于是"只改了主入口、忘了英文入口"这种最常见的漂移没人管 —— 而英文访客恰是最不可能来报这个 bug 的人。

落地页最终形态是**两个静态入口共用一个 bundle**（`vite.config.ts` 的 MPA `rollupOptions.input`），
只有 `<html lang>`、标题、描述与 hreflang 不同，代价是两个 1.7–2.4 KB 的 HTML。

移动端的覆盖**刻意不落盘**，与 [`apps/mobile/src/sync/config.ts`](../../apps/mobile/src/sync/config.ts)
的「凭据只放内存」同一条纪律：代价（每次冷启动回到设备语言）是有意接受的，写清楚比偷偷持久化更好。

---

## 四、门禁契约的变更（本次最容易看错的一处）

`scripts/check-ui-language.mjs` **原来的契约只有一句话：用户看得见的文案必须是中文。**

现在换成四条**更严**的：

1. **不许硬编码文案** —— 已迁移的应用里，用户可见的字符串字面量一律违规，必须 `t('key')`；
2. **zh 词条必须含中文** —— 防止用英文占位中文；
3. **en 词条不许含中文** —— 防止把中文复制过去当英文交差（这条只能靠机器：人眼扫过两栏相同的字，
   很容易当成"还没翻"而不是"翻错了"）；
4. **两份词条的 key 集合必须一致** —— 漏翻译必须在门禁上红。

**这不是放宽，是换了个更值钱的契约**：原来只保证"是中文"，现在保证"没有硬编码"且"两种语言都真翻了"。

按 key 的两处**显式例外**（不是放宽规则）：

- `common.brand`（`heyta`）与 `common.lang.en`（`English`）：纯拉丁词，zh 表允许不含汉字；
- `common.lang.zh`（`中文`）：语言切换器上必须显示**自称** —— 那正是给"看不懂英文"的用户准备的入口，
  写成 `Chinese` 对他就没有用了，所以它在两表里**刻意相同**。

### 为什么分阶段迁移，而不是一次性翻转

一次性翻规则会让仓库立刻全红，而**长期全红的门禁等于没有门禁**（`AGENTS.md` §8.3）。
所以 `ROOTS` 逐个应用迁移：`migrated: true` 走新规则，`migrated: false` 继续走旧规则（必须是中文）。
两边都不松 —— 未迁移不等于"没人管"，只是还在用旧契约。

`apps/landing` 与 `apps/mobile` 都是**整包一次翻转**的（迁移期间门禁短暂变红，翻完转绿）。
但 `apps/web` 不行：它最大（29 个源文件），而且**同一时间有另一条工作流在改它**
（`App.tsx`、`features/timeline/**`、`features/ai/*` 等）。整包翻转意味着门禁要红很久，
而这段时间里另一条工作流的每一次 `pnpm check` 都会看到与自己无关的红。

所以门禁的开关粒度从"整个根"细化到"**根 + 一份已迁移文件清单**"：

```js
{ dir: 'apps/web/src', migrated: true }   // 第 16 轮起：三个根都是整根迁移
```

**规则一条都没松**：每个文件仍然只可能处在两种契约中的一种 —— 在清单里就走规则 1，
不在就走旧契约，不存在"两边都不管"的文件。迁完之后把清单清空、`migrated` 置 `true`，把开关收回一个布尔。

🔴 清单里的路径会**逐条校验存在性**，写错的路径会让门禁**拒绝运行**而不是静默退回旧契约。
"以为管住了，其实没管"比门禁变红难发现得多，所以这里选择硬失败。

### 一个容易写错的形状：门禁只认"字面量紧跟 `t(`"

判据是 `/t\(\s*$/` 作用于字面量**之前**的源码。于是**这些写法会被误报成硬编码文案**：

```tsx
aria-label={cond ? t('web.a') : t('web.b')}   // ❌ 'web.a' 前面是 `t(cond ? `，不匹配
aria-label={cond ? 'web.a' : 'web.b'}         // ❌ 更不行
```

正确做法是**在 JSX 外先算成变量**再绑：

```tsx
const label = cond ? t('web.a') : t('web.b');   // ✅
…
aria-label={label}
```

落地页 `apps/landing/src/components/Nav.tsx` 就是这么写的，并且注释里记着这条教训 ——
移动端迁移时也独立复现了一次（当时有人口头判断这种形状"会被放行"，实测**不会**，门禁只认紧跟的那种）。

⚠️ 门禁**不跳过注释**，所以注释里也别写出上面两种会误报的形状，否则门禁会指着注释报红。

### 顺带修掉的一个盲区

旧门禁只从 **JSX 属性** 与 **JSX 裸文本节点**取候选，于是
`const SCREENS = [{ label: '四象限' }]` 这种**数据数组里的文案它看不到** ——
而落地页的展厅、能力矩阵、自建步骤全是用这种形状写的，是真实用户可见的大头。

⚠️ **迁移后这个盲区仍然存在，但不构成漏洞**：迁移模式要求"渲染出的字面量都要走 `t()`"，
而放在数据数组里的字面量仍然是字面量 —— 门禁看不见它，**是纪律在管，不是门禁在管**。
新增代码时不要把它当成"可以放中文的地方"。

**门禁能失败**（`AGENTS.md` §8.3 的硬要求）已用真实违规输入逐条验过 ——
在一份 `/tmp` 的仓库副本里注入违规、跑门禁、看退出码与诊断，全程不动真实仓库：

| 注入的违规 | 退出码 | 门禁给出的诊断 |
|---|---|---|
| 基线（不注入） | `0` | —— |
| 已迁移应用里写 `aria-label="违规文案"` | `1` | `文案：违规文案` |
| zh 词条写成纯英文 `Screens` | `1` | `中文词条里一个汉字都没有` · `改法：写成中文。确实是纯拉丁词的（如品牌名），加进 ZH_LATIN_OK 并说明理由。` |
| en 词条写成中文 `界面` | `1` | `英文词条里出现了汉字 —— 很可能是把中文复制过来当英文` |
| 从 en 删掉一条（漏翻译） | `1` | `中文词条表里有这条，英文表里没有 —— 漏翻译` · `改法：在 en.ts 补上 '<key>'。` |

四条规则各自给出**可操作**的诊断，而不是一句"不合规" —— 这一点很重要：
门禁红了以后要能直接照着改，否则下一个人会去猜或被逼着读门禁源码。

---

## 五、迁移进度

门禁的汇总行会打印「扫描文件数 / 文案处数 / zh 条数 / en 条数 / 已迁移的目录」，**条数以它为准**，
本文不重复数字（避免两处定义同一事实）。

| 外壳 | 状态 | 门禁模式 | 备注 |
|---|---|---|---|
| `apps/landing` | ✅ 已完成 | `migrated: true` | 含 `/en/` 双入口 + hreflang + 导航里的语言切换器；已发布并在线上逐条验过 |
| `apps/mobile` | ✅ 已完成 | `migrated: true` | 语言来源见 §3；域层文案的处置见 §7.1；英文单复数见 §7.4 |
| `apps/web` | ✅ 已完成 | `migrated: true` | 第 16 轮收尾：逐文件清单**退休**（§7.12）。订阅提示的本地词条表收编进全局表；语言切换器见 §7.8 |

`apps/mobile` 迁移时还发现并修掉了一处**门禁看不见**的中文（见 §7.6）：这提醒我们
"门禁绿"只等于"门禁覆盖到的地方是对的"，不等于"没有硬编码文案"。

**移动端最后一块中文（重复规则）也已处理**：域层的 `describeRecurrence` 返回中文句子，
现在拆成 `recurrenceParts`（域层，给结构化结果）+ `describeRecurrenceText`（壳层，给措辞）。
细节与两处刻意的措辞偏离见 §7.1。

---

### 7.12 收尾：三个外壳全部进入严格契约（第 16 轮）

第 16 轮把 `apps/web` 从"逐文件迁移"翻成整根 `migrated: true`，
`migratedFiles` 这个过渡装置**退休了**。做法分三步：

**① 先核实"真的没有文案了"，而不是直接翻。** 这一步差点被误导：
按"含汉字的行"粗扫，`apps/web/src` 还有 86 行、`AiSettings.tsx` 一个文件 34 行 ——
看起来遥遥无期。但那是**多行 JSX 注释的续行**（`{/*` 在段首，续行不以注释符号开头）。
写了个跟踪块注释 / 行注释 / 字符串的状态机重扫（并让 `https://` 里的 `//` 不算注释），
真实剩余是 **13 行 / 5 文件**，其中 8 行是下面 ② 的订阅词条，
另外 5 行是 `throw new Error('…')` 这类**开发者诊断**、加一个解析中文标记的正则。

> 教训：**"还有多少处未迁"这种计数必须和门禁用同一个口径。**
> 拿一个更宽的口径估工作量，会得出"还早得很"的错误结论；
> 而拿一个更窄的口径，会得出"已经没事了"的错误结论。两个都危险。

**② 收编订阅提示的本地词条表。** `apps/web/src/features/subscription/copy.ts`
是**另一条工作流**自建的本地表（7 条中英词条）。它的文件头写得很清楚：
为了不与本工作流抢 `packages/i18n` 而临时自建，"一旦词条表空出来就该平移过来"，
并把它作为技术债列进了自己的交付报告。第 16 轮把它平移进全局表
（`web.subscription.notice.*`），`SubscriptionNotice.tsx` 改成 `t()`，
本地表删除。**这是这次收尾里唯一一处真文案。**

顺带修掉的一个坑：原实现用 `` t(`${messageKey}.title`) `` 拼 key，
而**动态拼 key 是门禁明令禁止的**（拼错没有类型兜底）。现在是一张
`Record<SubscriptionNoticeVariant, { title; body }>` —— 变体漏一个是编译错误。

**③ 翻转，然后让门禁自己证明。** 翻转后门禁直接绿，没有需要补的地方 ——
因为 ① 已经核实过没有 JSX 字面量了。

**这一翻到底覆盖了什么，要说清楚**（免得把"门禁绿"当成"界面全绿"）：

| 现在**被管住**的 | 现在**仍然管不住**的 |
|---|---|
| 三个壳里所有 JSX 属性 / JSX 文本节点里的字面量 | 由**别的包**返回、被壳当变量渲染的中文（`§7.10` 的八条通道） |
| 词条表本身（zh 含中文 / en 不含中文 / key 集合一致 / 无死键） | 拼在函数里、通过变量进 JSX 的本地字符串（如 `const label = '中文'`） |
| 开发者诊断**不会**被误伤（候选只来自 JSX，`throw new Error` 不在视野里） | ① 用户笔记里**既有格式**的中文标记（`buildTimeline.ts` 的 `（依赖：X）` 正则 —— 翻了反而解析不出来）；② `ErrorScreen` 的**技术详情行**（`error.message` 原文，收在 `<details>` 里，主文案是按结构化 `failure.kind` 取词条的建议 —— 那是诊断**数据**，不是文案；第 16 轮专门确认过它不是漏，别再「修」它） |

后两类不是"没迁"，而是**按语义不该翻**：`throw new Error('找不到 #root 挂载点')`
是给开发者看的，把它放进面向用户的词条表反而会逼着人去翻一句没人看的话。

---

## 六、加一条新文案的流程

1. 在 `packages/i18n/src/locales/zh-CN.ts` 加**一行** `'命名空间.名字': '中文'`。
   - 一条词条一行 —— 门禁的词条解析是**逐行**的，并且会在"解析到的条数 ≠ 看起来像词条的行数"时直接报错；
   - **不要用 `...spread`**：它会让漏翻译在编译期不可见；
   - zh 词条必须**含汉字**（纯标点会触发规则 2）。
2. 在 `en.ts` 加同 key 的一行。**只能用 ASCII 标点** —— 全角 `，。：、（）「」` 落在 CJK 区间，会被规则 3 判为"英文含中文"。
3. 组件里 `const { t } = useI18n()`，然后 `t('命名空间.名字', { name })`。
   - 类型系统会校验 key：拼错是 **`tsc` 报错**，不是运行时的空字符串。
   - `t` 在同一个 locale 下**引用稳定**，所以 `useMemo(() => [...], [t])` 是正确写法（数据数组搬进组件时用它）。
4. 跑 `node scripts/check-ui-language.mjs`，确认退出码 0 且两个条数相同。

### 什么**不该**进词条表：正字法

规则 2（zh 必须含汉字）会挡下一类看起来很像文案、其实不是的东西：**差别只在标点的模板**。

已撞到两次，两次的处置都是"**搬进代码、按 locale 取**"，不是"给规则开豁免"：

| 撞到的 | 差别 | 现在在哪 |
|---|---|---|
| 移动端的中文列举分隔符 | `、` vs `, ` | `apps/mobile/src/lib/recurrence-display.ts` 的 `LIST_SEPARATOR: Record<Locale, string>` |
| web 捕获面板的剩余时间模板（第 10 轮） | `{date}（{remaining}）` vs `{date} ({remaining})` —— **只差全角/半角括号与一个空格，一个词都不差** | `apps/web/src/features/ai/locale-punctuation.ts` |

判据一句话：**这条字符串里有没有"词"**。

- `{date}（{remaining}）` 里的汉字在 `{remaining}` **那条词条**里，模板本身没有词 → 正字法 → 代码。
- 反例：`'{n} 天后'` 有"天后"两个词 → 文案 → 词条表（"天后"是中文的说法，不是标点习惯）。

🔴 **不要用"给 `allowed` 加一个 key"来绕过规则 2。** 那个 `allowed` 集合只有两个成员
（`common.brand` / `common.lang.en`），它们存在的理由是**两种语言的值本来就该一模一样**。
往里加一个模板 key，等于让"zh 词条必须含汉字"这条规则从一个**不变量**退化成一个**白名单** ——
以后任何一个忘了翻译、把英文原样填进 zh 的词条，都可以用"我这是模板"来辩护。

---

## 七、已知盲区与未核实

诚实列出边界，避免下一个人把它们当成"已经保证了"：

1. **`packages/domain` 里有一批面向用户的格式化函数返回中文** ——
   `formatMonthTitle` / `formatDayTitle` / `WEEKDAY_LABELS` / `formatRemaining` / `formatDuration` /
   `formatFocusDuration`（见 `packages/domain/src/date.ts`、`countdown.ts`、`focus.ts`）。
   它们被 `apps/web` 与 `apps/mobile` 共用，**不是"外壳的文案"**，因此不在本次"抽壳"的范围里，
   门禁也扫不到（门禁只扫 `ROOTS` 列出的应用目录）。
   **处理原则**：语义（"算出来是什么"）留在 domain，措辞（"怎么说出来"）搬到壳里 ——
   壳继续消费 domain 的**结构化**输出（`computeCountdown` / `monthGrid` / 毫秒数），自己用 `t()` 排版。
   - `apps/mobile` **已经按这个原则搬完**：`lib/due-display.ts`（剩余天数，阈值逐条照抄 `formatRemaining`）、
     `lib/date.ts`（月/日标题、星期）、`lib/focus-display.ts`（时长）。
     `packages/domain/src/date.ts` 的 `formatCompactDate` **刻意没搬** —— 它是纯数字、与语言无关。
   - ⚠️ **`packages/domain` 本身尚未改造**，函数还在那里、也还有别的调用方（`apps/web` 与 domain 自己的测试）；
     移动端只是**不再调用** `formatMonthTitle` / `formatDayTitle` / `WEEKDAY_LABELS` / `formatRemaining` /
     `formatFocusDuration` / `describeRecurrence` 了。**web 还没搬**，所以 web 的英文界面在这些位置仍会出现中文。

   **重复规则（`describeRecurrence`）用的也是这个套路，但它多一层麻烦**：
   它返回的是**一句话**，而不是一个数字 —— 没有"结构化输出"可以先拿。所以先给域层加了一个
   `recurrenceParts(rule)`，返回 `{ kind, interval, weekdays / monthDays / byDays / months }`，
   措辞由壳层的 `apps/mobile/src/lib/recurrence-display.ts` 用词条拼。
   为什么不让移动端自己再解析一遍 RRULE：RFC 5545 的 `BYDAY`/`BYMONTHDAY` 组合语义极刁钻，
   两份实现迟早在一个边缘上分叉，而且是"看起来对、偶尔错一次"那种。

   🔴 **中文那一份的措辞是照抄 `describeRecurrence` 的，并且被测试钉住**：
   `apps/mobile/tests/recurrence-display.spec.ts` 拿 `describeRecurrence` 当**独立参照**逐条比对
   （29 条规则）。故障注入验过：把词条表里的「每天」改成「每日」→ 该组测试立刻变红。
   没有这条测试，"迁移措辞"就是一次没有任何证据的重写。

   两处**刻意不逐字对齐**（都只能来自外部：本仓库的 `repeat-presets.ts` 构造不出多月份/负数日的年度规则，
   只有导入或别的客户端才会产生），测试里单独钉住、并写明理由：
   - 多月份：`每年 9、10 月` → `每年 9 月、10 月`（词条按"每个月自带单位"组织，英文尤其需要 September）；
   - 年度里的负数日：`每年 9 月 14、-1 日` → `每年 9 月 14 日、最后一天`（`-1` 是内部编码）。
2. **`localeFromPath` 在非 `/` 的 base 下未验证。** `apps/landing/src/lib/locale.ts` 读
   `import.meta.env.BASE_URL`，单元测试诚实标注了子路径部署分支**没有覆盖**（当前部署在根路径）。
3. **meta 文案（`<title>` / `<meta name="description">`）在两份 HTML 里是手写的**，不走词条表。
   这是刻意的：它们必须在 JS 执行前就存在。代价是改标题要**改两处**（`index.html` 与 `en/index.html`）。
4. **词条表没有复数/ICU 能力**（§2）。英文里 "1 day left" / "3 days left" 这类靠
   **调用方分支 + 单数兄弟词条**解决：`mobile.due.overdueOne` / `mobile.due.overdue` 这样成对存在，
   调用点写 `t(days === 1 ? '…One' : '…')`。zh 侧的单数版与复数版**逐字相同**（中文不分单复数），
   在那几行注释里写明了是刻意的，否则下一个人会以为漏翻。
   `apps/mobile/tests/plural-keys.spec.ts` 把这几组词条内容钉住了（含 `not.toContain('1 items')` 这类反向断言）。
5. **展厅交叉淡入的"重影"**：滚动到中间进度时两个窗口会同时处于约 0.48 不透明度。已知，未修。
6. **"先拼好再塞进 store、由组件直接渲染"的字符串是门禁的第二个盲区。**
   移动端迁移时抓到一例：`apps/mobile/src/lib/focus-timer.ts` 把
   `专注记录保存失败：${msg}` 拼好放进 store，`FocusScreen` 直接渲染 ——
   它既不是 JSX 属性也不是 JSX 文本节点，规则 1 扫不到。已改为 store 只带 `{ reason }`（数据），
   句子在壳里用 `mobile.focus.error.saveFailed` 拼。
   🔴 **所以"门禁绿"不等于"没有硬编码文案"**，只等于"门禁看得见的地方是对的"。
   迁移 `apps/web` 时要同样搜一遍 `features/*/store.ts`、`lib/*.ts` 里"拼中文再返回"的形状。

   **这两个后来都处理掉了**（web 第二批），处置方式与移动端同一套：
   - `features/sync/store.ts`：删掉 `describeStatus()`（**不留第二份措辞**），两处 `'未配置同步服务'`
     换成一个**数据码** `SYNC_NOT_CONFIGURED`（导出常量），`SyncBar` 认码出词条；
     其余错误把原始技术串插进 `web.sync.status.errorRetryable`，句子在壳里拼。
   - `features/focus/store.ts`：`error: string` → `error: { reason: string }`，与
     `apps/mobile/src/lib/focus-timer.ts` **同一形状**（两个壳不许各写一套），
     句子由 `FocusTimer` 用 `web.focus.error.saveFailed` 拼。

   ⚠️ 一个**必须记住的诚实结论**：把这两个文件登记进 `migratedFiles` 的收益**没有看起来那么大**。
   规则 1 的候选只取自 JSX 属性与裸文本节点，而 store 文件里全是普通字符串字面量 ——
   门禁取不到。所以这次登记更像"这个文件已迁"的**声明**（含路径有效性与禁止项检查），
   真正的保证来自"把句子全部移出 store"这个动作本身。**别把门禁覆盖说大。**
7. ~~**`apps/web` 还没迁完**~~ → **第 16 轮已迁完，逐文件清单退休**（§7.12）。
   ⚠️ 这条曾经写着"`features/ai/*` ~164 处、`AiSettings.tsx` ~72 处 仍未迁" ——
   那些数字是**按"含汉字的行"数出来的，而其中绝大多数是多行 JSX 注释的续行**。
   按门禁口径重扫后真实剩余是 13 行 / 5 文件（8 行订阅词条 + 5 行开发者诊断 / 解析正则）。
   这条留在这里当反面教材：**估工作量要用和验收同一个口径。**
   ⚠️ **在这些迁完之前 web 的英文界面是不完整的** —— 不能对外说"web 已经支持双语"。
8. ✅ **web 的语言切换器已落地**（第 8 轮，第三批）。
   `LanguageSwitcher.tsx` 挂在顶栏 `.ht-header__actions`（与主题切换按钮并列，**零 CSS 改动**），
   按钮文字是**目标语言的自称**（中文界面写 `English`，英文界面写 `中文`）—— 看不懂当前语言的用户
   恰恰最需要找到它。它**不新增任何词条**，只用既有的 `common.lang.zh` / `common.lang.en`。
   - 持久化与 `<html lang>` 由 `lib/locale-host.tsx` 承担，**线上 `main.tsx` 与测试共用同一个 `LocaleHost`**
     （抽出来的理由：避免"测试里手拼一遍 Provider"这种第二份接线）。
   - `apps/web/tests/language-switcher.spec.tsx`（6 条）挂**真的 `<App />`**，断言
     `收集箱 → Inbox`、tab 条 `时间线 → Timeline`、空状态、按钮自身，
     以及切换后 `el.textContent` **不再含** `收集箱`（反向断言）、`localStorage['heyta.locale']`、
     `document.documentElement.lang`、整树卸载重挂后仍是英文。
   - 注入验证过：把 `setLocale(next)` 改成 `setLocale(locale)`（点了没反应）→ 2 条红；
     只掐掉落盘副作用 → 另外 2 条红（说明持久化断言**独立于**可见文案断言，不是抄了一遍）。
9. **`packages/sync-client` 的 `describeConflictPayload` 仍是中文，且会吐出内部标识符。**
   它返回一句中文（空载荷 `（空）`），其中一支还会把载荷的**字段名**拼进去（`completedAt: 123`）。
   现在加了一个结构化兄弟函数 `summarizeConflictPayload(payload)` →
   `{ kind: 'text' | 'fields' | 'empty' }`（`text` 是用户自己的字，不翻译；`fields` **只报数量**，
   由壳决定怎么说），`describeConflictPayload` 改为建立在它之上，
   所以两条路径对同一种载荷的判断**永远是同一份**。
   ✅ **两端都已切到结构化版本**（web `ConflictDialog.payloadSummaryText`、mobile `conflict-view.payloadSummaryText`），
   **`describeConflictPayload` 现在没有生产调用方**，只有它自己的单测还在（保留是因为它仍是导出的公开 API）。
   ⚠️ `fields` 这一支以前会把 `completedAt` 这种内部标识符直接渲染进界面 —— 现在只报数量，
   两端都有 `not.toContain('completedAt')` 的渲染断言钉住。
10. 🔴 **跨包返回的用户可见中文**（门禁完全扫不到，三个壳都受影响）。
    这一条是上面 §7.6「拼好再塞 store」的**跨包版本**，规模更大：

    | 位置 | 字符串字面量里的汉字 | 性质 |
    |---|---|---|
    | `packages/domain/src/**` | 133 | 🔴 **真界面文案**：`preferences.ts`(31)「还需要 3 次专注」、`recurrence.ts`(27)、`date.ts`(19)、`preference-hints.ts`(14) |
    | `packages/app-host/src/**` | 165 | **大部分是模型提示词**（`ai-capture` 37 + `ai-prioritize` 37 + `ai-duration` 33 = 107 处里绝大多数）。判据只有一条：**这条字符串会不会被渲染** |
    | `packages/ai/src/**` | 63 | 披露(已结构化)、17 个 `reason` 码的**中文兜底句**、`presets.ts` 的端点 label/note、`health-store`(已结构化) |
    | `packages/sync-client/src/**` | 20 | 同步错误句（`未登录`、`未设置端到端加密口令…`），会流进两个壳的错误条 |
    | `packages/storage/src/**` | 27 | 🔴 **会在启动失败路径上渲染**（见下表后面的「门禁扫不到的一类通道」）：`indexeddb-adapter.ts` 的 8 条是真实用户场景（升级被别的标签页阻塞、隐私模式、配额满），`memory`/`sqlite` 适配器那些「事务访问了未定义的 store」是**编程错误** |
    | `packages/op-log/src/**` | 12 | `engine.ts` 的 3 条是引擎抛出的诊断（写入失败、opId 冲突）；`state.ts` 的 9 条是给文档/内省用的说明文本，**不渲染** |
    | `packages/local-api/src/**` | 48 | 本地 API / MCP 的工具说明（`tools.ts` 20 + `mcp.ts` 15） |
    | `packages/design-system/src/**` | 79 | ⚠️ **多半不是界面文案**：`generate.ts` 是**构建期**写进 Swift/ArkTS 产物的注释与告警 |
    | `apps/node-host/src/**` | 81 | ⚠️ **不在本目标的范围里**：它是 CLI 输出，不是「三个外壳」之一 |

    🔴 **这张表我第一版是错的，而且错得不轻。** 第一版用 `grep -c '[一-鿿]'` 数"含汉字的**行**"，
    于是 `ai-feedback.ts`（**全是文档注释、可渲染字符串是零**）被算成 143 处里的大头，
    而真正会渲染的 `preferences.ts` / `preference-hints.ts` / `storage` / `op-log`
    **一个都没进表**；`apps/node-host` 更是整块漏掉。

    **教训：排批次不能拿"含汉字的行数"当规模。** 现在有了可复现的工具：

    ```bash
    node research/tools/audit-cjk-strings.mjs              # 只扫 packages/<pkg>/src 与 apps/<app>/src
    node research/tools/audit-cjk-strings.mjs packages/ai  # 看单包
    node research/tools/audit-cjk-strings.mjs --json       # 机器可读
    ```
    它**剥掉注释**、只列字符串字面量；默认**跳过测试目录**
    （不过滤时 `packages/domain` 排第一的是 `tests/capture.spec.ts` 的 195 处夹具 ——
    拿那个排批次会得出"最该先迁的是测试数据"这种荒谬结论）。
    ⚠️ 它不判断"会不会被渲染"（那要人看），也不进 `pnpm check` —— 它是清单，不是门禁。

    这些**不是**"顺手也翻一下"就能解决的：它们的处置方式和 §7.1 的重复规则完全一样 ——
    **跨包函数改成返回结构化数据/错误码，措辞归各壳**。整批做，不要零敲碎打。

    ⚠️ 而且有一个**硬耦合**：`scripts/check-ai-coverage.mjs:382` 用**中文字串**钉住了共享包函数：

    ```js
    const cloudText = ai.describeDestination('heyta-cloud') ?? '';
    if (!cloudText.includes('不受端到端加密')) { fail(…) }
    ```

    也就是说 AI 面板的披露文案来自跨包函数，**只迁 `AiSettings.tsx` 的 JSX 不会让英文界面变英文**。
    动 AI 那批时必须连这个断言一起改（改成按词条 key 查两种语言），否则要么门禁失守、
    要么英文界面漏中文。这是 ADR-0006 的基石，不能糊。

    ✅ **第一步已经做了（第 8 轮）**：`packages/ai` 现在只返回结构化结论
    （`destinationDisclosure` / `retentionDisclosure`），中文句子退化成**由它投影出来的兼容层**，
    `buildDisclosure` 同时带上两者。设计、陷阱与剩下的步骤见 §9。

    ✅ **第 9 轮的审计又推翻了我两个判断**（都是好消息）：
    - **`routing.ts` / `provider.ts` 早就带 `reason` 码了**（17 个：`not-configured` / `no-route` /
      `bad-scheme` / `plaintext-remote` / `credentials-in-url` / `egress-not-authorized` /
      `circuit-open` / `capability-missing` / `http-error` / `network` / `empty-response` …）。
      也就是说 AI 那批**不需要再动 `packages/ai` 的结构**，缺的只是**壳去用 `reason`** ——
      那 31 处中文是**兜底句**，不是唯一信息源。这让 AI 批小了一大截。
    - 真正的缺口只剩两处，其中一处**这一轮补掉了**：`health-store.ts` 的熔断状态句
      （现在有 `endpointHealthDisclosure()`）；另一处是 `presets.ts` 的端点 `label`/`note`
      （设计见 §9「presets 怎么处理」）。

#### 🔴 门禁扫不到的一类通道：跨包返回 `{reason, message}`，壳渲染了 `message`

**这是我在第 10 轮逐行核 `storage` / `local-api` 那 45 条时发现的。
它比表里任何一条都更该先修 —— 因为门禁的结构性保证是"壳里没有硬编码文案"，
而这条通道让**中文照样出现在界面上**。**

形态是同一个，**已经抓到七处（第 12 轮修完 5 处，剩 2 处）**（全部逐行核过，不是推测）：

| # | 渲染点 | 中文来源 | 触发场景（真实） | 状态 |
|---|---|---|---|---|
| 1 | `apps/web/src/main.tsx:52` 取 `error.message` → `ErrorScreen.tsx:74` **直接 `{message}`** | `packages/storage` 的 `IndexedDB 升级被其它标签页阻塞 —— 请关闭该应用的其它窗口后重试`（`onblocked` 那条是**无条件**抛的；其余是 `request.error ?? …` 的兜底，只在浏览器不给错误对象时才出现） | 同站开两个标签页时升级 IndexedDB、Safari 隐私模式、配额满 —— **应用启动就直接失败** | ✅ 来源侧第 11 轮已做（`StorageError.failure`，5 个 kind，7 个新用例 + 验证器 `storage` 组）<br>✅ 第 12 轮已修：`features/shell/error-hint.ts` 把 kind 映射成建议词条（穷尽 `Record`），`ErrorScreen` 把原文降级成 `<details>` 技术详情（主文案变成建议）。新 `error-screen.spec.tsx` 11 条，注入用例第 ⑤ 条证明"把原文放回主文案位置"会红 |
| 2 | `AiSettings.tsx:748` `{localApiVerdict.message}` | `packages/local-api` 的 `validateLocalApiConfig()`：`端口必须是 1–65535 的整数，当前是 70000。` / `打开本机 API 必须设置一个访问 token。…` | 在设置里启用本机 API 时填错端口或没填 token | ✅ 第 10 轮已改为按 `reason` 取词条 |
| 3 | `AiSettings.tsx:598` 附近 `rejected.map(… {r.message} …)` | `packages/ai` 的 `validateEndpointUrl()`：`远端端点必须是 https。` / `端点地址里不要写用户名/密码…` | 添加一个远端端点时地址写错 | ✅ 同上 |
| 4 | 四个 AI 面板的「留多久」一行（`AiBreakdown.tsx:407` / `AiCapture.tsx:494` / `AiDuration.tsx:396` / `AiPrioritize.tsx:362`）`disclosure.retentionText ?? t(…)` | `packages/ai` 的 `describeRetention()`：`未离开设备，不涉及服务端保留。` / `保留策略由你自己的端点决定，heyta 无从知晓。` | 打开任一 AI 面板就会看到（本机端点与自备远端端点两支） | ✅ 第 11 轮已修：四个面板共用 `features/ai/disclosure-copy.ts` 的 `retentionMessageKey()`（`switch` 穷举 kind），新增 zh 两条**逐字等于**跨包句、en 两条，配 `ai-retention-locale.spec.tsx`（中/英 × 本机/自备）；已实证"改回 `retentionText` 则 2 条 en 用例变红"。（结构早在第 8 轮就做好，只是**壳里零使用**） |
| 5 | 四个 AI 面板的失败态（`AiBreakdown.tsx:278` / `AiCapture.tsx:347` / `AiDuration.tsx:243` / `AiPrioritize.tsx:245`）`setFailure(outcome.message)` → `AiBreakdown.tsx:520` `{failure}` | `packages/ai` 的 `AiFailure.message`（`provider.ts:96`），7 个 `reason` 各有一句 | 请求失败时 —— 网络、HTTP 错误、空响应、熔断、备用端点需要重新授权 | 🔴 **在 web 层做不到**（第 11 轮核实）：这里拿到的不是 `packages/ai` 的 `AiFailure`，而是 `packages/app-host` 的 `BreakdownOutcome` —— 它的 `reason` 只有 `'ai-unavailable' \| 'unparseable' \| 'empty-title'`，**7 个 `AiFailureReason` 在 app-host 边界被压成一个 `'ai-unavailable'`**，`status` 也丢了（`grep -c status ai-breakdown.ts` = 0）。修法在 app-host：四个 `*Outcome` 的失败分支加 `cause?: AiFailureReason` + `status?: number`（设计见 §9） | ✅ **第 18 轮已修**：`result.reason` 作为 `cause` 带出来（七个原因码 → 词条，穷尽），主文案按原因码取词条；`message` 降级为 `<details>` 技术详情（它有时是**动态披露**，如要发的字段 / 保留策略，整句进不了词条）。验证器 `aifailure` 组钉住「指错词条 → 授权提示消失」 |
| 6 | `AiSettings.tsx` 的预设按钮：`title={preset.prerequisite}` + `t('…presetAdd', { name: preset.label })` | `packages/ai` 的 `AI_ENDPOINT_PRESETS[].label` / `.prerequisite`（`'本机 Ollama'` / `'本机 LM Studio'` / 前置条件说明） | 打开设置看端点预设 | ✅ 第 11 轮修了映射；**第 17 轮修掉回退分支**（不再渲染跨包原值，改为显示 id）+ 加了一条**枚举全部出厂预设**的测试 —— 回退分支从「门禁拦不住、只能写注释」变成「新增预设没加词条就当场变红」，并由验证器 `preset` 组证明它会红 |
| 7 | `AiSettings.tsx` 熔断/失败提示（原 `describeEndpointHealth(health, now)`） | `packages/ai` 的 `health-store.ts` 熔断状态句：`暂时停止使用` / `{n} 秒后重试` | ✅ 第 12 轮已修：壳侧 `features/settings/health-copy.ts` 把 `endpointHealthDisclosure()` 的 kind 映射成词条 + 插值参数（与 retention 同一套），zh 逐字沿用兼容句，新 `ai-settings.spec.tsx` 英文用例断言"一个汉字都不许有" |

⚠️ 表里 4–7 是第 11 轮复核子代理那批时找到的 —— **门禁当时是绿的**。

⚠️ **但"渲染了一个变量"不等于"渲染了一句文案"。** 第 12 轮盘点时我的 grep 抓到
`AiPrioritize.tsx:463 {suggestion.reason}`，差点当成下一条通道 —— 它其实是
**模型生成的理由**（`ai-prioritize.ts:300` 从模型返回的 JSON 里读出来的）。
把模型输出"翻译"是错的。它牵出的真问题是另一件事：**提示词该按界面语言要理由**
（现在 `:211` 的提示词是中文写死的，所以英文界面可能拿到中文理由）——
那是 `packages/app-host` 提示词层的问题，**不是词条表能解决的**。
判据：`grep` 到的字符串要问一句"这是**我们**写的，还是**模型/用户**写的"。

✅ **最后一条（第 13 轮）也修完了，但过程推翻了我自己的记录两次。**

第 12 轮我在文档里写「移动端 `ProfileScreen.tsx:319 {status.message}` 把包里的中文整句渲染出来」——
**读代码之后发现是错的**：两边其实都已经在做「本地化框 + 原文参数」，
web 甚至已经有一个结构化码（`SYNC_NOT_CONFIGURED`，是**码**不是中文）。

真正的缺口在**包里和框里各一半**：

- `packages/sync-client` 抛的 6 句失败**没有结构化原因**，壳只能整句插进英文句子 →
  `Sync error: 未设置端到端加密口令，已停止同步（不会以明文上传）`（中英混排）；
- 移动端更糟：`describeSyncStatus` 的 error 分支**把 `message` 整个丢掉**，只剩「同步失败」——
  这已经不是 i18n 问题，而是**丢信息**（那个文件的文件头自己写着「每种失败都必须说清是哪一种」）。

修法（三层，每层都进了验证器）：

1. `packages/sync-client` 的 error 变体加**必需的** `reason`（6 个成员），
   并且**已知原因不再需要 `message`**（`SyncFailure` 判别联合）——
   于是「已知失败」那几个分支里**根本不存在**可以被误渲染的中文，
   `message` 只剩真正意外的那一类（诊断数据，本来也不该翻译）。
   顺带把原来那句含糊的「未登录或缺少加密口令」**拆成两条精确原因**。
2. web：`features/sync/sync-failure-copy.ts` 按 reason 取词条；
   哨兵 `SYNC_NOT_CONFIGURED` 整个删掉（`message` 是 `string`，拿它当码用没有任何类型保护）。
3. 移动端：`status-text.ts` 同样按 reason 取词条，两个壳**共用** `common.sync.error.*` 那五条句子
   （key 共享所以句子不会漂移；映射各写一份，因为 `packages/i18n` 是领域无关的，
   不能让它 import 业务包 —— 否则词条表就和同步协议焊死了）。

⚠️ 副产物：`apps/node-host` 的 CLI 也消费 `SyncStatus`，已知原因没有 `message` 之后它编译不过 ——
它是**终端界面**（不在三个外壳范围内），给了它一行诚实的兜底（`message ?? 同步失败（reason）`），
没有把词条表塞进 CLI。
这条通道的教训要记住：**"门禁绿"只证明"壳里没有硬编码文案"，它证明不了"界面上没有中文"。**
两者之间隔着一层"变量渲染"，而这一层只能靠**逐行看渲染点**（`grep '{[a-zA-Z.]*message}'` 之类）来发现。

✅ **一个已经做对的先例，修上面五条时照着它做**：

```
apps/web/src/features/focus/FocusTimer.tsx:237
  {t('web.focus.error.saveFailed', { reason: focus.error.reason })}
apps/mobile/src/screens/FocusScreen.tsx:317   ← 同样
```

**句子是词条，`{reason}` 是技术细节**（`error.message` 原文）。这不是缺陷 —— 它是这五条该有的形状：
**主文案归词条，技术串降级成参数或"详情"**。区别就在于技术串是**主文案**（上面五条：整屏只有它，用户读到的就是它）
还是**参数**（这里：外面那层句子已经本地化了）。修的时候别把技术串提成主文案。

🔴 **我自己在这条上判断错了一次，记下来**：我给子代理的第 5 条指令写的是
"`outcome` 是 `packages/ai` 的 `AiFailure`，用 `Record<AiFailureReason, MessageKey>` 取词条"。
**这个类型模型是错的** —— 我没有读调用点，只看了 `packages/ai` 的定义就往下推。
子代理拒绝执行并给了证据（`packages/app-host/src/ai-breakdown.ts:221` 的 reason 联合只有三个成员、
`grep -c status` = 0、四份 `*Outcome` 一模一样、六处既有断言钉在跨包中文上）。
这正是"**不要凭包里的类型去推断壳里拿到的是什么**"的一个实例：
中间隔着一层边界，而边界会把结构**压扁**。

✅ **可执行的收敛判据**（比"再看一遍"可靠）：

```
grep -rn "retentionText\|destinationText\|outcome.message\|verdict.message\|r.message" apps/*/src
```
排除注释后**必须为空**。第 10 轮之后 web 侧只剩第 5 条（4 处）与第 4 条（4 处）——
两条都已在同一批里交给子代理修，判据就是上面这条 grep。

🔴 **为什么门禁一定扫不到**：门禁检查的是**字面量**，而这里渲染的是 `{message}` —— 一个**变量**。
它和已经修好的 `disclosure.destinationText`、冲突载荷摘要是**同一个问题**（跨包文案流进界面），
只是这条路没人走过，所以"门禁全绿"在这条路上不等于"英文界面里没有中文"。

✅ **好消息：这三处的来源都已经带了结构化原因**，不需要重新设计：

| 来源 | 已经有的码 |
|---|---|
| `LocalApiConfigVerdict.reason` | `bad-port` / `token-required` / `not-loopback` / … |
| `EndpointUrlVerdict.reason` | `unparseable` / `bad-scheme` / `plaintext-remote` / `credentials-in-url` |
| `packages/storage` | ✅ 第 11 轮补上：`StorageFailure`（`open-failed` / `upgrade-blocked` / `request-failed` / `transaction-failed` / `programming-error`）；**IndexedDB 适配器已全部转换**，memory/sqlite 仍是裸 `Error`（那些是编程错误与驱动原始报错，不是界面文案，边界已写在 `errors.ts` 里） |

所以 #2 / #3 是**纯粹的壳侧改动**（按 `reason` 取词条），#1 的来源侧**第 11 轮已经做完**
（`StorageFailure`，与 `packages/ai` 的 `AiFailure.reason` 同一个做法），剩下的是壳侧。

🔴 **做 #1 时踩到的坑（值得记住）**：包一层之后 `error.name` 就从 `ConstraintError` 变成了 `StorageError`，
于是唯一索引冲突的幂等路径当场坏掉 —— **4 个既有用例变红抓到了它**。
修法是把驱动原始错误保留成 `Error.cause`，让需要驱动细节的调用方去查 `cause`（而不是查 `name`）。
`asStorageError()`（一手结构优先）也是同一个道理：外层统一 catch 不能把更具体的原因降级掉。

⚠️ **改 #2 / #3 时有一条能让既有测试不回归的技巧**：新加的 **zh 词条与现在的句子逐字相同**（含插值位置），
参数从组件**已有**的 `localApi.port` / `localApi.bindAddress` 取，**不要去解析那句 message**。
这样断言中文的既有用例原样通过，而英文界面同时变对了。

⚠️ 另外注意 `ErrorScreen` 里已经有过一次**同类修正修了一半**：注释说
「`IndexedDB` 是浏览器内部的接口名，对用户没有行动价值」并把 **hint** 换成了「浏览器的本地数据库」——
但 hint **上面那行**原始 `message` 原封不动，等于把同一句话用中文又说了一遍。
**修一半比没修更容易让人以为修好了。**

### 7.11 🔴 我的 i18n 包让移动端 APK 一启动就崩，而十几道门禁全绿

**这是这次迁移造成的、最严重的一个真实故障。**记在这里，因为它的形状会重复出现。

- **现象**：release APK 启动即崩 —— `TypeError: Cannot read property 'useContext' of null`，崩在 `TasksScreen`。
- **根因不在任何一行业务代码**：`packages/i18n` 为了自己的 `react.tsx`（`I18nProvider` / `useI18n`）
  把 `react` 放进了 devDependencies，解析到 **19.3.0**；而 `apps/mobile` 钉的是 **19.2.3**。
  于是 `packages/i18n/dist/index.js` 位于仓库根下，Metro 从它出发**逐级向上**查找时命中的是
  `packages/i18n/node_modules/react`，**而不是** `nodeModulesPaths` 里那两份 ——
  `nodeModulesPaths` 只是"找不到时才去的地方"。两个 React 各有各的 dispatcher，i18n 那一侧是 `null`。
- **为什么所有检查都没说话**：门禁查的是**源码与声明**，而这个缺陷只存在于
  "打包器最后装进去几份"这件事上。`check:ui-language`、`check:layering`、领域测试……
  一个都不看产物。**"检查全绿"证明不了"应用能跑"。**
- **修法（另一个 actor 做的）**：`apps/mobile/metro.config.js` 的 `resolveRequest` 把
  react / react/jsx-runtime / react/jsx-dev-runtime **硬改写起点**、钉成单实例；并新增
  `scripts/check-mobile-bundle.mjs` —— 它**真的打一份 bundle 数份数**，已接进 `pnpm check`。
  ⚠️ `extraNodeModules` **修不了**这个问题：包自己那份**存在**，正常解析会成功，
  兜底根本不触发。⚠️ 范围刻意收窄到 react 的三个入口，**不要顺手拦 `react-native`**
  （它内部有大量嵌套解析，改写起点会连带弄坏）。
- **验证记录（这条时间线本身就是教训）**：
  - 19:32 单平台版本的门禁报**绿**；
  - 19:35 门禁升级成**同时查 android + ios** 之后，立刻报出 **2 份**；
  - 19:36 加上 `resolveRequest` 之后重跑 → **android / ios 各 1 份**（8.2 MB bundle，两个平台都验了）。

  🔴 也就是说：**同一件事被两个强度不同的检查分别报绿/报红时，必须信更严的那个。**
  旧版本的绿不是"当时没问题"，而是**它测不出来**。这与 §八 那两次"空转注入造成的假绿"
  是同一类错误 —— 检查的**强度**本身就是需要被验证的东西。
- **web 没中招**：`apps/web` 与 `packages/i18n` 解析到的是**同一份** `react@19.3.0`
  （同一个 `.pnpm` 实例），所以 Vite 那边只有一个 React。
  🔴 **版本对齐 ≠ 单实例**：把 i18n 钉成 19.2.3 之后两份仍然是两份，而且会让 **web** 变成重复实例。
  所以"在依赖图里对齐版本"不是修法，**单实例解析才是**。
- **我这边没动依赖图**：给 i18n 加 `pnpm.overrides` 之类能"顺手也修好"，
  但那要改锁文件 + 重装 + 动根 `package.json`（另一个 actor 正在改它），
  而**包装器层面的单实例钉法已经被实测证明够了**。修在解析层比修在依赖图更准。
- **给下一个人的判断**：往 pnpm monorepo 里加一个**依赖 React 的包**，等于给每个打包器
  多铺一条 React 解析路径。加完必须**看产物**，不能只看门禁。

---

### 7.11 跨包文案：`packages/domain` 的偏好（第 14 轮）

前七条通道都是"壳里渲染了包里的中文"。这一段更根本：**领域层自己就在拼界面文案**。

`Preference.evidence` 的注释写着"给用户看的原话"，`preferenceLabel(id)` 直接返回中文名 ——
两个壳把这三处（名字 / 依据 / `hint.summary`）整句渲染出来。门禁扫不到，因为壳里渲染的是**变量**。

修法是这个仓库已经用过三次的套路（`StorageFailure`、`EndpointHealthDisclosure`、`SyncFailure`）：
**先给事实，再给句子**。

- `packages/domain/src/preference-evidence.ts`：`PreferenceEvidence` 判别联合（7 个成员，
  与 7 个 `PreferenceId` 一一对应）+ `preferenceEvidenceText()` 作为**中文投影**。
- `Preference.evidenceFacts` / `PreferenceHint.facts` 是**必需**字段 ——
  "新加一种偏好却忘了给事实形状"会**编译报错**（另有一条 `AssertSame<PreferenceId, PreferenceEvidence['kind']>`
  双向包含的类型断言）。
- 壳：`apps/web/src/features/settings/preference-copy.ts`（穷尽的 `Record`）。

⚠️ **这里的中文句子有两份**（领域投影 + 词条表）。两份就是两个会漂移的地方，
所以 `apps/web/tests/preference-copy.spec.tsx` **逐字比对**两者 —— 漂移必然变红
（验证器 `preference` 组第 ① 条注入的就是这个）。与其写注释提醒下一个人"记得同步"，
不如让漂移无法通过。

**两个我自己撞出来的坑（都不是"细心一点"能避免的，是测试抓到的）：**

1. 我按 `preference-hints.ts` 里**注入 prompt** 的措辞写了投影
   （`任务标题以中文为主，…请保持同样的风格`），而 `evidence` 是**给用户看**的另一套
   （`你的标题以中文为主，平均 10 个字`）。领域测试当场红：`以中文为主` 不见了。
   这两套措辞**刻意不同**（一个给模型看，一个给人看），所以事实只需要 `cjkShare` / `emojiShare`，
   措辞各归各的投影。
2. `Preference` 加了必需字段之后，领域 / app-host / web 一共 **9 个 spec 的手写 fixture**
   全炸了（`facts` 是 `undefined`，运行时才炸）。这是好事：它说明字段真的是必需的。
   修法是**由事实投影出 `evidence`**，而不是给 fixture 补一串假的中文 ——
   补完之后 fixture 的形状才和真货一致。
   （3 个 app-host/web spec 里的 `evidence` 手写值恰好**逐字等于**投影输出，
   这反过来证明投影没有改变行为。）

**同一段的第二半（第 15 轮完成）**：`WithheldPreference.detail` —— 领域层拼好的
另外 21 句中文（"还没有完成过的专注记录"、"还需要 5 次专注"…）。
它比名字和依据麻烦在两点：句子由 **(偏好 id, reason)** 两个维度决定
（`no-data` 7 种说法、`not-stable-enough` 7 种），
而且 `not-enough-samples` 那条还带一个数字，**只有领域层算得出来**
（`MIN_SAMPLE_SIZE - 已有样本`）。

做法：`WithheldPreference` 从「一个 interface + 一句中文」改成**判别联合**：

```ts
type WithheldPreference =
  | { id; reason: 'disabled' }
  | { id; reason: 'no-data' }
  | { id; reason: 'not-enough-samples'; remaining: number }   // ← 只有这一支有数字
  | { id; reason: 'not-stable-enough' };
```

`detail` **整个删掉**（域外消费者只有 `MemoryPanel` 一处，说明它是纯界面文案，
只是住错了地方），句子按 `(id, reason)` 进词条表：三张按 `PreferenceId`
**穷尽**的表 + 一个 `disabled`，共 22 条 × 2 语言。

为什么判别联合而不是 `remaining?: number`：可选字段会让"忘了给数字"变成
界面上一句"还需要 0 次专注"；判别联合让它**编译不过**。
（真源仍然是 `MIN_SAMPLE_SIZE - samples.length` —— 领域层没有放弃这个判断，
只是不再拼那句话。）

⚠️ **数字本身也是这套东西的一部分**：`remaining` 是**领域算出来的事实**，
不是壳能补的。验证器 `preference` 组第 ⑤ 条注入的就是"取到了数字却忘了传进句子"。

**顺带变强的两处断言**：领域测试原来只能 `expect(withheld?.detail).toContain('5')`
—— "还需要 5 次"和"还需要 15 次"都会让它变绿。现在断言的是
`{ reason: 'not-enough-samples', remaining: 5 }`，精确了。

## 八、验证命令

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

# 门禁本身（新契约）
node scripts/check-ui-language.mjs

# 词条表：类型（漏翻译）+ 单元测试
pnpm --filter @heyta/i18n build
cd packages/i18n && node_modules/.bin/tsc --noEmit -p tsconfig.spec.json && node_modules/.bin/vitest run

# 各壳
cd apps/landing && node_modules/.bin/tsc --noEmit -p tsconfig.json && node_modules/.bin/vitest run
cd apps/mobile  && node_modules/.bin/tsc --noEmit -p tsconfig.json && node_modules/.bin/vitest run
cd apps/web     && node_modules/.bin/tsc --noEmit -p tsconfig.json && node_modules/.bin/vitest run
```

⚠️ `apps/*` 的 `tsc` 解析的是 `@heyta/i18n` 的**构建产物**（`dist/`，gitignore）。
所以改完词条表后、跑各壳测试前，必须先：

```bash
pnpm --filter @heyta/i18n build
```

否则会出现"明明加了词条，壳里却报 `词条不存在`"——那是读到了旧的 `dist`，不是词条写错了。

### "改坏 → 红 → 改回 → 绿"的记录，以及它们的**位置问题**

迁移过程中每加一条检查，都跑过一次故障注入（注入一处，确认对应测试确实变红，再改回）。
下面是**注入的是什么**，这样任何人都能重跑；但要说清楚一件不光彩的事：

🔴 **这些探针当时写在 `/tmp/*.mjs`，而 `/tmp` 在这次会话中途被系统清空了 —— 文件没了。**
也就是说下面那些"我验过了"目前**不可复现**，只剩这张表里的描述。
教训是直接的：**故障注入的脚本和它保护的东西一样，不能住在临时目录里。**
（同一件事还有第二个后果：`/tmp` 里那批 headless Chrome 脚本也一起没了，
所以"线上验过 WebGL 降级"这件事同样只剩结论、没有脚本。）

**已经固化的是十二组（66 个用例）**：

```bash
node scripts/verify-i18n-failures.mjs             # 全部 12 组
node research/tools/audit-cjk-strings.mjs         # 跨包中文清单（不是门禁，是排批次的依据）
node scripts/verify-i18n-failures.mjs gate        # 只跑一组
node scripts/verify-i18n-failures.mjs disclosure  # AI 披露 + 熔断状态的结构层面守卫
node scripts/verify-i18n-failures.mjs conflict    # 冲突载荷的结构层面守卫
node scripts/verify-i18n-failures.mjs landing     # 落地页 head（/en/ + hreflang）
node scripts/verify-i18n-failures.mjs scene       # WebGL 白屏事故的两道防线
node scripts/verify-i18n-failures.mjs storage     # 存储失败的结构化原因（错误屏那条通道）
node scripts/verify-i18n-failures.mjs sync        # 同步失败原因的结构化（三层：包 / web / 移动端）
node scripts/verify-i18n-failures.mjs preference  # 偏好的「事实 → 句子」（领域投影 / 词条表 / 壳的判据）
node scripts/verify-i18n-failures.mjs preset      # 出场预设的 label / prerequisite（按 id 映射 + 回退分支）
node scripts/verify-i18n-failures.mjs aifailure   # 四个 AI 面板失败态（原因码 → 词条，message 降级为详情）
```

它自己会保证两件事：注入前**断言锚点存在**（否则空转的注入会伪装成"验证过了"），
还原前**确认文件没被别人改过**（这个仓库里同时有多条工作流在改同一个文件，
宁可用例失败也不能覆盖别人的改动）。

各组钉住的东西（每组都是"改坏一处 → 必须变红 → 还原 → 必须变绿"）：

| 组 | 用例 | 注入的是什么错法 |
|---|---|---|
| `gate` | 3 | 硬编码文案回流、词条表缺 key、门禁规则被放宽 |
| `catalog` | 4 | en 用中文交差、zh 用英文占位、两份 key 集合不一致 |
| `recurrence` | 9 | 中英重复规则的映射漂移（含"分隔符进词条表"这条错法） |
| `disclosure` | 10 | 🔴 把托管 AI 归类成第三方端点（**改分类而非改措辞**）、熔断优先级被破坏、剩余秒数向下取整、**端点健康映射错位（跳闸说成"失败过"）** |
| `conflict` | 6 | 结构化载荷退化成整份 JSON 丢给界面（当年真实的 bug 形状）、标题字段优先级颠倒 |
| `storage` | 7 | 把「被别的标签页阻塞」错报成「打不开」、统一 catch 把更具体的原因降级、**冲突判定不看驱动原始错误（这一条是实测发生过的回归：幂等写入的 4 个既有用例当场变红）**、**崩屏建议不再区分失败原因**、**把原始错误文本放回建议位置（英文界面又露中文）** |
| `sync` | 5 | 🔴 **把「没有加密口令」错报成「没登录」**（用户要做的两件事完全不同）、web 壳两种失败指到同一条词条、移动端不再区分原因（退回迁移前的「同步失败」） |
| `preference` | 7 | 领域投影与词条表**漂移**（同一个事实两份中文）、偏好名指错词条、把「逾期」说成「提前」（判据写反）、「还不了解」的原因指错偏好、`remaining` 忘了传进句子 |
| `preset` | 2 | 预设的 id 写错 → 落进回退分支（跨包中文 / 裸 id 直接上屏） |
| `aifailure` | 2 | 原因码指错词条 → 用户要做的动作（「去逐功能授权」）从界面消失 |
| `landing` | 6 | 英文入口的 `lang`/`canonical` 写回中文、hreflang 少一件、英文页顶着中文标题 |
| `scene` | 5 | 错误边界不再进入失败态（**白屏复发**）、降级时把整节丢掉、渲染器构造失败后不降级 |

⚠️ 其中三组（`conflict` / `landing` / `scene`）是**第 9–10 轮才补的**，此前它们只有描述。
三组都遵守同一条纪律：**基线必须是确定性的** —— `conflict` 故意不跑壳的测试
（壳的测试要读词条表，而词条表可能正在被别的批次写，那样基线自己就红了）。
`landing` / `scene` 只跑落地页的测试，与词条表无关。

| 被保护的检查 | 注入的故障 |
|---|---|
| 重复规则中英映射（`apps/mobile/tests/recurrence-display.spec.ts`）| ① `interval === 1` 判反；② 删 `-1`（最后一天）分支；③ 序数恒用 `ordinal.n`；④ 描述不了时返回空串；⑤ 剥掉 `BYDAY` 序数；⑥ 中文列举分隔符换成英文逗号 |
| ↗ 同一组里的**词条表**注入（最重要的两条）| ⑦ zh「每天」→「每日」（一个字之差，parity 组立刻红）；⑧ zh 星期「三」→「三日」；⑨ en「every day」写成「每天」 |
| 冲突载荷摘要（`packages/sync-client/tests/conflict-payload.spec.ts`）| ① 优先级调换成 `name` 先于 `title`；② 去掉标题的 `trim()`；③ 字段上限 4→5；④ 空对象不再算 `empty`；⑤ `null` 不再算 `empty` |
| 双入口 head（`apps/landing/tests/seo-head.spec.ts`）| ① 英文入口删掉整组 hreflang；② canonical 指回 `/`；③ 照抄中文 `<title>`；④ 照抄中文 description；⑤ 只改英文入口的主题引导脚本 |
| WebGL 降级（`apps/landing/tests/scene-fallback.spec.tsx`）| ① 渲染器构造抛错；② 懒加载分块失败（`lazy()` reject）|
| 门禁的逐文件迁移（`scripts/check-ui-language.mjs`）| ① `migratedFiles` 里放一个不存在的路径；② 放一个不属于本 root 的路径；③ 留一个未迁的文件却写进 `migratedFiles`；④ 已迁文件里留硬编码中文；⑤ zh 词条写成英文 |
| 门禁的文案扫描 | 在已迁文件里加一句非 `t()` 的中文 / 加一条只有标点的 zh 词条 |

⚠️ 两个注入在写探针时**自己先坏过**，记下来因为它们都是"假绿"：
- 有一次正则没匹配上（源码里 `<meta` 与 `name=` 之间是换行），故障**根本没注入**，
  测试当然绿 —— 于是那条契约其实没被验证。之后的探针都先断言"文件真的被改到了"。
- 有一次拿"内容没变"当注入成功的判据，而注入本身是把 `[]` 换成 `[]`（恒等），误报成失败。

---

落地页发布后还要验**线上**（本地 DNS 会返回代理假 IP，所以必须 `--resolve` + `--noproxy`）：

```bash
curl -s --noproxy '*' --resolve heyta.finlaw.cloud:443:124.223.13.226 https://heyta.finlaw.cloud/en/ \
  | grep -oE '<html lang="[^"]*"|<title>[^<]*</title>'
```

期望 `<html lang="en"` 与英文标题；`/en`（无斜尾）应当是 `301` 到 `/en/`。

---

## 九、AI 披露文案怎么本地化（第一步已完成，剩下的是切壳）

这是整个迁移里**唯一一处改错了会造成不可逆信任损失**的地方，所以先把设计写死，别临场发挥。

**当前进度**：下面设计里的第 1、4 条**已经落地**（`packages/ai` 结构化 + 新的注入验证组），
第 2、3、5 条还没做（要等 web 的 AI 面板那批一起动）。

### 现状：这条链是怎么到界面的

```
packages/ai/src/supply.ts          describeDestination() / describeRetention()  → 直接返回中文句子
        ↓
packages/app-host/src/ai-*.ts      把两句包成 disclosure: { destinationText, retentionText }
        ↓
apps/web/src/features/ai/*.tsx     4 个面板渲染（AiBreakdown / AiCapture / AiDuration / AiPrioritize）
                                   每个面板还各自写了一句中文兜底：
                                   `disclosure.retentionText ?? '未定案 —— 在 heyta 说明清楚之前，这个端点不允许启用。'`
        ↓
apps/mobile（同一份 disclosure）
```

`packages/ai/tests/egress.spec.ts` 把披露变成可失败的检查，规则**按目的地分开**：

1. `heyta-cloud` **必须**出现"不受端到端加密"这个**确切否定**；
2. 把这句话挖掉之后，**不许再出现任何**"端到端加密" —— 只许否认，不许顺口提；
3. `none` 与 `user-endpoint` **一个加密承诺都不许有**；
4. `E2EE` / `end-to-end` 这两个英文 token **在任何模式下都不出现**。

`scripts/check-ai-coverage.mjs:382` 又拿**中文字串**把它钉了一遍。

### 为什么不能只迁 JSX

披露文案来自**跨包函数**。只把 `AiSettings.tsx` 的 JSX 迁进词条表，
英文界面上这句话**仍然是中文** —— 而它恰恰是最不能出错的一句。

### 设计

1. `packages/ai` **只返回结构化目的地，不再返回句子**（它现在**没有任何 dependencies**，
   也不要为了这个给它加 `@heyta/i18n` —— 加依赖解决的是"谁来措辞"，而那本来就该是壳的事）：
   - `describeDestination(d)` → `{ kind: 'local' | 'third-party-endpoint' | 'heyta-cloud-managed' }`
   - `describeRetention(d)` → `{ kind: 'not-applicable' | 'third-party-decides' | 'undecided' }`
     （`heyta-cloud` 的保留策略**仍未定案**，继续用 `undecided` 表达"不许编数字"，语义一字不改）
   - `health-store.ts` 的三句健康状态同理：返回 `{ kind, failures?, seconds? }`。

   ✅ **也已完成（第 9 轮）**：`endpointHealthDisclosure(entry, now)` →
   `{ kind: 'ok' } | { kind: 'failing'; failures } | { kind: 'circuit-open'; failures; retryInSeconds }`，
   `describeEndpointHealth()` 同样退化成投影。
   ⚠️ 这里有一条**判定优先级**是结论的一部分，测试单独钉住：**已过期的跳闸不算跳闸**
   （`circuitOpenUntil <= now` 要落到 `failing`，否则一个其实已经恢复的端点会永远显示成不可用）。
   `Math.ceil` 也是刻意的：29.5 秒要说"30 秒后重试"，不能说"0 秒后重试" —— 两条都有注入用例。

   ✅ **`routing.ts` / `provider.ts` 不用改结构**：它们的失败结果**早就有 `reason` 码**（17 个），
   中文 `message` 只是兜底句。所以 AI 批剩下的工作**只有"壳按 reason 取词条"**。

   ✅ **已完成**（`packages/ai/src/supply.ts` + `egress.ts` + `provider.ts`）：
   新增 `destinationDisclosure()` / `retentionDisclosure()` 与两个类型；
   旧的 `describeDestination()` / `describeRetention()` **退化成由结构化结论投影出来的兼容层**
   ——它们 switch 的就是新函数的 `kind`，所以两条路径不可能各说一套；
   `buildDisclosure()` 的返回值**同时**带上结构化字段与（标注 `@deprecated` 的）旧文本字段；
   新的中文句子与旧的**逐字节相同**，所以既有测试一条没改。

   🔴 **顺手挖出一个真 bug**：`provider.ts` 的 `previewDisclosure()` 在 `mode: 'off'` 时返回
   `destinationText: ''` —— 一份**空的披露文本**（界面拿到只会渲染空白），而且空字符串
   与任何结构化结论都不可能"互相印证"。它以前还**没有显式返回类型**，
   所以两个分支形状不同也不会有人报错。现已显式标注 `EgressDisclosure` 并统一走 `buildDisclosure()`。
   （`previewDisclosure` 目前没有生产调用方，只有测试引用。）
2. 文案进**共享命名空间** `common.ai.*` —— 披露与壳无关，web 和移动端就该用同一份。
   不要各写一套：两边措辞一旦分叉，就是在两个平台上对用户许下**不同的**承诺。
3. **规则要逐语言重述**，不能把中文规则照抄一遍：
   - zh：必须有 `不受端到端加密`；挖掉后不得再出现 `端到端加密`。
   - en：必须有**对应语言的确切否定**；挖掉后不得再出现 `end-to-end`（大小写不敏感）。
     ⚠️ 这里有个真实的张力：规则 4 禁的是"在别处顺口提一句"，不是禁止否定句本身。
     所以英文的判定要**先扣掉否定句再查残留**，和中文那条完全同构 ——
     **不许为了让英文过而把规则整体放宽**。
   - 两种语言都：`E2EE` 不出现；`none` / `user-endpoint` 不出现任何加密承诺词。
4. `packages/ai/tests/egress.spec.ts` 改成断言**两种语言各自**的规则；
   它有权 import `@heyta/i18n`（dev 依赖），因为"AI 披露该怎么说"这条规则本来就该由 AI 这个包拥有。
   ✅ **已完成了一半**：结构层面的守卫先立好了 —— 新增 `tests/disclosure-shape.spec.ts`（9 条），
   其中最重要的一条是 **"托管不许被归成本地或第三方端点"**（有人想靠改分类软化那句话时先红），
   以及 **`undecided` 与兼容层 `undefined` 必须同时成立**（一边说没定、另一边编数字时先红）。
   这 4 种注入已固化进 `scripts/verify-i18n-failures.mjs` 的 `disclosure` 组。
   剩下的是"逐语言"部分，要等 §2 的词条落地。
5. `scripts/check-ai-coverage.mjs` 的 §8c 改成**按 key 查两份词条表**，而不是查函数返回值。
   🔴 新检查必须**同时覆盖 zh 与 en** —— 只查一种语言是退步，比现在更差。
   🔴 **ADR-0006 的结论是已接受的，不许改**（`AGENTS.md` §8）。这里只实现它，不重谈它。

### 两个容易搞错的边界

- **提示词不是界面文案。** `packages/app-host/src/ai-{breakdown,duration,prioritize,capture}.ts`
  里那 101 处中文，**大部分是发给模型的指令**。判断标准只有一条：**这条字符串会不会被渲染**。
  （`你是一个任务拆解助手…` 是提示词；`'任务没有标题，没什么可拆的。'` 是界面文案。）
- **`presets.ts` 的 `label: '本机 Ollama'` 是界面文案**（端点选择器里显示），要迁；
  `health-store.ts` 的三句健康状态也是。

### 🔴 `outcome.message` 怎么修（第 11 轮查清：**必须改 app-host**）

四条通道里唯一"壳侧做不到"的就是它。原因是一个**边界把结构压扁了**：

```
packages/ai        AiFailureReason = 7 个（network / http-error / egress-not-authorized / …）
                            ↓  app-host 的四个 ai-*.ts
packages/app-host  BreakdownFailureReason = 'ai-unavailable' | 'unparseable' | 'empty-title'
                            ↓  （capture 另加 'empty-text' | 'text-too-long'，prioritize 加 'empty-tasks'）
apps/web           setFailure(outcome.message)   ← 只剩一句中文
```

- 7 个原因被压成 `'ai-unavailable'` 一个，所以**一个 key 表达不了**"去授权 / 去加端点 / 缺能力 / 熔断 / 网络"
  这几种不同的修复动作；
- `AiFailure.status` 在 app-host 边界就丢了（`grep -c status` = 0），HTTP 状态码没法插值；
- 六处既有断言钉在跨包中文上（`ai-breakdown.spec.tsx:327/340`、`ai-capture.spec.tsx:526/549`、
  `ai-duration.spec.tsx:407/437`、`ai-prioritize.spec.tsx:244/400`），
  其中"授权"这条如果不加 `cause` 就只能退化成笼统文案 —— **那是实质退化，不是本地化**。

**修法（顺序不能反）**：

1. `packages/app-host` 的四个 `*Outcome` 失败分支加两个字段：
   `cause?: AiFailureReason`（`result.reason` 在 `ai-breakdown.ts:302-322` 那一层还在手上）
   `status?: number`（`result.status` 同上）；
2. ⚠️ `packages/app-host/src/index.ts` 与 `packages/domain/src/index.ts` 是 `export *` barrel，
   **当时有别的订阅/付费工作流正在改它们** —— 动手前先确认它空了；
3. 壳侧再按 `Record<AiFailureReason, MessageKey>` 取词条（这一步就变成纯壳侧了），
   `message` 降级成 `title`/"详情"，**既有那六处断言改成断言词条原文**（不是删掉）。

### presets 怎么处理（✅ 第 11 轮已做）

`AI_ENDPOINT_PRESETS` 里每个预设带 `label` / `note` / `prerequisite`，**外加**一份
`config.label`（后者会跟着配置被存下来）。所以不能简单地把它们换成词条 key：

- `config.label` 是**会被持久化的字段**，`AGENTS.md` §4 的纪律管着它 —— **不动它的语义**。
- 预设的 `label` / `note` / `prerequisite` 是**选择器界面**的文案，该迁。

做法：**壳按 `preset.id` 映射**（`'ollama' | 'lm-studio'`），文案进
**共享命名空间** `common.ai.preset.<id>.{label,note,prerequisite}`（web 与移动端共用一份，
理由同 §9 第 2 条：两边措辞分叉就是两个平台对用户说不同的话）。

🔴 **映射必须写成显式 `switch`，绝不许拼 key：**

```ts
// ❌ 这样写会**静默**毁掉"漏翻译 = 编译错误"
t(`common.ai.preset.${preset.id}.label`)

// ✅ 字面量 key 才能被类型系统与门禁检查
case 'ollama': return t('common.ai.preset.ollama.label');
```

拼出来的 key 是 `string`，`MessageKey` 的联合类型管不到它 —— 少一条词条**不会报错**，
只会在界面上显示成 `词条不存在：en / common.ai.preset.xxx.label` 或者干脆空白。
这是整个 i18n 设计里唯一一处"看起来能用、其实把类型安全绕过去了"的写法，
所以写在这里当禁令，而不是等 review 时靠人发现。

---

## 十、下一步（按优先级）

1. **web AI 批**（第 10 轮进行中，子代理在跑）：`features/ai/*`（4 文件）+ `AiSettings.tsx`
   + `features/capture/**` + `MemoryPanel.tsx` + `aiStore.ts` 的 `WEB_KEY_STORAGE_NOTICE`
   （真的渲染在 `AiSettings.tsx:776` —— 只迁 store 不迁渲染它的面板，会让英文界面露出一句中文）。
   ⚠️ **验收时不要只看门禁**：门禁此刻会绿，但它看不到下面第 2 条那三条通道。
   ⚠️ 做完之前**不能说"web 已支持双语"**。
2. 🔴 **"变量渲染"通道**（§7.10 的「门禁扫不到的一类通道」，第 10/11 轮共抓到 7 处）——
   门禁永远扫不到，但英文界面里会出现中文：
   - `AiSettings.tsx:748` `{localApiVerdict.message}`（`local-api` 的 `reason` **已存在** → 纯壳侧改动）；
   - `AiSettings.tsx:598` 附近 `{r.message}`（`packages/ai` 的 `EndpointUrlVerdict.reason` **已存在** → 纯壳侧改动）；
   - 🔴 四个面板的 `outcome.message`：**必须先从 app-host 把 `cause`/`status` 传出来**（设计见 §9）。
   ✅ 第 11/12 轮已修：`{message}` 那条（`error-hint.ts` + `<details>`）、`describeEndpointHealth`（`health-copy.ts`）、`{localApiVerdict.message}`、`{r.message}`、四个面板的 `retentionText`、预设 `label`/`prerequisite`。
   ⚠️ 修这些时把 **zh 词条写成与现有句子逐字相同**（含插值），既有中文断言就不会回归。
3. **跨包用户可见中文整批收掉**（§7.10）：`sync-client` 的同步错误（它的 `reason` 码**还没有**）、
   `app-host` 的 `notConfigured()` 与 AI 错误解释、`domain` 的 `preferences.ts`(31) /
   `preference-hints.ts`(14) / `recurrence.ts`(27) / `date.ts`(19)。**一次做完，不要零敲碎打** ——
   它们的处置方式一样（结构化返回 + 各壳措辞）。
   ⚠️ **注意 `app-host/src/ai-*.ts` 的 107 处里绝大多数是模型提示词**，不是界面文案 ——
   判据只有一条：**这条字符串会不会被渲染**。别把提示词翻成英文（那会改变模型行为，不是本地化）。
4. **落地页用新词条表重新发布**（§8 尾部的线上验收）。
   ⚠️ 发布前先跑一次**完整**的八组注入验证（`node scripts/verify-i18n-failures.mjs`）——
   第 10 轮只逐组跑过 `conflict` / `landing` / `scene`（词条表与门禁当时被子代理持有，
   跑 `catalog` / `gate` 两组会互相干扰）。**这个总数 42 还没有一次性跑过。**
5. **交出去之前看一眼产物，不只是门禁**（§7.11 的教训）：`pnpm check` 现在多了一道
   `check:mobile-bundle`（真的打 android + ios 两份 RN bundle 数 React 份数）。
   i18n 这条线里凡是"加了包 / 动了打包配置"的改动，都要顺带跑它 ——
   **绿色的门禁证明不了应用能启动**，而这道门禁本身也**被升级过一次**才真正有效。