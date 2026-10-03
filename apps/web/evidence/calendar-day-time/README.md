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
