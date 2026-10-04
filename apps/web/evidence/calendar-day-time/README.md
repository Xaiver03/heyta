# R14 · 任务的**时刻**（输入侧 → 日档那一小时）

这一目录里的三张图只回答一件事：**用户敲进去的「16:00」最后画在哪儿**。
判据分四层，图只是最外面那一层的证据：

| 层 | 判据 | 量的是什么 |
|---|---|---|
| 领域 | `packages/domain/tests/capture.spec.ts`（「时刻」那组） | `明天16:00 X` 解析出 `dueDate` + `dueTime`；**没有日子的 `16:00` 不单独成立**，原文留在标题里 |
| 共享 | `packages/ui/tests/capture-model.spec.ts`（R14 那组） | 芯片念得出「16:00」（不是「不设置」）、提交计划落在本地那一分钟 |
| 界面 | `apps/web/tests/due-date-edit.spec.tsx`（R14 那组） | 敲进框里的每个值 → **恰好一条 UPD**，payload 是那一分钟的 ms |
| 真浏览器 | `e2e/tests/calendar-day.spec.ts` 第 4、5 条 | 从输入框敲的一句话真的变成轴上那一格里的任务；时刻列不许折行 |

拍法（产物直接落在本目录，不经 `test-results/`，所以不会被下一次 playwright 运行清掉）：

```bash
cd e2e && npx playwright test tests/calendar-day.spec.ts
```

| 文件 | 是什么 | 它证明 |
|---|---|---|
| `day-timed.png` | 说一句「今天 16:00 挂在十六点-…」之后、**滚到轴顶**那一屏 | 全天带里说的是「『全天』里还没有任务；定到具体时刻的在下面那条轴上。」—— 也就是**这条带空不等于这一天空**。0:00 那一格里没有它 |
| `day-timed-hour16.png` | 同一屏，把 **16 那一格滚进视口** | 「挂在十六点-…」在 16:00 那一行、带勾选框；14:00–19:00 的时刻**各自一行**（这一张是修完折行之后重拍的） |
| `day-hour-labels.png` | 空的一天（不播任务），量 24 个时刻标签 | 时刻列**没有折行也没有溢出**（判据逐行量 `height` 对 `lineHeight`，见 `e2e/tests/calendar-day.spec.ts` 最后一条） |

## 🔴 这两张图各自抓到一个"断言测不出来"的缺陷

1. **全天带在说谎**。`day-timed.png` 那一版里，带上的空态写的是
   「这一天没有到期的任务。」，而它下面 20 行正挂着一条到期的任务。
   jsdom 的判据当时是绿的（它只数节点）。修法是**两句各说各的范围**，
   判据在 `apps/web/tests/calendar-day-view.spec.tsx` 里两边各钉一条。
2. **时刻列折行**。`14:00` 印成「14:0」+「0」（实测 `height 42 / lineHeight 21`），
   而 `0:00`–`9:00` 正常 —— 列宽 `space.8`（32px）装不下 14px 的两字小时。
   第一张 `day-timed.png` 只拍到 0:00–5:00，所以**它拍不到这个缺陷**；
   拍到它的是把 16 那一格滚进视口的第二张。这就是 §6.2 规定一第 4 条
   （"人必须真的打开那张图"）存在的理由。

## 这几张图**不证明**的事

- **不证明提醒跟着时刻走了**。`packages/domain/src/reminders.ts:178-182` 是纯 ms
  （`dueDate - offsetMs`），回归由 `packages/domain/tests/reminders.spec.ts:121` 钉，
  不在图里。
- **不证明时间线不错位**。有时刻的按原时刻落笔由
  `packages/ui/tests/timeline-board-model.spec.ts:140-144` 钉。
- **不证明跨设备**。图里的任务是本机 IndexedDB 造的；`dueDate` 是密文 payload 里的
  一个数，两端读到同一个值要靠设备验收（登记在计划 §5）。
- **不证明移动端**。日档的档位下拉只有 Web 接了。
- **不证明现在线画得准**。它按 `小时 × size.row-min-height` 推导，
  位置由 `apps/web/tests/calendar-day-view.spec.tsx` 那两条钉；
  图里只能看到"有这根线"。

## 为什么这一目录**故意没有**常驻 md5（00:2x 现量核过）

`bash research/tools/r17-evidence-md5-check.sh --all` 对本目录打印 `EMPTY`，那是**预期**，不是漏登记。
两条按构造成立的原因：

