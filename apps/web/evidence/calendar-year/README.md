# R13 · 年视图的真浏览器取证（四张）

被测对象：`e2e/tests/calendar-year.spec.ts` 在真 Chromium 里点真界面，截图落在本目录。
**不是** jsdom、**不是** hand-mounted 夹具；界面文案全部来自 `packages/i18n`。

字节来源与"人看过"：这四张的字节是 **2026-10-04 12:41** 那一趟 e2e 跑出来的（`stat` 现量，
不是本线自己跑的那趟），13:5x 由本线**逐张打开看过**，下面"人看到的"那一列就是看到的内容。

## 为什么这四张钉**代码锚点**而不是 md5

这四张里的任务名带**每趟随机后缀**（如 `钻取不被劫持-897025`），同一状态重跑必然不同字节 ⇒
钉 md5 等于造一条"每跑必红"的判据，而 §8.3 那条元规则说它会把人训练成忽略红。
所以按 `research/tools/r17-evidence-md5-check.sh` 的第三种形状钉**代码锚点**：
**重跑不红，决定形状的界面代码动了才红**。

```
UIPIN year.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN year-next.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN year-drilled.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
UIPIN year-bottom.png 8cb33f55 packages/ui/src/calendar apps/web/src/features/calendar apps/web/src/styles/app/main-area.css apps/web/src/styles/app/rail.css packages/design-system/src/tokens.css
```

钉 `39032107` 不是"随手取 HEAD"：上面五条路径里**最后一次**动过的提交就是它
（`git log -1 --format='%h %ad' --date=format:'%m-%d %H:%M' -- <五条路径>` 现量 `39032107 10-04 10:11`），
而这四张的字节是 12:41 —— **拍图晚于决定它们形状的代码**。

## 人看到的（13:5x 逐张复核）

| 文件 | 看到的东西 |
|---|---|
| `year.png` | 侧栏「日历」进入，工具条是「**2026年**」+「回到今天」+「+」+「视图 = 年」；主区是**十二张月卡按两列网格**排（1月/2月在上、3月/4月次行…），每张卡有「一…日」表头、日期**按周成行**（不是挤成一行），跨月的补位日期用浅色；左侧迷你月历是「2026年10月」且**今天 4 带高亮框 + 蓝点**；页底那句「未设截止时间的任务不在日历上，它们在「任务」页的收集箱里」。 |
| `year-next.png` | 点「>」翻到「**2027年**」：十二张卡整体重排（2027 年 1 月首日落周五、3 月 5 行、4 月 5 行），**侧栏迷你月历跟着走到 2027年10月**，且那一年里没有"今天" ⇒ 迷你月历里 4 号**不再高亮**（年翻页不污染"今天"这一格）。 |
| `year-drilled.png` | 点年卡里的某个月卡 ⇒ **钻取到月视图**：工具条变「2026年10月」+「视图 = 月」，网格带**周号**（40周…45周）、**休/班 调休标记**（绿色「休」、橙色「班」）、今天 4 是整格蓝底；格内那条任务 chip 被裁成「钻取不…」；下方「10月4日 星期日 1」+ 卡「钻取不被劫持-897025」（随机后缀，见上）。 |
| `year-bottom.png` | 滚到年视图**底部**：10月 / 12月 两张卡完整可见（10 月里 4 号仍是高亮 + 蓝点），11月 6 行、12月 5 行；说明年视图不是"只画前几屏"，**十二张卡都在同一棵 DOM 里**。 |

## 🔴 这四张顺手给另一条账当了证据

这四张（12:41 字节）的页头是**两行**：第一行「日历」，第二行才是「未同步 / 刷新 / 设置 / 语言 / 暗色」
—— 那是 `39032107` 把 `.ht-header` 从 `block-size` 改成 `min-block-size` + 加纵向 padding +
动作区可换行之后的**新形状**。而 `../calendar-day/` 那五张 10-03 11:09 的字节里页头还是**一行**。
⇒ 那五枚 `UISTALE` 不是探针坏，是**图比代码旧**（同一处 CSS 改动在两个目录里给出了一红一绿两种读数，
互相印证）。那五张的账与关闭命令写在 `../calendar-day/README.md` 末尾那一节。

## 10-05 12:2x 重拍批次（指针）

本目录这 4 枚锚点已重钉 `8cb33f55`，图逐张看过。
**批次记录（含"第一次重拍拍到首屏遮罩过渡帧"那条 A/B 与修法）只写一份**：
`../calendar-day/README.md` 的「10-05 12:2x 重拍批次」那一节。
