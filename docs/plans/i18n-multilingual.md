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
| 来源 | **URL 路径**：`/` = 中文，`/en/` = 英文 | **运行时偏好**（四层解析链，见下） |
| 为什么 | SEO 是这一版存在的理由：两个地址才能分别被收录，也才能被分享给指定语言的用户 | 应用在登录/本地存储后面，没有 SEO 需求；`apps/web` 也没有路由，用 URL 表达语言会凭空引入一套路由 |
| 具体做法 | 两个静态 HTML 入口（`index.html` / `en/index.html`），共用同一个 JS bundle；`src/lib/locale.ts` 从 `location.pathname` 判定 | `apps/web`：四层解析链（见下）；`apps/mobile`：设备语言 + **仅内存**的手动覆盖，登录会话内采纳账号语言 |

### 应用的语言解析链（2026-10-01 产品拍板）

> 优先级与 W3C / MDN 的共识一致：**显式选择必须持久化且最高，自动检测只做首启回退，绝不清掉明确选择。**

| 优先级 | 信号 | 说明 |
|---|---|---|
| 1 | 本机显式选择（`localStorage['heyta.locale']`） | 用户点过语言切换器。永远最高，登录与自动检测都不覆盖 |
| 2 | 账号语言（`users.locale`，仅登录后） | 新设备首登、本机无显式选择时采纳；登录态下改语言同时写回账号 |
| 3 | 系统语言（`navigator.language` / 设备语言） | 未登录首启。web 自 2026-10-01 起读 `navigator.language`（此前刻意不读，当日产品拍板推翻 —— 旧理由「换个浏览器被翻回」只成立于存储被忽略时，四层链下存储永远更高）。桌面壳的 WebView 该值反映系统语言，因此**不需要壳层 `?lang=` 透传** |
| 4 | `zh-CN` 兜底 | 系统语言不受支持（如 `fr-FR`）时。**产品明确：兜底必须是中文** |

`?lang=`（落地页交接）的位置：高于系统语言、低于已存偏好 —— 那是用户**刚在落地页读着**的语言。
标签匹配统一走 `packages/i18n` 的 `matchLocale`（BCP 47 主语言前缀 + 逗号列表取首个可识别候选），
web/mobile 共用一份（此前 mobile 的 `classifyLocale` 与将来 web 各写一份 = 第三次同形状漂移，先收掉）；
server 的 Accept-Language 解析（带 q 值、多条目）是另一个函数、留在服务端，等第三种语言落地时再决定搬运方式。

**落地页仍然刻意不做 `Accept-Language` 自动跳转**（范围只是落地页，不是应用 —— 应用的第 3 层是本地读
`navigator.language`，不涉及服务端跳转）。理由：自动跳转会让"用户分享出去的 URL"和"接收者看到的语言"不一致，
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

一次性翻规则会让仓库立刻全红，而**长期全红的门禁等于没有门禁**（`AGENTS.md` 的 §8 工作流第 3 条）。
所以 `ROOTS` 逐个应用迁移：`migrated: true` 走新规则，`migrated: false` 继续走旧规则（必须是中文）。
两边都不松 —— 未迁移不等于"没人管"，只是还在用旧契约。

`apps/landing` 与 `apps/mobile` 都是**整包一次翻转**的（迁移期间门禁短暂变红，翻完转绿）。
但 `apps/web` 不行：它最大（当时 29 个源文件，2026-09-27 实测 `apps/web/src` 已有 59 个 `.ts`/`.tsx`），而且**同一时间有另一条工作流在改它**
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

**门禁能失败**（`AGENTS.md` 的 §8 工作流第 3 条的硬要求）已用真实违规输入逐条验过 ——
在一份 `/tmp` 的仓库副本里注入违规、跑门禁、看退出码与诊断，全程不动真实仓库。
**用例的真身是脚本，不是这张表**（`node scripts/verify-i18n-failures.mjs gate` / `catalog` / `readiness`）；
表里只留"红在哪条判据"，改判据时以脚本输出为准。

| 注入的违规 | 退出码 | 门禁给出的诊断（逐字取自当前实现） |
|---|---|---|
| 基线（不注入） | `0` | —— |
| 已迁移应用里写 `aria-label="违规文案"` | `1` | 规则 1：字面量没走 `t()` |
| `migratedFiles` 里放一个不存在的路径 | `1` | 路径不存在 —— **拒绝运行**，而不是"找不到就当合规" |
| zh 词条写成纯英文 | `1` | `zh-CN 词条里没有汉字 —— 很可能是拿别的语言占位` · `改法：写成 zh-CN。确实是逐字不许翻译的（品牌名/平台名/命令），加进 UNTRANSLATABLE_KEYS 并说明理由。` |
| en 词条写成中文 | `1` | `en 词条里出现了汉字 —— 很可能是把中文复制过来当 en` |
| 从 en 删掉一条（漏翻译） | `1` | `zh-CN 词条表里有这条，en 表里没有 —— 漏翻译` · `改法：在 en.ts 补上 '<key>'。` |

> ⚠️ 这张表**更新过一次，而且必须更新**：规则 2/3 原来是单语言写法（`ZH_LATIN_OK`、"中文词条里一个汉字都没有"），
> 2026-10-01 按 locale 泛化后，白名单改名 `UNTRANSLATABLE_KEYS`、诊断文案由 `rules.scriptName` 生成。
> **文档抄门禁的措辞就会过期** —— 所以每条诊断都由脚本断言（`expectRedFor(name, needle, …)` 里的 `needle`
> 就是诊断子串；改了文案而没改用例，注入验证会红）。

四条规则各自给出**可操作**的诊断，而不是一句"不合规" —— 这一点很重要：
门禁红了以后要能直接照着改，否则下一个人会去猜或被逼着读门禁源码。

---

## 五、迁移进度

门禁的汇总行会打印「扫描文件数 / 文案处数 / zh 条数 / en 条数 / 已迁移的目录」，**条数以它为准**，
本文不重复数字（避免两处定义同一事实）。

| 外壳 | 状态 | 门禁模式 | 备注 |
|---|---|---|---|
| `apps/landing` | ✅ 已完成 | `migrated: true` | 含 `/en/` 双入口 + hreflang + 导航里的语言切换器；已发布并在线上逐条验过。第 17 轮加了价格区（新增 `landing.pricing.*`），并把三组指向**私有仓库**的外链（源码/文档/贡献）整组摘掉 —— 理由与「加回来时要做什么」的清单见 `apps/landing/src/components/Nav.tsx` 顶部 |
| `apps/mobile` | ✅ 已完成 | `migrated: true` | 语言来源见 §3；域层文案的处置见 §7.1；英文单复数见 §7.4 |
| `apps/web` | ✅ 已完成 | `migrated: true` | 第 16 轮收尾：逐文件清单**退休**（§7.12）。订阅提示的本地词条表收编进全局表；语言切换器见 §7.8 |

