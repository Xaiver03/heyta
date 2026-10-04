# 日历捕获（点 `+` 写一句话 → 落进刚指着那一格）· 真浏览器取证

判据在 `e2e/tests/calendar-capture.spec.ts`（2 条），DOM 那一层在
`apps/web/tests/calendar-capture.spec.tsx`。拍法：
`cd e2e && npx playwright test tests/calendar-capture.spec.ts`，
产物落 `e2e/test-results/calendar-capture.png` 后复制到本目录
（`test-results/` 会被下一趟 Playwright 清空）。

## `calendar-capture.png` —— 人看到的（2026-10-04 14:1x 逐张打开看过）

- 页头是 `日历 ‹ 2026年10月 › 回到今天` + **一颗带蓝色焦点环的 `+`** +
  `日历视图 [月 ▾]` + `未同步` + 刷新 + 齿轮 + `中文/English` + 主题切换。
  ⇒ 焦点环在 `+` 上，说明这张图拍在**刚点过 `+`** 之后，不是静态首屏。
- 网格上方一条**捕获输入条**，占位文案逐字是
  「添加到 10月4日 星期日，回车确认（写了「明天」就以「明天」为准）」，右侧 `+ 添加`。
  ⇒ 这一句是"锚点 = 选中那一格"这件事**唯一被用户看得见**的表达。
- **3 号那一格是空心蓝描边**（选中态），**4 号那一格里有一条任务条**
  `捕获-153908`，日期数字 4 压在实心主蓝上。
- 下方清单标题「10月4日 星期日」计数 `1`，行里同一条 `捕获-153908`。
- 最底一行说明「未设截止时间的任务不在日历上，它们在「任务」页的收集箱里。」

⚠️ 这张图**不证明**"输入里写『后天』时以输入为准"那一条 —— 那是 spec 的第 2 条，
它**没有截图**（`calendar-capture.spec.ts` 里只有第 1 条 `page.screenshot`）。
那条只有 DOM 断言。⇒ 登记为缺口，见 `docs/plans/calendar-profile-handoff.md` §4.1。

## 常驻判据：钉代码锚点，不钉 md5

`calendar-capture.spec.ts:64` 与 `:99` 都是 `Date.now().toString().slice(-6)`
（图里的 `捕获-153908` 每趟随机）⇒ 钉 md5 会变成每跑必红。
pin 取拍图（mtime 10-03 03:59）之前最后一次动过那组路径的提交 `51d828c5`（10-03 03:49）。

UIPIN calendar-capture.png 51d828c5 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css packages/i18n

🔴 补完锚点后 `r17-evidence-md5-check.sh --all` 报这一枚 UISTALE，且报得对：
`39032107`（10-04 10:11「主区头部可换行」）动了 `apps/web/src/styles/app/main-area.css`，
而这张图里的页头是换行之前的形状。处置是**重拍**（窗口前置同 §5 的 H），
**不是**把 pin 改成 `39032107` —— 那会把"我看过的字节"和"当前形状"混成一件事。
