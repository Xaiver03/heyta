# E2EE 密钥生命周期威胁模型（B）

## 资产与信任边界

资产是 vault root key、口令包、恢复码、明文实体和按功能派生密钥。客户端设备在用户解锁期间是可信执行边界；服务端、数据库管理员、同步网络、推送服务和托管 AI 提供方均不可信。服务端可以看到账号、clientId、时间、大小、顺序和设备活动，但不能得到 root key 或实体明文。

## 攻击者能力

攻击者可能读取服务端数据库、拦截/重放同步请求、窃取失效设备上的 clientId 和密文、获得登录账号但没有 E2EE 口令，或诱导用户泄露恢复码。设备被完全攻陷时，攻击者可以读取当时的进程内存；本协议不承诺在设备已经解锁且被攻陷后继续保密。

## 保证与非保证

保证包括：错误口令/恢复码不能解包 root key；包装密文被替换、record id/purpose 被改写或 keyVersion 被降级时 AES-GCM/AAD 校验失败；不同功能的派生密钥不同；客户端轮换遇到任一坏记录时不返回部分迁移结果；服务端不需要持有解密密钥。key-package PUT 还要求 strict schema、单步 `expectedKeyVersion` CAS 和相同 root fingerprint。

不保证：服务端无法隐藏访问模式（序号、时间、大小）；恢复码泄露后无法仅靠服务端撤销旧离线副本；旧设备在下一次同步前仍可能保有明文；当前存量口令密文不会自动获得 root-key 恢复能力。

服务端的 key package API 只接受 strict schema 的 wrapper，使用 `expectedKeyVersion` 做精确的单步 CAS，并拒绝 root fingerprint 变化；独立 DELETE 被拒绝，避免清空唯一 wrapper。设备撤销不把客户端自报的 clientId 当作身份，而是递增账号 `tokenVersion` 并关闭全部在线 WebSocket，再把撤销 clientId 留作审计 tombstone。

`reencryptVaultRecords` 的“原子”只针对客户端内存返回值，不能替代生产迁移边界。实际迁移采用服务端 inventory、manifest/chunk staging、数据库事务 commit 和持久回执：旧历史未迁移时 payload generation 保持 null，普通 vault 写入阻断；完整迁移后才发布新 root 与载荷世代。服务端以固定锁序和 wrapper revision/fingerprint CAS 防止上传、改口令与迁移互相覆盖，配额把暂存 reservation 一起计算。恢复码轮换也只能覆盖服务端当前包；攻击者若在轮换前复制了旧 opaque package，服务端无法撤销该离线副本。

## 关键失败判据

以下变异必须失败：去掉恢复码校验、把 HKDF purpose 固定成同一个值、从 AAD 中去掉 record id 或 keyVersion、用错误 root key 解密、只迁移记录列表的一部分、把登录密码当作 vault 解锁口令、让服务端接受未知的 `rootKey`/`recoveryCode` 字段，或允许旧 keyVersion 覆盖新包。`packages/sync-core/tests/key-lifecycle.spec.ts` 与 `server/tests/vault-key-package.routes.spec.ts` 覆盖这些运行时判据，`scripts/mutate-e2ee-key-lifecycle.mjs` 对核心校验做真实变异并要求指定测试转红。

## 会话、持久化与恢复边界

- wrapper revision 与 payload generation 分开验证：更换口令不能暗中改变载荷密钥，首次有旧历史的账号不能因创建 wrapper 就被判成已迁移。空 `entityIds` 与 HTTP 省略形式使用相同 AAD；非空列表仍需认证。
- 解锁操作和异步 KDF 都受会话 epoch 约束。锁定、登出、账号/服务端/token 变化后，迟到结果不得重新安装 root。同认证绑定的并发加载共享一个 promise，不能互相废弃；不同绑定不得共用。
- 恢复码解锁之后，新的口令和恢复码发布前不能取得写入 cipher；已经取得的 cipher 也必须在每次调用检查会话有效性。
- 浏览器持久化的迁移 draft 以当前 root 加密保护目标 root；它不是明文密钥。密文 journal 只保存请求身份、manifest 与加密 chunk，不保存口令、恢复码、明文或未包裹的 root。重启后必须重新解锁，并输入此前保存的新恢复码确认；不能自动绕过确认。
- 同 scope 的原生 save/load/remove 串行。登出先禁止自动恢复，再把删除排在已有保存之后；偏好写入失败仍尝试原生删除。拒绝异步 save 的返回值不等于删除其已落下的原生数据。
- OS 安全存储不改变本地业务数据库仍为明文的事实。Android Keystore 当前不要求用户认证，不承诺锁屏禁读；iOS `WhenUnlockedThisDeviceOnly` 的实际锁屏行为须由原生运行时证据支持。

