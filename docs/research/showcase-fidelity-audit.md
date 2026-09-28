# 界面复刻的保真度：展厅 mockup vs 真应用

> 状态：**调研记录**（归档层，结论有变时新增勘误、不改原文）
> 审计日期：**2026-09-28**（CST）
>
> 本文回答一个问题：**「我们的界面看起来不像真的」到底是什么问题。**
>
> 与另两份文档的分工（**不要互相抄**，同一件事写两遍必然漂移）：
>
> | 文档 | 负责 |
> |---|---|
> | [site-ia-and-landing-audit.md](site-ia-and-landing-audit.md) | 站点**信息架构**：缺哪些页面、每条访客路径通不通 |
> | [dida365-feature-benchmark.md](dida365-feature-benchmark.md) | **产品能力**：缺哪些功能 |
> | **本文** | **呈现的保真度**：页面上的界面图与外发产品**是不是同一个东西** |

---

## 0. 先纠正一个前提：滴答用的是截图和录屏，**我们才是 DOM**

提出这条审计时的判断是「他们是真实的 DOM 组件，我们的不真实」。实测下来**机制是反的**：

```
$ curl -sS -A '<UA>' https://dida365.com/ -o dida.html      # 107 672 B
```

| 元素 | 数量 |
|---|---|
| `<img>` | **91** |
| `<video>` | **10**（`preload="none" loop muted playsinline`） |
| `<svg>` | 28 |
| `<canvas>` | 0 |

图片是**真产品截图**，而且**每个能力都配了移动端变体**：

```
.../newHome/dida/header1.jpg
.../newHome/dida/choice1.png … choice5.png
.../newHome/dida/features/playback/calendar.jpg
.../newHome/dida/features/playback/mobile/calendar.jpg     ← 移动端变体
.../newHome/dida/features/ai/voice.jpg
.../newHome/dida/features/ai/mobile/voice.jpg
.../newHome/dida/features/ai/summary.jpg
.../newHome/dida/features/ai/workflow.jpg
```

那 10 个 `<video>` 是**真实录屏**（静音自动循环），不是动画。

**所以「改成 DOM」不是答案 —— 我们已经是 DOM 了。** 我们和滴答的真正差别不在技术，
在**这两件事**：

1. 它贴出来的像素**就是产品产出的像素**（截取，不可能漂移）；
2. 我们的复刻是**手抄的**，而手抄的东西**会漂移，且没有任何东西拦着它**。

本文余下部分全部在讲第 2 点，因为它才是可修的那个。

---

## 1. 方法（每条结论都能重跑）

真应用那一侧的取材**不需要登录**：应用是本地优先的，e2e 的 `openApp()` 直接进主界面。

```bash
# 1) 拍真应用（走 e2e 的 webServer：stub 4319 + vite 4318）
cd e2e && cat > tests/zz-shot.spec.ts <<'TS'
import { test } from '@playwright/test';
import { openApp } from './helpers';
test('拍真应用界面', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/real-app-tasks.png' });
  await page.getByRole('tab').nth(1).click();      // 四象限
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/real-app-quadrant.png' });
});
TS
node_modules/.bin/playwright test tests/zz-shot.spec.ts --reporter=line
rm -f tests/zz-shot.spec.ts

# 2) 拍展厅（按 Showcase 自己的进度公式落到"就位"那一帧，否则会拍到换位中间态）
#    scroll = sectionTop + (i / (n-1)) × (节高 − 视口高)   —— 见 Showcase.tsx 的 scrollToIndex
```

⚠️ **不要拿换位中的帧做判断。** 第一版拍到的是一张双重曝光（两块窗口各 47.6%），
那既不是缺陷也不是证据，只是取样取错了位置。

**已拍下的四张（本文所有判断的依据）**
`/tmp/real-app-tasks.png`、`/tmp/real-app-quadrant.png`、
`/tmp/our-win-0.png`（展厅第一屏＝四象限）、`/tmp/our-win-2.png`。

---

## 2. 复刻已经漂移：逐项实测

对照两侧的唯一事实源：真应用 `apps/web/src/App.tsx` 的 `PRIMARY_NAV` / `QUADRANT_NAV` /
`VIEW_TABS`，与复刻 `apps/landing/src/mockup/AppWindow.tsx`。

| # | 项 | 真应用 | 复刻 | 性质 |
|---|---|---|---|---|
| 1 | 主导航 | 收集箱 / 今天 / **已完成**（3 项） | 收集箱 / 今天（2 项） | **漏了一个入口** |
| 2 | 四象限计数 | **不显示计数**（`QUADRANT_NAV` 里没有 count 字段） | `count={3}` `{5}` `{2}` `{1}` | **凭空多出数据** |
| 3 | 清单区 | `ProjectsPanel`：标题 + **「新清单」输入框 + `+`** | 三行静态文字（工作 / 个人 / 读书） | 形态不同 |
| 4 | 标签区 | **有**（`web.tags.heading`「标签」+「新标签」+ `+`） | **完全没有** | **漏了一整块** |
| 5 | 视图 tab | **8 个**（任务/四象限/习惯/番茄钟/时间线/成长/回收站/设置） | **4 个**（前四个） | **漏了 4 个** |
| 6 | 今天进度卡 | 有（`TodayProgressCard`，`0/0` + 进度条） | **没有** | 漏 |
| 7 | 象限空态 | 「拖任务到这里」+ 拖拽图标 | 有的格子有、有的填了假任务 | 混用 |

