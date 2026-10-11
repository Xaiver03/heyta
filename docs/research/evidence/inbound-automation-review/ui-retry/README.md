# 自动收集 · 规则界面的「显式重试」真浏览器取证（八张）

出处：`.worktrees/inb-t7`（本线私有的 detached 副本，起跑 `1c166425801c187e0cb0fd1b939f8baedb89ff25`、
`status --porcelain -unormal` 行数 0），命令 `cd e2e && npx --no-install playwright test --config playwright.inbound.config.ts`，
运行时刻 2026-10-11 12:39–12:40，汇总行 `2 failed / 2 passed (2.1m)`。
**通过的正是产生这八张图的那两条用例**（`inbound explicit retry and themes 1280 / 390`）；
红的那两条是草稿复核那一组，它的四张图在隔壁 `../ui-draft/`。

| 文件 | 画面 |
|---|---|
| `form-<宽>-<亮暗>.png` | 「自动收集」分组本身：字段白名单勾选、回调密钥编号、目标清单编号、规则时区、每个事件最多创建几条任务、`创建规则` |
| `retry-<宽>-<亮暗>.png` | 整页设置面 + `最近接收` 里 `事件 event-recovery` 的 `需要确认`：`上一次模型请求可能已计费。重新解析会再次调用模型并使用额度。确认后你将等待可执行设备。` + `确认重新解析 / 取消` |

⚠️ **`form-*` 那四张左缘约 10px 被裁**（`回调密钥编号` 首字缺半笔）**是取证装置自己的动作，不是界面缺陷**：
用例在元素级截图之前调了 `scrollIntoViewIfNeeded()`，把设置面板横向推出去一点。
同一时刻的整页图 `retry-*` 里同一批标签完整带左边距 —— **看窄屏形状以 `retry-*` 为准**。

sha256（复跑会因渲染时序变字节，这枚是入库那一刻的）：

```
6fcec56ddfe3e186fc047dc8d1b8b519c3cc58f66c1ddd10cfb9eafc6798bd66  form-1280-dark.png
8699c92fbae024af4f658bafb9e9e189c98d28cbdcab0b4438694383678b252f  form-1280-light.png
4ad225eee0f939173ee48dc2fd5c287bdcc52d8e8da1b9ef3f86c403512d5442  form-390-dark.png
ac3a3c6cff879fd98acaabfb01a461264cdf3730a5ae88776ddde5ad8dc5bd95  form-390-light.png
e61058588ae71f4dc9fd9403b870d868203b9f43367b6880c9232549dfa12eb9  retry-1280-dark.png
7aeca42716ee2706697f697021d5339a3127ce4d46e77a3772bb167b169c5524  retry-1280-light.png
450120f81513226e27c71c1bac75d7297f627d97a7e6b7ea772f9c8a6ad06f52  retry-390-dark.png
07c7a08e27c4f06639478864cb9447ffd9223fe26d3a121943b72584a3cce402  retry-390-light.png
```

图里出现的账号信息全是用例自带的合成夹具（`fixture@example.test` / `fixture-token`），无真实凭据。
