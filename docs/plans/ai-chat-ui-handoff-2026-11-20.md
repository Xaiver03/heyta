# AI 对话页（Apple/UX 对齐 + 开源原语）交接

> 状态：**已完成（本轮目标）**｜日期：2026-11-20｜分支：main

## 1. 目标与范围
把移动端 AI 对话页按 Apple Design / UI UX Pro Max 收紧并借力开源原语：P1 ActionBar + ChainOfThought + Attachment；P2 `@assistant-ui/react-native` runtime 评估；P3 会话列表（ThreadList 形态）。不盲换 BYOK controller，不碰日历与不可逆层。

## 2. 已完成（提交，均已推送 gitee+origin）
| 提交 | 内容 |
|---|---|
| `136f2a5a` | AI 成为底部根 tab（渲染/接线） |
| `851f9308` | 根 tab 输入框不再被底栏遮住；Android 键盘避让改 undefined（修整屏空白） |
| `1621d171` | 空态 2×2 建议卡 + ⋯ 收历史/新会话 |
| `782791ca` | 收紧：建议改竖排单卡 4 行、字号层级/去冗余 |
| `a3ecce1c` | P1 ActionBar：助手/错误消息 复制 + 重试 |
| `a39a4188` | P1 ChainOfThought：工具步骤可折叠 |
| `c5f3a3d1` | P1 Attachment：回形针→任务选择面板，引用追加 prompt |
| `26b5a250` | P3 会话列表（ThreadList 形态）+ P2 评估文档 `ai-runtime-spike.md` |
| `39bdaee2` | Android 真机截图（引用面板 / ⋯ 会话菜单） |

新增文件：`apps/mobile/src/ai/{suggestion-grid,chain-of-thought,task-attachment,session-list}.tsx`，`docs/plans/ai-chat-oss-adoption.md`，`docs/plans/ai-runtime-spike.md`。

## 3. 验证状态（现量）
- `apps/mobile` 全量测试：**1389/1389 通过**；`npx tsc --noEmit -p apps/mobile/tsconfig.json`：**0 错**。
- 门禁绿：`check-design-token-refs`、`check-row-single-source`、`check-empty-state`、`check-theme-single-source`、`check-ui-language`、`check-nav-chrome`。
- 截图（`docs/research/mobile-ia/`）：`ai-suggestions-compact.png`、`ai-attach-sheet.png`(iOS)/`ai-attach-sheet-android.png`、`ai-sessions-list.png`、`ai-more-menu-android.png`。

## 4. 未闭合 / 已知边界
1. **ActionBar 与 ChainOfThought 无截图**：设备未配置 AI 端点，无真实消息；仅类型/词表验证。配好端点后可补图。
2. **多会话/重命名未做**：`chat-controller` 每账号只存一条（`saveAssistantHistory/loadAssistantHistory`，共享层 `@heyta/app-host` 与 web 共用），改多会话会影响 web，属单独一项。
3. **图片附件未做**：web 有「附一张图」，移动端缺；需引入图像选择依赖（过 §3.1–3.2 许可/可维护性门）+ 端点多模态。
4. **外部红（非本线）**：`check-l4-no-style` 报 `apps/mobile/src/screens` 内联样式 54 > 基线 52（另一并线会话既有，非本轮新增，本轮 AI 代码在 `src/ai/`）；`check-shell-surfaces` 报 web `dist` 比源码旧（他线未 build）。

## 5. 下一步（有序）
1. （可选）配一个 AI 端点，补齐 ActionBar/思考链真机截图。
2. 多会话：`@heyta/app-host` 会话存储扩为列表 + 选择/重命名（评估对 web 影响；勿破坏 `chat-controller` 现有测试）。
3. 图片附件：选型 `react-native-image-picker`（核对 license/维护），接入多模态端点和现有 `web.ai.attach.*` 词条。

## 6. 复跑命令
```
pnpm --filter @heyta/i18n build
npx tsc --noEmit -p apps/mobile/tsconfig.json
cd apps/mobile && npx vitest run
node scripts/check-design-token-refs.mjs && node scripts/check-ui-language.mjs && node scripts/check-nav-chrome.mjs
```

## 7. 死胡同与注意（本轮实测）
- 搜索通道本轮不可用：`deepseek-search` 返回 402（余额不足）；GitHub API 走 `127.0.0.1:7890` 超时；百度 302、搜狗反爬。`@assistant-ui` 信息经 `web_fetch` 拿到（`/native` 页）。
- **不要抬 `check-l4-no-style` 基线**换绿；先降总数。
- Android 真机易掉线：需 USB 数据线重连 + 解锁信任；安装可能需过 OPPO 身份验证。