`VIEW_TABS` 的数量有现成的门禁级断言，可以直接核对：

```bash
cd e2e && node_modules/.bin/playwright test tests/smoke.spec.ts --reporter=line
#   expect(page.getByRole('tab')).toHaveCount(8)   ← 真应用是 8
```

**第 2 条是「不真实」最刺眼的形状**：复刻给每个象限编了 3/5/2/1 四个数字，
而真应用**根本不显示计数**。访客会以为界面上有这四个数 —— 这正是复刻比截图危险的地方：
**截图不可能编造产品没做的 UI，手抄可以。**

### 2.1 为什么一直没人发现

因为**没有任何门禁在看这件事**。已有的三道相关门禁管的是别的：

| 门禁 | 实际管什么 | 管不管"复刻像不像" |
|---|---|---|
| `check:design`（`design-system/heyta/check-hardcoded.mjs`） | 页面里不许硬编码颜色/间距，必须用 token | ❌ 管的是**取值来源**，不是**结构是否忠于应用** |
| `check:ui-language` | 界面不许出现硬编码文案 | ❌ |
| `check:widgets` | 小组件契约 | ❌ |

复刻与应用之间是**两个包、两份定义、零连接**。`AppWindow.tsx` 顶部写着
「复现对象：`apps/web/src/App.tsx` 的 `.ht-app` 网格」—— 那是一句**注释**，
不是一条**约束**。注释不会红。

---

## 3. 审计的副产品：真应用自己有一个可见缺陷

对照真界面截图时发现的，**与落地页无关、是应用本体的问题**。

### 3.1 实测数字（先说结论：这条我第一版判断错了机制）

第一版看截图，我写的是「tab 栏溢出，所以要把标签压成竖排」。**量完发现不是**：

```
1280px  栏宽=524 需要=524 溢出=0   栏高=52   8 个 tab 高度=[44×8]
1440px  栏宽=610 需要=610 溢出=0   栏高=52   tab 高度=[44×8]
1680px  栏宽=628 需要=628 溢出=0   栏高=52   tab 高度=[44×8]
```

**栏从来不溢出**（`scrollWidth == clientWidth`）。真正的形状在标签的**行盒**上：

| 视口宽 | 标签折行 | 每个 tab 实测宽度 |
|---|---|---|
| 1280 | **10/10 折行** | 66–78px |
| 1440 | **10/10 折行** | 66–78px |
| 1680 | **0/10** | 68–80px |

（10 个＝8 个视图 tab ＋ 同一样式类复用的「日期 / 倒计时」。）

### 3.2 机制

`.ht-viewtabs` 是 `display: flex`（`apps/web/src/styles/app.css:519`），
`.ht-viewtab` 是 `inline-flex`（`:528`）—— **两处都没有**：

- `white-space: nowrap`（所以标签能折行），
- `flex: 0 0 auto`（所以 flex 会让每个 tab **收缩到内容宽度以下**）。

于是栏宽不够时，flex 不是"放不下就溢出"，而是**把每个 tab 压窄**，
标签在 `min-height: 44px` 的盒子里折成两行。**44px 高度因此看起来正常，
只有肉眼看截图才发现字是竖排的** —— 高度这个最常见的不变量在这里恰好是骗人的。

1680px 是分界：10 个 tab 各需 68–80px，加上间隙约 780px，
1440px 下只分到 610px，1280px 下 524px —— 都差得不少。
**1280 与 1440 是最常见的笔记本宽度，不是边界情况。**

### 3.3 这件事正好解释"复刻为什么不真实"

复刻只画了 **4 个 tab**，所以它**比真应用好看**。一个比真应用好看的界面图，
就是一句会兑现不了的承诺 —— 访客在页面上看到干净的 4 个标签，装上应用拿到的是
10 个折行的标签。

### 3.4 修法（改完后本节数字应全为 0/10）

```css
.ht-viewtabs { overflow-x: auto; }        /* 放不下就横向滚动，而不是压窄子项 */
.ht-viewtab  { white-space: nowrap; flex: 0 0 auto; }
```

⚠️ 顺序上**必须先修应用、再修复刻**：先把真应用修好，复刻才可以忠实地画 8 个 tab
而不难看。反过来先给复刻画 8 个折行的 tab，是把应用的事故搬到落地页上展览。

---

## 4. 结论与建议（按性价比排序）