`apps/mobile` 迁移时还发现并修掉了一处**门禁看不见**的中文（见 §7.6）：这提醒我们
"门禁绿"只等于"门禁覆盖到的地方是对的"，不等于"没有硬编码文案"。

**移动端最后一块中文（重复规则）也已处理**：域层的 `describeRecurrence` 返回中文句子，
现在拆成 `recurrenceParts`（域层，给结构化结果）+ `describeRecurrenceText`（壳层，给措辞）。
细节与两处刻意的措辞偏离见 §7.1。

---

---

### 7.14 双语这条线的四条**验证边界**（第 19 轮提出：账号语言 + 日/韩就绪）

这四条都是"事情做了、但判据覆盖不到那一角"，写下来是为了让下一个人不必重新发现，
也为了**别把它们读成已验证**。

🟢 **第 20 轮（2026-10-01）把前两条关掉了**，关的方式是**真跑**而不是改写措辞 ——
所以这一节现在同时记着：原来缺什么、这次实测到什么、以及**实测顺手翻出来的两个
不属于本线的缺陷**。后两条仍然没关，写清楚卡在哪。

1. ✅ **已闭合：英文浏览器首启现在是常驻门禁。**
   原来的处境：`apps/web/tests/setup.ts` 把 `navigator.language` 钉成 zh-CN
   （为的是保住迁移前那批「无偏好 ⇒ 中文」的用例），于是"英文浏览器的首启访客
   看到的是不是英文"**在单测层不可观测** —— 把解析链第 3 层整个删掉，jsdom 全绿。
   第 19 轮那次真浏览器实测是**一次性的**，跑完就没了。

   现在按当时写下的"正确做法"补上了：`e2e/tests/language-first-launch.spec.ts`
   五条，每条都 `newContext({ locale })` **显式设**系统语言（不依赖这台机器的
   系统语言，否则同一份代码在中文 Mac 与英文 CI 上给出不同结论），
   `testDir: './tests'` ⇒ `pnpm check:ai-e2e`（在 `pnpm check` 里）自动收。
   ⚠️ **没有去解 `setup.ts` 的钉** —— 那会让几十条与语言无关的用例集体变红，是假信号。

   🔴 **这条门禁上线当天就抓到一个真缺陷**，而且是判据自己抓的：
   五条里有三条断言"首启的推断值**不落盘**"（推断值一旦写进 `localStorage`，
   `hasStoredLocalePreference()` 就把它误判成"用户选过" ⇒ 解析链第 2 层
   「登录后采纳账号语言」永不触发）。三条全红。根因与修法：

   | | |
   |---|---|
   | 缺陷 | `LocaleHost` 用 `useRef(true)` 实现"首启那一遍不落盘"，而 `main.tsx` 四处都套着 `<StrictMode>`，dev 下 effect 同一 dep **跑两遍、同一个 ref** ⇒ 第二遍走了落盘分支 |
   | 实测打印 | `effect pass 1 firstRun=true locale=en` / `effect pass 2 firstRun=false locale=en` ⇒ `localStorage['heyta.locale']` 已经是 `en` |
   | 修法 | 落盘挂到**显式动作**（`selectLocale` 里 `applyLocale`）而不是"值变了"的 effect；effect 只留幂等的 `activateLocale`。不把 `applyLocale` 塞进 `setLocale(updater)` —— StrictMode 同样重放 updater |
   | 为什么单测此前测不到 | 那批用例挂的是**不带 `<StrictMode>`** 的 `LocaleHost`。补上 `mount(true)` 的四条之后：旧写法下**恰好这 4 条红、原有 8 条仍全绿** |
   | 界面上看得见吗 | 看不见。变异运行里界面语言与 `<html lang>` 的断言**全部照绿**，症状只在存储层 |

   ⚠️ 本轮实跑在**隔离检出**的 4331 端口（仓库标准配置钉 4318，此刻被另一条会话占着，
   `reuseExistingServer: false` 会直接失败，也不去抢它）。截图 6 张人已看过。

2. ✅ **已闭合（并更正一条写错的数字）：切换器"从 LOCALES 派生"两处都做了真变异。**
   第 19 轮说这条"无法在本工作树内证明"，理由是改共享词条源会让别人的批次一起红 ——
   这个顾虑对**主工作树**成立，对**隔离检出**不成立。本轮用
   `git worktree add --detach /tmp/… HEAD` + 一次真 `pnpm install` 把它证完了：

   | 变异 | 实测 |
   |---|---|
   | `LOCALES = ['zh-CN']`（等价于 `slice(0,1)`） | `language-switcher.spec.tsx` **8 条里 5 红 3 绿** |
   | 还原 | 8/8 绿 |
   | 全量注入套件（17 组 / 114 条判据） | **114/114 符合预期，exit 0** —— 此前这条线从没整跑过一遍 |
   | `pnpm -r build`（干净检出、干净 HEAD） | exit 0 |

   🔴 **原文写的"精确 6 条红"是错的**（实际 5 条）。数字错在这里而不被发现，
   是因为它从来没被复跑过 —— 判据被抄进文档之后就没人再量一遍，正是本仓库最高发的失效形状。

   ⚠️ 剩下那一半（**真**加一种语言、把 `ja` 打开）仍然留到真要加的那天验。
   `LOCALE_LABEL_KEY` 的 `satisfies Record<Locale, MessageKey>` 保证漏登记自称是编译错误。

