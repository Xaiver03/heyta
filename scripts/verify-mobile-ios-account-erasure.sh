#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac

set -u
export PATH="/opt/homebrew/bin:$PATH"
export PORT="${PORT:-3100}"
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
# 🔴 **trap 必须排在 source 之后** —— `scripts/lib/mobile-e2e.sh:702` 自己有一条 `trap restore_ime EXIT`，
#    而 bash 的 EXIT 只有一个处理器 ⇒ 在 source **之前**设的那条会被**静默替换**。
#    现量：30 枚 source 这份 lib 的 rig 全在这个形状里，`scripts/` 下因此堆了 40 枚 `.snap.` 残留，
#    而 `check:script-snapshot` 按字面匹配（`:121`，窗口只到第 35 行）对它们全部报绿 ⇒ 洞登记为 G-trap-lie。
#    第一条字面是给那条门禁认的 needle；第二条才是生效的那条，它继续清 `$0`，并带走本趟的含明文落盘产物 ——
#    界面 dump 里有**访问令牌**（凭据面板把它印在输入框的值上），而这条验收证的正是「注销之后本机不留明文」，
#    装置自己更不许在 /tmp 留明文。挂在 EXIT 上而不是末尾 `rm` 一次：判红 / 环境无效那些早退路径也要删。
trap 'rm -f -- "$0"' EXIT
trap 'rm -f -- "$0" "${IDB_DUMP_FILE:-}" "${CLOSE_BODY:-}"' EXIT
#
# iOS 模拟器「注销账号 = 本机明文库真的销毁」验收（真模拟器 + 真服务端，零 mock）
# ==========================================================================
#
# 这一格补的是 E2 里**只有 iOS 才有的一份证据**：op-sqlite 的 **iOS 后端**收到
# `ACCOUNT_CLOSED` 信号之后，模拟器容器里那枚明文库是不是真的没了。Android 那一格
# （`verify-mobile-account-erasure.sh`）证的不是同一件事 —— 两个后端各有一份
# `removeDatabase` 实现，任何一端没证过都不许报成「移动端已证」（计划 §10.13）。
#
# ## 这条腿问什么、不问什么
#
# 🔴 **不问**「界面上点得到注销吗」—— 那是 E3 的移动端 UI 腿，判据在
#    `apps/mobile/tests/account-closure-entry.spec.ts` 与 Android 装置的第 5 步
#    （两端渲染同一份 `AccountClosureScreen`，平台差异不在那一屏）。
#    注销那一发在这里落在**服务端自己的端点**（`DELETE /api/account` ——
#    那个屏幕最终调的就是它），设备侧只看「下次同步收到 410 之后容器里还剩什么」。
#    ⇒ 走的是 `packages/sync-client` 的 `isAccountClosedFailure` → `eraseLocalData`
#      → 宿主销毁器 → `apps/mobile/src/db/op-sqlite-driver.ts` 的 `destroy()`。
#
# ## 判据（A/B 承重，D 是这一格的正证）
#
# | 号 | 判据 | 为什么要有它 |
#|---|---|---|
#| **A** | 注销**之前**容器里 `Library/heyta.sqlite` 在盘上，且 `ops` 数得出 ≥1 行 | 库本来就没有 ⇒「它消失了」恒真。这是全脚本唯一的前提证明 |
#| **B** | 换成语法合法、服务端不认的令牌（401 `TOKEN_INVALID`，**不是** 410）后同步，库**必须还在**，**并且 `ops` 行数必须还是判据 A 读到的那个数** | 🔴 承重的负向对照。「任何 401 都删库」= 改一次密码就毁掉所有设备的本地数据。🔴 **两腿都是必需的，这条是 Android 那侧的存活变异臂教的**（计划 §10.131）：同一条放宽装进真机 APK 后，只量「文件在不在」的 B **没有转红**，而它在 `packages/sync-client` 层内是 9 红 ⇒ 尺不对，不是产品没事。⚠️ **iOS 这一腿自己能不能红尚未实测**（Android 侧带它复跑中）；在此之前不许把这行写成"有牙" |
#| C | 之后设备下一次同步，界面上出现 `common.sync.error.accountClosed` 那句 | 证明客户端把它读成「账号已注销」而不是「重新登录」（`client.ts:925-945` 那段顺序判定）。只有 D 没有 C，「文件没了」可能来自任何别的原因 |
#| **D** | 容器 `Library/` 里以 **`heyta.sqlite`**（整串库名）为前缀的残留 **0 枚** | 这一格的正证本身。🔴 前缀只能是整串库名：同一目录实测还有一枚**不归 destroy 管**的 `heyta-device-prefs.sqlite`（计划 §10.68.6：5/5 枚模拟器都在）⇒ 按词干 `heyta` 数会把它算成残留，每趟假红。🔴 不写死 `-wal`/`-shm` 名单：op-sqlite 三个后端的 `opsqlite_remove` 各自只 unlink 一条路径，旁挂能不能消失由 SQLite 自己的收尾决定，数「前缀枚数」才挡得住 |
#| E | 再同步一次（令牌已死）之后残留仍是 0 | 销毁之后没有第二条写路径把它重建；也是幂等证明 |
#
# ## 变异靶（拿到窗口后随跑，两条都按「恰好红」判）
#
#   M1 摘掉 `onAccountClosed` 里的本机销毁回调 ⇒ **D 恰好转红**（C 仍绿：那句报错
#      来自同步结果分类，与清库成不成功无关 —— 这正是「C 不能替 D 作证」的原因）
#   M2 把「只有 ACCOUNT_CLOSED 才清库」放宽成「任何 401 都清库」 ⇒ **B 恰好转红**
#
# ## 界面腿的状态要说清楚
#
# 🔴 填写/滚动/收键盘这些动作走的是共享工具 `scripts/tools/ios-ax-shim.py`
#    （iOS AX 驱动的唯一实现；本脚本只是它的调用方，**没有第二份实现**）。
#    但**这一整套顺序在本装置上还没真机跑过** —— 首跑若红在填写步，先按
#    `found/visible/typedRc` 的读数判「是界面到不了还是产品坏了」，
#    不许直接写成产品缺陷（§7 元规则一）。
#
# 用法：IOS_UDID=<udid> PORT=3100 bash scripts/verify-mobile-ios-account-erasure.sh
#
# 前置（**都不由本装置创建**，与 verify-mobile-* 全族一致）：
#   · `IOS_UDID` 指向一台**已启动**的模拟器。不给就只允许「同名唯一」或「整机唯一」
#     两种自动选中，多台且无同名 ⇒ **不猜**（`verify-ios-lan-http.sh:74-107` 同一规则）——
#     猜中的那台可能正被另一条会话实时配置。
#   · 那台设备上**已装有** heyta。本装置**不装包**（装包属于 `reinstall:mobile` 那一层），
#     但第 0 步判它新不新。
#   · `PORT` 指向一个 TEST_MODE 服务端；`/tmp/heyta_mobile_{token,email,e2ee}.txt` 齐。
# 🔴 退出码：**0** 全绿 / **1** 判据红 / **3** 环境条件不成立（设备归属、产物不新鲜、
#    服务端不可达、别人的验收在跑、AX 工具接口漂移）—— 3 不是产品判决，别照着它改代码。

# 当场自检（判据，不是注释）：最后一行 trap 必须**排在 source 之后**且含 `$0`。两个方向都能红。
_last_trap_line=$(grep -nE '^trap .* EXIT$' "$0" | tail -1 | cut -d: -f1)
_last_trap_body=$(grep -E '^trap .* EXIT$' "$0" | tail -1)
# 🔴 用 POSIX 字符类而不是 `\s` —— BSD grep 的 ERE 对 `\s` 没有保证（这仓已经栽过 `\b` 那一次）。
_src_line=$(grep -nE '^[[:space:]]*\.[[:space:]]*".*lib/mobile-e2e\.sh"' "$0" | head -1 | cut -d: -f1)
if [ -z "$_src_line" ]; then
  echo "❌ 自检读不到 source lib 的那一行 ⇒ 先后关系没法判，本趟作废" >&2
  exit 1
fi
if [ -z "$_last_trap_line" ] || [ "$_last_trap_line" -le "$_src_line" ]; then
  echo "❌ 生效的 EXIT trap（第 ${_last_trap_line:-无} 行）排在 source lib（第 ${_src_line} 行）之前" >&2
  echo "   ⇒ lib 尾部的 trap 会整条替换它，快照与明文产物都不会被清" >&2
  exit 1
fi
case "$_last_trap_body" in
  *'"$0"'*) ;;
  *) echo "❌ 生效的 EXIT trap 不再清快照副本 —— 现量：${_last_trap_body}" >&2
     echo "   ⇒ 按字面匹配的门禁查不出来，本趟作废" >&2
     exit 1 ;;
esac

BID=${IOS_BID:-com.heyta}
DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
DB_NAME=heyta.sqlite
LIB_NAME=heyta-device-prefs.sqlite
STAMP=$(date +%H%M%S)
NOTE_A="ios-erase-${STAMP}"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
SHIM="$(cd "$(dirname "$0")" && pwd)/tools/ios-ax-shim.py"
LOAD1=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{} ')

# 🔴 设置面那一行的可点名是**标题 + 副标题拼起来**的（`ProfileScreen.tsx:612-614`
#    把 `mobile.profile.entry.settings` 与 `.settings.hint` 一起交给无障碍层）。
#    两个半边各自都是词条表的值；拼串本身不是 ⇒ 所以拼在这里，注释指回真源。
SETTINGS_ROW="设置, 同步凭据、桌面小组件与语言"

