# R11 批三 · 日历**周视图**（7 格 + 档位下拉）

产品负责人 2026-10-02 对标滴答时点名的第 3 档（计划 §9.4 批三）。
判据在 `e2e/tests/calendar-week.spec.ts`（真浏览器，4 条）+
`apps/web/tests/calendar-view.spec.tsx`（DOM，5 条）+
`packages/ui/tests/calendar-view-step.spec.ts`、`calendar-date-text.spec.ts`（游标算术与措辞）+
`packages/domain/tests/calendar.spec.ts`（`weekGrid` / `startOfWeek`）。

拍法：`cd e2e && npx playwright test tests/calendar-week.spec.ts`，
产物落在 `e2e/test-results/` 后**立刻**复制到这里（原因见
`../calendar-cells/README.md` 与 §7 #142）。

| 文件 | 是什么 | 它证明 |
|---|---|---|
| `calendar-week-tall.png` | **一条任务都没有**，视口 1280×1200 | 周档的整块板子仍然铺满内容区，而那一行停在内容高度（44px）—— 剩余空间归"当天那一格"。**这张图是批三最重要的一张**：它拍在修好之后 |
| `calendar-week-bars.png` | 今天播 8 条（比上限多 2 条），视口 1280×1200 | 格子里画满 **6 条**（月档只有 3 条）并把余下 2 条折成 `+2`；标题说的是「2026年9月28日 – 10月4日」这个**周区间**；页头那个下拉显示「周」 |
| `calendar-week-nav.png` | 点过一次 `›` 之后 | 第一格从周一跳到**下一个周一**（走 7 天，不是走一个月），侧栏迷你月历与它同源 |

## 🔴 这三张图**不证明**的事

- **不证明移动端**。周视图只有 Web 宿主接了档位下拉；`apps/mobile` 仍不传 `view`，
  也就是**只有月档**。共享板两端同一份，但那一端的入口没接 ——
  登记在计划 §9.9 的"未验清单"里，别当已交付。
- **不证明日/年视图**：它们**还不存在**，所以下拉里当时只有两档
  （§9.3 那条"不摆点了没反应的菜单项"）。
  ⚠️ **这句已过期（2026-10-03 批五下半）**：现在是**三档** —— 第三档是「时间线」，
  它不是日历档位而是外壳的另一个视图，证据与判据在 `../calendar-view-family/`。
  ⚠️ **这句本身也过期了（同日批四）**：现在下拉里是**四项**
  「月 / 周 / 日 / 时间线」，日视图的证据在 `../calendar-day/`（计划 §9.12）。
- **不证明跨设备**：图里的任务是本机 IndexedDB 造的。

## 这一批靠"看图"才拦住的那个错

第一版把周视图实现成**"那一行吃剩余空间"**（理由写得很顺："周档的主体就是这一行"），
差分判据也**真的会失败** —— 撤掉 `flexGrow` 它就红。
但把图打开看：空日历时那一行变成一根 **772px 的纯蓝立柱**
（选中格是实心主蓝，而格子被拉满整行），占掉屏幕三分之一。

⇒ **判据能红 ≠ 判据测的是对的事。** 那条判据当时在证明"我实现了我想要的行为"，
而"我想要的行为"本身是错的。
最后撤回生长决定，让两档共用同一条布局规则（剩余空间归清单），
并把那条差分**反过来写**（行高 720/1200 必须一字不变），
细节与逐次数在 §7 #144。

## 2026-10-04 14:1x：这三张图**补上常驻判据**（此前一条都没有）

和 `../calendar-cells/` 同一批被 `r17-evidence-md5-check.sh --all` 点名的（3 张图 / 0 条锚点）。
不钉 md5 的理由相同：`e2e/tests/calendar-week.spec.ts:35` 的
`STAMP = Date.now().toString().slice(-6)` 会进图（`周视图-0-445927`），每趟随机。