3. ⚠️ **仍然是边界，但卡点换了 —— 原来那句"本机不可执行"是错的。**
   第 20 轮写的是"需要真 provider 配置，这台机器上 `/tmp/heyta-ai-live` 没有凭据"。
   本轮实测：**能跑**。本机 `127.0.0.1:11434` 上有一个在服务的 Ollama，而
   `packages/ai/src/provider.ts` 文件头写的就是"只用 OpenAI 兼容的 `/chat/completions`
   HTTP 契约（Ollama / LM Studio / vLLM / llama.cpp / 各家中转都实现它）" ——
   也就是说**这条链路的合法形状之一恰好就在这台机器上**，之前那句"不可执行"
   把"没配过"当成了"配不了"。写一份 `{mode:"own", endpoint:"http://127.0.0.1:11434/v1", …}`
   就跑起来了。

   跑起来当场照出**验收脚本自己的三个假红**（不是产品缺陷，见下面"顺带修掉的"）：
   `❌ 被拒绝了` / `❌ 网络请求数 = 0（实际 1 次）` / `❌ 目的地如实标注 none` ——
   **读起来像出境闸门漏了**，而闸门行为完全正确（`supply.ts:100`：回环端点目的地是
   `none`，`requiresEgressConsent('none') === false` ⇒ 本机不需要逐功能出境授权）。

   🔴 **语言那半条仍然没关掉**，而且现在有了量出来的理由。同一台机器、同一个模型，
   只切 `HEYTA_AI_LOCALE`（判据是"条目里含中日韩汉字的个数"，不是人眼印象）：

   | locale | 跑了几次 | 结果 |
   |---|---|---|
   | `en` | **9** | **9 次里条目全部含汉字**（纯拉丁条目 = 0），条目数 1–5 不定 |
   | `zh-CN` | **6** | 同样全中文（这是它该说的语言），拆解本身成立：修脚本报错后那次 5 项、**exit 0** |

   本机唯一可用的模型是 `qwen2.5:0.5b`（494M）。它连"只输出 `- ` 开头的条目"都
   不稳定地遵守，**所以它证明不了"英文界面 ⇒ 模型真的用英文输出"** ——
   这不是链路的问题，是探针的能力不够。
   ✅ **顺带修掉的**（同一笔提交 `ea7344f7`）：`verify-ai-breakdown-live.mjs` 与
   `verify-ai-preferences-live.mjs` 把目的地写成死的 `'user-endpoint'`，
   现在改成用产品自己的 `classifyDestination` / `requiresEgressConsent` 推导，
   闸门步骤按形状分支（需要授权时钉"不发请求"，本机时钉"不适用 ⇒ 请求照发"）。
   修后实测：`HEYTA_AI_LOCALE=zh-CN` ⇒ **exit 0**；
   `verify-ai-preferences-live.mjs` ⇒ **exit 0（17 项）**；
   **变异**：把 `NEEDS_CONSENT` 强行改 `true` ⇒ 精确回到那三条红（exit 1）。
   要关语言那半条，需要**一个有指令遵循能力的模型**（本机装一个 ≥7B，或接用户自己的
   非回环端点 —— 后者还能顺带把"需要出境授权"那一支也跑真）。命令仍是 §10 第 7 条。

   ⚠️ **一个副作用要登记**：`/tmp/heyta-ai-live/provider.json` **存在与否**会改变
   别人的用例行为 —— `apps/web/tests/journey-ai-memory.integration.spec.tsx` 整块
   只在这个文件存在时才跑（他们自己在该文件里写着"缺文件 = 静默跳过 …
   一个永远不执行的判据，比没有判据更糟"）。我为边界③创建了它，于是那条旅程
   **在本轮从"静默跳过"变成"真跑"**。本轮结束已把该文件删除；下次谁要再跑边界③，
   要知道自己同时把这条旅程用例打开了。

4. ⚠️ **仍是边界：账号语言 → 英文邮件的端到端没有实跑**（要真发信）。
   本轮把"为什么这里跑不了"量清楚了，三条都卡住：
   ① `server/src/email.ts` 此刻是**另一条会话的未提交改动**，改它等于踩进别人的批次；
   ② 外发通道 Ethereal 从这台机器**不可达**（`curl` 返回 000），本机也没有任何
   SMTP catcher 可以接；③ 现有那批服务端用例把 db 和发信调用**都 mock 掉了**，
   所以它们证明的是"选对了模板"，不是"信真的以英文发出去"。
   服务端判据因此停在单元级（解析优先级 `body > 账号 > Accept-Language > zh-CN`）。
   要关这条，需要一台能真发信或能起本地 SMTP 落件环境的机器，**不是**再多写几条单测。

📌 **本轮顺带查出的两件不属于本线的事**（都已入档，都不是 i18n 引入的）：

- 🔴 **HEAD 的界面在真浏览器里是塌的**：`.ht-app--with-sidebar` 的
  `grid-template-columns` 吃了两个 HEAD 的 `tokens.css` 里不存在的变量
  （`--ht-layout-sidebar-min/max-width`，它们躺在另一条会话未提交的改动里），
  未定义 `var()` 让**整条声明**失效 ⇒ rail/sidebar/main 竖排单列。
  机制、取证与"为什么所有门禁都看不见它"见 §7 第 91 条。
- **注入探针搬到隔离检出时，软链 `node_modules` 会让"改 dist"的探针静默失效**
  （改的和测的不是同一份文件），见 §7 第 92 条。
- **落地页仍有 3 条红灯，归属不变**（第 19 轮也记了三条，但**用例名已经不是那三个**
  —— 本轮实测：`只取第一段：更深的路径仍落在同一个页面上` + `selfhost` 中/英两条
  "正文里不许出现内部工具链语言"，其余 1002 条绿）。落在并行会话未完成的
  文档中心改造（`site/docs.ts` / 词条表）里，**不是**本轮改动造成的；
  本轮碰到的落地页面（`mockup-fidelity.spec.tsx`）仍然全绿。

### 7.13 价格是唯一一个「词条表之外还有事实源」的文案（第 17 轮）

价格区把一个**别的文案都没有的问题**带进来了：词条表里的价格只是「对外怎么说」，
而真正收多少钱在 `server/src/billing/wechat.adapter.ts` 的价目表里，
法务文本又是一份对用户的承诺。**三处不一致就是虚假宣传**，
而类型系统看不见字符串里的数字，测试也各测各的模块。

所以第 17 轮加了一道专门的**跨层一致性门禁**：

```bash
node scripts/check-pricing-consistency.mjs
```

它由 `scripts/check-ui-language.mjs` 调用（挂在「文案说的是真话」这个契约下），
读四处的金额并逐个比对：

| 层 | 文件 | 谁读它 |
|---|---|---|
| 实际收多少 | `server/src/billing/wechat.adapter.ts` | 服务端下单 + 回调金额校验 |
| 对外怎么说 | `packages/i18n/src/locales/{zh-CN,en}.ts` 的 `landing.pricing.*` | 落地页 |
| 对外怎么承诺 | `server/legal/terms-of-service.heyta.md` | 用户与服务方 |
| 一句话的价格表 | `docs/reference/pricing-and-entitlements.md` 的 `pricing-ssot` 块 | 人 + 门禁 |

