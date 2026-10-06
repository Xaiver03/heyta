# 备份侧的定点删除（P-12）：监管要求什么、本仓能做到哪一步

状态：**调研 + 建议，未拍板**（拍板点写在 §6）。起因是批次 E 挂着的一条敞口：
注销在活库里有真硬删除，但**备份里没有"把某一个人单独删掉"的能力**，
法务文档因此只能写成"随保留期自然过期"（`packages/legal/src/documents/privacy.ts:410`、
`personal-info-list.ts:522-524`、`data-rights.ts:328`）。

本文所有仓内结论都是 10-05 16:5x 现量，右栏给 `file:line`；外部结论逐条带出处（§7）。

---

## 1. 监管到底要求什么（先把目标定准，别解一道不存在的应用题）

ICO《Right to erasure》正面处理了备份，四句话可执行：

1. **不能拿备份当拒绝理由** —— 你"must take steps to ensure erasure from backup systems as well as live systems"；
2. **不要求立刻** —— "the data will remain within the backup environment for a certain period of time until it is overwritten"；
3. 过渡期要做的是把备份**"put … beyond use"**，并且"**do not use the data within the backup for any other purpose**"，
   留到"replaced in line with an established schedule"；ICO 认为这样"unlikely … pose a significant risk"；
4. **时限不因备份延长** —— 仍然"without undue delay and at the latest within one month"。

⇒ 合规目标**不是**"做出一个能改 gzip 快照的删除器"，而是三件事：
**(a) 那个"established schedule"真的存在并可核验；(b) 备份内容在过渡期真的只用于灾难恢复；
(c) 任何一次恢复都不许把已注销的账号复活。** 这三件本仓都能落到代码与门禁上。

法理上另一条支撑：Thoughtworks 对 crypto-shredding 的定位是"**密钥销毁比文件擦除更可行**"，
且明确它的适用条件是工程师"maintaining appropriate control of a smaller set of encryption keys" ——
本仓恰好**不满足**这个前提（见 §3）。

## 2. 本仓今天真实有什么（现量）

| 事实 | 出处 |
|---|---|
| 唯一的备份实现是 `pg \| gzip` 两份产物：整库 + **账号面单独一份**（`--table=users --table=passkeys`） | `server/scripts/backup.sh:98`、`:107` |
| 默认留存 14 天，靠 `find -mtime +N -delete` 过期 | `backup.sh:34`、`:135` |
| 主路径**不加密**，只有 `umask 077` + `chmod 700` | `backup.sh:28`、`:68`；`docs/adr/0049-…:45` |
| 加密版与轮制版脚本**存在但没接线**（无 compose/CI/runbook 引用） | `server/tools/backup-encrypted.sh:76-80`、`backup-rotate.sh:3`；`ADR-0049:47`"未被接成默认路径" |
| **仓内没有任何定时任务**；部署脚本明确不碰操作者的 crontab | `server/scripts/deploy.sh:504`、`:514-526` |
| 生产机上到底几天、是否每日跑 —— **仓内无法证明**，runbook 自己的示例还与默认值打架（示例 `RETENTION_DAYS=3` vs 表里默认 14） | `server/docs/backup-and-recovery.md:35` vs `:45`；`ADR-0049:46,99` |
| **没有恢复脚本**（`server/scripts/` 里只有 `backup.sh`） | `ls server/scripts` 现量 |
| 服务端**没有**可解全量的托管密钥；根密钥客户端生成、Argon2id 包裹、AAD 带 `keyVersion` | `docs/adr/0050-…:11-13`、`:57`；`packages/sync-core/src/key-lifecycle.ts:255-266` |
| 服务端持有的账号面密钥只有**全舰队共享**的两枚（Argon2 pepper、`JWT_SECRET`） | `server/src/password/hash.ts:10-15` |
| 账号硬删是 19 条 FK CASCADE / 18 张表；`Operation` 没有任何 TTL 列 | `server/prisma/schema.prisma:182`；`docs/research/legal-data-flow-inventory.md:72` |
| 已有的"实体删了但记录还活着"的先例：`RevokedSyncDevice` | `schema.prisma:372` |
| 现有留存对账判据**刻意不管备份**（它的正则钉的是"同步事件 / 45 天"那一族） | `packages/legal/tests/retention-claim.spec.ts:83-92` |

## 3. 为什么"逐账号 crypto-shredding"这条路在本仓是堵死的

要做逐账号销毁，必须存在**一把只属于该账号、且销毁它就能让该账号密文不可读**的密钥。
现量：根密钥由客户端生成，服务端只存**不透明的包裹串**（`schema.prisma:386-400` 的 `packageData Json`），
服务端能解密的唯一路径是**离线拿到用户自己的口令/密钥文件**（`server/scripts/recover-user.ts:10-14`：
密钥只从 `RECOVER_ENCRYPT_KEY` / `--key-file` 读，且它自己写着"still test against a known account first"）。
服务端持有的两枚秘密都是**全舰队共享**的（pepper / `JWT_SECRET`）—— 销毁它们等于把**所有人**的备份一起销毁。