**这次逐张打开看过**，记两点上面那张表没写的：

- `calendar-week-bars.png`：周六那一格里画了 **7 条**条、下面 `+2`，而页头标题是
  「2026年9月28日 – 10月4日」，下方清单计数 8 —— 三个数字互相对得上，
  这是"折叠发生在格子里、没发生在清单上"的唯一一张图。
- `calendar-week-nav.png`：可见周已经跳到「10月5日 – 10月11日」而**下方那一格仍写
  「10月3日 星期六」**（计数 0）。这不是 bug（选中日与可见区间是两条状态），
  但**看图才会注意到**，而它正是上面"侧栏迷你月历与它同源"那条主张的边界：
  迷你月历跟 cursor 走，选中日不跟。别把这张图当成"整屏同步移动"的证据。

UIPIN calendar-week-bars.png 73ad62a3 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css
UIPIN calendar-week-nav.png 73ad62a3 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css
UIPIN calendar-week-tall.png 73ad62a3 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css packages/design-system/src/tokens.css

pin 取拍图（mtime 03:47）之前最后一次动过那组路径的提交 `401bbcd6`（10-03 03:13）。
🔴 补完锚点后 `--all` 报这三枚 UISTALE —— 与 `../calendar-cells/` 同一个原因
（`39032107` 10-04 10:11 动了 `main-area.css`，页头形状已变，而这三张图里的页头是旧的）。
重拍与登记同 §4.1，窗口前置同 §5 的 H。

## 2026-10-05 09:52 重拍 + 10:0x 逐张看过（三张都看了），锚点换到 `73ad62a3`

重拍命令与前置门读数在 `../calendar-cells/README.md` 那一节（同一趟）。

**三张都还在证明原来那件事**：
- `calendar-week-tall.png`（批三最重要的一张）：1280×1200 下**那一行仍停在内容高度**，
  多出来的高度整个归下方清单区 —— 那根 772px 纯蓝立柱没有回来。
- `calendar-week-bars.png`：格子里画满 **6 条** + `+2`，下方清单计数 **8** —— 三个数字对得上
  （6 来自 `packages/ui/src/calendar/model.ts:72` 的 `MAX_WEEK_CALENDAR_BARS`，
  spec 的断言也从它推导，不抄字面量）。
- `calendar-week-nav.png`：点 `›` 之后整周跳到**下一个周一**（10月12日–18日），
  侧栏迷你月历与主区同源；下方那一格**不跟**（仍锚在选中日）。

🔴 **两条"位置/日期"级别的主张随拍摄日漂走了**（形状没变，图里的字变了）：
上面 14:1x 那节写的是「**周六**那一格里画了 7 条」「页头标题是 9月28日–10月4日」
「下方那一格仍写 **10月3日 星期六**」—— 重拍后分别是「**周一**（10月5日）那一格」
「2026年10月5日–10月11日」「10月5日 星期一 · 0」。
原因不是代码：spec 把任务播在**今天**，所以"哪一格带条形""区间是哪一周"跟着日历走。
⇒ **这几张图能引用的主张只能是形状**（几格、几行、折叠、剩余空间归谁），
   不能引用图里的日期与星期 —— 那一层每次重拍都会动。

⚠️ **一条我自己看错的东西（记下来挡下一次）**：第一眼看 `calendar-week-bars.png`
数出"7 条 bar"，差点登记成"折叠数与清单数差一"的缺陷。实际是**把当天那格的「休」标记行**
数成了第 7 条条形；条形真实数量是常量推导的 6，而 spec 断言的就是它。
⇒ 像素行数不是计数判据；要计数就去看 DOM 或看那条断言（§7 那一族：先怀疑探针）。

🟡 新出现、上面那张表没写的：日期下方的**绿色「休」/橙色「班」**调休标记（这三张里都有）。
它属于并行那条线（W4b），本线只登记"图里现在有它"，主张与判据不归这里写。