# ── 设备侧与容器侧的读法 ────────────────────────────────────────────────────
ax() { python3 "$SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json; }
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
ax_press() { ax "$1" --pressable --press --json >/dev/null 2>&1; }
dismiss_keyboard() { ax --dismiss-keyboard --json >/dev/null 2>&1 || true; }
ls_lib_dir() { ls -1 "${DATA_CONTAINER}/Library" 2>/dev/null | tr -d '\r'; }
db_present() { [ -f "${DATA_CONTAINER}/Library/${DB_NAME}" ]; }
db_ops_count() { sqlite3 "${DATA_CONTAINER}/Library/${DB_NAME}" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' '; }
# 🔴 计数前先 `sed 's#.*/##'` 剥路径：离线六臂量过它的方向（计划 §10.68.5）——
#    列表若回显**全路径**，前缀锚点直接读成 0 枚，也就是「库还在盘上」会被报成
#    「销毁成功」（假阴性 = 危险那一侧）。`ls -1` 今天给的是裸名，这道防线不是装饰。
# note_visible <原文>：在 AX 树里找这条便签文本 —— **先 NFKC 归一化，再比子串**。
#   10-05 09:0x 手探现量（`tmp/probe-notes-screen.sh`，同一份 dump）：两件事叠在一起，
#   所以 lib 的 `idb_has`（语义是"精确标签或值"）对这条读数**永远不会命中**：
#     ① 便签行的可及标签是**组合句**：界面上没有任何节点的 label/value 逐字等于正文，
#        只有「编辑便签「…」」「把便签「…」钉到今天」「删除便签「…」」三枚按钮；
#     ② iOS 把标签里的 ASCII 规范化成了**全角**：`ios-erase-090233` → `ｉｏｓ－ｅｒａｓｅ－０９０２３３`。
#        同一份 dump：原文 needle 命中 **0**，NFKC 之后命中 **3**。
#   ⇒ 归一化 + 子串是实测唯一可用的读法。命中时把标签**原样**打出来（失败行要打印量，§10.140）。
#   ⚠️ 量程：这条判据回答的是"界面上数得出这条便签"，不回答"它落库了"—— 后者由判据 A 的
#      `ops` 行数负责（两回事，别互相替）。
text_on_screen() {
  python3 - "$IDB_DUMP_FILE" "$1" <<'PY'
import json, sys, unicodedata
path, needle = sys.argv[1], unicodedata.normalize("NFKC", sys.argv[2])
try:
    nodes = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print("READ_FAIL %s" % e); sys.exit(2)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
hits = []
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        for k, v in n.items():
            if isinstance(v, str) and needle in unicodedata.normalize("NFKC", v):
                hits.append("%s=%s" % (k, v.strip()[:70]))
if hits:
    print("HIT %d" % len(hits))
    for h in hits[:3]:
        print("   ", h)
    sys.exit(0)
print("MISS"); sys.exit(1)
PY
}
note_visible() { text_on_screen "$1"; }

# screen_says <关键字…>：C 档失败时把界面上**真的写了什么**打出来（今天已经栽了三次
# "needle 与渲染形态不符"，所以这一档不再只报"没读到"）。
dump_screen_text() {
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as e:
    print("   （取不到树：%s）" % e); sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
keys = ("同步", "注销", "失败", "离线", "未配置", "登录", "错误")
seen = []
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        v = n.get("AXLabel") or n.get("label") or ""
        if isinstance(v, str) and v.strip():
            nv = unicodedata.normalize("NFKC", v)
            if any(k in nv for k in keys):
                seen.append(nv.strip()[:120])
seen = list(dict.fromkeys(seen))
print("   界面上与同步/注销有关的文本 %d 条：" % len(seen))
for v in seen[:12]:
    print("     ·", v)
PY
}

residue_count() { printf '%s\n' "$1" | sed 's#.*/##' | grep -c "^${DB_NAME}"; }

# 界面**签名**：树上所有非空可及名（NFKC、截 60 字）排序去重拼成一行。
# 为什么判据是"签名变了"而不是"看见 busy"：真机实测「正在同步…」在 12 个 1s 采样里
# **一次都没命中**（同步比采样快），而这一腿要回答的只是"这一下有没有被接住"。
# 🔴 10-05 10:2x 第二版：关键字版（只收 同步/正在/失败/注销/离线/最新）在**步骤 3** 上假红过 ——
#    那次同步无事可做、前后都是「已是最新」，唯一变的是「上次成功同步」旁边那枚**时间值**
#    （`10-05 09:46` → `10-05 10:16`），而它不含任何关键字。所以签名改成**整棵树的全部可及名**。
#    这一腿是**诊断腿**（它红了不代表产品坏了），宁可宽一点，也不要它恒红；
#    承重的判据不在这儿 —— 是步骤 5 的 `HTTP 401`、步骤 6 的 `已是最新`、步骤 8 的注销那句。
sync_signature() {
  idb_dump
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1]))
except Exception:
    print("TREE-UNREADABLE")
    raise SystemExit
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
seen = set()
for t in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(t):
        for key in ("AXLabel", "AXValue", "label", "value", "title"):
            v = n.get(key)
            if isinstance(v, str) and v.strip():
                seen.add(unicodedata.normalize("NFKC", v).strip()[:60])
                break
print(" | ".join(sorted(seen)))
PY
}

# 内容级取证（判据 D/E 的新腿）：每表行数 + 明文 needle 在**整个文件字节**里的命中
# + 空闲页 + 文件的 birth/mtime。为什么必须有它（10-05 10:0x 实测，计划 §10.142）：
# 注销那一秒销毁确实跑了（六张表 0 行、便签原文在 73 728 字节里 UTF-8 与 UTF-16LE 都 0 命中、
# freelist 0），但**这个文件的 birth 就是那一秒** ⇒ 它被删掉之后又被一次重开建回了空壳。
# 只看"heyta.sqlite 还在不在"分不出这两种结局，而它们的处置完全不同：
# 前者是"明文仍在"（产品缺陷），后者是"销毁后有复活路径"（登记缺口）。
# ⚠️ 明文检索走字节、不走 SQL：`DELETE FROM` 之后行读不到了，页里的字节还在（traps #171
#    那一族：Hermes/SQLite 里的中文可能是 UTF-16LE，按 UTF-8 grep 恒 0 命中会读成"干净"）。
db_forensics() {  # <库文件路径> <明文 needle>
  python3 - "$1" "$2" <<'PY'
import datetime, os, subprocess, sys
db, needle = sys.argv[1], sys.argv[2]
if not os.path.exists(db):
    print("文件不存在 ⇒ 容器已删（内容级取证无从谈起）")
    raise SystemExit
def q(sql):
    r = subprocess.run(["sqlite3", db, sql], capture_output=True, text=True)
    out = r.stdout.strip().replace("\n", ";")
    return out if out else ("ERR:" + r.stderr.strip()[:60])
tables = [t for t in q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").split(";") if t]
pairs = [(t, q('SELECT COUNT(*) FROM "%s";' % t)) for t in tables]
print("表与行数：" + " ".join("%s=%s" % p for p in pairs))
print("freelist=%s page_count=%s" % (q("PRAGMA freelist_count;"), q("PRAGMA page_count;")))
if needle:
    raw = open(db, "rb").read()
    print("明文 needle %r 命中：UTF-8=%d UTF-16LE=%d（文件 %d 字节）"
          % (needle, raw.count(needle.encode()), raw.count(needle.encode("utf-16-le")), len(raw)))
st = os.stat(db)
print("birth=%s mtime=%s birth_epoch=%d" % (
    datetime.datetime.fromtimestamp(st.st_birthtime).strftime("%m-%d %H:%M:%S"),
    datetime.datetime.fromtimestamp(st.st_mtime).strftime("%m-%d %H:%M:%S"),
    st.st_birthtime))
# 回给 shell 的三个数**必须分内容行与 meta 行**：`meta` 里那枚 `clientId` 不是用户内容，
# 而"销毁之后还有没有用户明文"与"销毁之后还有没有写路径"是两条不同的判据（10-05 10:1x
# 自测照出来的：设备现库 ops/state/archive 全 0、meta 恰好 1 行 ⇒ 合并计数会把"空壳被重建"
# 误报成"明文仍在"，而这两件事的处置完全不同）。
content = sum(int(v) for t, v in pairs if t != "meta" and v.isdigit())
meta_rows = sum(int(v) for t, v in pairs if t == "meta" and v.isdigit())
plain = 0
if needle:
    plain = raw.count(needle.encode()) + raw.count(needle.encode("utf-16-le"))
print("SUMMARY content_rows=%d meta_rows=%d plain=%d tables=%d" % (content, meta_rows, plain, len(tables)))
PY
}


dismiss_ios_save_password() {
  # 系统「保存密码？」弹窗**不在应用的 AX 树里**，而它会让整棵树只剩 AXApplication。
  # 配方来自兄弟 rig `scripts/verify-mobile-ios.sh` 的同名函数（那边 2026-09-29 第 37/42 轮
  # 实测出来的三条：① 先按标签试；② 守卫不许用页面标题当"没有弹窗"的证据；
  # ③ 坐标要按**当前 app frame** 推，不许写死 402×874 的那一组）。
  # 🔴 10-05 08:55 实测补的第四点：这弹窗是**延迟**出现的（填完 secure 框之后才弹），
  #    所以只在填写步调一次不够 —— 每个"等标签"的地方都要先摘它（见 sync_now）。
  local _l _r
  for _l in "以后" "Not Now" "Later" "以后再说"; do
    _r=$(ax "$_l" --pressable --list --json)
    if [ "$(jget "$_r" found)" = "True" ]; then
      ax "$_l" --pressable --press --json >/dev/null 2>&1
      sleep 1.5
      ok "已关掉 iOS「保存密码？」系统弹窗（标签命中「${_l}」）"
      return 0
    fi
  done
  # 先收软键盘再看树：键盘弹着时被盖住的底部标签也会从树上消失，会把**键盘态**
  # 误判成**弹窗态**，然后按一组坐标乱点（兄弟第 6 轮实测过这个误判）。
  dismiss_keyboard
  local t m
  t=$(jget "$(ax "任务" --list --json)" found)
  m=$(jget "$(ax "我的" --list --json)" found)
  if [ "$t" != "True" ] && [ "$m" != "True" ]; then
    echo "     底部两个标签都不在树上 ⇒ 按 iOS 系统弹窗态处理，按坐标点「以后」"
    # 坐标 = app frame × (31%, 61.5%)，比例来自截图量取（系统弹窗的布局不由我们的代码决定，
    # 只能按比例锚）；frame 取不到时退回 402×874 并**把这件事打出来**，不静默用默认值。
    local _fr _aw _ah _sx _sy
    _fr=$(ax - --list --json 2>/dev/null)
    _aw=$(jget "$_fr" width); _ah=$(jget "$_fr" height)
    case "${_aw}" in ''|*[!0-9]*) _aw=402; echo "     [dismiss] 取不到 app frame 宽，退回 402" ;; esac
    case "${_ah}" in ''|*[!0-9]*) _ah=874; echo "     [dismiss] 取不到 app frame 高，退回 874" ;; esac
    _sx=$(python3 -c "print(int(${_aw}*0.31))" 2>/dev/null || echo 125)
    _sy=$(python3 -c "print(int(${_ah}*0.615))" 2>/dev/null || echo 537)
    echo "     frame=${_aw}x${_ah} ⇒ 点 (${_sx},${_sy})"
    ax --tap "${_sx}" "${_sy}" --json >/dev/null 2>&1 || true
    sleep 2
    # 点完必须回读"树回来了没有"—— 点了不算，那是 §7 里"按下 ≠ 生效"的同一族。
    t=$(jget "$(ax "任务" --list --json)" found)
    m=$(jget "$(ax "我的" --list --json)" found)
    if [ "$t" = "True" ] || [ "$m" = "True" ]; then
      ok "已按坐标关掉 iOS「保存密码？」系统弹窗（回读：任务=${t} 我的=${m}）"
      return 0
    fi
    echo "     [dismiss] 点完仍读不到底部标签（任务=${t} 我的=${m}）⇒ 交给调用方判红"
  fi
  return 1
}