ADR-0049 已经判过一次：crypto-erase 解决 Art.32、**不解决 Art.17**（`:53-62`），
并拒绝在密钥托管未定前把加密备份接成默认路径（`:64-65`）；ADR-0050 又钉死"不在服务端保存可解密所有数据的托管恢复密钥"（`:57`）。
⇒ 想靠"服务端销毁一把 per-account key"来满足 Art.17，要么得让服务端**能**解密（直接破坏 E2EE 与 ADR-0050），
要么得把备份**按账号分片加密**（备份/恢复成本与一致性重做）。两条都不是 P-12 该付的价。

## 4. 建议做的（三件，全部可测）

**A. 把"established schedule"从声称变成对账。**
唯一数字源：`RETENTION_DAYS` 与备份频率写进一处（照 `docs/reference/pricing-and-entitlements.md` 的 ssot 块那个形状），
法务三份里的"14 天 / 每日一份"由它生成或对它；新门禁 `check:legal-backup-retention` 三方对账
**脚本默认值 / runbook 示例 / 法务句子**，不一致就红。今天现成的第一条红就是它该抓的：
`backup-and-recovery.md:35` 的 `RETENTION_DAYS=3` 与 `:45` 的默认 14 与 `privacy.ts:409-410` 的"每日一份 / 14 天"。
⚠️ 频率那一半**必须先在生产机上现量**（crontab 与产物 mtime），仓内证不出来；量不出来就不许在法务里写"每日"。

**B. 账号面做真正的定点删除；密文面做 beyond use。**
`backup.sh:98` 已经把 `users`/`passkeys` 单独成档 —— 这是唯一有身份标识的那一半（邮箱明文、口令散列、凭据），
也是**唯一可以行级过滤**的那一半。做法：

1. 新增 `AccountTombstone`（形状沿用 `RevokedSyncDevice`）：`userId`、`emailHash`（**不存明文邮箱**）、`closedAt`；
   注销硬删时在同事务里写一条，且它**不在**那 19 条 CASCADE 覆盖范围内（否则删账号把自己删了）。
2. accounts 那份改成 `COPY (SELECT … WHERE id NOT IN (SELECT user_id FROM account_tombstones)) TO …`
   ⇒ **新备份不再含已注销账号**；整库那份做不到，由 A 的窗口 + C 的恢复闸覆盖。
3. 判据：造一个含"已注销账号"的旧 accounts 档 → 跑导出 → 数得出该 id **0 次**；
   变异 = 摘掉 `NOT IN` 那一支 ⇒ 必须恰好红一条。

**C. 补一条恢复闸（今天根本没有恢复脚本，这是最薄的一环）。**
在服务端脚本目录里新增一枚恢复脚本（今天那里只有 `server/scripts/backup.sh` 一枚 —— 现量 `ls` 过）：
导入完成后**立刻**按墓碑表 `DELETE`（带 FK 级联），再断言
"每一个墓碑 id 在恢复后的库里 0 行"，不为 0 就**退出非零且不落地**。
判据：拿一份含已注销账号的旧整库档跑恢复 ⇒ 断言必须红；把闸摘掉 ⇒ 账号复活 ⇒ 红。
这条把 ICO 的"beyond use"从形容词变成一次可复现的拒绝。

## 5. 建议不做的

- ❌ 服务端逐账号密钥销毁（§3 的两条代价都大于收益，且第一条直接违反既有立场）；
- ❌ 把整库备份改成按账号分片（备份/恢复一致性重做，换来的只是"能定点删"这个本可用 A+B+C 达到同等合规效果的动词）；
- ❌ 任何"注销后立即从备份彻底删除"的表述 —— 现有那三句"做不到"的实话**要留着**，
  改的只是让它从"代码里没有这个能力"升级成"账号面已经不做进新备份、恢复侧会被拒绝、密文面按 N 天过期且只用于灾难恢复"。

## 6. 要拍的板（三件，都不是代码问题）

1. **`RETENTION_DAYS` 定多少**（现量冲突：3 vs 14）—— 数字越短，ICO 那条"age out"越硬。
2. **备份是否默认加密 + 密钥托管在哪** —— `backup-encrypted.sh:39-45` 现在是**同机 root 可读的口令文件**，
   等于没有托管；建议 `age` 公钥、私钥离线由运维者持有。这条同时是 ADR-0049 拒绝默认切换的那个前置。
3. **是否接受"整库备份不定点删、账号面定点删"作为对外口径** —— 这是本文的核心建议，
   落地要新写一份 ADR（不改 ADR-0049/0050 的结论），并把 §4 三件排进批次。

## 7. 出处

- ICO《Right to erasure》备份段落（本文引用的五处引文全部来自这一页）：
  <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/>
- Thoughtworks Tech Radar《Crypto shredding》（适用条件与"控制一小撮密钥"的前提）：
  <https://www.thoughtworks.com/es-cl/radar/techniques/crypto-shredding>
- CNIL《Le droit à l'effacement》：**未**给出备份专项规则，只给一个月（可延至三个月）的时限 ——
  记这条是为了标明"别把 ICO 的说法安到 CNIL 头上"：<https://www.cnil.fr/fr/comprendre-mes-droits/le-droit-leffacement-supprimer-vos-donnees-en-ligne>
- 本仓：`docs/adr/0049-…`、`docs/adr/0050-…`、`server/scripts/backup.sh`、`server/tools/backup-encrypted.sh`、
  `server/docs/backup-and-recovery.md`、`packages/legal/src/documents/{privacy,data-rights,personal-info-list}.ts`、
  `packages/legal/tests/retention-claim.spec.ts`、`server/prisma/schema.prisma`。