## 可复跑的生产证据

[ADR-0050](../adr/0050-e2ee-key-lifecycle-and-recovery.md) 汇总最新状态与截图；
`pnpm verify:vault-web` 在真实 PostgreSQL、生产 HTTP 路由和独立浏览器上下文中验证恢复、
旧历史迁移、新设备重建、chunk 网络中断后的重启续传、commit 响应丢失后的同请求恢复及取消。
这些浏览器证据不替代 Android/iOS 当前安装产物验收。隐私文档中的存储类别、用途、留存与
账号注销范围同时维护在 `packages/legal/src/documents/privacy.ts`，由已有级联对账测试检查。

## 本机 API 与 AI 出境

同步 E2EE 只约束服务端能看见什么。本机 API 在可信客户端读取已物化的明文，它不需要同步
root key；因此“锁定数据密钥”不是“锁定本地应用”，不能承诺锁定后本机 API 无法读本地库。
当前本地业务库未加密，获得同用户文件权限的恶意进程本就可能直接读库。回环监听也不等于
可信调用方，浏览器恶意页面、扩展和同机进程都属于这一攻击面。

已有防线由同一套代码执行：`packages/local-api/src/tools.ts` 的 `authorizeToolCall` 先查
总开关与 bearer token，再查工具存在性及逐工具 grant，未登记的授权默认拒绝；
`projectForTool` / `readItemForTool` 做字段投影，宿主 `isReadable` 决定条目是否可读。
当前产品没有“受保护条目”概念，生产宿主显式允许普通任务，不能把保留的过滤接口宣传为
已存在的逐条隐私隔离。持有有效本机 token 并获授权的调用者能读到相应明文，随后如何使用
不再受同步加密保护；撤销 token/工具权限只能停止后续访问，不能追回已读取的内容。

内置 AI 与本机 API 共用工具目录和 `isToolGranted`，内置 AI 的写调用只形成提案，确认后
经 app-host 的动作进入唯一 op-log 写入口。托管 AI 的出境授权仍由 `packages/ai/src/egress.ts`
按功能和目的地判定，并披露发送字段；同意任务拆解不等于允许习惯和专注记录出境。provider 为完成推断会看到
已授权的明文；HKDF 的 `sync`、`ai-task-planning`、`ai-feedback` 密钥域隔离不能替代字段
投影和授权，也不能被描述成“模型处理时仍看不到明文”。不得把 root 或 sync 派生密钥交给
provider；功能派生密钥只约束相应密文用途，不提升调用者权限。

这些边界的运行时判据在 `packages/local-api/tests/`、`packages/ai/tests/` 与
`packages/app-host/tests/ai-tool-run.spec.ts`。本轮全量测试中 local-api 103 条、AI 222 条通过；
它们与 Vault 迁移判据分别成立，不能互相替代。

验收自身也属于秘密边界。`pnpm check:vault-diagnostics` 通过真实浏览器失败验证自动 aria 快照、输入调用日志和断言不会把恢复表单内容落盘；负向对照移除保护时必须检出运行时合成秘密。Vault 截图仍显式遮罩恢复码，trace/video 关闭，密钥与存储泄漏断言只输出布尔值；模型请求观察器只保留内存数据。该门禁已进入全仓检查及 `verify:vault-web` 前置，不能仅凭截图已打码就认定诊断产物安全。
