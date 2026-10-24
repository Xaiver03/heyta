# ADR-0073：头像这类「非 op 载荷」跟着**会话那把钥匙**走 —— vault 模式下复用 vault 信封，AAD 冻住

- **状态**：已接受（2026-10-24）
- **日期**：2026-10-24
- **相关**：[ADR-0040](0040-email-password-auth-decoupled-from-e2ee.md)（登录口令与 E2EE 口令**解耦**；§7.2「Web 端口令不持久化」）、
  [ADR-0050](0050-e2ee-key-lifecycle-and-recovery.md)（vault 根钥匙 / 会话 / 轮换）、
  [ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md)（UI 单源 —— 本单的裁决点因此落在 `@heyta/app-host` 而不是某个壳）
- **触发**：产品负责人 2026-10-24 实拍「个人资料」屏 —— 登录态账号上，头像那一格**永远**写着
  「本机没有保存这个口令 —— 请先在「同步设置」里填写一次」，而那个输入框在 vault 模式下**根本不渲染**

---

## 一、要解决的问题

头像（`users.avatarHash` 指向的那段密文）从 R10 起就是**客户端加密**的，用的是
「同步那把口令」，依据写在 `packages/app-host/src/hosted-auth.ts` 的文件头：服务端只存密文，
所以法务表 E「生物识别 ❌ 不收集」那句「没有任何生物特征模板离开你的设备」才是真的。

那条依据有一个**当时成立、现在已经不成立**的前提：「能同步 ⇔ 有口令」。
ADR-0050 的 vault 落地之后，登录态账号（`accountId` 有值）的同步走 **vault 根钥匙**，
而 `apps/web/src/features/sync/store.ts` 在 vault 模式下把 `getPassword` 固定返回 `undefined`。
于是：

1. 头像的钥匙在**每一个登录态账号**上都不存在；
2. 界面据此给出的指引指向「同步设置」里一个 vault 模式下**不渲染**的输入框
   （`SyncSettingsPanel` 的 `!vaultMode` 分支）——那是**无解的**指引，不是"还没填"；
3. 既有判据全部长在"没有 `accountId`"的夹具上，所以这一格在 CI 里**一直是绿的**。

## 二、选项

| 选项 | 否决理由 |
|---|---|
| A. 头像改成**明文**上传（"反正是头像"） | 🔴 与法务表 E 那句依据直接冲突：一张人脸照片就是"生物特征离开设备"。要改就得先改法务口径 —— 那是产品决策，不是实现顺手 |
| B. 头像继续只认口令，界面上补一句「登录态下不支持换头像」 | 把**实现缺陷**写成产品限制。同一个用户的任务数据用 vault 钥匙能读，头像却读不了 —— 没有一条产品理由解释这个差别 |
| C. 登录时把 vault 口令**顺手塞进** `sync.password`，让头像继续用口令那套 | 一个进程里出现**两套真源**（vault 根钥匙 + 口令）。口令改一次，全部旧头像永久解不开，而用户看不到任何线索 |
| **D. 头像用「这台会话现在有的那把钥匙」：vault 模式下复用 vault 信封**（选定） | 代价是**新的密文形状**与一个**冻住的 AAD**（见 §三.2），换掉它的成本是中等的：已上传的头像不可迁移 |
| ~~E. 等 Web 端口令进钥匙串（ADR-0040 §3.2 D2）再谈~~ | 那条只在桌面/移动端成立（Web 明写「不假装」）。它消不掉登录态账号的缺口 —— vault 模式下**没有口令**这件事与钥匙串无关 |

## 三、结论

### 1. 一个裁决点：`resolveAvatarKey()`

`packages/app-host/src/hosted-auth.ts` 新增 `AvatarKey = string | { cipher }` 与
`resolveAvatarKey({ password, vaultCipher })`：

- 有 vault cipher ⇒ 用它（**与同步数据同一把钥匙**）；
- 否则有非空口令 ⇒ 用口令（手填 `baseUrl + token + 口令` 的实例、自建、旧凭据）；
- 都没有 ⇒ `undefined`（界面说「先解锁」，不说「你没有头像」）。