🔴 两条设计选择值得单独记下来，因为它们都是**被真实失败教出来的**：

1. **扫全量金额，而不是「检查某条词条含不含 ¥99」。** 后者只要求那个数字
   **在文档里出现过** —— 把法务文本 §4 的 ¥99 改成 ¥139 时它照绿，
   因为 §2 那张表里还留着一个 ¥99。而「同一份对外文本里出现两个不同的价格」
   恰恰是最坏的那种事故。
2. **匹配不到锚点时直接报错，不许跳过。** 词条被改名之后，「找不到就跳过」的实现
   会让这道门禁**永远通过**，而那正是最需要它红的时候。

判据与理由见 [ADR-0017](../adr/0017-single-paid-tier-and-payment-channel.md) §3.2；
上面两条各自的注入用例在 `scripts/verify-i18n-failures.mjs` 的 `pricing` 组（7 个用例）。

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
   🔴 **2026-10-01 形态变更（上面"按钮文字是目标语言的自称"那句随之过期）**：二态 toggle
   换成 `LOCALES` 派生的**一排 `.ht-chip`**（每个语言一枚，当前那枚 `--on` + `aria-current`），
   自称 key 登记进 `LOCALE_LABEL_KEY`（加语言漏登记 = 编译错误），点当前语言不写不回传；
   用例 **6 条 → 8 条**，新增的那条直接断言节点集合 = `LOCALES.map(...)`
   （变异 `LOCALES.slice(0,1)` ⇒ 8 条里 **5 条红**；这个数字 2026-10-01 在隔离检出里复量过，
   此前文档写的"精确 6 条"是错的）。2026-10-01 又加了一组 `<StrictMode>` 用例 → **12 条**，
   理由与它抓出的那个缺陷见 §7.14 第 1 条；"派生 ≠ 硬编码两种"这条也已在
   **隔离检出**里用真变异证完（见 §7.14 第 2 条），不再是没有证据的边界。
   落地页复刻改用同一份 `LOCALES`/`LOCALE_LABEL_KEY`。
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
    | `packages/widget-core/src/**` | ~47（15 真文案 + 32 诊断） | 🔴 **真界面文案**：`adaptive-card.ts` 的 **Windows 组件模板整面单语中文**（无任何语言分支，模板落盘 `apps/web/public/widgets/*.json`）；`contract.ts` 的 32 处是 fail-close 解析诊断，不渲染。**2026-10-01 深度审计才发现这张表漏了它** —— 四平台组件里唯一整面单语的面（iOS/Android/鸿蒙组件都已双语） |
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

**已经固化的是十七组**（第十四组起是 2026-10-01 这一轮加的）：
`gate`/`catalog`/…/`coupon` 那十四组共 **91 个用例**（2026-09-27 实测输出行
`🔴 1/91 个用例不符合预期` —— 见下面的 🔴 说明），本轮新增三组 **23 个用例**
（`diag` 6 + `e2eecopy` 5 + `readiness` 12），三组各自跑过、条条符合预期。
🟢 **114 这个总数已经整跑过了**（2026-10-01，在 `git worktree add --detach HEAD`
+ 一次真 `pnpm install --frozen-lockfile --ignore-scripts` 的**干净检出**里）：
**114/114 符合预期，exit 0**，同一天同一份检出上 `pnpm -r build` 也是 exit 0。
⚠️ 仍然**不要在共用工作树上跑全量**：`gate` / `e2eecopy` 这几组注入的是
`packages/i18n/src/locales/zh-CN.ts` 这类**别的批次正在改的文件**（脚本文件头就写了
这条告警），在别人改到一半时反复覆写它们不是"慢一点"，是**会写坏别人的批次**。

🔴 **搬到隔离检出时有一条硬前提**（本轮实测，代价是两次假失败）：
**不能把主工作树的 `node_modules` 软链过去。** `recurrence` 那组改的是
`packages/i18n/dist/**`，软链会让 `require('@heyta/i18n')` 顺着链解析回**主工作树**
那份 dist ⇒ 探针改的和测试读的不是同一个文件 ⇒ 表现是"注入没让测试变红"，
看起来像门禁坏了。机制见 §7 第 92 条。

```bash
node scripts/verify-i18n-failures.mjs             # 全部 17 组（⚠️ 见上：只在干净检出上跑）
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
node scripts/verify-i18n-failures.mjs pricing    # 价格三处一致（价目表 / 词条表 / 法务文本），见 ADR-0017 §3.2
node scripts/verify-i18n-failures.mjs coupon     # 券的算术 / 判定 / 持久化（ADR-0018）
```

```bash
# 首启语言解析链 —— 真浏览器（唯一能观测 navigator.language 那一层的地方）
pnpm check:ai-e2e                                 # 整个 e2e 套件，含 language-first-launch.spec.ts
cd e2e && npx playwright test tests/language-first-launch.spec.ts   # 只跑这一条
```

⚠️ 上面这条 e2e 用 `newContext({ locale })` 真的改 `navigator.language`，
所以它是**唯一**能测到解析链第 3 层的判据（jsdom 那批被 `setup.ts` 钉成 zh-CN，
见 §7.14 第 1 条）。截图落在 `e2e/test-results/language-first-launch-*.png`，
**结论必须以人真的打开那张图为准**（§6.2 规定一）。
🔴 它同时是本轮那个 `<StrictMode>` 落盘缺陷的发现者 —— 三条"首启不落盘"当场就红。

🟢 **`coupon` 组那 8 条"必须变红"曾经是空转的（2026-09-27 实测），现已修**
（`2bbf791a`）：`prepareProbe('coupon', …)` 的复制清单缺 `server/scripts`，
而 `server/tests/billing-pricing-store.pglite.spec.ts:42` 要
`import … from '../scripts/pricing'` —— 副本里那个模块不存在 ⇒ **基线自己就是红的**
⇒ 后面 8 条注入条条"变红"通过，一个断言都没跑到。这正是 §8 末尾说的"假绿"。
今天全量跑 114/114 时这一组是**基线绿 + 8 条注入各自红**，已复核。
📌 留这段是因为**它过期得很快**：文档里"某组现在是坏的"这种句子的保质期，
取决于别人什么时候把它修掉 —— 所以引用它之前要重跑，而不是照抄。

