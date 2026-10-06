# R11 批四 · 日历**日视图**（全天带 + 24 小时轴 + 横向拖拽换天）

产品负责人 2026-10-03 滴答实测后给出的形状（原话记在计划 §9.12）：
"日的定义就是这样子的，就是**铺满整面**的……点今天，那个今天就自动跳转到今天来了……
鼠标在这里左右滑动，就是**上一天和下一天的切换**。"

判据在 `e2e/tests/calendar-day.spec.ts`（真浏览器，3 条）+
`apps/web/tests/calendar-day-view.spec.tsx`（DOM，11 条）+
`apps/web/tests/calendar-drag-day.spec.tsx`（手势，11 条）+
`packages/ui/tests/calendar-day-buckets.spec.ts`（分桶与游标算术，9 条）。

拍法：`cd e2e && npx playwright test tests/calendar-day.spec.ts`，
产物落在 `e2e/test-results/` 后**立刻**复制到这里 —— 不是"回头再收"，
因为**下一次任何 playwright 运行都会清空那个目录**（§7 #142，本轮实测第二次命中：
先跑日档拿到五张图、复制，再跑 `calendar-dida/-sidebar/-wheel/-capture` 时那五张已经没了）。
复制脚本本身要"前置存在性检查 + 后置 `cmp -s`"，否则它会对着不存在的源文件打印 ✅（§7 #177）。

| 文件 | 是什么 | 它证明 |
|---|---|---|
| `calendar-day-full.png` | 今天，视口 1280×720，全天带里播了**一条** | 这一档摊成两张卡：「全天」带 + 0:00 起的小时轴，**板子铺满内容区**（判据量的是板高 ≥ 内容盒，不是"看起来挺高"）。轴整列空着而带里有东西 ⇒ 底下必须说出「这一天没有定到具体时刻的任务，它们都在上面那条「全天」里。」 |
| `calendar-day-drag-next.png` | 从**那条任务那一行上**起手、往左横拖 800px（终点落在侧栏里）之后 | 标题跳到「10月4日 星期日」，**侧栏迷你月历圈住的那天跟着走**；全天带空了 ⇒ 换成共享空态「这一天没有到期的任务。」，而**上面那句"都在全天里"不再出现**（两条带都空时说两遍就是两份口径） |
| `calendar-day-drag-prev.png` | 接着往右拖回来 | 回到今天，且**拖过的那条任务没被顺手勾掉**（起手点在可点的行上，这是最坏路径） |
| `calendar-day-away.png` | 点两次页头 `›`（与拖拽共用同一个 `stepCalendarCursor`） | 「10月5日 星期一」，侧栏圈 5；**现在线消失**（它是"现在"，不是"那一天"） |
| `calendar-day-back-today.png` | 在 10-05 上点「回到今天」 | 标题回今天、侧栏回今天、**现在线回来了**（DOM 计数 = 1） |

