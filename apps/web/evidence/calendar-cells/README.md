# R11 批一 + 批二 · 日历月格（全高 + 任务条 + `+N`）与页头工具栏

产品负责人 2026-10-02 的两条原话：**"日历是全高的，而不是只占一半"**、
**"内容永远不会被截断"**；批二把顶部工具栏搬进页头。
判据在 `e2e/tests/calendar-cells.spec.ts`（真浏览器）+
`apps/web/tests/calendar-view.spec.tsx`（DOM）+
`packages/ui/tests/calendar-cell-bars.spec.ts`（分条与折叠的判断）。

拍法：`cd e2e && npx playwright test tests/calendar-cells.spec.ts`，
产物落在 `e2e/test-results/` 后**立刻**复制到这里 ——
`test-results/` 会被下一趟 Playwright 清空（§7 #124），而且如果变异电池
（`/tmp/mutate-r11.py`）还在跑，那一趟读到的是**变异体的 `dist`**（§7 #142）。

| 文件 | 是什么 | 它证明 |
|---|---|---|
| `calendar-toolbar.png` | 点过一次 `›` 之后，1280×720 | 工具栏住在**页头**（`‹ 2026年11月 › 回到今天`），而且**侧栏迷你月历跟着同一个 cursor**（它也是 11 月）—— 两处月份不一致就是两份状态 |
| `calendar-cells-empty.png` | **一条任务都没有**的日历，视口 1280×1200 | 空日历也铺满内容区（板高 1096 = 内容盒 1096）。这是"只占一半"唯一能被看出来的状态 —— 720 高的视口上内容的自然高度就有 740，撤掉约束也看不出差别（§7 #137） |
| `calendar-tall-viewport.png` | 同一屏、同样 5 条任务，视口从 720 拉到 **1200** | 🔴 多出来的 480px **全部归当天那一格**：星期行还是 44px，长高的是下面的清单。批二第一版把"全高"实现成"网格被拉长"，720 上每行 190px、整月要滚着看 —— 这张图就是那个形状被改掉之后的对照 |
| `calendar-cells.png` | 亮色，1280×720，今天 5 条任务 | 格子里画的是**标题**（3 条）而不是圆点，第 4、5 条折成 `+2`；整月 6 行都在可视范围内 |
| `calendar-cells-dark.png` | **点过页头那个主题切换按钮**之后的同一屏 | 暗色下卡片底色真的换了（不是"黑底白卡"），条上的字与选中格底色不同色 |

## 🔴 这几张图**不证明**的事

- **不证明移动端**。`packages/ui` 那块板两端共用，但这里只拍了 Web。
  移动端要在模拟器上重跑 `pnpm verify:mobile-calendar` 才算数，
  而**这一批没有跑**：当时装在 emulator-5554 上的 APK 是 10-02 17:31 打的，
  不含这批改动（§7 #27 那个"测试绿但装的是旧产物"的形状），
  而重打重装会与并发会话的 `pnpm check` 抢同一台设备。
  ⇒ 登记在 `docs/plans/ui-review-fill-zh-timeline.md` §9 的"未验清单"里。
- **不证明跨设备**：图里的任务是本机 IndexedDB 造的。
- **不证明视图切换**：日/周/年还不存在，工具栏那一格只有「月」。
- **不证明"同步状态进了顶栏"**（§9.3 第 1 条差异化）：那一格**故意留空**，
  理由与取证在 §9.7 —— 现在顶栏那颗"未同步"是页头本来就有的 `SyncBar`，不是新的一份。

## 看图才现形的两件事

1. **假暗色**：第一版暗色截图是直接 `setAttribute('data-theme','dark')` 拍的 ——
   外框黑了而**月历卡片还是纯白**（共享层色板由 `<HeytaUiProvider>` 按 React 状态解析，
   不吃那个属性），而当时那条判据是**绿的**。改成点产品自己的主题按钮 +
   断言"卡片底色必须变"之后图才是对的。
