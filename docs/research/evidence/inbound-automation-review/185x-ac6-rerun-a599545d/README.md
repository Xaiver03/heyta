# AC-6 真浏览器那一趟 · 10-11 18:4x 在当前 HEAD 上的复跑件

载体：本线私有隔离副本 `.worktrees/inb-t7`，`git rev-parse HEAD` = `a599545dc9a8732cbfdef7005dd67174d9e50c61`，起跑前 `status --porcelain -unormal` 行数 0。
命令：`cd e2e && npx --no-install playwright test --config playwright.inbound.config.ts` ⇒ `E2E_RC=1`、汇总逐字 `2 failed / 2 passed (2.1m)`。
端口 4468（本配置自有，`--strictPort`），`outputDir=/tmp/heyta-inbound-ui-results`。日志：`~/.cache/heyta-inb-t8-recheck-1011/ac6-184632.e2e.log`。

两条红 = `encrypted date draft review and Vault invalidation 1280/390`，栈在 `e2e/tests/inbound-automation.spec.ts:85:69`（等 `查看并编辑草稿` 按钮）⇒ 缺陷本体记在 **B140**（`active` 旋钮从没人接）。

| 文件 | 是什么 | sha256 |
|---|---|---|
| `draft-1280-dark.png` | 失败态那一步之前抓的草稿编辑器（证明界面画得出来） | `f64f9b2f4c393b1ac91e0d7726a16936cd968fccf954299e546c7137e8818d60` |
| `draft-390-dark.png` | 失败态那一步之前抓的草稿编辑器（证明界面画得出来） | `2b01ebb2c1c4576773f0f76fc01c2722a4f52a559b48063ace4779aaa2803082` |
| `form-1280-dark.png` | 通过态：规则表单（字段白名单/时区/条数） | `6fcec56ddfe3e186fc047dc8d1b8b519c3cc58f66c1ddd10cfb9eafc6798bd66` |
| `form-1280-light.png` | 通过态：规则表单（字段白名单/时区/条数） | `8699c92fbae024af4f658bafb9e9e189c98d28cbdcab0b4438694383678b252f` |
| `form-390-dark.png` | 通过态：规则表单（字段白名单/时区/条数） | `9c6913e421af2482e64d83d4a85b265a36207b4a2e59b89474557e8d7e998f50` |
| `form-390-light.png` | 通过态：规则表单（字段白名单/时区/条数） | `ac3a3c6cff879fd98acaabfb01a461264cdf3730a5ae88776ddde5ad8dc5bd95` |
| `retry-1280-dark.png` | 通过态：显式重试那一格（最近接收 + 确认重新解析） | `e61058588ae71f4dc9fd9403b870d868203b9f43367b6880c9232549dfa12eb9` |
| `retry-1280-light.png` | 通过态：显式重试那一格（最近接收 + 确认重新解析） | `7aeca42716ee2706697f697021d5339a3127ce4d46e77a3772bb167b169c5524` |