🔴 **上面这五张的形状主张要按"拍于哪一刻的工作树"来读，不是"HEAD 的界面"**（11:5x 现量，我把这五张重新打开看了）：
`git log -1 --format='%h %ad' --date=format:'%m-%d %H:%M' -- calendar-day-full.png` ⇒ **`5e23b7bf` 10-03 23:58**，
而把主区页头改成"动作整体可换行"的那笔 CSS 是 **`39032107`（10-04 10:11）** 才进的 HEAD
（同一件事的实测记录在 `../calendar-view-options/README.md`：那两枚年视图的页头从一行折成两行、年板从 4 列掉到 2 列）。
**人此刻看到的**（`calendar-day-full.png`）：页头**一行排满**（`日历` · `‹ 10月3日 星期六 ›` · `回到今天` · `+` ·
`视图` `[日 ▾]` · `未同步` · `⟳` · `⚙` · `中文`/`English` · 右上角月亮），**没有折行**；
全天带里一条 `日视图-947421`，轴从 `0:00` 排到 `7:00`（视口 1280×720 到此为止），底部两句说明都在。
⇒ 三条要说清的：
① 图里的"今天"是 **10-03 星期六**（表格里那几处"今天"都指拍摄日，不是读图日）；
② 这五张**不证明**今天的 HEAD 在日档下也画一行页头 —— 日档通常不开详情列，
而"折成两行"那个现象的前提是主区被挤窄，所以**这一处既不能说一致也不能说不一致，是没取证**；
③ 要把 ② 变成读数只有一条路：等 4318/4319 空闲且负载落回个位，重跑
`cd e2e && npx playwright test tests/calendar-day.spec.ts`，把新图复制回本目录、**人打开看过之后**
按新字节改上面这张表，并**把提交号一起记进来**（这条纪律就是 `39032107` 那笔教出来的）。
⚠️ 这五枚**没有常驻 md5**（本目录只有下面 `day-en-empty.png` 一枚有，理由见"锚点规则"那一节）——
但**这不等于没人管**：12:1x 起它们各有一枚 `UIPIN` 代码锚点（见下面那节），现量
`bash research/tools/r17-evidence-md5-check.sh --dir apps/web/evidence/calendar-day`
⇒ `entries=1 mismatch=5 pins=8 md5bad=0 pinbad=5 pinunknown=0`，rc=**1**。
🔴 **那五枚红是**"形状主张已过期，要重拍"**，不是事故** —— 它把这一节第 ② 条那句"没取证"
从一段等人读的话变成一条会自己响的读数。敞口的**另一半仍然开着**并且是**故意的**：
这五张的"字节过期"仍然没有任何东西报红，因为它们每趟必变（`STAMP` + 游标日期），
报它等于制造常驻红。

## 🔴 这几张图**不证明**的事

- **不证明现在线画在哪**。它按 `小时 × size.row-min-height` 推导，跑在 10 点档 ⇒
  落在 0:00–7:00 这一屏**之外**。图里只有"有没有这根线"的 DOM 计数能作证，
  位置由 `apps/web/tests/calendar-day-view.spec.tsx` 的「现在线」那两条钉。
- **不证明移动端**。日档只有 Web 宿主接了档位下拉；`apps/mobile` 仍不传 `view`
  （只有月档）。登记在 §9.9 的"未验清单"，别当已交付。
- **不证明年视图**：它还不存在（批四的另一半没开工）。
- **不证明跨设备**：图里的任务是本机 IndexedDB 造的。

## 这一批靠"看图 + 真拖"才拦住的两个错

1. **大幅度拖没反应**。第一版把 `pointermove` / `pointerup` 挂在**宿主**上 ——
   指针一旦拖出内容区（落在侧栏子树里），事件冒不上来。
   症状是"轻轻拖有用、用力拖反而什么都不发生"，jsdom 里**测不出来**
   （测试里的事件是在宿主自己身上起的）。
   修法：起手挂宿主，移动/抬手/取消挂 `window`。
   守卫：`calendar-drag-day.spec.tsx` 那条「抬手已经拖出宿主」+ 变异臂 W
   （把监听挂回宿主 ⇒ 恰好 1 红，读数在下面）。
2. **轴上大片空白会被读成"这一档没接上数据"**。图里那句
   「这一天没有定到具体时刻的任务，它们都在上面那条「全天」里。」
   就是为了这个而存在的 —— 而它**不能**在两条带都空的时候也说
   （那时共享空态已经说过"这天没到期任务"）。

## 变异臂读数（2026-10-03，本机，十支全部"变红 + 归因到我要它红的那一条 + 逐字节还原"）

`python3 /tmp/mutate-r11.py T U V W Z`（只改 `apps/web`）与
`python3 /tmp/mutate-r11.py X AA Y AB AC`（改 `packages/ui`，其中三支要先
`pnpm --filter @heyta/ui build`，因为判据读 `dist/` —— §7 #12 那一族）：