# ── 0. 现场与归属 ──────────────────────────────────────────────────────────
step "0. 现场与归属（设备 / 产物新鲜度 / 服务端 / 别人的验收 / AX 工具接口）"
UDID=${IOS_UDID:-}
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted -j 2>/dev/null | python3 -c "
import json, sys
want = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
booted = []
for _rt, devs in (data.get('devices') or {}).items():
    for d in devs:
        if d.get('state') == 'Booted':
            booted.append((d.get('name') or '', d.get('udid') or ''))
same = [u for n, u in booted if n == want]
if len(same) == 1:
    print(same[0])
elif len(booted) == 1:
    print(booted[0][1])
" "$DEVICE_NAME" 2>/dev/null)
  if [ -z "$UDID" ]; then
    echo "   ❌ 认不出该验收哪台模拟器（已启动 $(xcrun simctl list devices booted 2>/dev/null | grep -c Booted) 台，且无唯一同名「${DEVICE_NAME}」）—— 不猜。"
    echo "      显式指定：IOS_UDID=<udid> bash scripts/verify-mobile-ios-account-erasure.sh ⇒ exit 3（环境条件）"
    exit 3
  fi
fi
IDB_UDID="$UDID"
export IDB_BIN IDB_UDID

# 🔴 dump 落盘必须换成**本趟私有的路径**。lib 的默认值是一枚固定路径
#    （`scripts/lib/mobile-e2e.sh:1029` 的 `IDB_DUMP_FILE=${IDB_DUMP_FILE:-/tmp/_heyta-idb-dump.json}`），
#    两个理由都要挡：
#    ① 两条 iOS 线共用它时，后写的那趟会**覆盖前者的证据**而没人报红
#       （同一形状已经在 e2e 的截图 md5 上实测过一次：证据被别人重写、读数照常绿）；
#    ② 更要紧的：本装置全程要把**访问令牌**填进凭据面板，而 `describe-all` 会把输入框的
#       **值**一起抄进这份 dump ⇒ 探针自己在 /tmp 里造了一份本机明文。
#       这条验收证的就是「注销之后本机不留明文」，装置本身更不许留下明文。
#    删除挂在文件头那条 EXIT trap 上（早退也删），不只在末尾删一次。
IDB_DUMP_FILE=/tmp/_heyta-idb-dump-erase-$STAMP.json
export IDB_DUMP_FILE

OTHER=$(another_mobile_e2e_running)
if [ -n "$OTHER" ]; then
  echo "   ❌ 有别的移动端验收正在跑（并行 = 互相拆现场 / 抢同一台设备）："
  printf '%s\n' "$OTHER" | sed 's/^/      /'
  echo "      这是环境条件，不是产品失败 ⇒ exit 3"
  exit 3
fi

APP_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if [ -z "$APP_CONTAINER" ] || [ ! -d "$APP_CONTAINER" ]; then
  echo "   ❌ 这台设备上没有已装的 ${BID}（本装置不装包 —— 装包是 reinstall:mobile 那一层的动作）⇒ exit 3"
  exit 3
fi
# 🔴 新鲜度：装着的产物比源码旧 ⇒ **这一格不成立**（traps #178 同一形状）——
#    验出来的销毁行为属于上一次构建，不属于当前这批代码。拒绝跑，而不是跑完再解释。
BUNDLE_JS="${APP_CONTAINER}/main.jsbundle"
APP_MTIME=$(stat -f %m "$APP_CONTAINER" 2>/dev/null || echo 0)
JS_MTIME=$(stat -f %m "$BUNDLE_JS" 2>/dev/null || echo 0)
# 🔴 扫描面必须含**销毁编排真正住在那儿的那几个包**：这条判据量的是
#    `packages/sync-client/src/client.ts` 的 `eraseLocalData` 与 `packages/app-host/src/local-erasure.ts`
#    的注册表，原先只扫 apps/mobile/src + packages/ui/src ⇒ 改了销毁器而 bundle 没重打时，
#    这一格会拿旧 bundle 报"销毁成立/不成立"而门全程绿灯（Android 侧 `lib/apk-freshness.sh:36`
#    漏的是同一批包，两边各自现量过一次）。
#    用数组而不是单个空格分隔串：仓库根含空格（"All in one Data"），词分割会把路径切断，
#    那时 find 失败 ⇒ 下面按"取不到源码 mtime"响亮 exit 3，不会假装新鲜。
SRC_DIRS=(
  "$HEYTA_REPO_ROOT/apps/mobile/src"
  "$HEYTA_REPO_ROOT/packages/ui/src"
  "$HEYTA_REPO_ROOT/packages/sync-client/src"
  "$HEYTA_REPO_ROOT/packages/app-host/src"
  "$HEYTA_REPO_ROOT/packages/storage/src"
  "$HEYTA_REPO_ROOT/packages/op-log/src"
  "$HEYTA_REPO_ROOT/packages/i18n/src"
  "$HEYTA_REPO_ROOT/packages/domain/src"
)
NEWEST_SRC_LINE=$(find "${SRC_DIRS[@]}" \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
  | xargs -0 stat -f '%m %N' 2>/dev/null | sort -rn | head -1)
