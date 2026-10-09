# 助手跨页面生命周期与长消息布局验收

日期：2026-10-08。来源：受控实施树，Web Chromium。模型响应由本地 stub 固定；DOM、导航、IndexedDB、op-log 与 app-host 为真实实现。不代表原生移动端或已发布安装包验收。

## 修复

1. 修复任务页 → 日历 → 任务页后正在运行的请求丢回答：消息列表、披露状态与请求控制闸门一起由账号绑定的 Provider 持有。导航不重发请求；运行中新会话仍不可切换；取消披露仍恢复草稿且不出站。
2. 修复长网址/连续文字气泡从左侧裁切：真正的消息节点 `.ht-ai__item` 约束容器宽度并允许任意断点换行。没有新增边框。
3. 将此前提案证据中的硬编码 `opDelta = 1` 改为真实 op-log 前后读数，且增加日历重挂载，不能把设置遮罩开关冒充重挂载验收。

4. 修复默认未提供 `historyStorage` 时被 `?? null` 意外关闭的本机历史；显式 `null` 仍禁止落盘。默认存储复用 app-host 的服务器与账号分槽，不跨账号清除或恢复。
5. 登录、退出及换号会同步递增 Provider 会话代际；同一挂载点也重建助手。旧 writer、旧模型请求和迟到的提案确认不能更新下一代会话，即便账号路径是 A → B → A。
6. 恢复的未确认危险提案保留内容但移除确认按钮，并隐藏“等你确认/将要执行”等过期状态文案。

根任务随后为输入容器补充设计 token `shadow-sm`。`composer-shadow-long-message.log` 记录该合并样式后的定向浏览器 1/1；四张长文本深浅截图已重新生成，1280/1050 两档仍完整换行，输入容器有浅阴影且没有新增边框。

## 证据

- `browser-tests.log`：6/6，无重试；运行中跨页、提案跨设置和日历、长网址/连续文字深浅主题、刷新历史、危险提案刷新失效、账号切换与真实退出。
- `running-journey.json`：2 次模型请求（首轮 + 工具结果回送），最终只有 1 条助手回答。
- `proposal-journey.json`：真实 opCount 1 → 2，任务备注包含新增清单，未确认时无新 op。
- `unit-tests.log`：3 文件 49/49；包括跨挂载继续上下文、披露取消、显式 null 零历史键、同槽切换/退出、A → B → A 旧响应及迟到确认不覆盖新账号草稿。
- `history-refresh-before.json` / `history-before.log` / `history-before.png`：修复前真实刷新后对话消失，历史键为空、助手回答数 0。
- `history-refresh-journey.json` / `history-after-refresh.png`：修复后 guest 分槽确实落盘，刷新后助手回答数 1，模型请求仍为原来 2 次。
- `history-expired-proposal.json` / `.png`：刷新前后 opCount 都是 1，无新增清单，无确认按钮，模型请求仍为 1 次。
- `history-account-isolation.json` / `history-account-return.png`：同邮箱/账号 ID 切换服务器 A → B → 真实退出 → A，B 与退出态没有 A 的消息或草稿；退出确实清除登录凭据；回到 A 恢复 A 历史。身份为已认证夹具，不代表本轮验证了注册认证服务。
- `typecheck.log`：Web TypeScript 通过。
- `long-message-before.log` / `long-message-before.png`：修复前同一几何断言失败，容器左缘 944，气泡左缘 -200.6875。
- `long-message-geometry.json`：1280 和 1050 两档视口、深浅主题，气泡和容器左右界一致，scrollWidth == clientWidth（320 或 283）。
- `running-*.png`、`proposal-*.png`、`long-message-*.png`：实际 DOM 截图；已人工检查长消息完整换行，等待/回复/确认按钮可见。

边界：本轮不声称全端 AI 生命周期完成；没有运行真实模型，也没有为此创建新的公开发布。全部修改仅在受控树，等待根任务有界镜像与最终冻结构建。

## 最终独立复审接续（2026-10-08）

复审先确认现有 6 项浏览器 / 49 单测确实覆盖同槽换号、退出、A → B → A 旧回包、迟到确认及提案刷新失效，然后用临时定向探针实际发现新的隔离缺陷。`final-review-baseline-probe.log` 的 2 项通过表示缺陷成功复现，**不是修复通过**；临时探针已删除。

新增修复与实际验收：

1. `currentAccount()` 与 Provider 均读取真实同步 store。凭据落盘失败不再把已登录会话误判成访客。真实浏览器在 `Storage.setItem` 抛配额异常后走 `applyAuthToken`，助手仍回复；凭据和历史确实都未落盘。结果在 `history-quota-runtime.json`。
2. 共享历史身份保留规范化服务器路径；同域 `/team-a` 与 `/team-b/` 的同邮箱、同 accountId 不共用历史。根路径 hosted 键不变，默认端口、域名大小写、路径规范化及尾斜杠等价。真实浏览器有独立同域路径换号/退出/返回旅程，结果在 `history-account-isolation-paths.json`。旧的非根路径 origin 历史不猜测属于哪个实例，保留原记录。
3. 手填配置更换地址或 token 后同时清除旧 email/accountId；仅改本机加密口令保留身份和草稿。`applyAuthToken` 缺少身份时也只有完全相同的凭据能保留标签。生产认证调用始终提供 `session.user.email/id`，正常认证不受影响。
4. 手填会话退出或进入核验账号时重置临时 resolver。同一未核验 token 在退出后重登也取得新 scope，不能复用旧会话。真实浏览器覆盖 A → 手填 B → 手填 C → 真实退出 → 同 token C 再进入，记录在 `history-manual-credentials.json`。

最终日志：`final-review-browser-tests.log` **9/9，无重试**；`final-review-unit-tests.log` **6 文件 80/80**（AI、凭据落盘、设置预填、实时接线）；`final-review-history-accounts.log` **7/7**；`final-review-typecheck.log` TypeScript rc=0；`final-review-apphost-build.log` 共享产物已重建。`final-review-source.json` 固定被验源码 SHA，不将此前 49 项日志冒充本次结果。

`AiToolRun` 当前没有产品渲染入口：源码仅由助手引用其 `intentText` 导出，旧组件留有缺少代际检查的潜在实现，不能声称其已做完整换号验收，也不能将它描述为当前用户可进入的工具页面。已运行浏览器覆盖的是正式 `AssistantPanel` 路径。

仍保留上述 Web / 模型 stub / 原生新安装包未验的边界；本次不修改服务端或业务后端。
