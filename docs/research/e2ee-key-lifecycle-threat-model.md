# E2EE 密钥生命周期威胁模型（B）

## 资产与信任边界

资产是 vault root key、口令包、恢复码、明文实体和按功能派生密钥。客户端设备在用户解锁期间是可信执行边界；服务端、数据库管理员、同步网络、推送服务和托管 AI 提供方均不可信。服务端可以看到账号、clientId、时间、大小、顺序和设备活动，但不能得到 root key 或实体明文。

## 攻击者能力

攻击者可能读取服务端数据库、拦截/重放同步请求、窃取失效设备上的 clientId 和密文、获得登录账号但没有 E2EE 口令，或诱导用户泄露恢复码。设备被完全攻陷时，攻击者可以读取当时的进程内存；本协议不承诺在设备已经解锁且被攻陷后继续保密。

## 保证与非保证

保证包括：错误口令/恢复码不能解包 root key；包装密文被替换、record id/purpose 被改写或 keyVersion 被降级时 AES-GCM/AAD 校验失败；不同功能的派生密钥不同；客户端轮换遇到任一坏记录时不返回部分迁移结果；服务端不需要持有解密密钥。key-package PUT 还要求 strict schema、单步 `expectedKeyVersion` CAS 和相同 root fingerprint。

不保证：服务端无法隐藏访问模式（序号、时间、大小）；恢复码泄露后无法仅靠服务端撤销旧离线副本；旧设备在下一次同步前仍可能保有明文；当前存量口令密文不会自动获得 root-key 恢复能力。

服务端的 key package API 只接受 strict schema 的 wrapper，使用 `expectedKeyVersion` 做精确的单步 CAS，并拒绝 root fingerprint 变化；独立 DELETE 被拒绝，避免清空唯一 wrapper。设备撤销不把客户端自报的 clientId 当作身份，而是递增账号 `tokenVersion` 并关闭全部在线 WebSocket，再把撤销 clientId 留作审计 tombstone。

`reencryptVaultRecords` 的“原子”只针对客户端内存返回值：它保证坏记录不会产生部分返回数组，但尚未提供服务端数据库事务、批量进度、断点恢复或双写切换。恢复码轮换也只能覆盖服务端当前包；攻击者若在轮换前复制了旧 opaque package，服务端无法撤销该离线副本。

## 关键失败判据

以下变异必须失败：去掉恢复码校验、把 HKDF purpose 固定成同一个值、从 AAD 中去掉 record id 或 keyVersion、用错误 root key 解密、只迁移记录列表的一部分、把登录密码当作 vault 解锁口令、让服务端接受未知的 `rootKey`/`recoveryCode` 字段，或允许旧 keyVersion 覆盖新包。`packages/sync-core/tests/key-lifecycle.spec.ts` 与 `server/tests/vault-key-package.routes.spec.ts` 覆盖这些运行时判据，`scripts/mutate-e2ee-key-lifecycle.mjs` 对核心校验做真实变异并要求指定测试转红。