SRC_MTIME=${NEWEST_SRC_LINE%% *}
NEWEST_SRC=${NEWEST_SRC_LINE#* }
NEWEST=$(( APP_MTIME > JS_MTIME ? APP_MTIME : JS_MTIME ))
echo "   设备: ${DEVICE_NAME} (${UDID})"
echo "   已装产物: ${BID}  app=${APP_MTIME} main.jsbundle=${JS_MTIME}   源码最新 mtime=${SRC_MTIME:-未取到}"
echo "   源码最新那枚（取证，归属靠它）: ${NEWEST_SRC:-未取到}"
echo "   扫的目录数: ${#SRC_DIRS[@]}（含 sync-client / app-host / storage / op-log / i18n / domain）"
echo "   容器 data: ${DATA_CONTAINER:-（尚未生成，首启后才有）}"
echo "   负载(记录值): ${LOAD1:-未取到}   服务端: $HOST_SERVER"
if [ -z "$SRC_MTIME" ]; then
  echo "   ❌ 取不到源码 mtime（find/xargs 在这台机器上没跑通）⇒ 无法判新鲜度，本趟不作数。exit 3"
  exit 3
fi
if [ "$NEWEST" -lt "$SRC_MTIME" ]; then
  echo "   ❌ 设备上装的是旧产物（bundle 比源码旧）⇒ 量的不是当前代码。先 pnpm reinstall:mobile。exit 3"
  exit 3
fi

# 🔴 这一发 2026-10-04 改过形状，两处都不是装饰：
#    ① `--noproxy '*'`：这台机器的代理配置是"关掉但留着 127.0.0.1:7890"
#       （`networksetup -getwebproxy Wi-Fi` 现量 Enabled: No）。curl 只在 `no_proxy`
#       环境变量里点名了主机才绕开代理，而 `127.0.0.1` **不在**默认豁免里 ⇒ 代理一开，
#       这一发会拿到代理回的 200 而不是服务端的 ⇒ "服务端就绪"假绿，后面 create-user 才炸，
#       而那里是产品形状的红灯。与 verify-mobile-trash.sh / verify-mobile-account-erasure.sh 同一条纪律。
#    ② 判 body 不判 2xx：现量服务端 `/health` 回 `{"status":"ok","db":"connected","wsConnections":0}`，
#       而 `/api/health` 回 **404**（`{"message":"Route GET:/api/health not found"}`）——
#       原来的 `curl -sf` 只要求 2xx，任何一份回 200 HTML 的东西都算"就绪"。
#       保留 `/api/health` 那一腿是因为它是挂载路径的兜底，但同样要求 body。
HEALTH_BODY=$(curl -s --noproxy '*' -m 5 "$HOST_SERVER/health" 2>/dev/null)
if printf '%s' "$HEALTH_BODY" | grep -q '"status":"ok"'; then
  ok "服务端在 $HOST_SERVER 可达（/health: ${HEALTH_BODY:0:60}）"
elif curl -s --noproxy '*' -m 5 "$HOST_SERVER/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
  ok "服务端在 $HOST_SERVER 可达（经 /api/health）"
else
  echo "   ❌ 服务端不可达 —— 注销信号送不到设备，B/C/D 全部无从判起 ⇒ exit 3"
  echo "   现量：${HOST_SERVER}/health 返回「${HEALTH_BODY:-空}」"
  echo "   这不是产品失败：这一格证的正是「账号已注销」这个信号有没有送到，服务端不在场时信号根本发不出来。"
  exit 3
fi
SRV_PID=$(lsof -ti "tcp:${E2E_PORT}" -sTCP:LISTEN 2>/dev/null | head -1)
SRV_CMD=$(ps -o command= -p "${SRV_PID:-0}" 2>/dev/null | cut -c1-90)
echo "   服务端归属: pid=${SRV_PID:-未识别} HEAD=$(git -C "$HEYTA_REPO_ROOT" rev-parse --short HEAD 2>/dev/null) dist=$(stat -f '%Sm' "$HEYTA_REPO_ROOT/server/dist/src/index.js" 2>/dev/null || echo 缺)"
echo "   服务端命令行: ${SRV_CMD:-未取到}"

if ! resolve_idb; then
  echo "   ❌ 找不到 idb —— iOS 验收要从设备内部驱动界面 ⇒ exit 3"
  exit 3
fi
ensure_idb_companion || { echo "   ❌ idb companion 起不来 ⇒ exit 3"; exit 3; }
# 🔴 本装置依赖共享 iOS AX 工具的三个动作。那份工具正被另一条线改 ——
#    接口漂了，本装置会一路红在填写步，而症状长得像「产品界面坏了」。
#    所以开局机器可读地确认这三个旗标还在，缺任一个判**环境无效**（exit 3）。
SHIM_HELP=$(python3 "$SHIM" --help 2>&1 || true)
SHIM_MISSING=""
for _flag in --dismiss-keyboard --type-text --scroll-into-view; do
  printf '%s\n' "$SHIM_HELP" | grep -q -- "$_flag" || SHIM_MISSING="${SHIM_MISSING} ${_flag}"
done
if [ -n "$SHIM_MISSING" ]; then
  echo "   ❌ ios-ax-shim 不再接受：${SHIM_MISSING# } ⇒ 装置与工具接口漂移，本趟不判产品。exit 3"
  exit 3
fi
ok "iOS AX 工具接口在位（--dismiss-keyboard / --type-text / --scroll-into-view）"

# ── 1. 起 App 到主界面 ─────────────────────────────────────────────────────
step "1. 全新态起 App，并处置首启两屏（隐私同意面板 / 欢迎页）"
# 🔴 这一档**原来是恒红的**：它只有 `simctl uninstall` + `simctl launch` —— 卸载之后那个
#    bundle id 在这台设备上已经不存在，`launch` 必然失败 ⇒ 症状长得像"装出来的 App 起不来"，
#    而真因是装置自己把载体删了没装回来（第一次跑就会死在这里，且没有任何一层会指出这点）。
#    "全新态"要靠**卸掉再装回来**，不是卸掉就完。
# 源产物：优先用调用方给的 `IOS_APP_SRC`（驱动/重装层知道 .app 打在哪），没有就把设备上那份先捞出来。
#    ⚠️ 用 `cp -Rp` 而不是 `cp -R`：保留 mtime 才让上面那条新鲜度判据仍然是**同一条**判据
#    （`cp -R` 会把 bundle 的时间推成"现在"，那条判据就变成永远不会红的装饰）。
find /tmp -maxdepth 1 -name 'heyta-ios-erasure-app-*.app' -mmin +240 -exec rm -rf {} + 2>/dev/null || true
APP_SRC="${IOS_APP_SRC:-}"
if [ -z "$APP_SRC" ]; then
  APP_ON_DEVICE=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)
  if [ -z "$APP_ON_DEVICE" ]; then
    echo "   ❌ 这台设备上没有 ${BID}，也没给 IOS_APP_SRC ⇒ 没有产物可装。"
    echo "      装当前产物是 reinstall 层的动作：IOS_DEVICE_NAME=\"<这台的名字>\" bash scripts/reinstall-all.sh --only ios"
    echo "      ⇒ 环境无效（3），不判产品"
    exit 3
  fi
  APP_SRC="/tmp/heyta-ios-erasure-app-$$.app"
  rm -rf "$APP_SRC"
  cp -Rp "$APP_ON_DEVICE" "$APP_SRC" || { echo "   ❌ 捞产物失败（${APP_ON_DEVICE} → ${APP_SRC}）⇒ 环境无效（3）"; exit 3; }
  echo "   产物已先捞出来（保留 mtime）：$APP_SRC"
fi
[ -d "$APP_SRC" ] || { echo "   ❌ IOS_APP_SRC 指向的目录不存在：${APP_SRC} ⇒ 环境无效（3）"; exit 3; }
xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1
if ! xcrun simctl install "$UDID" "$APP_SRC" 2>/dev/null; then
  echo "   ❌ 装回失败（${APP_SRC} @ ${UDID}）⇒ 这一格的前提（设备上有一份全新安装的当前产物）没成立。"
  echo "      这是装置/环境，不是产品：exit 3"
  exit 3
fi
echo "   已卸旧装新（全新态；装回的是同一份当前产物，mtime 未变）"
[ -d "$APP_SRC" ] && case "$APP_SRC" in
  /tmp/heyta-ios-erasure-app-*) rm -rf "$APP_SRC" ;;
esac
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 \
  || { bad "App 起不来（${BID} @ ${UDID}）"; summary "iOS 注销销毁" "" 1; }
sleep 8
# 🔴 用 `idb_has` 判存在与否要看**退出码**（0=在树上），它什么都不打印。
#    把它当"读回字符串再比 0/1"会让每一屏都被读成「不在」—— 静默跳过 = 这条处置是装饰。
for _screen in "同意并联网" "先离线使用"; do
  idb_dump
  if idb_has "$_screen"; then
    XY=$(idb_label_center "$_screen" 2>/dev/null)
    if [ -z "$XY" ]; then
      bad "「${_screen}」在树上但取不到坐标（角色不是可点节点？）"
      xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-0-screen-stuck.png" >/dev/null 2>&1
      summary "iOS 注销销毁" "" 1
    fi
    idb_ui tap $XY >/dev/null 2>&1
    sleep 3
    echo "     已点「${_screen}」@ ${XY}"
  else
    echo "     首启没有「${_screen}」这一屏"
  fi
done
dismiss_ios_save_password
idb_dump
if idb_has "任务"; then
  ok "已到主界面（底部标签「任务」在树上）"
else
  bad "处置完首启两屏后仍读不到「任务」标签 —— 界面没到主屏，后面的填写都不可信"
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-0-not-on-main.png" >/dev/null 2>&1
  summary "iOS 注销销毁" "" 1
fi

# ── 2. 建号 + 填凭据 ───────────────────────────────────────────────────────
step "2. 建一个已知口令的新账号，把凭据填进设备的设置面"
# 🔴 覆盖的是 `HEYTA_E2E_SERVER` 而不是 `SERVER`：helper 里那句
#    `HEYTA_E2E_SERVER="${SERVER:-…}"` 在 **source 时**就展开定死了（那时是 10.0.2.2），
#    调用点再改 SERVER 不会重新求值 —— 建号会静默打到 Android 模拟器那个地址上。
if HEYTA_E2E_SERVER="$HOST_SERVER" heyta_e2e_fresh_account; then
  TOKEN=$(cat /tmp/heyta_mobile_token.txt)
  EMAIL=$(cat /tmp/heyta_mobile_email.txt)
  E2EE=$(cat /tmp/heyta_mobile_e2ee.txt)
  ok "新账号就位：$EMAIL"
else
  echo "   ❌ 建不了新号（服务端没开 TEST_MODE？）—— 沿用旧凭据会把销毁判据打在别人的历史上 ⇒ exit 3"
  exit 3
fi
# 🔴 坏令牌**必须是结构合法的 JWT、只有签名是错的** —— 这一条是照着兄弟 rig 抄的
#    （`scripts/verify-mobile-account-erasure.sh:499-510`，那边把理由和实测都写下来了）。
#    本仓库今天（10-05 10:2x）为没先读它又付了一次代价：旧那枚 `eyJ….0000….sub-not-real`
#    的 payload 不是合法 JSON，服务端在**验签之前**就 JSON.parse 炸出 SyntaxError ⇒
#    真机日志里是 `Request failed 500 GET /api/sync/ops`，而判据 B 想测的是
#    **401 + `TOKEN_INVALID`** 那条路径。修那枚 500 的提交是 `f9152fbf`，
#    而这台载体（`heyta-wt-trash-e2e`，服务端 HEAD=ad61621a）**不含它** ——
#    也就是说：拿"坏形状"当坏令牌，判据的成立与否会**取决于服务端的构建新旧**，
#    那是判据不该有的性质。换签名不换结构 ⇒ 新旧服务端都回 401。
BAD_SIG=$(python3 -c 'import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("="))')
BAD_TOKEN="${TOKEN%.*}.$BAD_SIG"
# 前提证明（服务端的**那一半**，与下面步骤 5 的设备那一半各证一段）：
# 直接问一次，先确认这枚令牌在这台服务端上确实回 401 + TOKEN_INVALID。
# 没有这一腿，步骤 5 那句"界面上没有 HTTP 401"会同时兼容"令牌没换上""设备没请求"
# "服务端回的是 500"三种完全不同的病。
SRV_PRE=$(curl -s -o /tmp/heyta-ios-badsig-body.txt -w '%{http_code}' \
  -H "Authorization: Bearer $BAD_TOKEN" "$HOST_SERVER/api/sync/status")
