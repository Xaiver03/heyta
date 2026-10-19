# r136 · iOS「AI 面 + 帮助面」英文装机态（浅档一趟）

> r133 那格的**不证清单第 1 条**就是"英文装机态这一趟没取"。r135 补上了应用内语言开关的装置
> （`scripts/qa/ios-app-language.py`，陷阱 #469 说清了三条系统语言通道都动不了这枚包），
> 这一趟用那枚通道把 AI 面与帮助面在**英文档**跑一遍。

## 1. 出处

| 项 | 现量 |
|---|---|
| 取数时仓库 tip | `git rev-parse --short HEAD`（共享工作树，取数期间仍在被别人推进 —— 本文件不抄号，跑一次就有） |
| **装机件** | 载体 `~/heyta-carriers/head-r128` @ `f8d7155e`，`Heyta.app/Info.plist` mtime `2026-10-18 18:11` ⇒ 与 r131/r132/r133/r134/r135 **同一枚件**，本趟没有重装 |
| 设备 | `heyta-iphone-17pro` / `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，屏 `[402, 874]`，外观 **light**（本趟没动外观档） |
| 语态 | 应用内语言开关切到 `en`（9 步 `rc=0`）→ 跑本旅程 → 切回 `zh`（8 步 `rc=0`）；三趟起跳 06:33 同一分钟 |
| 装置 | `scripts/qa/ai-face-ios.py`（r133 那枚，**未改动**）+ `scripts/qa/ios-app-language.py`（r135 那枚） |
| 落点 | `ios-ai-face-r136/english/`（独立目录，不覆盖 r133 的 `light/` `dark/` —— 陷阱 #472） |

## 2. 读数

**20 步全 passed**（与中文档同一枚装置、同一步数）。每一枚双语定位符都在英文档命中过：

| 步 | 英文档命中的标签 | 帧 |
|---|---|---|
| `open assistant` | `AI assistant, Ask one assistant to capture, plan, break down, or review your tasks` | `[16, 446, 370, 60]` |
| `assistant -> ai settings` | `Set up AI` | `[287, 134, 98, 44]` |
| `open settings` | `Settings, Profile, preferences, sync and security` | `[16, 343, 370, 44]` |
| `scroll to help section` | `Complaints and reports` | `[32, 748, 338, 60]` |
| `help section` | `helpSection: true`、`feedbackRow: true` | — |

**助手屏的状态卡**：8 枚候选 marks 里恰有两枚为真 —— `What would you like to finish today?` 与
`Ask about local tasks now. Set up AI to organize ideas and plan ahead.`；其余六枚（两档的"只使用本机"/
"读不到这台设备上的数据"）全 false。这与代码那句"同一时刻只会渲染一枚状态卡"对得上，
**不是**"英文档少了两张卡"。

**有界滚动在英文档同样到位**：`Complaints and reports` 那行落到 `[32, 748, 338, 60]`，
底边 `748+60=808 ≤ 866`（这一屏是模态、没有 tab 栏 ⇒ 视口下界取屏高 − 8，见 #477）。
行高从中文档的 44 变成 60 —— 英文 hint `Opens your mail app with a message to our intake mailbox` 多折一行，
**是内容高度变化，不是裁切**。

## 3. 逐张人眼看过（5 张，其中一对逐字节相同）

| 图 | 看过之后 |
|---|---|
| `profile.png` | 全英：`Account` / `Not signed in` / `Sign in or register` / `Settings` / `Recent activity` / `Not synced yet` / `Notifications` / `My growth`；无截断 |
| `assistant.png` | 全英：`AI assistant` / `Set up AI` / `History` `Read only` `Execute` / `What would you like to finish today?` / 四枚建议 chip / `Describe a task, or ask a question...` / `AI can be wrong. Check important information.` |
| `ai-settings-group.png` 与 `ai-settings-via-assistant.png` | **sha256 逐字节相同**（`67e33ebf…`）⇒ 两条入口到同一屏这条尺在英文档同样成立；面板全英，含托管卡那句 ⚠️ 解密披露与 `Add On-device Ollama` |
| `help-feedback.png` | `Help and feedback` / `Complaints and reports` / 那行英文 hint 完整在场（顶部一行被滚动位置切一半是滚动位置，不是布局缺陷） |

`modalLuminance` 五张全 **252**（浅档）—— 与 r133 浅档同一读数，说明这趟没有把暗档混进来（#472 那一族的自检）。

## 4. 与 r133 那枚候选缺陷的关系（一句，不重复量化）

未选中 `Checkbox` 圆环的对比度问题在英文档**同样在场**（`ai-settings-group.png` 三枚圆环 + 托管卡一枚）。
它是 token 层的（`color.border-strong` on `color.surface`），**与语态无关** ⇒ 不新增一条缺陷，
量化与判据缺口仍记在 r133 的 RESULT.md §六。

## 5. 不证

1. 暗档英文（本趟只跑浅档 —— 外观档与语态是两维，另一维的组合没取）。
2. 任何**写入**：三枚闸门、端点新增、`Complaints and reports` 那一下真的拉起邮件页（只读纪律，故意没按）。
3. 注册档、凭证流转、iPad/窄屏/大字体。
4. **当前源码**那一面（装机件仍是 `head-r128` 那一枚）。

## 6. 设备状态与复跑

语言**已还原中文**（`ios-app-language.py --to zh` 8 步 `rc=0`，`常规` 那组标签回读命中）、外观未动（light）、
通知授权仍是「不允许」（r132 那处未还原状态）、companion pid 31182 未收。

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
B=apps/mobile/evidence/ux-final-20261018
python3 scripts/qa/ios-app-language.py --udid $U --to en
python3 scripts/qa/ai-face-ios.py --udid $U --evidence-dir $B/ios-ai-face-r136/english
python3 scripts/qa/ios-app-language.py --udid $U --to zh   # 收尾必须这一条
```