它自己会保证两件事：注入前**断言锚点存在**（否则空转的注入会伪装成"验证过了"），
还原前**确认文件没被别人改过**（这个仓库里同时有多条工作流在改同一个文件，
宁可用例失败也不能覆盖别人的改动）。

各组钉住的东西（每组都是"改坏一处 → 必须变红 → 还原 → 必须变绿"）：

| 组 | 用例 | 注入的是什么错法 |
|---|---|---|
| `gate` | 3 | 硬编码文案回流、词条表缺 key、门禁规则被放宽 |
| `catalog` | 3 | en 用中文交差、zh 用英文占位、两份 key 集合不一致 |
| `recurrence` | 10 | 中英重复规则的映射漂移（含"分隔符进词条表"这条错法） |
| `disclosure` | 10 | 🔴 把托管 AI 归类成第三方端点（**改分类而非改措辞**）、熔断优先级被破坏、剩余秒数向下取整、**端点健康映射错位（跳闸说成"失败过"）** |
| `conflict` | 6 | 结构化载荷退化成整份 JSON 丢给界面（当年真实的 bug 形状）、标题字段优先级颠倒 |
| `storage` | 7 | 把「被别的标签页阻塞」错报成「打不开」、统一 catch 把更具体的原因降级、**冲突判定不看驱动原始错误（这一条是实测发生过的回归：幂等写入的 4 个既有用例当场变红）**、**崩屏建议不再区分失败原因**、**把原始错误文本放回建议位置（英文界面又露中文）** |
| `sync` | 5 | 🔴 **把「没有加密口令」错报成「没登录」**（用户要做的两件事完全不同）、web 壳两种失败指到同一条词条、移动端不再区分原因（退回迁移前的「同步失败」） |
| `preference` | 7 | 领域投影与词条表**漂移**（同一个事实两份中文）、偏好名指错词条、把「逾期」说成「提前」（判据写反）、「还不了解」的原因指错偏好、`remaining` 忘了传进句子 |
| `preset` | 2 | 预设的 id 写错 → 落进回退分支（跨包中文 / 裸 id 直接上屏） |
| `aifailure` | 2 | 原因码指错词条 → 用户要做的动作（「去逐功能授权」）从界面消失 |
| `diag` | 6 | 🔴 **把原因码退回整句中文**（web 推送 17 条 + 移动端粘贴失败）、模板字面量里拼中文句子、同样的句子写进 `detail` 字段（换个字段名绕过门禁 —— 规则 5「诊断字段不许装句子」就是为它加的）。含两条正向对照（还原后必须回绿） |
| `e2eecopy` | 5 | 披露文案 zh 去掉否定（「不受端到端加密保护」→「受端到端加密保护」，**这是法务级错误**）、en 的 key 改名、**把 en 从 `E2EE_COPY_RULES` 里拿掉**（新语言必须登记，不能静默不查） |
| `readiness` | 12 | 🔴 整组跑在 **`/tmp` 隔离副本**上，真实工作区一个字都不动（这是唯一能在共用工作树上跑的一组）。加一门语言但没登记文字系统判据、加了 `LOCALES` 却没有 `locales/xx.ts`、`locales/` 下躺着没启用的表、**ja 用英文占位**、**ja 全是 CJK 标点/全角（假名判据 ≠ CJK 判据）**、ko 同理、**白名单不是整族放行**、从 `LOCALE_SCRIPT_RULES` 拿掉 ja、**把 `LOCALES` 改名 ⇒ 门禁够不着时必须响亮失败而不给绿**；含三条正向对照 |
| `landing` | 6 | 英文入口的 `lang`/`canonical` 写回中文、hreflang 少一件、英文页顶着中文标题 |
| `scene` | 5 | 错误边界不再进入失败态（**白屏复发**）、降级时把整节丢掉、渲染器构造失败后不降级 |
| `pricing` | 16 | 🔴 价目表与页面不一致（用户看到的价格≠实收）、法务文本**另一处**被改（文档里仍留着一个正确数字 —— 这条正是「扫全量金额」的理由）、`pricing-ssot` 块自己被动过、**偷偷加第二个 SKU**、以及锚点失效时必须报错而不是静默通过 |
| `coupon` | 9 | 🔴 **整组现在是空转的**（基线就红，见上）：折扣取整从 `ceil` 改 `floor`（每单多收一分钱）、去掉"折后 0 元不可支付"、门槛 `>=` 改 `>`、限量券超发、`expired`/`reversed` 占用名额、结算不比冻结金额、去掉幂等闸 |

⚠️ 其中三组（`conflict` / `landing` / `scene`）是**第 9–10 轮才补的**，此前它们只有描述。
三组都遵守同一条纪律：**基线必须是确定性的** —— `conflict` 故意不跑壳的测试
（壳的测试要读词条表，而词条表可能正在被别的批次写，那样基线自己就红了）。
`landing` / `scene` 只跑落地页的测试，与词条表无关。

| 被保护的检查 | 注入的故障 |
|---|---|
| 重复规则中英映射（`apps/mobile/tests/recurrence-display.spec.ts`）| ① `interval === 1` 判反；② 删 `-1`（最后一天）分支；③ 序数恒用 `ordinal.n`；④ 描述不了时返回空串；⑤ 剥掉 `BYDAY` 序数；⑥ 中文列举分隔符换成英文逗号 |
| ↗ 同一组里的**词条表**注入（最重要的两条）| ⑦ zh「每天」→「每日」（一个字之差，parity 组立刻红）；⑧ en「every day」写成「每天」 |
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

### 发布方式（第 17 轮起，写下来是因为此前只存在于 shell history 里）

仓库里**没有**落地页的部署脚本：产物是**手工 rsync** 上去的，
`.github/workflows/ci.yml` 只验证不部署。所以把命令写在这里，否则下一个人只能猜。

```bash
pnpm --filter @heyta/landing build
rsync -az --delete --itemize-changes apps/landing/dist/ ubuntu-jcli:/var/www/heyta-landing/
```

⚠️ `--delete` 是**必要**的，不是顺手加的：`assets/` 里是带 hash 的文件名，
不删旧的就会一直堆着（而 `index.html` 只指向新的那一份）。
第 17 轮它同时清掉了服务器上残留的 `hey.svg` ——
那份文件与 `BrandMark.tsx` 是同一套几何的第二份拷贝，已经从仓库删除。
⚠️ 同步前先 `--dry-run` 看一眼要删什么，`--delete` 对目标目录是无差别生效的。

### 线上验收

