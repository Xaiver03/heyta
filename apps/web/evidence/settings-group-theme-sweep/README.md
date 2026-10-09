# 设置分组 × 明暗 × 窄宽 取证（个人资料 / 账号与安全 / 同步与隐私 / AI 与集成）

**产出者**：`scripts/qa/reminders-data-responsive.mjs` 里的 `captureGroup` 那一趟。

```bash
# 另起一台 vite（本线用 4379，与 e2e 套件的 4318/4319 不撞）
cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 4379 --strictPort
# 再跑装置，把证据指到本目录
HEYTA_RESPONSIVE_HEADED=0 \
  HEYTA_RESPONSIVE_EVIDENCE="$PWD/../../apps/web/evidence/settings-group-theme-sweep" \
  node scripts/qa/reminders-data-responsive.mjs
```

## 为什么补这一趟

覆盖表实测出来的洞，不是推测：`apps/web/evidence/account-suite/` 那 11 张里带 `dark` 命名的 **0 张**，
`apps/web/evidence/assistant/` 7 张里 1 张 —— 而本轮验收要求是「实际验收深浅主题」。
补这四组用的是本线自己的装置，没有去改别人在写的 spec：「显示」那一组由同装置的提醒五态与数据管理两趟覆盖，
「关于与帮助」由 `e2e/tests/help-entry-ux.spec.ts` 覆盖（375/1440 × 明暗）。

## 这八张图证明什么

16 格（4 组 × 明暗 × 390/1440），`groups` 逐格记了导航文案、组标题、可交互控件枚数、`data-theme` 读数与几何。
四条判据（`sweep-report.json`，整趟 `SWEEP_RC=0`、装置全部 11 条断言 true）：

- `everyCaseCoversEverySweepGroup` —— 4 档视口 × 2 组一个都没漏（`.every` 对空集合是真，所以覆盖要单独钉）。
- `groupSweepTitleMatchesNav` —— 导航上那一档写的名字，与进去之后那组的标题**逐字相同**。
- `groupSweepActionable` —— 每组至少一枚可交互控件（判"空壳分组"）。
- `groupSweepThemeApplied` —— 暗色那一档 `document.documentElement.dataset.theme` 真的是 `dark`，
  而不是「文件名写着 dark 的亮色图」。

可交互控件数逐组不同（未登录态）：`profile` 1、`account` 1、`sync` 6、`ai` 4；文本量 44 / 33 / 261 / 496 字。
⇒ `groupSweepActionable` 的下界 1 是被 `profile`/`account` 那两格**顶着过的**，不是随手写的大阈值。

三条新判据各种过一次**种一棵坏**：把某格标题改成另一组的名字 ⇒ 假；把某格控件数归零 ⇒ 假；
把某暗色档的属性读数改成 `light` ⇒ 假。⚠️ 第一趟我挑的格子本身就是 `light`，那次"改成 light"是**空变异**，
所以这里点名到具体格子。

## 这三格它不证明

1. **载体是无头 Chromium**（`carrier.headless=true`）：不抢前台的那一档。它不影响这两组的渲染，
   但提醒权限的 `default`/`granted` 两态只有有头才有 —— 那是同装置另一趟的事，见
   `apps/web/evidence/reminders-data-responsive/`。
2. **拍的是未登录门禁态**：`账号与安全` 整组只有「登录后管理订阅、登录方式与账号安全。」+ 登录钮
   （实测 `textLength=33`、`interactive=1`），`个人资料` 同理。**已登录的那三块（换绑邮箱 / 登录设备 / 注销）的暗色证据仍然欠**，
   它们住在 `account-email-change-and-sessions.spec.ts`，那份套件目前是亮色单档、且由账号面那条线在写。
   （`同步与隐私` 与 `AI 与集成` 两组不依赖登录：未登录态本身就有 6 枚与 4 枚可交互控件。）
3. **导航形状跟着工作树**：`openGroup` 现在两种形状都认（`button[aria-controls]` 与 `a[href="#…"]`），
   但**锚点那一臂在当前工作树上取不到读数**（HEAD 才有），要在干净检出上跑一次才算闭合。