两个壳只负责**把钥匙交进来**（Web：`apps/web/src/features/sync/avatar-key.ts` 的 `useAvatarKey`），
"用哪把、谁优先"只有这一处。

### 2. 信封：复用 vault op 形状，身份**冻住**

vault 模式下的头像密文 = `createVaultPayloadCipher` 的信封（`heyta-vault-op/` 魔数 + keyVersion + AES-GCM），
AAD 取一个**合成的、永不变更**的身份：

```ts
{ id: 'account-avatar', clientId: 'account-profile', actionType: 'account.avatar',
  opType: 'set', entityType: 'account', timestamp: 0, schemaVersion: 1 }
```

🔴 **这七个数改任何一个，已经传上去的头像就再也解不开**（不是报错，是"这台设备解不开"）。
`timestamp: 0` 是刻意的：头像不是 op，没有"什么时候发生的"要认证。

不新开 `purpose`：`encryptVaultRecord` 的 `purpose` 是**共享层**的词表，为一个界面对象加一档
等于让 sync-core 认识"头像"这个概念。合成身份把它留在 app-host 这一侧。

### 3. 读侧：**先看信封，再选钥匙**

`isVaultOpEnvelope()`（`@heyta/sync-client`）只回答形状。两种钥匙的密文长得完全不同，
拿错钥匙只会得到一次"解不开"，而用户会被要求核对一把**本来就是对的**钥匙。
「先试这个、失败再试那个」要多付一次 Argon2id —— 否决。

## 四、后果

1. **登录态账号终于能换头像**，前提与同步**同一个**：会话解锁过。未解锁则界面说
   「端到端加密口令不在这台设备上 —— 解锁一次之后就能换头像」+「去解锁」，
   去处是「同步与隐私」（`SETTINGS_ANCHORS.sync`），不是一句无解的话。
2. **移动端还没接**（`apps/mobile/src/screens/ProfileScreen.tsx` 仍只传 `config.password`）：
   接口接受字符串，所以它照旧编译、照旧走口令那条路。vault 模式下移动端**仍然**撞同一个墙 ——
   这一格是**已知缺口**，不是两种语义：改动只是把 `host.getVaultSession()` 的 cipher
   交给同一个 `resolveAvatarKey`。⚠️ 在它落地之前，不许对外说"多端都能换头像"。
3. **旧密文不迁移**：口令写的头像在 vault 会话里解不开（`undecryptable`），界面说的是
   "这台设备解不开"并保留服务端那份 hash —— 用户重传一张即可，不会丢数据。
   🔴 反过来说：**不主动覆盖**。这是 R15b 那条判据的延续（把"解不开"说成"你还没有头像"
   会让用户把自己那张好图覆盖掉）。
4. **AAD 是一条不可逆约束**：它现在是代码里的常量，任何"顺手改一下 id 让它更规范"的改动
   都会静默毁掉所有存量头像。判据把它钉在
   `packages/app-host/tests/hosted-account-profile.spec.ts` 的「两种钥匙不互相冒充」那一组里。

## 五、判据

| 层 | 判据 |
|---|---|
| 取舍（谁优先 / 都没有） | `packages/app-host/tests/hosted-account-profile.spec.ts` · `resolveAvatarKey` |
| 往返 + 反向（原图不在密文字节里） | 同上 · 「vault 往返」 |
| 两种钥匙不互相冒充 | 同上 · 「口令解 vault 密文 = undecryptable，vault 解口令密文也 = undecryptable」 |
| 接线（登录态账号真的用 vault 信封） | `apps/web/tests/profile-panel.spec.tsx` · 「登录态账号：有 vault 钥匙就不说缺口令，上传走的是 vault 信封」（变异实测：让 `useAvatarKey` 忽略 vault ⇒ 本条红） |
| 真浏览器 | `e2e/tests/profile-avatar-e2ee.spec.ts`（口令那条路，四张取证图） |