| 臂 | 改了什么 | 红的判据 | 断言原文 |
|---|---|---|---|
| T | `dx < 0 ? 1 : -1` 写成反向 | 往左拖 = 未来 | `expected -1 to be 1` |
| U | `DRAG_MIN_PX = 44` → `0` | 没拖够的普通点击不换天 | `expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| V | 拿掉"以竖向为主不算换天" | 竖向为主 ⇒ 那是滚这一屏 | `expected -1 to be +0` |
| W | 监听从 `window` 退回宿主 | 抬手已经拖出宿主仍要换天 | `大幅度拖（抬手落在宿主之外）没换天: expected "vi.fn()" to be called 1 times, but got 0 times` |
| X | `isAllDayMs(...)` 取反 | 本地零点进「全天」带、不挂 00:00 | `expected [] to deeply equal [ 'a' ]`（4 条一起红，含带时刻那条） |
| Y | 那句"都在全天里"的条件放宽成"轴空就说" | 两条带都空时**不许**说那句 | `空一天时那句"都在全天里"是谎话: expected '这一天没有定到具体时刻的任务，它们都在上面那条「全天」里。' to be ''` |
| Z | 日档 `setCursor` 不再带走 `selected` | 轴/标题/侧栏高亮指同一日 | `日档里翻了游标，选中的那天没跟上 ⇒ 侧栏与轴各指一天: expected '2026-10-03' to be '2026-10-04'` |
| AA | 日档步长 `addDays` → `addMonths` | 一段 = 一天，跨月跨年按天走 | `expected '2026-11-03' to be '2026-10-04'` |
| AB | 现在线的"只看今天"闸门拿掉 | 翻到别的日子现在线消失 | `现在线跟着游标一起翻到别的日子去了: expected <div …(3)></div> to be null` |
| AC | 🔴 整条日档分支不渲染（`view === 'day'` → `false`） | **三条日档 e2e 全红**（`3 failed`，红条数=3） | `✘ …calendar-day.spec.ts:126:1 › 🔴 日档把这一天摊开… (17.1s)` |

AC 是这批的**防空判据臂**：它不测某个行为，测的是"这三条 e2e 有没有一条其实在空面板上断言"。
三支里任何一支活下来，那一支就是恒过的假判据 —— 实测三支全红。

⚠️ U 这条特意**不**挂在「阈值卡在 `DRAG_MIN_PX`」那条上：那条自己 import 了这个常量，
把常量改成 0 它照样自洽（两边读同一个数），**只有钉死 5px 的那条有牙齿**。
这是元规则 2（判据的参照不许与被约束的对象同涨，§7 #145）在手势阈值上的一次现形。

⚠️ 后五支排在 `verify-mobile-*` 跑完之后才执行 —— 理由不是判据，是**共用一台机器**：
X/Y/AB/AC 要重写 `packages/ui/dist`，而另一条会话正在读它打移动端 bundle（§7 #142 同一族）。

---

## R16 追加的三张（2026-10-03 18:24，**英文会话**下的日档）

跑的是 `e2e/tests/calendar-day-en.spec.ts`（2 条），视口 1280×720。**拍过两趟**（18:24 与 18:53），
下面表里的 md5 是**后一趟**（mtime 18:53:16–17）。这三张**跨趟必然不同**，因为种子标题里带
`STAMP`（写这句时是 `en-day-793948`，06:46 那趟是 `en-day-589776` —— **值每趟都换，所以它不能当指纹用**，能当判据的只有"这句话整行读得出"）。🔴 而 `full` 与 `no-timed`
「是同一屏」这件事**在两趟里都成立**（两张并排看：同一标题、说明都在视口内）⇒ 那条降级不是偶然读数。
语言由 URL 上的 `?lang=en` 决定（解析链第 2 层；第 1 层 `heyta.locale` 这里**故意不写**，
写了就把英文压回去 —— 理由见 `docs/plans/calendar-year-time-and-mobile-profile.md` §2 R16 那格的更正）。
**三张人都打开看过**；md5 一并记下（同一检出里别人也在跑 e2e，文件会被覆盖）。

🔴 **12:1x：锚点规则改写成两条，因为它们各自被实测打穿过**（01:34 → 06:46 → 11:54 三次覆盖 + 一次逐像素对账）：

1. **常驻 md5 只给"同一笔代码下两趟重跑字节相同"的图。** 本目录三张里只有 `day-en-empty.png` 满足
   （11:54 那趟重跑之后它的字节与 HEAD **逐字节相同** —— 这是**量出来的**稳定性，不是假设）。
   另两张带 `STAMP` 的图**本文件上面早就写明「值每趟都换，所以它不能当指纹用」**，
   却仍然被留在 md5 那一列里 —— 那句话已经把它判过死刑，只是没人去执行它 ⇒ 12:0x 的 `--all` 因此报了两枚红，而**那两枚红不携带任何产品信息**
   （逐像素实测：`day-en-full` 新旧两批字节差 **468/3686400** 枚像素，**全部落在任务名那一行**，
   `en-day-589776` → `en-day-083090`；页头、轴、说明句、空态字全部逐字节相同）。
   一条每跑必红的判据会把人训练成忽略红（§8.3 元规则），所以它们的 md5 **降级为记录值**（留在表里，
   不再是对账锚点）。
2. **形状主张改钉"代码锚点"**：`UIPIN <文件> <拍图时那批界面代码的提交> <决定这张图形状的路径…>`，
   判据是"那些路径里最后一次动它们的提交 ≤ 钉的那笔"。它**不吃重跑的噪声**（臂 6 专门测这件事：
   图字节一个字没变、源码动了 ⇒ 仍然红），所以它回答的是 md5 回答不了的那半边 —— **主张过期**。

```text
UIPIN day-en-full.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN day-en-empty.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN calendar-day-full.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN calendar-day-drag-next.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN calendar-day-drag-prev.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN calendar-day-away.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN calendar-day-back-today.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
```

⚠️ **后五枚曾经红过（UISTALE），10-05 10:2x 那趟重拍 + 逐张看过之后才转绿并改钉 `73ad62a3`**
（现量：`calendar-day-full.png` 盘上字节 `6e17d015…` == `git show HEAD:` 同一枚，随 `da8688b6` 入库）。
当初为什么它必须红：钉 `5e23b7bf`（10-03 23:58）之后 `39032107`（10-04 10:11）动过 `main-area.css`（页头可换行）
⇒ 上面「② 这五张**不证明**今天的 HEAD 在日档下也画一行页头」那条没取证 —— 是这条**机器读数**替它说话的，
而不是只有一段话等着被下一个人忽略。要让它转绿只有一条路：第 ③ 条写的那趟重拍（等窗口 + 人看图 + 把 pin 换成新字节对应的那笔代码提交）—— 10:2x 走的就是这条路。

🟢 **10-05 11:0x 这五枚的路径集补宽了一枚 `packages/design-system/src/tokens.css`，而且补宽是免费的**：
`git merge-base --is-ancestor 1e5dd492 73ad62a3` ⇒ rc=**0**（`1e5dd492` 10-05 00:06 是唯一一枚在 `39032107` 之后动过 tokens.css 的提交，
而它已经在这五枚的钉**之下**）。现量 `--dir apps/web/evidence/calendar-day` ⇒ rc=**0**、`pins=8 pinbad=0`，
且每行 `UIOC` 的针脚变成了 `（决定形状的源码最后一次动它是 1e5dd4926d ≤ 钉的 73ad62a3）`
—— **针脚变了才是补宽真的生效**，原样复读说明那条路径没进路径集。

🔴 **上面那三枚 `day-en-*.png` 刻意没跟着补宽**：它们的钉是 `39032107`，**早于** `1e5dd492` ⇒ 补宽会立刻转 UISTALE。
那枚红是**对的红**（tokens.css 确实在那三张之后动过），处置只有一条：重拍 + 逐张看图 + 重钉（连同 `calendar-year` 4 枚、
`calendar-view-options` 2 枚，一共 **9 张**要占一次 e2e 窗口；逐枚模拟读数与代价表在 `docs/plans/calendar-profile-handoff.md` §4.05 (42) ②）。
**不能靠"把钉改成 `73ad62a3` 再补宽"绕过** —— 那是用一次改字把一条真过期的主张洗成绿的。

| 文件 | md5 | 人看到的 |
|---|---|---|
| `day-en-full.png` | 非锚点（每趟随机）：`d9916538a42055e92d034ac7913b37b3` 是 06:46 那趟的字节；11:54 重跑版 `382ac057fa4ac8a514291d11279c4da8` | 整屏英文：页头 `Calendar` / `Sun, 10/4` / `Back to today` / `View Day` / `Not synced yet`；「All day」带里一条 `en-day-589776`（随机后缀每次现造 ⇒ 这三张的 md5 **跨趟必不同是设计**）；轴从 `0:00` 起；⚠️ 06:46 那趟重渲染后**这张里没有红色 now 线**（拍于 06:46，线落在 `6:00` 之下、不在取景内。旧文案那句"`1:00` 与 `2:00` 之间有一条红色 now 线"是 01:34 那一趟的事实，**对这张不成立**）；**最长那句说明在轴卡下面整行读得出**：`Nothing on this day has a specific time — they are all in the "All day" band above.`（单行、没换行、没省略号、没出容器）；🔴 **原来这张下面还有一行 `day-en-no-timed.png`，10-05 12:0x 按 §4.05(41) 删掉了**：它与本行**逐字节相同**（`md5 bac2e33145d264ab07f777d0654e40ff`、`cmp -l` 差异 **0** 字节）⇒ spec 里那次 `scrollIntoViewIfNeeded()` 是空操作、那张不构成独立证据；现在 spec 改断言"说明底沿 ≤ 视口高"，**它红了才说明需要一张独立补拍**（那时要连本表这行与一枚锚点一起补回来，不是把断言改松） |
| `day-en-empty.png` | `db9226d940c933fa0f7594a65e23a811`（10-05 12:2x 重拍后重取；上一枚 `d64c499450…` 是 02:1x 那批 —— 这枚 md5 是**常驻锚点**，所以那次覆盖被 `--all` 报成 MISMATCH，不是靠人记住） | 空的那天的英文态：「All day」卡里居中 `Nothing is due on this day.`，**没有**上面那句"都在全天里"（那天两条带都空，说了就是谎），底部仍有一句 `Tasks without a due date are not on the calendar, they live in the Inbox on the Tasks tab.`；轴只到 `4:00` 那一档；⚠️ 旧文案的"同样带红色 now 线"对这张同样不成立（now 线在取景外）。🔴 **新字节里页头是两行**（第一行 `‹ Sun, 10/4 › Back to today + View[Day ▾]`，第二行 `Not synced yet ⟳ ⚙ Language 中文/English ✓ 🌙`）—— 与旧文案第 30 行那句"页头一行排满"是同一件事的反面，见下面 10-05 那一节 |

🔴 **05:4x 更正：上面这三枚 md5 是重取的，原来那三枚（`46d2e2fb…` / `51926322…` / `eb50b404…`）已经对不上盘上字节**。
成因与 `calendar-view-options/README.md` 那一条**是同一件事**：2026-10-04 01:34 另一条会话跑 e2e 时把同名 png 覆盖，
而覆盖之后**连图带这份 README 一起被提交** ⇒ 坏指纹此刻**就在 HEAD 上**（`git status` 对本目录为空、
`git show HEAD:day-en-full.png | md5 -q` == 新值）。上面那句"同一检出里别人也在跑 e2e，文件会被覆盖"
是当初就写下的预警 —— **它预言对了，但没有配套任何一条会红的对账**，所以它只是把风险写进了文档，没有拦住它。
05:4x 三张图**人都重新打开看过**，本表按新字节改写（旧写法里的 `Sat, 10/3` 与 `en-day-054555` 已经不成立：
日期过午夜、任务名那条是每次运行现造的随机后缀）。
🟢 常驻对账：`bash research/tools/r17-evidence-md5-check.sh --all`（认两种形状：`md5 -r` 的裸行与本表这种
`| 文件 | md5 | 说明 |`；**12:1x 起还认第三种** `UIPIN <文件> <提交> <路径…>` = 代码锚点，
管"字节没变但主张过期"那一半）。它的牙由 `--selftest` **八臂**钉住（md5 对照腿 0 枚 /
md5 注入腿恰好 1 枚 / 表格形状解析到 1 条 / 表格形状注入腿恰好 1 枚 / UIPIN 正例 1 命中 /
**UIPIN 源码动了而图字节一个字没变 ⇒ 恰好 1 枚 UISTALE** / UIPIN 钉不存在的提交 rc=4 /
UIPIN 路径集为空 rc=4）。
⚠️ 八臂**全部跑在合成夹具上**：第一版的对照腿复制本目录这份现场 README，12:0x 现场被 11:54
那趟重跑顶掉一枚字节 ⇒ 对照腿在 exit 4 自杀、**后面六臂一条没跑** —— "牙的检查"不能由它要保护的那份现场卡住。

顺带量到、**判成不是缺陷**的一条：英文那张空态卡里 `Nothing is due on this day.`
上下留白很大（卡片按"能装下带任务的行"的高度撑开）。这是共享 `EmptyState` 在
定高容器里的既有形态，中文那一档同样（`calendar-day-full.png` 可比），
不是英文变长带来的 ⇒ 归到"空态视觉密度"那一类，不在本批改。

## 🔴 13:4x 现量：本目录**五张**的形状锚点真过期了（故意留红，不许改钉糊过去）

`bash research/tools/r17-evidence-md5-check.sh --all` 报 `calendar-day` 五枚 `UISTALE`
（`calendar-day-full.png` / `-drag-next.png` / `-drag-prev.png` / `-away.png` / `-back-today.png`，
钉的是 `5e23b7bf`，"源码里决定这张图形状的路径已在 `390321074d` 之后又动过"）。

**先按"探针坏"查过，结论是它没坏**：
- `stat` 现量：这五张的字节是 **10-03 11:09:12**，而那一笔决定形状的提交是 **10-04 10:11** ⇒ 图比代码旧 23 小时。
- 那一笔在锚点路径集合里动的正是 `apps/web/src/styles/app/main-area.css`
  （`.ht-header` 的 `block-size` → `min-block-size`、`padding: 0 var(--ht-space-6)` → `var(--ht-space-2) var(--ht-space-6)`、
  `.ht-header__actions` 从 `flex: 0 0 auto` 改成可换行）—— **页头条就画在这五张的顶上**。

⇒ **不许把五行 `UIPIN` 直接改成 `39032107`**：那等于用一次改字把"这张图画的是当前交付形状"
变成一句没有字节支撑的话（§8.3：不能失败的判据比没有更糟，**不能"被改绿"的判据同理**）。

关闭它的一步（要浏览器窗口，与 R17/H 那两张同一个门：4318/4319 空闲 + 负载落回个位）：
```bash
cd e2e && npx playwright test tests/calendar-day.spec.ts     # 重拍这五张
# 然后：人打开这五张（§6.2 规定一），再把五行 UIPIN 重钉到"拍图那一刻"的最后一次决定提交
git log -1 --format='%h %ad' --date=format:'%m-%d %H:%M' -- \
  packages/ui/src/calendar apps/web/src/features/calendar \
  apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/i18n
