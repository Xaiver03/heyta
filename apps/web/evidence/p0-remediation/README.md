# P0 体验整改 —— 视觉基线取证（2026-10-06）

依据：[../../../../docs/research/product-level-ia-ux-audit.md](../../../../docs/research/product-level-ia-ux-audit.md) §8
（W1-W9「一周内」批）。采集：`e2e/tests/p0-remediation.spec.ts`（真浏览器，6/6 passed）。
**以下 7 张图全部由执行会话逐张打开看过**（§6.2 规定一第 4 条），结论登记在各条。

| 文件 | 工单 | 人看结论 |
|---|---|---|
| `w1w3-tasks-1440-light.png` | W1+W3 | rail 主段 4 键 + 「…」更多；AI 抽屉收起为一行入口，首屏主动作回到任务输入框 ✅ |
| `w1-more-open-light.png` | W1 | 菜单 6 项（四象限/时间线/番茄钟/成长/便签/倒数纪念日），图标+文字、贴 rail 弹出 ✅ |
| `w1-more-open-dark.png` | W1 | 暗色下菜单可读、对比正常（真开关切换，非 emulateMedia）✅ |
| `w2-settings-suppresses-detail.png` | W2 | 设置占满内容区，右侧任务面单**整根退场**——对照旧图 `../detail-pane-overlay/settings-sheet.png` 的同屏并排，整改生效 ✅ |
| `w4-narrow-375-tasks.png` | W4 | 底栏 4 目的地全部单行横排；范围筛选成横滑 chip 条；逐字竖排消失——对照 `../../../../screenshots/web-mobile/MW01-移动端任务.png` ✅。⚠️ 登记未修：375px 下行尾控件组折行占高（row-tail-fold 既有债，非本轮回归） |
| `w5-quadrant-after.png` | W5 | **2026-10-06 晚重拍**（产品负责人看过首版实装后拍板"四象限本来就应该铺满"，`cellEmptyCompact` 塌缩已撤——历史见 `QuadrantBoard.tsx` 文件内注记）：现为 2×2 等分占满视口（滴答同款框架）；保留的 W5 三样 = 「拖任务到这里」同屏恰 1 次、四格计数徽标 0/0/0/2、规则说明收进「▶ 帮助」✅ |
| `w6w7-detail-groups.png` | W6+W7 | 标题成统领元素；「基本信息/时间」组头在视野内（组织/自动化在折叠下方，e2e 断言四枚组头全部在场）；优先级 select 在「组织」组 ✅ |

## 与单测的分工

jsdom 判据（组序、键盘、草稿保留、变异验证）在各 spec 文件里；本目录只回答
**"用户看到的界面长什么样"**。窄屏几何判据（宽>高）已写进 spec 断言，不只靠看图。
