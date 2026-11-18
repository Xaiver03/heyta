# 「个人中心 / 我的」排版按规范收口 · 立项

> 状态：**已落地（2026-11-18，iPad 实拍验收；iPhone 实拍受「真机不能程序化点击」限制）**。负责：移动端壳。依据：`docs/agents/ux-principles.md`、`docs/agents/screen-chrome.md`、`docs/agents/design-system.md`、`docs/research/profile-center-decision-record.md`（IA 已定，本单只做**排版**）。
> 实拍证据：[`.local/profile-center-evidence-20261118/profile-center-ipad-before.png`](../../.local/profile-center-evidence-20261118/profile-center-ipad-before.png)（iPad 模拟器，同一套 RN 代码）。

## 现状问题（逐条映射规范）
1. **左对齐不一致**：节标题「近期状态/同步/整理与记录」的 x≈190，而各行图标 x≈230、行标题 x≈185 —— 不在同一 gutter。违反「一行一容器」的对齐轴单一。
2. **行无容器**：订阅/设置/通知/全部功能、清单/标签/便签 是裸露的「图标+文字」，无行容器、无分组卡、无发丝线，行与行间距过大且不齐。违反「控件高度一档」「一行一容器」。
3. **右侧值/箭头不对齐**：「同步 / 尚未同步」的值贴到屏幕最右边（x≈1300），与其它行右端不统一；身份块有右侧箭头，列表行大多没有 —— 可交互线索不一致。违反左侧标签+右侧值/箭头的统一右对齐。
4. **宽屏无内容栏宽约束**：iPad 全宽铺开成稀疏长列表，大片右侧空白、行被拉长。page 档应有内容列最大宽度并居中。
5. **两套对齐轴混用**：身份块（头像/还没登录/同步提示）居中，下方列表左对齐 —— 同一屏两种对齐。
6. **顶部标题裸文本**：「我的」直接是左上角一段字，无 AppBar 规范（缺 page 档顶栏处理）。
7. **近期状态三列**：`1 / 0 / 0/17` 靠 space-between 摊开，标签在宽屏下会散、数字基线不齐。

## 目标态（按规范）
- **行解剖复用 settings 行模型**：`packages/ui/src/settings/model.ts` 的 `SettingsRowModel` + 现有 `Card` 分组 + `SectionHeader`，与设置面同一套行骨架；不新长第三套容器（`check:settings-row-anatomy`）。
- **单一对齐轴**：所有节标题、行图标、行标题、右侧值/箭头落在同一内容列的同一 gutter。
- **分组卡 + 发丝线**：入口按语义分组（账号 / 整理与记录 / …），组内行等高；右侧值靠内容列右缘，不贴屏边。
- **内容列最大宽度**：宽屏（iPad/横屏）内容列 max-width（如 640dp）居中，行不拉伸。
- **身份块与列表同轴**：要么统一居中，要么统一左对齐——与内容列同一条轴。
- **顶部 AppBar**：用 `Screen`/`AppBar` 的 page 档，标题进 app bar。
- **近期状态**：三列等宽栅格，数字与标签统一 baseline，换行受控。

## 2026-11-18 落地结果

- **容器靠阴影分层**：`Card` 增可选 `shadow(sm|md|lg)`、`Screen` 增可选 `background="grouped"`（都 opt-in）。「我的」8 张分组卡改 `shadow="md"`，「我的」页底改浅灰分组底 —— 白卡+阴影+圆角，不堆描边（`44c8f2d7`）。
- **可导航行补 `›` + 卡内发丝线**：`SettingsActionRow` 增 `discloses`，`ActionLine` 在 `discloses` 时画 `›`；「我的」15 个 action 行设 `discloses:true`，入口卡与整理卡行间插 `Divider`（`212170f9`）。
- **内容列最大宽度**：共享层 `CONTENT_MEASURE_MAX = 680` 已由 `page` 档 `Screen` 收窄居中（iPad 实测卡片≈630 宽），无需再加；本文原「宽屏无约束」一句作废。
- **验收**：iPad 模拟器 Medium 与 accessibility-extra-large 两档实拍，行对齐同一内容列、右值落卡内右缘、每行 `›`、发丝线齐（证据 `.local/profile-center-evidence-20261118/profile-center-ipad-chevrons-dividers.png` 与 `dt-ipad-a11yxl-profile.png`）。
- **仍受限**：iPhone「我的」实拍需在真机上点击，`idb` 对非模拟器拒绝点击、物理机重启也受限；iPhone 与 iPad 用同一套 RN 组件，差异仅在宽度。

## 落点
- `apps/mobile/src/screens/ProfileScreen.tsx`（渲染区，约 1300–1830 行）。
- 复用：`apps/mobile/src/ui/kit.tsx` 的 `Card` / `SectionHeader`；`packages/ui/src/settings/model.ts` 的行模型；若有共享 `SettingsRow` 渲染器则抽出复用。
- 门禁：`check:settings-row-anatomy`、`check:mobile-settings`、`check:tap-targets`、`check:l4`、`check:design-token-refs`。

## 验收
- iPhone（414pt）+ iPad（820pt）两档截图逐项对照上面 7 条：左对齐、行高、右对齐、内容栏宽、对齐轴、AppBar、近期状态基线。
- 大字号（见 `dynamic-type-support.md`）下不破版。
- 门禁全绿；不改 IA（仍只读身份 + 短回顾 + 入口）。