本地 DNS 会返回代理假 IP，所以必须 `--resolve` + `--noproxy`：

```bash
curl -s --noproxy '*' --resolve heyta.finlaw.cloud:443:124.223.13.226 https://heyta.finlaw.cloud/en/ \
  | grep -oE '<html lang="[^"]*"|<title>[^<]*</title>'
```

期望 `<html lang="en"` 与英文标题；`/en`（无斜尾）应当是 `301` 到 `/en/`。

🔴 **第 17 轮加的判据：门禁绿 ≠ 线上对。** 词条表和门禁都在仓库里，
而访客看到的是**产物**。`--delete` 有没有生效、hash 有没有换、
地址有没有真的从 bundle 里消失 —— 这些只能在线上查。所以发布后除了 head，还要查产物内容：

```bash
curl -s https://heyta.finlaw.cloud/ | grep -oE 'assets/main-[A-Za-z0-9_-]+\.js'
curl -s https://heyta.finlaw.cloud/assets/main-<上面那个 hash>.js -o live.js
grep -c 'github\.com' live.js        # 🔴 必须是 0：仓库私有，任何源码入口都是 404
grep -c '只收一台服务器的钱' live.js    # 1 = 新文案真的上线了
```

⚠️ 这一步抓出过一次**门禁看不见的真实泄漏**：自建区的终端里有一行
可复制粘贴的 `git clone https://github.com/Xaiver03/heyta.git`。
`tests/render.spec.tsx` 原本只断言「没有指向它的 `<a href>`」——
而它不是链接，是**代码块里的文本**。所以那条断言后来改成查**整页文本**，
线上也改成直接 grep 产物里的 `github.com`。

第 17 轮的实测结果：`/` 与 `/en/` 都是 `200`、hreflang 三元组一致、
线上 bundle 里 `github.com` 出现 **0** 次、两个价格与中英两套新文案都在产物里。

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

## 十、下一步（按优先级，2026-10-01 定稿）

产品当日拍板三件事：① 应用语言四层解析链（§3，本节第 4 条落地）；
② 日语/韩语在路线上 —— 做「就绪准备」、不提前翻译（清单见本节末）；
③ locale 不进 op-log，UI 偏好不做跨设备同步（账号语言已覆盖邮件与登录场景）。

1. ✅ **web AI 批已完成（第 10 轮起，随整根迁移在第 16 轮收口）**：`features/ai/*`（4 面板 + `RouteUnavailable`）、
   `features/settings/AiSettings.tsx`、`features/capture/**`、`features/settings/MemoryPanel.tsx`、
   `aiStore.ts` 那句浏览器密钥提示（已进词条表 `web.ai.settings.keyNotice`，
   渲染点 `AiSettings.tsx:1057`）全部迁完；`apps/web/src` 现在是整根 `migrated: true`（§7.12）。
   ⚠️ 但仍然**不能说"web 已支持双语"** —— 剩余原因见第 6 条（两处「中文当插值参数」）与第 7 条（AI 提示词语言）。
2. ✅ **"变量渲染"通道已修完**（§7.10 的「门禁扫不到的一类通道」；最后一条 —— 四个面板的失败态 —— 第 18 轮修完）：
   - 四个面板的 `outcome.message`：第 18 轮由 app-host 把 `cause: AiFailureReason` 带出来
     （`packages/app-host/src/ai-breakdown.ts:248` / `ai-capture.ts:477` / `ai-duration.ts:383` /
     `ai-prioritize.ts:342`），壳侧 `apps/web/src/features/ai/ai-failure-copy.ts` 按原因码取词条，
     `message` 降级成 `<details>` 技术详情。
   - ⚠️ 这条通道留下的纪律（修新通道时照做）：**主文案归词条，技术串只做参数或"详情"**，
     别把技术串提成主文案。
3. ✅ **web 渲染 `packages/domain` 中文格式化函数的通道已闭合**（2026-10-01 逐点核实 ——
   此前这条一直是本清单唯一标红项，别再照它派活）：
   - `DueBadge.tsx:61` 走 `dueText(task, mode, now, t)`（`:40-45` 有显式禁用 `formatRemaining` 的注释）；
   - `CaptureComposer.tsx:135-141` 走共享层 `captureChipRemainingDays` + `remainingText(days, t)`；
   - `FocusTimer` 的文案全部由 `@heyta/ui` 的 `FocusPanel` 以 `t()` 注入。
   `formatRemaining` / `formatRemainingUntil` / `formatFocusDuration` / `formatMonthTitle` /
   `formatDayTitle` / `WEEKDAY_LABELS` / `describeRecurrence` 的**生产调用方为零**
   （仅剩 domain 内部互调，与 `ai-capture.ts:62,159` 拼 AI 提示词的 `周X`）。

   ⚠️ **其余跨包中文不是"还没迁"，别照老清单去做**：`packages/ai/src/routing.ts`(34) /
   `provider.ts`(11) 那批**已按 §9 的设计降级为兜底句**（壳按 `reason` 取词条）；
   `packages/ai/src/supply.ts` 的披露已是结构化结论；`packages/sync-client` 的失败**已有 `reason` 码**
   （第 13 轮，见 `packages/sync-client/src/client.ts`）；`app-host` 的 `notConfigured()`
   现在返回结构化原因（`packages/app-host/src/host.ts:279`，`reason: 'not-configured'`，不再是一句中文）；
   `packages/domain/src/preferences.ts` 那 31 处中文**已经不在了**（第 14/15 轮改成
   `preference-evidence.ts`(17) / `preference-hints.ts`(14) 两份**刻意的中文投影** + 词条表）。
   📋 出清单用 `node research/tools/audit-cjk-strings.mjs`。判据仍然只有一条：
   **这条字符串会不会被渲染** —— `ai-*.ts` 里绝大多数是模型提示词，**不要翻**。
