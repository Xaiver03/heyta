# 变异装置（`docs/research/performance-hotpaths-audit.md` §8.1 的证据）

这些不是门禁，也不是产品代码 —— 它们是**"这条判据到底能不能失败"的回答**：
每台装置都做三件事：① 先跑一次未变异对照（拿到"这套件一共几条、现在全绿"这个基线），
② 把被测对象改回病灶形状、跑同一份 spec、要求**红在该红的那一腿**（按断言名字点名，
不接受"红了就行"），③ 立刻还原并复跑，最后逐字节比对确认回到原样。
🔴 前七台改的是**工作树里的源码**（所以每台都带还原与逐字节比对）；
`verify-gate-wiring-candidate.mjs` 改的是**候选副本**（`--pkg`），工作树零改动 ——
用哪种取决于那个文件归谁，见下面第 4 条。

| 装置 | 钉的工单 | 臂 |
|---|---|---|
| `mutate-p18.mjs` | P1-8（管理后台 `state:'settled'` 恒 0） | 对照 / 写回病根 / 还原复跑 |
| `mutate-p11.mjs` | P1-1（番茄钟 `pause()` 不停表） | 对照 / 摘掉停表 / **"只在 resume 里补停表"这种假修** / 还原 |
| `mutate-p12-p06.mjs` | P1-2 + P0-6（月历与成长视图的记忆化） | 每臂**先重打包 `@heyta/ui`**（`apps/web` 读 dist，不重打包跑的是旧产物） |
| `mutate-p011.mjs` | P0-11（上传把 per-op `encrypt()` 放进 `Promise.all`） | 并行 ⇒ 派生数红 / 复用同一密文 ⇒ 密文互不相同红 / 对照 |
| `mutate-p110.mjs` | P1-10（计数取代全表物化） | 删桥转发 / `countAllOps` 丢归档 / 引擎闸门退回物化 / 对照 |
| `mutate-p07b.mjs` | P0-7（提醒读侧一次遍历归组） | 退回 O(任务×提醒) / 不滤墓碑 / 丢 id 序 / 对照 |
| `mutate-p118.mjs` | P1-18（记忆层关着也付） | ⚠️ 它原地改 `apps/web/src/App.tsx`，**只能在那个文件干净时跑** |
| `verify-gate-wiring-candidate.mjs` | §8 第 17 步那道新门禁的**接线补丁** | C0 现状 / C1 进链 / C2 只加定义 / C3 插出 `&&&` —— 🔴 **它不改工作树**：改的是 `/tmp` 下的候选副本（见下面第 4 条） |
| `mutate-shell-surfaces-anchor.mjs` | `check:shell-surfaces` 断言 A 的**锚点分类**（2026-10-05 把"未跟踪的取证产物"从源码锚点里摘出来那次修法） | A0 原样副本绿 / A1 ps1 改取证文件名红 / A2 sh 的 scp 行改名红 / A3 删一枚**真**源码锚点仍红 / **A4 两半**：产物缺席不再红 + `HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 照样红。🔴 每台里最值钱的是 A4 那两半——少了 a 就是没修，少了 b 就是借修名的放宽。它同样**只改副本**（`rsync --link-dest` 硬链接 + 先 `rm` 再写，绝不就地 truncate） |

⚠️ 下面这几台**不属于本表那条线**（它们钉的是回收站/批次 E 的工单，见 `docs/plans/trash-and-archive.md`；
这一族有几台不写死在这里 —— 数一下就行：`ls research/tools/mutation-rigs/*.sh research/tools/mutation-rigs/*.mjs | wc -l`），
放在这里只是因为它们是同一族形状：**不改工作树、只回答"这条判据能不能失败"**。

| 装置 | 钉的工单 | 臂 |
|---|---|---|
| `e2-destroy-reopen-probe.mjs` | #87（`destroy()` 之后一次普通读把空壳建回来，§10.147） | 默认臂 ⇒ `PROBE=REOPENED` rc=**1**（当前 HEAD 就是这个形状）/ `PROBE_SKIP_READ=1` ⇒ `PROBE=clean` rc=**0**，**只用来证明这台装置能报绿**，跳过那一发读等于没问那个问题 |
| `android-passive-branch-selftest.sh` | #77（`ERASURE_TRIGGER=external` 那档，§10.146） | 五条腿：默认档不发 `DELETE` / external 三前提全成立 / 探针不通即中止 / 回 401 不去驱动设备 / 界面没那句 ⇒ C 判红。`PASSIVE=pass` 才是绿 |
| `ios-erase-arm-b76.sh` | #76 的**臂本体**（iOS 判据 B「一次 401 不许清库」自己能不能红，§10.155） | 🔴 **它不属于上面那句"不改工作树"**：这枚会落变异（`packages/sync-client/src/client.ts`）→ 重打 → **重装进它自己的模拟器**，`trap restore EXIT` 复原两侧，源与产物两侧都打 md5。要占设备窗口，跑前先 `PREFLIGHT=1`。13:0x 从 gitignored 的 `tmp/` 转正进来；它调用的判据驱动 `tmp/e2-ios-erasure.sh` **没有**转正 ⇒ 干净检出上它 `ARM=ENV rig-driver-missing` 以 **3** 退出（响亮，不是假绿） |
| `ios-erase-verdict-arms.sh` | #76（上面那枚臂的**结论分岔**，§10.155 / traps #288 · #291） | 七条腿全用环境变量注入**六条计数**（不注入 `LEG_TOTAL` —— 求和也在它眼下跑），一台设备都不碰：L1/L2 `rc=3`/`rc=0` 而腿全 0 ⇒ `NO-RUN`｜L3 跑过而 B 全绿 + 完整臂趟 ⇒ `DEAD` 且允许说"关于产品的结论"｜L4 同形状但 `RECOUNT` ⇒ 同一句 `DEAD` **不许**主张装载过｜L5 12:51 现场（B 计数全 0 而 `PREM`/`C` 有读数、summary 报失败）⇒ `NEEDLE-MISMATCH`/3｜L6 只数据腿红 ⇒ `OK` 并写明"文件腿这一枚问不到"｜L7 只文件腿红 ⇒ 也 `OK`（`OK` 不绑死在某一条腿上）。绿读数 `ARMS=pass (7/7)`；**两条变异读数**（都在 13:0x 现量）：① 摘 `NO-RUN` 那一档（6 行）⇒ 只红 L1/L2；② 摘 `NEEDLE-MISMATCH` 那 7 行 ⇒ **只红 L5**，且那一腿的输出逐字复现历史上那句假结论「判据 B 在 iOS 上没有牙」。抽的是臂本体的结论段 ⇒ 载具路径打进输出，两处都没有时报 `ARMS=NO-CARRIER` |
| `ios-erase-b-fileleg-probe.sh` | #90（iOS 判据 B **文件腿**到底能不能失败） | 五条腿全在临时目录里造盘上形状，**一台设备都不碰**：L1 库在⇒绿｜L2 库被 `unlink`⇒🔴红（承重腿：它区分"坏探针恒绿"与"好探针问不到"）｜L3 只剩 `-wal`/`-shm`⇒红｜L4 同目录只有 `heyta-device-prefs.sqlite`⇒红（证它认整串库名，§10.68.6 那个词干假红的反向）｜L5 有内容的库 vs 销毁后重开的空壳 **两格都绿**而 ops 差一行 ⇒ 当场打印"这一枚问不到，牙齿在数据腿"。绿读数 `FILELEG=RIGID`；**变异读数**：把谓词逐字换成"只数目录在不在"（恒真形状）⇒ `FILELEG=FAIL` rc=1，恰好 L2/L3/L4 三条被抓、L1/L5 不受影响。判据块与谓词都从真身 `scripts/verify-mobile-ios-account-erasure.sh` awk 抽，抽到 >12 行或缺绿/红 needles 即 `EXTRACT=*` 退 1（上一版锚点写成 `(else)?` ⇒ 抽出 188 行 ⇒ 载具里混进 `$UDID`，`set -u` 让**每条腿的 rc 都变成崩溃码 1**，本该绿的 L1 也红） |
| `rig-step-verbatim-recheck.sh` | #77 的那句断言「HEAD 的 step 5 本体逐字存活」（§10.146，10-05 12:3x 复量） | 按 `step "5`→`step "6` 取块、逐行去缩进成集合，报 `MISSING`（HEAD 有而工作树没有＝被改写的原句）。三档结论：`survives` / `title-only`（只有标题那行改了）/ `rewritten`。自带阳性对照：从工作树块删 1 行公共行 ⇒ `MISSING` 必须恰好 +1，否则整条判 `UNFAIABLE` 不作数。⚠️ **这台自己的第一版是恒真的**（收了输出路径参数却没用，比的是两个不存在的文件）⇒ 修法与教训在 traps **#289** |

跑法（本机有测试内存闸门，别的套件在跑时会拒绝启动）：

```bash
sh research/tools/mutation-rigs/wait-and-run.sh /tmp/mut.log 1200 \
  node research/tools/mutation-rigs/mutate-p11.mjs
```

## 四条从这些装置里长出来的判据纪律

1. **`ran` 必须落在读数里。** P0-7 的 B 臂第一趟报"判据存活"，实际是装置把
   `aliveReminders(` 剥掉后留下多余右括号 ⇒ 变异体语法错 ⇒ vitest 走集合期失败 ⇒
   `Tests` 行里没有 `N failed` ⇒ 装置读到 `failed=0`。**一条没跑起来的臂，
   长得和一条没牙的判据一模一样。** 防护有两种形态，两种都算数：
   `ran <= 0` 直接抛（现量：`grep -l 'ran <= 0' research/tools/mutation-rigs/*.mjs`），
   以及**期望 `ran`/`passed` 从对照推导**（后者天然不可能在 `ran=-1` 时判绿 ——
   `mutate-p011` 的 `C 跑到 3 条`、`mutate-p12-p06` 的 `ran === expectRan`、`mutate-p18` 的
   `passed === TOTAL` 都是这一型）。**判据是"这一臂能不能在没跑起来时被判绿"，不是"有没有那行 `if`"。**
2. **期望值要从对照推导，不能写死。** `mutate-p18.mjs` 曾经断言"恢复后 `passed === 15`"，
   而那份 spec 已长到 18 条 —— 于是**判据明明有牙，装置整体报红**。
3. **归组类改动要"多面一起断"。** 只断"读了几遍表"没有区分力（改成什么都不返回，读数也是 1）；
   必须同时钉活体对照、逐条等价、墓碑过滤、空桶边界。
4. **"要改别人手里的文件"不等于"这条验证做不了"——先找被验对象有没有候选输入旋钮。**
   前七台都是原地改源码再还原，那只适用于**文件归本批**的情况。`package.json` 正被并行会话
   改着，而 `scripts/check-gate-wiring.mjs` 本来就为了注入验证带了 `--pkg <候选>`：
   把候选写到 `/tmp` 指给它，四臂（现状 / 进链 / 只加定义 / 插出 `&&&`）当场就有读数，
   工作树零改动。**同一个道理适用于任何有 `--root` / `--dist` / fixture 旋钮的门禁 ——
   先读它自己的 `--help` 和文件头，再决定"这条得等别人"。**
   📌 那一臂 C3 是我第一次拼候选时的手误（`&&&` 把下一段顶出了链），而门禁点名的是
   **被顶掉的 `check:md-tables`**、不是新加那道 ⇒ 顺手证了两件事：检测面覆盖任意一道，
   以及"定义还在、链里没有"这个形状确实抓得住（这正是这道门禁存在的理由）。

`gate-run.sh` 是被 `wait-and-run.sh` 取代的早期版本（它只认日志里的拒绝字样，
而装置会吞掉内层输出 ⇒ "没跑到用例"在它眼里长得像"跑完了"）。留着是为了让人认得出这个形状。