```

⚠️ **同目录里另外两张不在这条账上**：`day-en-full.png` / `day-en-empty.png`
（R16 英文取证）字节是 **10-04 12:41**，晚于 `39032107` 那一笔 ⇒ 当时它们的锚点成立、工具打的是 `UIOC`（信息行）而不是红。
🔴 **10-05 12:0x 给这两枚的路径集补宽了 `packages/design-system/src/tokens.css`，它们因此转成 UISTALE**：
`1e5dd492`（10-05 00:06，首屏动画落到 web/Android/iOS）动过 tokens.css，而这两张拍于 10-04 12:41
⇒ **这一枚红是对的红**（决定形状的源码确实在图之后动过），闭合动作是"重拍 → 逐张看过 → 重钉"，
**不是**把钉改到当前提交（那等于用一次改字把一条真过期主张洗成绿的）。
（第三张 `day-en-no-timed.png` 已按 §4.05(41) 删掉 —— 它与 `day-en-full.png` 逐字节相同，不构成独立证据。）

## 🔴 2026-10-05 09:52 重拍 + 10:1x 逐张看过：上面第 ② 条那句"没取证"**现在有读数了，而且它推翻了一句旧文案**

重拍走 `bash research/tools/r17-reshoot-stale.sh --confirm`（前置门现量：4318/4319 空闲、
`load1=7 ≤ 12`、内存 free 45%、dist 新鲜、判据路径无未提交改动）。五张字节全换：
`a619f82a→6e17d015`（full）/ `c3489770→6641533d`（drag-next）/ `fe8f9d40→92a1920b`（drag-prev）/
`0281e9fb→5537c9bd`（away）/ `7b82a6b5→602be474`（back-today）。五枚 `UIPIN` 从 `5e23b7bf` 换到 `73ad62a3`。

🔴 **被推翻的那句**：上面第 30 行写"人此刻看到的：页头**一行排满**、**没有折行**"，
并在第 36 行留了一句"这五张**不证明**今天的 HEAD 在日档下也画一行页头 —— 这一处**没取证**"。
⇒ **重拍之后这五张的页头全是两行**：第一行 `‹ 10月5日 星期一 › 回到今天 + 视图[日 ▾]`，
第二行 `未同步 ⟳ ⚙ 语言[中文 ✓ English] 🌙`。也就是 `39032107`（页头可换行）在日档下**同样折行**，
与 `../calendar-view-options/` 那两枚年视图一致。第 ② 条那个敞口**已闭合**，
而闭合的方式正是第 ③ 条写的那一步（重拍 + 人看 + 换 pin），不是把 pin 改成 `39032107`。

**逐张看见的**（只写图里真有的）：
- `calendar-day-full.png`：今天 10月5日 星期一，「全天」带里一条 `日视图-113718`，
  轴从 `0:00` 排到 `6:00`（720 高到此为止），底部两句说明都在。
- `calendar-day-drag-next.png`：往左横拖 800px 之后标题到 **10月6日 星期二**、
  侧栏圈住 6 ⇒ "往左=下一天"这条主张成立（旧图里是 10月4日 星期日，**日期随拍摄日走，形状没走**）。
  全天带空 ⇒ 只剩共享空态 `这一天没有到期的任务。`，而"都在上面那条「全天」里"那句**不再出现** ✓。
- `calendar-day-drag-prev.png`：拖回来之后回到今天，且**那条任务还在、复选框是空的**
  （标题就叫「别拖我就被勾了-113718」）⇒ 这条图存在的理由（起手点在可点的行上）仍然成立。
- `calendar-day-away.png`：点两次 `›` → 10月7日 星期三，侧栏**同时**画两样东西：
  方框圈住 7（cursor）+ **5 号下面一枚实心小蓝点（今天）**。这个"选中/今天"双标记
  上面那张表没写过，是这次看图新记的一条。
- `calendar-day-back-today.png`：点「回到今天」→ 标题与侧栏都回 5 ✓。
  ⚠️ 这张里**「全天」带是空的**（而 `full` 那张有一条）—— 查过出处，不是不一致：
  `e2e/tests/calendar-day.spec.ts:252` 那一条用例**本来就不播任务**（只翻两天再点回来，
  断言 `now-line` 计数 0→1）。现在线本身在 720 的取景外（拍于 10:0x，线在 4:00 之下），
  所以这张图**只**能作证"标题/侧栏回来了"，线由那条 DOM 断言作证 —— 与上面
  "不证明现在线画在哪"那一格同一条边界。

⇒ 复跑对账：`bash research/tools/r17-evidence-md5-check.sh --dir apps/web/evidence/calendar-day`。


## 10-05 12:2x 重拍批次（这一族的**真源记录在这里**，另三份 README 只留指针）

- **触发**：本目录 7 枚里有 2 枚（`day-en-*`）的路径集补宽了 `packages/design-system/src/tokens.css`
  ⇒ 当场转 UISTALE（`1e5dd492` 10-05 00:06 动过 tokens.css，而那两张拍于 10-04 12:41）。
  重拍把整目录 7 张一起刷新，同趟带上 `calendar-day-time/`（它的图由同一枚 `calendar-day.spec.ts` 产出）。
- 🔴 **第一次重拍（12:1x）有两张是废的**，而 `--all` 全绿看不出来：`day-en-empty.png` 与
  `calendar-day-time/day-hour-labels.png` 对 HEAD 的像素差 **AE = 855096 / 855948（≈93%）**。
  逐张打开看见的是**一枚半透明的 `h` 品牌 mark 压在内容上** —— `1e5dd492` 那批首屏退场动画的**过渡帧**。
  ⚠️ **产品没有错**（遮罩按 `animationend` + 有界兜底自己摘，见 `apps/web/src/boot-splash.ts`），
  **错在取证载体没等它摘掉**：一张正在淡出的遮罩既不是首屏也不是目标界面，
  而它同时骗过像素判据和"非空白"判据（§7 第 82 条那一族换了个触发源）。
  修在 `e2e/tests/helpers.ts` 新增的 `waitForBootSplashGone`，挂在 `openApp` 与本 spec 的
  `openAppEnglish` 末尾；`boot-splash.spec.ts` 是**故意**拍品牌帧的，它不走 `openApp` ⇒ 不受影响。
- **A/B（同一对文件、同一个装置，只换载体）**：12:1x `AE=855096/855948` ⇒ 12:2x `AE=3884/4982`
  （0.42% / 0.54%）。差异区实测在页头日期与左下迷你日历的今日格（`magick compare` + `-trim`：
  `83x26+25+129`、`100x96+8+68` 一类）⇒ 来源是**日期翻到 10/5** 与每趟随机的任务名，不是形状。
- **逐张看过**（14 枚改过字节的图全看了）：本目录 `calendar-day-{full,drag-prev,away,back-today}` +
  `day-en-{full,empty}`，以及 `calendar-day-time/{day-hour-labels,day-timed-hour16}`、
  `calendar-year/{year,year-next,year-drilled,year-bottom}`、`calendar-view-options/{view-select-closed,view-tabs-year}`。
  形状与各自行「人看到的」一致；`calendar-day-drag-next.png` 与 `day-timed.png` 重拍后**与 HEAD 逐字节相同**
  （⇒ 不需要重看，但这次按目录批量重钉时它们的锚点也一并挪到 `8cb33f55`，如实记这一句）。
- **锚点**：本目录 7 枚 + `calendar-year` 4 + `calendar-view-options` 2 + `calendar-day-time` 3 = 16 枚
  全部重钉 `8cb33f55`；现量 `bash research/tools/r17-evidence-md5-check.sh --all` ⇒
  `pins_parsed=26 mismatch=0 UISTALE=0 rc=0`。