1. 图里有**随机任务名**：`e2e/tests/calendar-day.spec.ts:49` 是
   `const STAMP = Date.now().toString().slice(-6);`，第 306 行把它拼成 `挂在十六点-${STAMP}`
   并直接渲染进 16:00 那一格 ⇒ 每跑一趟像素就不同。
2. 图里有**"今天"的日期**：页头「10月4日 星期日」与侧栏迷你月历跟着系统日期走 ⇒ 隔天必变。

任何一条都让"钉住的 md5"变成**下一趟必然 MISMATCH** 的判据 —— 那比没有判据更糟（AGENTS §8.3 的对偶：
一条永远红的常驻判据会把人训练成忽略它）。所以这里不钉 md5，改用可复跑的两条：

- 重新拍：`cd e2e && npx playwright test tests/calendar-day.spec.ts`，产物在 `e2e/test-results/` 后复制到本目录。
- 看图（00:2x 这一趟我打开三张看过，与上面那张表逐条对得上）：
  `day-timed-hour16.png` = 16:00 那一格里有那条任务、"全天"块是空态文案；
  `day-timed.png` = 未定时刻的那条**不在**轴上（轴从 0:00 起、全天块给的是同一句空态）；
  `day-hour-labels.png` = 小时标签逐档 0:00/1:00/2:00/3:00/4:00，"这一天没有到期的任务。"

🟢 要让它**可以**常驻对账，前置是把上面两条随机源消掉（`STAMP` 改成可注入定值 + 把"今天"冻进夹具），
这属于 e2e 夹具改造、且 `e2e/` 正被并行会话使用 ⇒ 登记不代做。

## 🔴 13:5x 补：这三张此前**一条常驻判据都没有**（工具打 `EMPTY`），现按代码锚点钉上

复跑 `bash research/tools/r17-evidence-md5-check.sh --all` 现量：本目录曾报
`EMPTY apps/web/evidence/calendar-day-time（README 里解析到 0 条 md5 条目、0 条 UIPIN）`
—— 也就是"这三张图是当前的交付形状"这句话**没有任何一层会为此变红**（正是那把装置文件头要拦的那件事）。

为什么钉**代码锚点**而不是 md5：图里的任务名带**每趟随机后缀**（现量 `挂在十六点-867223`），
同一状态重跑必然不同字节 ⇒ md5 是"每跑必红"的判据，§8.3 说它会把人训练成忽略红。

```
UIPIN day-hour-labels.png 39032107 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css
UIPIN day-timed.png 39032107 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css
UIPIN day-timed-hour16.png 39032107 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css
```

钉 `39032107` 的理由（现取，不是抄 HEAD）：上面五条路径里最后一次动过的提交就是它
（10-04 10:11，那一笔把 `.ht-header` 改成可换行 + 加纵向 padding），而三张的字节是 **10-04 12:41**
（`stat` 现量）⇒ **拍图晚于决定形状的代码**。字节是别人那一趟跑的，13:5x 由本线**逐张打开看过**。

## 人看到的（13:5x 逐张复核，三张是三种不同状态，别当同一张的三个副本）

| 文件 | 看到的东西 | 它单独断的那一条 |
|---|---|---|
| `day-hour-labels.png` | 视图=日、10月4日 星期日；「全天」卡里是「**这一天没有到期的任务。**」；下面时刻轴 `0:00 / 1:00 / 2:00 / 3:00 / 4:00` **每行左侧都画得出小时标签** | 空日子也要有**完整小时刻度**（不是"有任务才画轴"） |
| `day-timed.png` | 同一视图，但「全天」卡里换成了「**「全天」里还没有任务；定到具体时刻的在下面那条轴上。**」；顶部 `0:00…4:00` 各行是空的 | 有"定到时刻"的任务时，**全天区不许把它收进去**，且空态文案是**另一句**（两句各是一条主张，混用会假绿） |
| `day-timed-hour16.png` | 滚到 `14:00…18:00`：那条「挂在十六点-867223」**正好落在 16:00 那一行**，14/15/17/18 各行空 | 🔴 R14 的核心：时刻任务落在**它自己那一小时**的行里，既不堆顶部也不进「全天」 |

⚠️ 这三张与 `../calendar-day/` 那五张是**两批**取证（那五张字节 10-03 11:09、已因页头形状过期而留红待重拍；
本目录这三张字节 12:41、晚于那笔改动 ⇒ 锚点成立）。别把两批混成一句"日视图的图都旧了"。
