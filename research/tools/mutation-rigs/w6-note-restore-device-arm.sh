#!/usr/bin/env bash
# W6-c 设备级变异臂：只拿掉「恢复便签时清墓碑」那一处修复，看回收站那两条腿会不会红。
#
# 为什么存在：目标要求每张工单齐三件，其中"只拿掉修复后的变异读数"在 W6-c 的**设备层**是 0 条
# （账见 docs/plans/trash-and-archive.md §10.170 / §10.174）。第一趟死因不是产品，是两处守卫
# 正确拒绝了一次无效臂（构建主机不可达 ⇒ 产物字节没变 ⇒ 那一趟跑的是旧 APK）。
# 这个脚本把那次的三个缺陷补掉：① 起跑前先证明**产物通道活着**；② 起跑前证明**设备窗口没人占**；
# ③ 变异必须**进到 APK**（md5 与臂前不同）才允许跑验证，否则整臂判无效而不是判红。
#
# 退出码（三档，别混）：
#   0  臂有效且拿到了预期红集
#   1  臂有效但红集与预期不符（这才值得读产品结论）
#   3  **环境无效**（打包主机不可达 / 设备窗口被占 / 源码不干净 / 产物没变）——不是产品失败
#
# 用法：bash research/tools/mutation-rigs/w6-note-restore-device-arm.sh [--dry-run]
#   --dry-run = 只跑四道前置然后退出（0=窗口可开，3=环境无效），**一个字节都不改**。
#               这一档存在的理由：整臂要 30 分钟以上，而"窗口是不是我的"这件事不该靠开臂来试。
#   🔴 这条承诺本身有个例外，而且它曾经不成立：前置 1 的"本臂残留自愈"要**写文件**，
#      旧实现把它放在 DRY 判定之前，于是 `--dry-run` 会悄悄改动工作树。
#      现在 DRY 只**报告**残留（DRY=HEAL-SKIPPED）不动字节；判据见同目录的
#      `w6-dry-run-arms.sh`（臂数由它自己打印的 `ARMS=` 为准，别往文档里抄；含
#      "dry 前后 md5 逐字相同"与"非 dry 确实从 HEAD 取回"两档）。
# 需要独占：emulator-5554 + 一台能出 APK 的 Android 构建主机。一趟 = 变异构建 + 干净构建 + 跑到第 7 步。
set -u

DRY=0
RESIDUE_FOUND=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# 🔴 三层不是两层：这个文件在 research/tools/mutation-rigs/ 下，少算一层会把 R 落到 research/，
#    于是下面所有路径都不存在 —— 而"不存在"在 `git status --porcelain` 上长得和"干净"一模一样（空输出），
#    前置守卫会**静默假通过**。（第一次跑就撞上了：warning: could not open directory 'research/packages/…'）
R="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$R/packages/app-host/src/note-actions.ts"
APK="$R/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
DEV="${HEYTA_ANDROID_SERIAL:-emulator-5554}"
PORT="${PORT:-3100}"
WORK="$(mktemp -d /tmp/w6-arm.XXXXXX)"
PRISTINE="$WORK/note-actions.pristine.ts"
BASE_MD5="$WORK/base-apk.md5"

say() { printf '%s\n' "$*"; }
die3() { say "ARM=ENV-INVALID reason=$1"; exit 3; }

cd "$R" || { say "ARM=FAIL reason=cd"; exit 1; }
# 载体自证：R 必须是仓库根（有 package.json 与 pnpm-workspace.yaml），否则后面的"干净"全是假的
[ -f "$R/package.json" ] && [ -f "$R/pnpm-workspace.yaml" ] || die3 "R 不是仓库根（${R}）—— 前置守卫会因路径不存在而空过"
[ -f "$SRC" ] || die3 "变异目标不存在：$SRC"

# ── 前置 1：变异目标必须是**干净**的（撞车判据只认同一文件的未提交 diff）────────────
# 但"脏"分两种：**上一趟被 SIGKILL 留下的本臂变异**（可自愈）与**别人的在飞改动**（必须让路）。
# 两者的区别可以逐字节判：脏内容等于本臂那一发针脚 ⇒ 是残留，从 HEAD 取回原文件继续；否则 die3。
SRCREL="packages/app-host/src/note-actions.ts"
[ "$SRC" = "$R/$SRCREL" ] || die3 "SRCREL 与 SRC 不一致（装置自己漂了）"
if [ -n "$(git status --porcelain -- "$SRC")" ]; then
  if node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");process.exit(t.includes("        payload: {},\n      });\n      return true;\n")?0:1)' "$SRC"; then
    if [ "$DRY" = 1 ]; then
      # 🔴 dry 只报告，不写。写下去就违反了本文件对 --dry-run 的承诺。
      RESIDUE_FOUND=1
      say "DRY=HEAL-SKIPPED 检测到上一趟本臂的残留（针脚逐字节相符，可自愈），但 --dry-run 不写任何字节 ⇒ 要清就正式开臂"
    else
      git show "HEAD:$SRCREL" > "$SRC"
      git diff --quiet -- "$SRC" && say "RESIDUE_HEALED=上一趟的本臂变异已从 HEAD 取回（不是别人的改动）" \
        || die3 "自愈后仍脏，不动别人的东西"
    fi
  else
    die3 "$SRC 有未提交 diff 且**不是**本臂那发针脚 ⇒ 本臂不落任何未提交的字节（归属不由本装置判：现量 git diff -- ${SRCREL}）"
  fi