2. **一块没有字的白底**：`calendar-cells-dark.png` 里页头那颗语言 chip 是白的、
   标签看不见。根因不是对配色 —— 稳态 16.40:1 —— 而是 `.ht-chip` 只给
   `background` 上了过渡、`color` 瞬切，切换中间态实测 **1.01:1**。
   已修（删掉那条过渡）并钉在 `e2e/tests/theme-switch-contrast.spec.ts`。
   细节与逐帧数字在 §7 #143。

⇒ 这两条都是 AGENTS §6.2 规定一（"人必须打开那张图看一眼"）的实锤：
   **判据全绿 + 图是错的**，只有看图能区分。

## 2026-10-04 14:1x：这五张图**补上常驻判据**（此前一条都没有）

`r17-evidence-md5-check.sh --all` 加"有图但 README 里 0 条锚点"那一档时，本目录是被点名的五枚之一
（5 张图 / 0 条判据）。上面那张表写的是**主张**，主张底下没有任何一层会为此变红 ——
有人重跑 `calendar-cells.spec.ts` 覆盖字节、或者决定这些形状的源码又动了，都不会有读数。

**为什么不钉 md5**：`e2e/tests/calendar-cells.spec.ts:45` 是
`const STAMP = Date.now().toString().slice(-6)`，图里的任务名（`日历格-0-479965`）**每趟随机** ⇒
钉 md5 就是造一条每跑必红的判据。所以钉**代码锚点**（`UIPIN`）：重跑不红，
**决定形状的源码动了才红**。

**这次逐张打开看过（14:1x，五张都看了）**，看到的就是上面那张表说的那些，另有两点值得记：

- 五张图里**页头不是同一个形状**：`calendar-cells*.png` / `calendar-tall-viewport.png` /
  `calendar-toolbar.png` 的页头是 `‹ 2026年10月 › 回到今天 未同步 ⚙ 中文/English 主题`，
  **没有**「日历视图」那个档位下拉；而 12:4x 之后拍的 `../calendar-week/`、
  `../calendar-capture/` 里有。⇒ 这三枚目录的图**不能互相引用成"同一屏"**。
- `calendar-cells-dark.png` 里页头那颗语言 chip 确实是一块**没有字的白底** ——
  那就是上面"看图才现形的两件事"第 2 条讲的中间态，图拍在修好**之前**，
  所以它是那条已修缺陷的**证据**，不是新缺陷。别拿这张图去报 bug。

UIPIN calendar-cells.png 5340c126 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css packages/i18n
UIPIN calendar-cells-dark.png 5340c126 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css packages/i18n
UIPIN calendar-cells-empty.png 5340c126 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css packages/i18n
UIPIN calendar-tall-viewport.png 5340c126 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css packages/i18n
UIPIN calendar-toolbar.png 5340c126 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css packages/i18n

钉的是**拍这五张图那一刻**最后一次动过上面那组路径的提交（`5340c126`，10-03 02:10，
字节 mtime 02:58）。🔴 **补完锚点之后 `--all` 当场报这五枚 UISTALE**，而且报得对：
`39032107`（10-04 10:11「主区头部可换行」）动了 `apps/web/src/styles/app/main-area.css`，
也就是**这五张图里的页头已经不是当前形状**。
⇒ 处置**不是**把 pin 改成 `39032107`（那会把"我看过的字节"和"当前形状"混成一件事），
而是**重拍**。重拍要跑 `cd e2e && npx playwright test tests/calendar-cells.spec.ts`，
它和 §5 的 H 共用同一个窗口前置（4318/4319 空闲 + 负载落回个位，
`check:ai-e2e` 会按端口 SIGKILL 别人的 dev server ⇒ 不许在窗口没开时硬跑）。
登记在 `docs/plans/calendar-profile-handoff.md` §4.1。