SRV_PRE_BODY=$(head -c 160 /tmp/heyta-ios-badsig-body.txt 2>/dev/null)
if [ "$SRV_PRE" = "401" ] && grep -q 'TOKEN_INVALID' /tmp/heyta-ios-badsig-body.txt; then
  ok "前提（服务端那一半）成立：这台坏签名令牌在这台服务端上回 401 + TOKEN_INVALID（不是 500、不是 410）"
else
  bad "前提（服务端那一半）不成立：回的是 HTTP=${SRV_PRE:-取不到} body=${SRV_PRE_BODY:-空}
      ⇒ 判据 B 在这台服务端上量不到它想量的那条路径，本趟 B 不作数（先修令牌形状或服务端构建）"
fi

open_settings_sheet() {  # 打开设置面并等「服务器地址」输入框进树
  dismiss_keyboard
  ax "我的" --pressable --scroll-into-view >/dev/null 2>&1
  ax_press "我的"; sleep 3
  local r
  r=$(ax "$SETTINGS_ROW" --pressable --scroll-into-view)
  if [ "$(jget "$r" visible)" != "True" ]; then
    bad "「设置」入口滚不进可见区（found=$(jget "$r" found) scrollRc=$(jget "$r" scrollRc)）—— 兜底路径无法继续"
    return 1
  fi
  ax "$SETTINGS_ROW" --pressable --press --json >/dev/null 2>&1
  sleep 2.5
  local i
  for i in $(seq 1 12); do
    [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ] && return 0
    sleep 1
  done
  bad "设置面没打开（12 秒内「服务器地址」输入框不在树上）—— 判据不能建在没打开的面上"
  return 1
}

# cpcount：按**码点**数，不按字节。
#   实测（10-05 08:4x，本 rig 首跑）：secure 框三档回读恒为 60 而期望 20 ⇒ 判据恒红。
#   根因不在设备上：iOS 安全框的掩码是**每个字符一枚 3 字节圆点**，而这一趟是在
#   `LANG` 与 `LC_ALL` 都为空的环境里跑的，bash 3.2 的 `${#var}` 那种写法在
#   非 UTF-8 locale 下数的是**字节** ⇒ 20 位口令读成 60（`printf '\xe2\x97\x8f'` × 20
#   在同一环境里 `${#}`=60 而 `python3 len()`=20，两边现量）。
#   ⇒ 掩码这一档唯一稳的读数是码点数；字节数只作为诊断值一起打出来。
#   🔴 这条与「探针跟着环境说话」同族：同一句判据在带 UTF-8 locale 的终端里是绿的，
#      在剥了 locale 的后台任务里就恒红 —— 所以计数不能交给 shell 的隐式 locale。
cpcount() { python3 -c 'import sys;print(len(sys.argv[1]))' "$1"; }

fill_field() {  # <标签> <值> [secure]
  local lbl="$1" val="$2" kind="${3:-}" out back attempt=1 vl bl
  while [ "$attempt" -le 3 ]; do
    dismiss_keyboard
    if [ "$kind" = "secure" ]; then
      out=$(ax "$lbl" --role AXTextField --type-text "$val")
      back=$(jget "$out" detail)
      # secure 框回读是**掩码**：码点数等于原文才叫「进去了」（多了 = 上一次的残留 = 追加）。
      # 🔴 掩码不能逐字比，但也**不能因为不能比就跳过** —— 码点数是实测唯一可用的读数
      #    （字节数不行，理由见上面 cpcount 那段：非 UTF-8 locale 下会 3 倍虚增）。
      vl=$(cpcount "$val"); bl=$(cpcount "$back")
      if [ "$(jget "$out" typedRc)" = "0" ] && [ "$bl" = "$vl" ] && [ -n "$back" ]; then
        ok "已填「${lbl}」（secure：聚焦+键盘输入，掩码码点 ${bl} = 原文码点 ${vl}）"
        return 0
      fi
      note="typedRc=$(jget "$out" typedRc) 掩码码点=${bl}（期望 ${vl}；字节 ${#back}）"
    else
      # 🔴 普通框走 `--set`（set-value 是**替换**），不许走 `--type-text`：
      #    10-05 08:3x 首跑实测 —— 新 UI 把「服务器地址」**预填成产品默认值**
      #    （`apps/mobile/src/sync/config.ts:125` = `http://10.0.2.2:3000`，正好 20 字符），
      #    而键盘输入是**追加**：回读 41 = 20+21，重试再 62、83（每档 +21）⇒ 逐字比永远不中，
      #    症状长得像"界面写不进去"。这个形状兄弟 rig `verify-mobile-ios.sh` 的 `set_field`
      #    早就踩过并写下了 —— 这里是把它的配方搬过来，不是再造一遍。
      #    判据仍然按"回读逐字相同"，**不按 rc**（兄弟实测：`set-value` rc=0 而回读为空）。
      out=$(ax "$lbl" --role AXTextField --set "$val")
      back=$(jget "$out" detail)
      if [ "$back" = "$val" ]; then
        ok "已填「${lbl}」（set-value 替换，回读逐字相同）"
        return 0
      fi
      note="setRc=$(jget "$out" setRc) 回读长度=${#back}（期望 ${#val}）$(jget "$out" setErr)"
    fi
    echo "     [fill] 「${lbl}」第 ${attempt} 次没成：${note}"
    attempt=$((attempt + 1))
    sleep 0.8
  done
  bad "「${lbl}」三次都没能写进去（${kind:-text}）"
  return 1
}

close_settings_sheet() {
  local i
  for i in $(seq 1 6); do
    [ "$(jget "$(ax "关闭" --list --json)" found)" != "True" ] && { ok "设置面已关（第 ${i} 次检查）"; return 0; }
    ax_press "关闭"
    sleep 2
  done
  bad "设置面关不上（点了 6 次「关闭」它还在）—— 下一轮起点会脏"
}