fi

# ── 前置 2：设备窗口归属（别的验证脚本在跑就让路）──────────────────────────────
if ps -eo command | grep -E 'verify-mobile-[a-z]+' | grep -v -e grep -e "$(basename "$0")" >/dev/null; then
  die3 "另一趟 verify-mobile-* 正在驱动设备（窗口不独占）"
fi
adb get-state >/dev/null 2>&1 || die3 "adb 没有可用设备（DEV=${DEV}）"
curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/health" || die3 "服务端 :$PORT 不可达"

# ── 前置 3：产物通道活着（Android 构建走打包主机；不可达就别开这一臂）──────────────
# 🔴 探法必须是**跨默认 shell 都成立**的那一种：远端是 Windows，默认 shell 可能是 cmd.exe，
#    给它 `true` 会以"不是内部或外部命令"失败 —— 那会被误读成"主机不可达"，
#    而它其实活着（第一次跑就撞上：stderr 里同时有 openssh 的后量子告警和 cmd 的乱码报错）。
#    `echo` 在 cmd 与 PowerShell 里都成立，所以拿回显串当唯一判据。
HOST="${HEYTA_ANDROID_HOST:-windows-pc}"
# 远端仓库根必须与 run-gradle 的默认**同源**（它读同一个环境变量）；
# 写死路径的话，别人改了 REMOTE_ROOT 时这一还原会推到不存在的地方，而"回读对上了"是**自己跟自己比**——假 ok。
REMOTE_ROOT="${HEYTA_ANDROID_REMOTE_ROOT:-C:/src/heyta}"
if [ "${HEYTA_ANDROID_LOCAL_GRADLE:-0}" != "1" ]; then
  PROBE="$(ssh -o ConnectTimeout=8 -o BatchMode=yes "$HOST" 'echo HEYTA_PROBE_OK' 2>"$WORK/ssh.err" | tr -d '\r\n')"
  if [ "$PROBE" != "HEYTA_PROBE_OK" ]; then
    die3 "Android 构建主机 $HOST 探不到（回显=[$PROBE] stderr=$(tr -d '\n' <"$WORK/ssh.err" | tr -d '\r')）；显式本机例外须把"本机执行"那一行留在读数里"
  fi
  say "BUILD_HOST=$HOST 可达（回显 ${PROBE}）"
fi

if [ "$DRY" = 1 ]; then
  # 🔴 "源码干净"这一格在发现残留时**不能照原样打印** —— 那是把"没写"读成"本来就是干净的"。
  if [ "$RESIDUE_FOUND" = 1 ]; then
    say "PREFLIGHTS=OK-WITH-RESIDUE（载体自证 / 源码**有本臂残留、dry 没清** / 设备窗口独占 / adb 有设备 / :$PORT 可达 / 构建主机可达）"
    say "DRY=1 ⇒ 没有改任何字节、没有装包、没有跑验证。⚠️ 但 $SRCREL 现在仍是变异内容，正式开臂时前置 1 会自动取回。"
  else
    say "PREFLIGHTS=OK（载体自证 / 源码干净 / 设备窗口独占 / adb 有设备 / :$PORT 可达 / 构建主机可达）"
    say "DRY=1 ⇒ 没有改任何字节、没有装包、没有跑验证。要取读数就去掉 --dry-run 并保证 ≥30 分钟独占。"
  fi
  exit 0
fi

cp "$SRC" "$PRISTINE"
md5 -q "$APK" >"$BASE_MD5" 2>/dev/null || : >"$BASE_MD5"

restore_src() {
  cp "$PRISTINE" "$SRC"
  if git diff --quiet -- "$SRC"; then say "SRC_RESTORED=clean"; else say "SRC_RESTORED=FAIL 手工核对 $SRC"; fi
  # 🔴 本地干净 **不等于**打包机干净：run-gradle 步骤 2 把"当时的工作树"整棵同步到 C:\src\heyta，
  #    所以变异内容已经上了那台共享机器，而 trap 只还原本地。17:24 实测：本地 0 行脏，
  #    远端同一文件 md5=ca70c6e9…（变异体），与 pristine 的 diff 恰好是那 1 行。
  #    下一趟别人的构建会把这发变异打进 APK，而它自己的 sha256 对账比的是"本地 vs 远端"——
  #    两边都是同一份错的时候就看不出问题（AGENTS §7 第 82 条那个形状）。所以这里必须真推回去并回读。
  if [ "${MUT_APPLIED:-0}" = 1 ]; then
    if scp -q -o ConnectTimeout=8 -o BatchMode=yes "$PRISTINE" "$HOST:$REMOTE_ROOT/$SRCREL"; then
      scp -q -o ConnectTimeout=8 -o BatchMode=yes "$HOST:$REMOTE_ROOT/$SRCREL" "$WORK/remote-recheck.ts" 2>/dev/null
      if [ -s "$WORK/remote-recheck.ts" ] && diff -q "$WORK/remote-recheck.ts" "$PRISTINE" >/dev/null; then
        say "REMOTE_RESTORED=ok $REMOTE_ROOT/$SRCREL md5=$(md5 -q "$WORK/remote-recheck.ts")"
      else
        say "REMOTE_RESIDUE=推回去了但回读没对上 —— 🔴 手工核对 $HOST:$REMOTE_ROOT/$SRCREL"
      fi
    else
      say "REMOTE_RESIDUE=推不回去（scp 退出非 0：主机不可达**或**远端路径不存在，两种都得手工核）—— 🔴 打包机上可能仍是变异内容"
    fi
  fi
}
trap restore_src EXIT