4. ✅ **语言解析链落地**（§3，2026-10-01 拍板；`0aa6cb0e` P1-1 + `0d13984b` P1-2）。
   `matchLocale` 进 `packages/i18n`（消灭 web/mobile 两份标签归一实现）、web `resolveInitialLocale`
   加 `navigator.language` 第 3 层、mobile `classifyLocale` 收编为 `matchLocale`、
   解析链测试翻转（`tests/setup.ts` 把 jsdom 的 `navigator.language` 钉成 zh-CN，保住「无偏好 ⇒ 中文」）。
   账号语言半边同期落地：`users.locale` **可选列** + 登录响应回传 + 本机无显式选择时采纳 +
   登录态改语言写回账号（`pushLocaleToAccount`）+ `hosted-auth` 三个发信函数带 locale，
   服务端解析 `body > 账号（按邮箱查）> Accept-Language > zh-CN`。
   **判据实跑结果**（本轮，真浏览器 Playwright，截图人看过）：
   zh-CN 浏览器首开 `/app` → 中文；**en-US 浏览器首开 → 英文**（第 3 层直接生效，无需登录）；
   点「English」→ 侧栏 `Inbox` + `localStorage['heyta.locale']=en` + `<html lang>=en` + 当前语言 chip 换成主蓝边框；
   显式选择重开仍在（第 1 层高于第 3 层）。账号语言那半边是**服务端单元判据**（18 条 i18n + server 9/9），
   ⚠️ **端到端"中文浏览器 + 应用切英文 + 魔法登录 → 英文邮件"这条没有实跑**（要真发信），登记为未核实。
5. ✅ **widget-core 收编**（§7.10；`75b0a07b`）。`adaptive-card.ts` 的模板字符串进 `widget.*` 词条，
   `apps/web/public/widgets/*.json` 改成**生成物** + `pnpm check:widgets`（`scripts/check-widgets.mjs --check`
   逐字节对账，照 server-copy 模式）；鸿蒙 `WidgetModels.ts` 的 `QUADRANT_LABELS_EN` 四条补齐，
   并由 `tests/harmony-widget.spec.ts` 与词条表 `web.shell.nav.q1`–`q4` **逐字对照钉住**
   —— 之前英文设备上四个象限名是整卡片唯一没翻译的一处。
   顺带找回一条我自己上一条提交留下的红灯（`39283aaf`：pwa 缓存判据的假记录缺 `placeholder`）。
6. ✅ **「中文当插值参数」残余 ×2**（§7.10 修了七次的那条通道的尾巴；`75b0a07b` 推送半边 + `c1065e53` 专注半边）：
   `apps/web/src/pwa/push-subscribe.ts` 的 17 条中文 `reason` 与
   `packages/app-host/src/focus-actions.ts` 的中文校验异常都改成**结构化 reason 码**，
   壳层穷尽 `Record<Reason, MessageKey>`（编译期拦新增原因码漏配词条）。
   同批给门禁加了**规则 5「诊断字段不许装句子」**（`diagnostic: true`），并用
   `verify-i18n-failures.mjs` 的 `diag` 组证明它真的会红（`20afed13`）—— 这条通道的**上游**从此也有门禁。
7. ✅ **AI 提示词按界面语言**（`87924f75`）。四个 `app-host/src/ai-*.ts` 的提示词加 locale 段
   （`OUTPUT_LANGUAGE_DIRECTIVE`：用界面语言输出），否则英文用户确认后会把模型的中文标题/清单
   **写进数据并同步**（`ai-breakdown` 的 `mergeChecklistIntoNote` 落备注，概率性通道）。
   判据：28 条单测 + 三处变异（拿掉指令段 / 传错 locale / 只改一份提示词）各自精确报红。
   🔴 **未跑通的那条**：「英文界面跑捕获 → 模型输出英文」需要真 provider 配置，
   这台机器上 `/tmp/heyta-ai-live` 没有凭据 ⇒ 命令 `HEYTA_AI_LOCALE=en pnpm verify:ai-breakdown-live`
   **本轮不可执行**，登记为缺口（不是"已验证"）。
8. ✅ **`scripts/check-ai-coverage.mjs` 的中文钉子改按词条 key 查两份表**（`8ac9fe8d`）。
   它原先钉的是一处**界面已经不再渲染**的字符串（第 9 节第 5 条的遗留），所以 en 披露不受保护；
   现在按 key 同时查 zh/en 两张表。判据 `e2eecopy` 组 5/5，含"往 en 表塞回中文 / 删掉 en 那条"两种注入。

### 日/韩就绪清单（准备、不提前翻译）

> CLDR 实锤：**中、日、韩全部只有 `other` 一个复数类** —— 现有「调用方分支 + `…One` 成对词条」
> 对 ja/ko 原样可用（成对词条实测仅 23 组）。**复数机制的触发条件 = 真出现有复数形态的语言**
>（俄/德/波兰/阿拉伯），不是日韩。加第三种语言那天照这张清单走：

- ✅ `types.ts` 的 `Locale` 联合加一项 —— `CATALOGS satisfies Record<Locale,…>` 让缺表直接编译不过
  （设计好的 forcing function，**不加运行时 fallback**）；
- ✅ **门禁规则按 locale 泛化**（本轮）：`scripts/check-ui-language.mjs` 的逐条规则换成
  `LOCALE_SCRIPT_RULES`（`{ mustContain, forbidden }`）—— zh=必须含汉字；en=不许含 CJK/全角；
  **ja=必须含假名**（防把中文原样交差 —— 真日语几乎必有假名）；ko=必须含谚文。
  自称白名单从硬编码 `ZH_LATIN_OK` 改成 `UNTRANSLATABLE_KEYS` + **由 `common.lang.X` 词条派生**的
  外来自称豁免（`endonymSuffixMap`）：加一种语言时它的自称自动被认，不需要再改门禁。
  🔴 规则 6 是**单一事实源**检查：受门禁约束的文件清单 ↔ `LOCALES` ↔ `LOCALE_SCRIPT_RULES`
  三者必须一一对应 —— 加 `ja` 忘了写规则，门禁红而不是静默放行。
  未启用的语言不进规则表、只在门禁输出里印一行
  `ℹ️ 已登记文字系统规则、尚未启用（准备好但先不做）：ja、ko`。
  判据：`verify-i18n-failures.mjs` 的 `readiness` 组 **12 条**（/tmp 副本隔离，不动真实仓库），
  含"塞规则但漏 locale""把 en 的 forbidden 拿掉""已迁移文件里写硬编码文案"等注入。
- ✅ **web 切换器从二态 toggle 改 `LOCALES` 列表**（本轮）：`LanguageSwitcher.tsx` 渲染
  `LOCALES.map(…)` 的一排 `.ht-chip`（复用既有 `.ht-chip--on`，零新增 CSS），语言名用**自称**词条
  `common.lang.*`；自称 key 登记成 `LOCALE_LABEL_KEY`（`satisfies Record<Locale, MessageKey>`）
  —— **加 `Locale` 忘了登记自称 = 编译错误**，这就是"准备好但先不做"的具体形状。
  落地页复刻（`AppWindow.tsx`）用同一份 `LOCALES`/`LOCALE_LABEL_KEY`，不再自己列一份。
  判据：`apps/web/tests/language-switcher.spec.tsx` 8 条，其中一条**直接断言节点集合 =
  `LOCALES.map(...)`**（不是"有两个按钮"）；变异 `LOCALES.slice(0,1)` ⇒ 精确 6 条红。