**① 复刻必须与真应用**单向对齐**，并加一道门禁（最高优先）。**
方向只能是**应用 → 复刻**：以 `apps/web` 的定义为准，复刻跟着改，**反过来不行**
（为了复刻好看去改应用是倒因为果）。门禁的最小形态：从 `apps/web/src/App.tsx`
读出 `PRIMARY_NAV` / `QUADRANT_NAV` / `VIEW_TABS` 的**项数与标签**，与
`AppWindow.tsx` 里的项数比对，不等就红。**没有这条门禁，第 2 节那张表会自己长回来。**

**② 先把复刻里"编造"的部分删掉，其次才是补。**
「多出来」比「少」更该先修：少一个入口是**不完整**，多四个计数是**不诚实**。

**③ 补动，而不是补图。** 滴答有 10 段真录屏，我们 0 段 —— 静态复刻再准，
也表达不了"拖一下会怎样"。我们恰恰有**能录的真实操作**（本地优先、无网络依赖，
录制成本极低）。形态走现有 `Showcase` 的窗口内，不引入新范式。

**④ 平台矩阵按 `site-ia-and-landing-audit.md` §3.2 #3/#14 做**（对方已在实现 `/platforms`），
本文不重复 —— 只补一条：**每一端的界面图都必须是那一端真实产出的**，
不要用桌面复刻缩放成手机。滴答是 `features/.../mobile/*.jpg` 分开出的，这点值得照抄，
它是**唯一一处我建议直接照抄滴答的做法**。

**⑤ 不要改成截图。** 复刻这条路本身是对的（主题自适应、随语言变、任意 DPI 清晰、
体积小、可被 `check:design` 管住），滴答的截图路线是它的成本结构决定的。
**我们缺的不是截图，是"复刻被验证过与应用一致"。**

---

## 5. 未核实项

- 滴答那 10 段 `<video>` 的实际内容与文件体积（只看了标签属性，没下载）。
- ~~真应用在 >1440 宽下 8 个 tab 是否自然放得下~~ → **已核实**：1680px 起全部单行
  （见 §3.1 的表），所以分界就在 1440 与 1680 之间。
- 复刻在窄屏下的行为（展厅本身是 3D 摆动，未测 < 1024）。

---

## 6. 落实记录（2026-09-28，**不改写上面的原文**）

上面的 §2、§3 是**修复前**的实测状态。当天已按 §4 的 ①② 落地：

| 项 | 改动 | 证据 |
|---|---|---|
| 复刻漏「已完成」 | 补上，并用**应用自己的词条 key** `web.shell.nav.completed` | `mockup/AppWindow.tsx` |
| 复刻编造象限计数 | **删掉**四个数字（真应用 `QUADRANT_NAV` 无 count 字段） | 同上 |
| 复刻漏「标签」整块 | 补上，形态照真应用：标题 + 「新标签」输入框 + `+` | 同上 + `mockup.css` 的 `.mk-field*` |
| 复刻的清单是三行静态名字 | 改成真应用的形态：「新清单」输入框 + `+` | 同上 |
| 复刻只有 4 个视图 tab | 补到 **8 个**；标签全部改用 `web.shell.*` / `web.trash.*`（**与应用同一份文案**） | 同上 |
| 真应用 8 个 tab 折行 | `app.css` 加 `overflow-x: auto` + `white-space: nowrap` + `flex: 0 0 auto` | 见下 |
| 真应用标题「收集箱」竖排 | 同一个根因，`.ht-header__title` / `.ht-header__actions` 一并修 | 见下 |
| 复刻的 tab / 标题也跟着折行 | `mockup.css` 同步同一组属性（**两份 CSS 必须成对维护**） | `mockup.css` |

### 6.1 修完的实测数字（与 §3.1 对照）

```
真应用    1024px  折行=0/10  标题行数=1  header 高=56  整页横向溢出=0
          1280px  折行=0/10  标题行数=1  header 高=56  整页横向溢出=0
          1440px  折行=0/10  标题行数=1  header 高=56  整页横向溢出=0
          1680px  折行=0/10  标题行数=1  header 高=56  整页横向溢出=0

复刻      .mk-viewtab 共 42 个（3 块窗口 × 14）  折行=0  标题行数=1
```

⚠️ 两个必须一起看的量：**折行**与**整页横向溢出**。只把 `white-space: nowrap` 加上去、
不给容器 `overflow-x: auto`，折行会变成**整页横向滚动条** —— 那比折行更糟。
"溢出为 0" 就是这条的证伪点。

### 6.2 这条门禁还没做

§4 ① 说的「门禁」**尚未实现**。现在两份定义的连接仍然只是一行注释，
所以 §2 那张表**还会自己长回来**。最小形态写在这里，留给下一次：

> 从 `apps/web/src/App.tsx` 读出 `PRIMARY_NAV` / `QUADRANT_NAV` / `VIEW_TABS`
> 的**项数与标签 key**，与 `apps/landing/src/mockup/AppWindow.tsx` 里引用的
> key 集合比对，不等就红。

之所以值得做成门禁而不是再写一句注释：这次漂移是**五项同时发生**、
且**没有任何一条已有门禁看得见**（`check:design` 只管取值来源、`check:ui-language`
只管有没有硬编码文案）—— 靠人复查是挡不住的。