# ── 变异：只拿掉那一处修复（op 照发、墓碑不清）；锚点必须唯一命中 ──────────────────
node -e '
const fs = require("fs");
const p = process.argv[1];
const from = "        payload: { deletedAt: null },\n      });\n      return true;\n";
const to   = "        payload: {},\n      });\n      return true;\n";
const t = fs.readFileSync(p, "utf8");
const n = t.split(from).length - 1;
if (n !== 1) { console.error("MUTATION_ANCHOR_HITS=" + n); process.exit(1); }
fs.writeFileSync(p, t.replace(from, to));
' "$SRC" || die3 "变异锚点没有唯一命中（产品代码已漂，先重读 ${SRC}）"
MUT_APPLIED=1
say "MUT=note-restore-clears-tombstone removed"

say "=== 构建共享包 + APK（变异态） $(date +%H:%M:%S) ==="
pnpm --filter @heyta/app-host build >"$WORK/apphost.log" 2>&1 || die3 "app-host 构建失败，看 $WORK/apphost.log"
pnpm build:android >"$WORK/apk-mut.log" 2>&1 || die3 "APK 构建失败，看 $WORK/apk-mut.log（这一臂没有产物就等于没有读数）"

NEW_MD5="$(md5 -q "$APK" 2>/dev/null || echo none)"
[ "$NEW_MD5" != "$(cat "$BASE_MD5")" ] || die3 "APK 字节没变（${NEW_MD5}）⇒ 这一臂无效，不许把旧产物的红读成变异红"
say "APK_MUTATED=$NEW_MD5"

say "=== 重装（签名可能与在装包不匹配 ⇒ 先 uninstall，会清 app 数据） $(date +%H:%M:%S) ==="
adb -s "$DEV" uninstall com.heyta >/dev/null 2>&1
adb -s "$DEV" install -r -g "$APK" 2>&1 | tail -1 | sed 's/^/INSTALL=/'

say "=== 跑 verify:mobile-trash（变异态） $(date +%H:%M:%S) ==="
PORT="$PORT" bash scripts/verify-mobile-trash.sh >"$WORK/verify-mut.log" 2>&1
MUT_RC=$?
say "VERIFY_MUT_RC=$MUT_RC  log=$WORK/verify-mut.log"
grep -E '^ *(❌|FAIL|✗)' "$WORK/verify-mut.log" | head -20 | sed 's/^/  红> /'

# ── 收尾：必须把设备恢复成"装的是当前源码"，否则下一趟验的是变异体 ────────────────
say "=== 还原源码 + 重打 + 重装干净产物 $(date +%H:%M:%S) ==="
restore_src
trap - EXIT
pnpm --filter @heyta/app-host build >"$WORK/apphost-clean.log" 2>&1 || say "CLEAN_BUILD_RC=1（共享包）—— 手工复跑，别把变异体留在盘上"
pnpm build:android >"$WORK/apk-clean.log" 2>&1 || say "CLEAN_BUILD_RC=1（APK）—— 🔴 设备上可能还留着变异产物，必须手工重装后才算干净"
CLEAN_MD5="$(md5 -q "$APK" 2>/dev/null || echo none)"
[ "$CLEAN_MD5" != "$NEW_MD5" ] && say "APK_CLEAN=${CLEAN_MD5}（与变异体不同 ✅）" || say "APK_CLEAN=与变异体相同 ⇒ 🔴 干净构建没生效"
adb -s "$DEV" uninstall com.heyta >/dev/null 2>&1
adb -s "$DEV" install -r -g "$APK" 2>&1 | tail -1 | sed 's/^/REINSTALL=/'

say "预期红集：回收站列出→点恢复那一腿（脚本 step 5）+ 笔记本读到活着那一腿（step 7）"
say "读法：这两条红 + 其余腿绿 = 变异读数到手；一条都不红 = 那两条腿没有牙；全红 = 先怀疑臂而不是产品。"
if [ "$MUT_RC" -eq 0 ]; then
  say "ARM=SUSPECT 变异后仍全绿 ⇒ 这两条腿对这一处修复没有牙（不是产品坏了）"
  exit 1
fi
say "ARM=DONE"
exit 0