- ✅ **`gen-server-copy` 的 `SOURCES` 从 `LOCALES` 派生**（本轮）：脚本解析
  `packages/i18n/src/types.ts` 里 `export const LOCALES` 的字面量数组（保持顺序），
  解析不到就地**带原因抛出**（不是静默回落到双元组）。实跑生成物 diff 恰好 1 行
  （`SERVER_LOCALES = ["zh-CN","en"]`），`pnpm check:server-copy` 绿、server `tsc --noEmit` 0。
  ⚠️ **一条无法在本工作树内证明的变异**：真要证"派生 ≠ 硬编码 2"必须往共享 `types.ts` 加 `ja`
  并重建 dist —— 这是并行会话共用的工作树，**没有做**，登记为未证明。
- **落地页第三入口 checklist**（加 `ja` 那天照这五行做，缺一处就是"词条有 ja、站点没有 ja"）：
  1. **前缀解析**：`apps/landing/src/site/paths.ts:153` 的 `localeFromPath` 现在是
     `rest === '/en' || rest.startsWith('/en/') ? 'en' : DEFAULT_LOCALE` —— 语言前缀**写死了一个**。
     改成按 `LOCALES` 查前缀表（`{ en: '/en', ja: '/ja' }`），未登记的前缀照旧回落 `DEFAULT_LOCALE`。
     ⚠️ `src/lib/locale.ts` 只是它的 re-export（理由写在那个文件头），**别在那儿改**。
     同一文件里 `stripLocalePrefix` 是 `pageFromPath` 的一环，前缀只剥一层这件事也得跟着改
     —— 那条链上有过两个**静默**失败（只取第一段 / 没剥 `#hash`），改之前先读文件头。
  2. **hreflang**：`scripts/gen-entries.mjs` + `scripts/entry-template.html` 现在写死三条
     （`zh-CN` / `en` / `x-default`）。加语言要变成**每 locale 一条 + 一条 `x-default`**，
     不能只追加 —— 组内有一条不一致搜索引擎会**整组忽略**，而忽略是静默的。
  3. **判据**：`apps/landing/tests/seo-head.spec.ts` 的 `ENTRIES` 已经是从 `LOCALES` 派生的
     （`:161`），所以新入口会被自动枚举；但 `:212` 断言的是字面量三元组
     `['en','x-default','zh-CN']`、`:221-224` 逐条写死两种语言、`:234` 只做中英两两比较 ——
     **这三处会当场红，是设计好的**（别为了让套件绿把它们改成宽松比较；要改成 `LOCALES` 遍历，
     同时保留"三条以上也必须齐全"的强度）。
  4. **入口产物**：`gen:entries` 按 `LOCALES` 多生成一个目录（`check:entries` 会逐字节比对提交物，
     所以**必须重跑生成再提交**），`og-card{,-en}.png` 这类**每语言一张**的分享图要补 `ja` 那张，
     `public/sitemap.xml` 同步加项。
  5. **发布**：§8 尾部「发布方式」写的是**手工 rsync**（仓库里没有落地页部署脚本）——
     新语言目录必须一起 rsync，否则线上是"词条有 ja、`/ja/` 404"。
     ⚠️ 这几处文件**文档中心那轮正在动**（`site/paths.ts` / `site/pages.ts` / 帮助→文档），
     动手前先确认它们不在别人的未完成改动里。
- ✅ 正字法 `Record<Locale,…>`（`LIST_SEPARATOR` 等）加语言即编译错，已就位无需动作。

### 明确不做（写下来防翻案）

- **运行时逐条 fallback 链**：业界 `fallbackLng` 是给「部分翻译也上线」的库准备的；
  我们的立场是编译期完整才上线（§2），加了它等于拆掉「漏翻译 = 编译错误」。
- **复数机制**：见上，触发条件明确。
- **locale 进 op-log / UI 偏好跨设备同步**：2026-10-01 拍板不做。
- **壳层 `?lang=` 透传**：被 `navigator.language` 层取代（WebView 该值反映系统语言）。
- **Geo-IP 判语言**：业界共识视为争议项，排除。

### 这一轮之后仍然要守着的两条

9. ✅ **落地页用新词条表重新发布**（第 17 轮做完）——
   发布方式与线上验收的判据见 §8 尾部的「发布方式」/「线上验收」。
   ⚠️ 下一次发布前跑一次**完整**的注入验证（`node scripts/verify-i18n-failures.mjs`），
   但**必须在干净检出上跑** —— `gate` / `e2eecopy` 那几组改的是 `zh-CN.ts` 这类
   常有别的批次在改的文件（§8 的 🔴 说明）。
   2026-09-27 第一次跑全量：**91 个用例，1 条不符合预期** —— `coupon` 组的基线
   （原因见 §8，是探针复制清单缺 `server/scripts`，**不是**产品缺陷）。
   🔴 **它意味着那一组 8 条"必须变红"是空转的，别把这次结果当成全绿。**
10. **交出去之前看一眼产物，不只是门禁**（§7.11 的教训）：`pnpm check` 现在多了一道
   `check:mobile-bundle`（真的打 android + ios 两份 RN bundle 数 React 份数）。
   i18n 这条线里凡是"加了包 / 动了打包配置"的改动，都要顺带跑它 ——
   **绿色的门禁证明不了应用能启动**，而这道门禁本身也**被升级过一次**才真正有效。
11. 🔴 **§7 #79「改完 i18n 必须重建 dist」现在管的不只是词条表**：本轮加的是**解析链用的导出**
   （`LOCALE_LABEL_KEY`、`LOCALES`），而消费方（web / landing）解析到的是 `packages/i18n/dist` ——
   所以**加导出后不重建，下一个 typecheck 就是在旧产物上报错**。
   本轮流程：改 `packages/i18n/src` → `pnpm --filter @heyta/i18n build` → 才跑 landing typecheck（绿）。
   ⚠️ 这一条**没有反证**（没有故意不重建去看它具体怎么红），是照 §7 #79 的既有纪律做的；
   以后凡是动 `packages/i18n/src` 的**任何**导出（不只是词条），收尾都要带那次 build。