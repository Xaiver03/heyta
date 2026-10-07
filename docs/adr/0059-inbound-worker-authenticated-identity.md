# ADR-0059：入站 worker 身份必须由独立凭据认证

> 状态：**已接受（技术方案，2026-10-07）**。更正 [ADR-0058](0058-inbound-automation-commit-and-task-batch.md) 背景中“现有认证同步禁止 B 冒充 A 上传”的依据，不改变其唯一许可/唯一提交身份决定。实现与验证仍见[计划](../plans/inbound-automation.md)。

## 更正依据

完整调用链是：`middleware.ts` 的 AuthUser 只有 userId/email；`sync.routes.ops-handler.ts` 从已通过结构校验的**请求正文**取 clientId；`operation-upload.service.ts` 把它传入 `validateOp(op, clientId)`。验证的是 op 与正文身份一致，**不是 JWT 中的设备身份**。在同一账号权限下，同时自报相同的两个 clientId 可通过这一项检查。

之前只读到了验证函数和 storage 注释，就将其称为设备认证边界，结论过强。普通 B 宿主不改请求身份时确实无法直接补传 A 的 op，但这不是安全意义上不可冒充。本 ADR 将这一错误显式更正；不能删除此前记录后假装没有发生。

## 决策

1. 新增入站 worker 注册：账号 JWT 认证之后，服务端生成 workerId 和 256 位随机 worker 凭据。数据库只存凭据的 SHA-256，不接受调用者指定既有 workerId 或凭据。记录绑定账号、注册时声明的 syncClientId 和本地数据库实例 epoch；这些声明在注册后不可通过普通请求修改。
2. 领取、续租、冻结结果、请求许可、ACK 均要求账号 JWT **和** worker 凭据；从凭据索引得到 workerId，不从请求体选择。新设备可注册自己的身份，无法取得原设备的许可 owner 身份。同步设备管理列表不是入站授权表。
3. `inbound:` 是业务 op 的保留前缀。正常同步上传也必须对该前缀执行额外门禁：绑定事件、已授予许可、workerId、syncClientId、本地库 epoch 与固定 opId。只有账号 JWT、伪造正文 clientId、同账号另一 worker 凭据均不得提交原 owner 的入站 op。读侧同步无须、也不得取得别的设备 worker 凭据。
4. 该门禁必须覆盖真正的保存路径与精确重复/请求缓存提前返回路径，不能只保护新自动收集路由，也不能以拿到普通上传成功回执来倒推存在有效许可。不同请求外观不能绕过保留前缀校验。
5. worker 凭据不随业务 op 或账号收件私钥同步。登出/本地库重建销毁本地凭据，新数据库 epoch 重新注册；已授权旧 owner 的未知提交不重新分配。撤销设备与账号 tokenVersion 失效要一并阻断新 worker 操作。离线旧设备已取得的数据无法远程擦除。

## 验证边界

用同一账号两套独立 JWT/worker 凭据和数据库：A 持许可，B 同时伪造正文 clientId 与 op.clientId 为 A，再走普通 `/sync/ops`，必须失败且不落盘；只在 `validateOp` 上测 clientId 不一致不算这项通过。覆盖没有 worker 凭据、错误账号、错误本地库 epoch、撤销、同凭据重试和上传缓存路径。

服务端仍看不到加密任务明文。worker 身份与许可证明“谁获得这次提交权”，不能证明其密文内容正确；内容验证依赖授权客户端、冻结结果和本地完整性校验。本 ADR 不宣称为恶意账号所有者提供防伪任务数据库，也不扩大既有普通本地任务的联网要求。