fill_three_credentials() {  # <令牌>
  open_settings_sheet || return 1
  # 顺序：服务器地址 → 口令 → 令牌。`configured` 只看地址+令牌，
  # 最后写令牌意味着中途被打断不会留下「半配置」的歧义态。
  fill_field "服务器地址" "$HOST_SERVER" || return 1
  fill_field "端到端加密口令" "$E2EE" secure || return 1
  fill_field "访问令牌" "$1" || return 1
  dismiss_ios_save_password
  # 终态断言：三个字段**同时**还在 —— 「后一步把前一步清空」是实测踩过的形状，
  # 逐字段各自的局部断言抓不住它。
  local miss=""
  [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 服务器地址"
  [ "$(jget "$(ax "访问令牌" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 访问令牌"
  [ "$(jget "$(ax "端到端加密口令" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 端到端加密口令"
  if [ -n "$miss" ]; then bad "填完之后这些字段反而不在了：${miss# }"; return 1; fi
  ok "三个凭据字段同时就位"
  if [ "$(jget "$(ax "填好服务器地址与访问令牌后才能同步。" --list --json)" found)" = "True" ]; then
    bad "界面仍认为未配置（填进去的没生效）"
    return 1
  fi
  close_settings_sheet
}

sync_now() {  # 点「立即同步」：忙时它会改名叫「正在同步…」，所以先等它回到空闲名
  dismiss_keyboard
  ax "我的" --pressable --press --json >/dev/null 2>&1
  sleep 3
  # 🔴 10-05 08:55 实测：「保存密码？」是**填完 secure 框之后**才弹的，
  #    所以填写步里那次 dismiss 挡不住它 —— 弹窗立着时**底部两个标签都不在树上**
  #    （`dismiss_ios_save_password` 就靠这条判"这是系统弹窗态"，摘完回读 任务/我的 又都在）。
  #    ⚠️ 这一腿的证据是**日志那三行**，不是某张截图：09:00:54 存下的那张
  #    `apps/mobile/evidence/ios-account-erasure-2-no-composer.png` 拍的是**摘掉弹窗之后**，
  #    画面是任务页空态 + FAB，里面没有弹窗（10-05 11:0x 逐张回看时发现自己此前把这张图
  #    描述成了"按钮在弹窗底下被盖着"，那是错的 ⇒ 计划 §10.141 ⑤ 已原地撤回那句）。
  #    超时**不直接判红**：先摘弹窗、再等一轮，两条都没等到才 bad（并把两轮的读数都打出来）。
  if ! idb_wait_label "立即同步" 90; then
    echo "     第一轮没等到 ⇒ 先按系统弹窗处置一遍再等第二轮"
    dismiss_ios_save_password || true
    # 🔴 摘掉弹窗之后**必须重新导航**（10-05 11:0x 对着 08:57 那一趟的日志 + 那张截图复核出来的）：
    #    上面那一下 `ax "我的" --press` 是在弹窗立着的时候发的，它没落地 —— 那一趟摘完弹窗的
    #    回读是「任务=True 我的=True」（两个标签回到树上），而截图显示界面停在**任务页**。
    #    所以第二轮若就这么等，等的是"任务页上永远不会出现的标签" ⇒ 必然再空转 90 秒，
    #    最后判一条长得像"同步没被触发"的红（真因是探针停在错的页上）。
    ax "我的" --pressable --press --json >/dev/null 2>&1
    sleep 3
    if idb_wait_label "立即同步" 90; then
      echo "     第二轮等到 ⇒ 弹窗腿成立（第一轮那一下确实是被系统弹窗吃掉的）"
    else
      bad "90+90 秒内（第二轮前摘过一次系统弹窗、并重按过一次「我的」）仍没等到「立即同步」—— 这一次同步没被触发，后面的读数不作数"
      return 1
    fi
  fi
  # 🔴 按之前必须先把状态块**从导航栏底下让出来**（10-05 10:0x 手探 `tmp/probe-sync-press3.sh`）：
  #    步骤 3 为了点便签输入框把这一页滚到了底部，于是「立即同步」落在 y=72..116，
  #    而导航栏（标题「我的」y=80..100）**正盖在它上面**。shim 的 press 是按坐标 tap
  #    （它文件头写的"键盘遮挡"就是同一族事故），tap 打在导航栏上照样回 result=success，
  #    而服务端**一条请求都收不到** —— 判据 C 连红 40 个采样窗，症状长得像
  #    "移动端不渲染注销那句"，而那句其实一直会渲染（同一枚假服务端实测：y=410 处
  #    出现了逐字相同的「这个账号已经注销，无法再次登录，同步已停止」）。
  #    `--scroll-into-view "账号"`（页面首行；整块在折叠线上方时 shim 会真的向下拖）
  #    把状态块让到 y≈552，实测让位之后那一发请求就到了服务端。
  ax "账号" --scroll-into-view --list --json >/dev/null 2>&1
  SIG0=$(sync_signature)
  ax_press "立即同步"
  ACKED=0
  for _ in $(seq 1 12); do
    sleep 1
    [ "$(sync_signature)" != "$SIG0" ] && { ACKED=1; break; }
  done
  if [ -z "${SIG0// /}" ]; then
    # 这一条**是真门**：签名空 = 连"上次成功同步/失败原因"那一块都不在树上 ⇒ 根本不在状态面，
    # 后面每一步的读数都没有承载面。它与"按了没变化"是两件事，不能混在一起判。
    bad "按下「立即同步」之前界面签名是**空的** ⇒ 不在同步状态面上，这一步之后所有读数都不作数"
    return 1
  fi
  if [ "$ACKED" = "0" ]; then
    # 🔴 这一档 10-05 10:16 那趟从 `bad` 降成诊断腿（当时它在步骤 3 与步骤 10 各假红一次）：
    #    "签名一字未变"在产品**按设计**不产生第二次可见变化时是正常读数 ——
    #    · 无东西可同步 ⇒ 只有时间戳动（甚至不动）；
    #    · 再点一次而同一个 401/410 失败 ⇒ 那行字一模一样。
    #    承重证据因此一律放在**各步自己的前提腿**里（步骤 5 读 `HTTP 401`、步骤 6 读 `已是最新`、
    #    步骤 8 读注销那句、步骤 10 改冷启动 + birth 对账），这里只报"这一发有没有让界面动过"。
    echo "     ACK=unchanged（诊断腿，不判红；签名前 160 字：${SIG0:0:160}）"
  else
    echo "     ACK=changed"
  fi
}

fill_three_credentials "$TOKEN" \
  || { xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-1-credential-fill.png" >/dev/null 2>&1; summary "iOS 注销销毁" "" 1; }

# ── 3. 造一条本机数据，让"销毁"有东西可销 ──────────────────────────────────
step "3. 界面上建一条便签（让库里真的有用户字节）"
sync_now
sleep 8
# 🔴 便签输入框住在**「我的」这一页**，不在「任务」页：Android 那侧同一个动作是
#    `verify-mobile-notes.sh:299-303`（点「我的」→ `scroll_to_desc "写点什么…"`）。
#    10-05 09:00 实测：这里原先点的是「任务」⇒ 整页没有便签输入框，
#    症状长得像"界面写不进去 / 探针坏了"，实际是**走错了页**。
#    `sync_now` 结束时人已经在「我的」（它就是从那页按的「立即同步」），所以这里
#    只要把页面**滚到**那个框，不要再换页。
dismiss_ios_save_password || true
ax "写点什么…" --scroll-into-view --list --json >/dev/null 2>&1
sleep 2
idb_dump
XY=$(idb_field_center "写点什么…" 2>/dev/null)
if [ -z "$XY" ]; then
  bad "找不到便签输入框「写点什么…」—— 没有本机数据时判据 A 只能退化成「库文件在」，这一格不构成销毁证明"
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-2-no-composer.png" >/dev/null 2>&1
  summary "iOS 注销销毁" "" 1
fi
idb_type_into "写点什么…" "$NOTE_A" || bad "便签文本没输进去"
# 🔴 输入之后**软键盘立着**，而「添加便签」就在它底下（09:13 截图实测：便签段只露出半行，
#    按钮整块被键盘盖住）。原先这一行是裸的 `idb_ui tap $XY` —— 坐标是从树上取的**对的**，
#    但那一下落在键盘上，而 idb 回的是"成功"。
#    共享 shim 专门为这件事写过一道判据（`scripts/tools/ios-ax-shim.py:252-270`：
#    目标被键盘盖住时报 `tap-blocked-by-keyboard`，**绝不报 success**，
#    起因是另一次"点了没生效却被读成 success"把排查整片带偏）。
#    ⇒ 绕过 shim 就是绕过它已经付过学费的那层保护。这里改回走 shim 的 press，
#      并且**读它回的结构**：被挡就先收键盘重试一次，仍不 success 就响亮判红。
XY=$(idb_label_center "添加便签" 2>/dev/null)
if [ -z "$XY" ]; then
  bad "找不到「添加便签」按钮"
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-2c-no-submit.png" >/dev/null 2>&1
  summary "iOS 注销销毁" "" 1
fi
dismiss_keyboard
sleep 1
NOTE_PRESS=$(ax "添加便签" --pressable --press --json)
if printf '%s' "$NOTE_PRESS" | grep -q 'tap-blocked-by-keyboard'; then
  echo "     [note] 第一次按被软键盘挡住 ⇒ 再收一次键盘后重试"
  dismiss_keyboard; sleep 1
  NOTE_PRESS=$(ax "添加便签" --pressable --press --json)
fi
NOTE_RC=$(jget "$NOTE_PRESS" result)
if [ "$NOTE_RC" != "success" ]; then
  bad "按下「添加便签」没生效：result=${NOTE_RC} found=$(jget "$NOTE_PRESS" found)（不是坐标问题就是树变了，读数原样打在这里）"
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-2d-press-failed.png" >/dev/null 2>&1
  summary "iOS 注销销毁" "" 1
fi
echo "     已按「添加便签」（result=${NOTE_RC}，坐标 ${XY} 只作存在性证据，点这一下走的是 AX press）"
sleep 4
idb_dump
if NOTE_HIT=$(note_visible "$NOTE_A"); then
  ok "便签已建出：${NOTE_A}（树上命中 $(printf '%s' "$NOTE_HIT" | head -1 | awk '{print $2}') 枚节点）"
  printf '%s\n' "$NOTE_HIT" | sed 's/^/     /'
else
  bad "便签没出现在界面上（读数：'$(printf '%s' "${NOTE_HIT:-}" | head -1)'，写这一步没走通，A 之后数到的会是一只空库）"
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-2b-no-note-row.png" >/dev/null 2>&1
  summary "iOS 注销销毁" "" 1
fi

step "4. 判据 A：注销**之前**本机库必须在盘上、且有 op 行（前提证明，不是过场）"
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if ! db_present; then
  bad "容器里没有 Library/${DB_NAME} —— 后面「它消失了」将恒真，本趟作废"
  summary "iOS 注销销毁" "" 1
fi
OPS_N=$(db_ops_count)
case "$OPS_N" in
  ''|*[!0-9]*) bad "读不到 ops 计数（'${OPS_N}'）—— 库结构或表名变了？本趟作废"; summary "iOS 注销销毁" "" 1;;
esac
if [ "$OPS_N" -ge 1 ]; then
  ok "判据 A 成立：${DB_NAME} 在盘上，ops 有 ${OPS_N} 行"
else
  bad "判据 A 不成立：库在但一条 op 都没有 ⇒ 这台设备上没有东西可销毁，D 不构成证据"
  summary "iOS 注销销毁" "" 1
fi

# 🔴 内容腿的**阳性对照**（10-05 10:2x 加，不是仪式）：判据 D 里"便签原文在整个文件字节里
#    0 命中"这一句，只有先量到"注销**前**它命中得到"才叫销毁。本机库如果是**密文**落盘
#    （E2EE 的一种合理实现），这个 needle 会恒 0 命中，于是 D 的内容腿是一枚**永远通过**的判据。
#    读不到就如实说"这一趟没有量程"，不许把 0 命中归功给销毁器。
FORE0=$(db_forensics "${DATA_CONTAINER}/Library/${DB_NAME}" "$NOTE_A")
echo "   销毁之前的内容级读数（这一行是步骤 9 那三腿的阳性对照）："
printf '%s\n' "$FORE0" | sed 's/^/     /'
SUM0=$(printf '%s\n' "$FORE0" | sed -n 's/^SUMMARY content_rows=\([0-9]*\) meta_rows=\([0-9]*\) plain=\([0-9]*\).*/\1 \2 \3/p')
ROWS0=$(printf '%s' "$SUM0" | awk '{print $1}'); PLAIN0=$(printf '%s' "$SUM0" | awk '{print $3}')
if [ "${PLAIN0:-x}" != "0" ] && [ "${ROWS0:-x}" != "0" ]; then
  ok "阳性对照成立：注销**前**这份库里有内容行 ${ROWS0} 条、便签原文在文件字节里命中 ${PLAIN0} 处 ⇒ 步骤 9 那个 0 命中才读得出「销毁」"
else
  bad "阳性对照红：注销**前**内容行=${ROWS0:-读不到}、便签原文命中=${PLAIN0:-读不到} ⇒ 本机库不是明文落盘（或这条便签没落库）
      ⇒ 判据 D 的内容腿在这一趟**没有量程**，它的 0 命中不许写成「销毁成功」"
  printf '%s\n' "$FORE0" > "$EVIDENCE/ios-account-erasure-0-plaintext-control.txt" 2>/dev/null || true
fi

# ── 5. 判据 B：401 不许清库 ────────────────────────────────────────────────
step "5. 判据 B：换成服务端不认的令牌（401 TOKEN_INVALID），库必须还在"
fill_three_credentials "$BAD_TOKEN" \
  || { bad "B 这一档的令牌没换成 ⇒ 判据 B 没跑到，本趟不作数"; summary "iOS 注销销毁" "" 1; }
sync_now
sleep 10
# 🔴 前提腿（10-05 10:1x 加）：先证明"确实发生了一次 401"，再谈"401 之后库还在"。
#    这一档以前**没有**这条腿，而 09:42 那一趟的现量是：换坏令牌之后服务端零请求
#    （日志 01:46:41 之后直到 01:48:58 注销之间一行都没有）⇒ 那两腿量到的其实是
#    "换了个令牌、库还在"，跟 401 无关。遮挡修好之后前提**仍然**不能默认成立 ——
#    界面上的错误详情行是逐字渲染的（假服务端实测：'同步请求失败：HTTP 410 — Account unavailable — …'
#    原样出现在 AX 树里），所以 "HTTP 401" 读得到就是真发生了。
idb_dump
if text_on_screen "HTTP 401"; then
  ok "判据 B 的**前提**成立：这台设备真的收到了一次 HTTP 401（不是"换了个令牌但没人请求"）"
else
  bad "判据 B 的前提不成立：界面上没有 HTTP 401 ⇒ 这一次同步压根没被服务端拒过，
      下面两条腿读到的"库还在"与 401 无关，本趟 B 不作数（先修探针：见 sync_now 的让位与接住腿）"
  cp "$IDB_DUMP_FILE" "$EVIDENCE/ios-account-erasure-3b-no-401-dump.json" 2>/dev/null || true
fi
if db_present; then
  ok "判据 B（文件腿）成立：一次 401 之后 ${DB_NAME} 仍在盘上"
else
  bad "🔴 判据 B 红：一次 401 就把本机库删了 —— 改一次密码会踢掉所有设备并毁掉它们的本地数据"
fi
xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-3-401-keeps-db.png" >/dev/null 2>&1
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
# 🔴🔴 **数据腿**（与 Android 那侧 `verify-mobile-account-erasure.sh` 同一批补，同一条理由）：
#    10-05 06:2x 的设备级变异臂（`isAccountClosedFailure` 放宽成"任何 401"）在 Android 真机上
#    **没有让文件腿转红**，而同一条不变量在 `packages/sync-client` 层内是 9 红（计划 §10.131）。
#    B 承诺的是「不动**用户数据**」，而"删库 → 自动同步重试把空库开回来"会留下一个
#    全新的 0 行库文件 —— 文件腿照样绿。iOS 这一档原来用的是同一把尺，**同一个洞**，
#    所以这里同步补第二腿：ops 行数必须还是判据 A 那一刻读到的那个数。
#    ⚠️ 这一腿自己"会不会红"尚未在 iOS 上实测（Android 侧正在带它复跑同一臂）。
OPS_AFTER_B=$(db_ops_count)
if [ -z "$OPS_AFTER_B" ] || ! printf '%s' "$OPS_AFTER_B" | grep -qE '^[0-9]+$'; then
  bad "🔴 判据 B 红（数据腿）：401 之后读不到 ops 计数了（'$OPS_AFTER_B'；A 那一步读到的是 $OPS_N 行）⇒ 库被清掉后没能以可读形状回到盘上"
elif [ "$OPS_AFTER_B" = "$OPS_N" ]; then
  ok "判据 B（数据腿）成立：401 之后 ops 仍是 ${OPS_N} 行（与 A 那一刻逐字相同 ⇒ 用户数据没被动过，「文件还在」只是它的一半）"
else
  bad "🔴 判据 B 红（数据腿）：401 把 ops 从 $OPS_N 行变成了 $OPS_AFTER_B 行 —— 就算文件还在盘上也不算数（「删库 → 重开空库」正是被文件腿读成绿的那条路）"
fi

step "6. 换回真令牌并同步（D 需要一条「曾经配好过」的对照基线）"
fill_three_credentials "$TOKEN" || { bad "换回真令牌没走通"; summary "iOS 注销销毁" "" 1; }
sync_now
sleep 10
# 配对腿：这一档必须**真的同步成**，否则"库仍在"只是"没人碰过它"，D 也就没有
# 一条"曾经配好过"的基线可对照。（"已是最新" = `mobile.sync.synced`，实测在 AX 树里。）
idb_dump
if text_on_screen "已是最新"; then
  ok "步骤 6 的配对腿成立：换回真令牌之后这台设备又同步成了一次（界面上读得到「已是最新」）"
else
  bad "步骤 6 的配对腿红：换回真令牌后没读到「已是最新」⇒ 这一档没真的同步，
      后面 D「销毁前库里有东西」的基线不成立"
  cp "$IDB_DUMP_FILE" "$EVIDENCE/ios-account-erasure-6b-no-synced-dump.json" 2>/dev/null || true
fi
if db_present; then
  ok "换回有效令牌后库仍在（B 的读数不是「库里本来就没人写过」）"
else
  bad "换回有效令牌后库反而没了 ⇒ 是上一档那次 401 删的，B 的红成立"
fi

# ── 7. 注销那一发走服务端自己的端点 ────────────────────────────────────────
step "7. 用这台设备的令牌调 DELETE /api/account，并确认服务端此后回 410"
CLOSE_BODY=/tmp/heyta-ios-close-${STAMP}.json
# 🔴 探针打的是**同步端点**，不是 `/api/account`。
#    10-05 09:15 首跑红在这里，读数是"注销后拿旧令牌请求得到 404 而不是 410"——
#    而 404 是 Fastify 的 **route not found**：裸 `/account` 在 `server/src/api.ts:713`
#    **只注册了 `fastify.delete`**（`accountProfileRoutes` 那几条是 `/account/<profile 路径>`），
#    所以那发 GET 在**路由层**就 404 了，认证中间件（410 的生产者）根本没跑到。
#    ⇒ 这条红是探针的形状，不是产品的形状。改成打客户端同步真正会撞的那条：
#      `GET /api/sync/status`（`server/src/sync/sync.routes.ts:295`，无请求体 ⇒
#      不会在 schema 校验层被 400 挡在中间件之前）。
#    🔴 并且**先要一次阳性对照**：注销**前**同一个 URL 用同一枚令牌必须 200。
#      没有这一腿，"注销后不是 410"永远分不清是"信号没了"还是"探针从来不通"。
PROBE_URL="$HOST_SERVER/api/sync/status"
PROBE_PRE=$(curl -s -o /dev/null -w '%{http_code}' "$PROBE_URL" -H "authorization: Bearer ${TOKEN}")
if [ "$PROBE_PRE" = "200" ]; then
  ok "探针阳性对照成立：注销**前** $PROBE_URL 用同一枚令牌回 200（下面那发读得到 410/404 之差）"
else
  bad "探针自己不通：注销前 $PROBE_URL 回的是 ${PROBE_PRE} 而不是 200 ⇒ 本趟不判产品（先修探针）"
fi
# 🔴 注销那一刻的时间戳要**在发 DELETE 之前**取：D/E 两档要用它判"这枚文件的 birth 在注销之前
#    还是之后"。以前这两档把"birth 就是注销那一秒"当固定话术印出来 —— 那是一句不管量到什么都
#    会打印的断言（恒真），而它恰好是 D 的结论里最要紧的那一半。
CLOSE_EPOCH=$(date +%s)
CLOSE=$(curl -s -o "$CLOSE_BODY" -w '%{http_code}' -X DELETE "$HOST_SERVER/api/account" \
  -H "authorization: Bearer ${TOKEN}")
echo "     DELETE /api/account → HTTP ${CLOSE}  body: $(head -c 160 "$CLOSE_BODY" 2>/dev/null)"
AFTER_BODY=/tmp/heyta-ios-after-${STAMP}.json
AFTER=$(curl -s -o "$AFTER_BODY" -w '%{http_code}' "$PROBE_URL" -H "authorization: Bearer ${TOKEN}")
AFTER_CODE=$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1],encoding="utf-8")).get("code",""))
except Exception: print("")' "$AFTER_BODY" 2>/dev/null)
echo "     注销后同一发 → HTTP ${AFTER}  code=${AFTER_CODE:-（body 里没有 code 字段）}  body: $(head -c 160 "$AFTER_BODY" 2>/dev/null)"
if [ "$AFTER" = "410" ] && [ "$AFTER_CODE" = "ACCOUNT_CLOSED" ]; then
  ok "服务端对旧令牌此后回 **410 + code=ACCOUNT_CLOSED**（E1b 的形态在这台服务端上成立：注销独占 410，其余仍 401）"
else
  bad "注销后再拿这枚令牌请求同步端点得到的是 HTTP=${AFTER} code=${AFTER_CODE:-无} 而不是 410/ACCOUNT_CLOSED —— 设备收到的信号不是「账号已注销」，D 就算红也不能算产品缺陷"
fi
rm -f "$CLOSE_BODY" "$AFTER_BODY"

step "8. 判据 C：设备下一次同步把这件事读成「账号已注销」"
sync_now
DONE=0
for i in $(seq 1 40); do
  idb_dump
  # 🔴 这一档以前用 lib 的 `idb_has`（语义是**精确**标签或值）。今天在同一枚 rig 上已经
  #    量过两次"needle 逐字正确但渲染形态不是我以为的那种"（§10.141 ⑦：便签正文只出现在
  #    组合标签里，而且 ASCII 被规范化成全角）。状态卡这一句同样可能被加了前缀或换行拆开，
  #    所以换成同一把尺：NFKC + 子串。
  if text_on_screen "这个账号已经注销，无法再次登录，同步已停止"; then DONE=1; break; fi
  sleep 3
done
if [ "$DONE" = "1" ]; then
  ok "判据 C 成立：界面报出的是「账号已注销」那句，不是「重新登录」那句"
else
  bad "40×3s 内界面没报出注销那句 —— 客户端没把它分类成 account-closed；D 就算空了也不能归功于销毁器"
  cp "$IDB_DUMP_FILE" "$EVIDENCE/ios-account-erasure-4c-dump.json" 2>/dev/null || true
  dump_screen_text
fi
xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-4-after-closure.png" >/dev/null 2>&1

step "9. 判据 D（这一格的正证）：容器 Library 里以 ${DB_NAME} 为前缀的残留 0 枚 + 内容级取证"
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
sleep 4
LISTING=$(ls_lib_dir)
RESIDUE=$(residue_count "$LISTING")
PREFS=$(printf '%s\n' "$LISTING" | sed 's#.*/##' | grep -c "^${LIB_NAME}$")
FORE1=$(db_forensics "${DATA_CONTAINER}/Library/${DB_NAME}" "$NOTE_A")
echo "   内容级取证（每一行都是量出来的）："
printf '%s\n' "$FORE1" | sed 's/^/     /'
SUM1=$(printf '%s\n' "$FORE1" | sed -n 's/^SUMMARY content_rows=\([0-9]*\) meta_rows=\([0-9]*\) plain=\([0-9]*\).*/\1 \2 \3/p')
ROWS1=$(printf '%s' "$SUM1" | awk '{print $1}'); META1=$(printf '%s' "$SUM1" | awk '{print $2}'); PLAIN1=$(printf '%s' "$SUM1" | awk '{print $3}')
EPOCH1=$(printf '%s\n' "$FORE1" | sed -n 's/^.*birth_epoch=\([0-9]*\)$/\1/p')
# Δ = 这枚文件的 birth 相对"发出 DELETE 那一刻"的秒数（负 = 文件比注销更早，说明销毁没删掉它）
if [ -n "$EPOCH1" ] && [ -n "$CLOSE_EPOCH" ]; then D1=$(( EPOCH1 - CLOSE_EPOCH )); else D1=""; fi
echo "     birth 相对注销那一发 = ${D1:-读不到} 秒（>0 ⇒ 销毁之后新建的；<0 ⇒ 注销之前就在，销毁没删掉它）"
if [ "$RESIDUE" = "0" ]; then
  ok "判据 D 成立：${DATA_CONTAINER}/Library 里以 ${DB_NAME} 为前缀的残留 0 枚（真机运行时，不是桩；-wal / -shm / -journal 任何旁挂都在射程内）"
elif [ "$ROWS1" = "0" ] && [ "$PLAIN1" = "0" ]; then  # 内容行 0 + 明文 0（meta 里的 clientId 另计）
  # 🔴 这一档 10-05 10:0x 才分得出来：以前它和"明文仍在"共用同一句红话，而两者是完全
  #    不同的缺陷（一个是销毁没跑，一个是跑完之后有东西把**空壳**建回来）。
  #    10-05 10:16 那一趟里"销毁没跑"那一支被**否证**了（birth 在注销之后），
  #    而 meta 那一支的两趟读数不一致（手探 meta=1 / rig meta=0）⇒ 只报量，不进结论。
  if [ -n "$D1" ] && [ "$D1" -lt 0 ]; then
    bad "判据 D 红：**销毁那一发没删掉文件** —— 内容行 ${ROWS1}、明文命中 ${PLAIN1}，
      而 ${DB_NAME} 的 birth 比发出 DELETE 早 ${D1#-} 秒 ⇒ 这一枚从注销之前一直躺在盘上。
      （这是设备级 M1″ 臂的形状，不该出现在未变异的运行里。）"
  else
    bad "判据 D 红，但**不是**「明文仍在」：用户内容级三腿全过（内容行 ${ROWS1}、便签原文在整个文件字节里命中 ${PLAIN1}、freelist 见上），
      而 ${DB_NAME} 的 birth 在发出 DELETE **之后** ${D1:-（读不到）} 秒 ⇒ 文件确实被删掉了，
      之后有一次重开把**空 schema** 建了回来（meta 行数=${META1:-读不到}：10-05 两趟读数不一致 ——
      手探那一趟 meta=1（一枚新 clientId），rig 干净这一趟 meta=0 ⇒ 不把它写进结论，只记"重建的是空壳"）。
      这一格量到的是「销毁之后仍有一条写路径把它重建」，不是「没销毁」。它仍然判红：
      计划 §10.2 的承诺是文件级残留 0 枚，而判据 E 存在的理由就是抓这条重建路径。"
  fi
  printf '%s\n' "$LISTING" | sed 's#.*/##' | grep "^${DB_NAME}" | sed 's/^/       残留：/'
else
  bad "判据 D 红：残留 ${RESIDUE} 枚**且用户内容没清空**（内容行=${ROWS1:-读不到}，明文命中=${PLAIN1:-读不到}，meta=${META1:-读不到}）⇒ 本机明文仍在"
  printf '%s\n' "$LISTING" | sed 's#.*/##' | grep "^${DB_NAME}" | sed 's/^/       残留：/'
fi
echo "     （另：设备本地偏好库 ${PREFS} 枚在册（${LIB_NAME}）—— 它不属于本机明文库，注销不该动它；这一行只把形状打在读数里，见计划 §10.68.6 的 G-prefs）"

step "10. 判据 E：重启一趟（不点任何按钮、不发任何请求）之后残留仍是 0（没有第二条写路径把它重建）"
# 🔴 载体为什么从"再同步一次"换成"重启一趟"（10-05 10:16 那趟照出来的）：判据 C 之后
#    客户端**按设计**进入「同步已停止」，再点「立即同步」在产品上就是什么都不做 ——
#    而 sync_now 的 ACK 腿把"界面签名一字未变"读成「这一发没被接住」，判了一条红。
#    服务端日志同期零条连接，证明那一发根本没出去，也**不该**出去。
#    重启一趟是更强的载体：它走宿主完整的启动/开库路径，且不需要网络。
BIRTH1=$(printf '%s\n' "$FORE1" | sed -n 's/^birth=\(.*\) mtime=.*$/\1/p')
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1
sleep 3
if ! xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1; then
  bad "重启起不来（${BID} @ ${UDID}）—— 这一档的载体没成立，E 没有读数"
fi
sleep 10
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
RESIDUE2=$(residue_count "$(ls_lib_dir)")
FORE2=$(db_forensics "${DATA_CONTAINER}/Library/${DB_NAME}" "$NOTE_A")
echo "   第二次内容级取证（birth/mtime 与第一次对照）："
printf '%s\n' "$FORE2" | sed 's/^/     /'
EPOCH2=$(printf '%s\n' "$FORE2" | sed -n 's/^.*birth_epoch=\([0-9]*\)$/\1/p')
BIRTH2=$(printf '%s\n' "$FORE2" | sed -n 's/^birth=\(.*\) mtime=.*$/\1/p')
if [ -n "$EPOCH2" ] && [ -n "$EPOCH1" ]; then D2=$(( EPOCH2 - EPOCH1 )); else D2=""; fi
echo "     birth：D=${BIRTH1:-读不到} → E=${BIRTH2:-读不到}（差 ${D2:-读不到} 秒）"
echo "     （>0 ⇒ 重启这一趟把文件删了又新建；0 ⇒ 还是 D 那一枚）"
if [ "$RESIDUE2" = "0" ]; then
  ok "两次读都是 0 枚残留：销毁成立，且重启一趟没有把它建回来"
elif [ "$RESIDUE" = "0" ]; then
  bad "第一次读是 0、重启一趟之后变成 ${RESIDUE2} 枚 —— 这才叫销毁之后有东西把它重建了（复活路径）"
elif [ -n "$D2" ] && [ "$D2" -gt 0 ]; then
  # 🔴 10-05 10:16 那趟量到的正是"残留两枚相邻读数之间 birth 前移了 15 秒"，
  #    而服务端日志在那 15 秒里**零条连接** —— 那一趟中间发生的是"滚动 + 点一次立即同步"，
  #    不是冷启动。所以这一支只说量到的事：**不需要网络也会长出一枚新的空壳**。
  #    到底是不是"每次开 App 都会"，由本档的冷启动载体回答（EPOCH2 > EPOCH1 且这一趟只有 terminate/launch）。
  bad "重启这一趟之后盘上是**另一枚** ${DB_NAME}（birth 比 D 那次晚 ${D2} 秒），内容行/明文见上 ⇒
      销毁跑过了，但它之后**不需要任何网络活动**就能再长出一枚空壳。
      这一趟 intervening 动作只有 terminate + launch（零点击），所以这条就是冷启动路径本身。"
else
  bad "重启一趟之后仍是 D 那一枚（birth 未变，残留 ${RESIDUE2} 枚）⇒ 冷启动没有再动它；
      残留是注销那一秒之后的重建（见判据 D 那一档的读数），不是每条启动路径都在写。"
fi

echo "     截图：apps/mobile/evidence/ios-account-erasure-{0-not-on-main,1-credential-fill,2-no-composer,3-401-keeps-db,4-after-closure}.png"
echo "     🔴 本装置**不**证移动端注销屏幕的界面腿（E3 那一格）：注销那一发走的是服务端端点。"
summary "iOS 注销销毁"
