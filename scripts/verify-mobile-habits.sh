#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
#
# 移动端「习惯」屏验收（真模拟器，零 mock）—— 工单 H12
# =====================================================
#
# 🔴 为什么必须有这一份，而不是"再截一次图"
#
# `apps/mobile/evidence/android-habits-*.png` 那 9 张**早就在仓库里**（10-01 17:2x），
# 但产它们的那枚一次性脚本**没有入库** ⇒ 在当前产物上**无法复跑**。
# 后果不是"少几张图"，是这一整面**没有判据**：习惯屏自 10-01 之后落了
# H2（新建入口）/ H3（图标选择器）/ H4（月历 + 补打卡）/ H5（frequency 写入口）
# 四批改动，而设备侧**没有任何一层**会因为它们坏掉而变红。
# 成长屏（`GrowthScreen`）读的是同步过来的连续数字，它绿只证明"数字算出来了"，
# 不证明"习惯那一屏画在当前装出来的包里"。
#
# 与 §6.1.1 那三行"测试全绿 ≠ 这是当前产物"是同一条，缺的是**第四种面目**：
# 门禁与单测全都在 JS 层，装机态那一屏从来没人量。
#
# ─────────────────────────────────────────────────────────────────────────
# 八条判据，每条都把"点了"与"生效了"分开证
#
#   ① 装的是**这一批源码**打出来的包（`apk-freshness` 那条 mtime 对账，不是"装上了"）
#   ② 空态：习惯那一屏**进得去**，且空态文案在（挡"入口接了但屏是白的"）
#   ③ 手机上建一条习惯 → 手机本地库**恰好 1 条 `HABIT/CRT`**（不是"界面出现了它"）
#   ④ 清单里那一行的 aria 数字与本地库对得上（`连续 0 天` ⇒ 没把"渲染"当"物化"）
#   ⑤ 详情里点打卡 → `HABIT_LOG/CRT` **恰好 1 条**，且清单那一行变成 `连续 1 天`
#      （打卡是"写了一条 op"，不是"格子变了颜色"）
#   ⑥ **杀掉进程重开**之后仍是已打卡（本地优先的判据：状态在库里，不在 React 里）
#   ⑦ 暗色不是"截图变暗"：同一屏 light/dark 的**主色亮度**必须真的翻面，
#      且两边都还数得出主蓝（挡"暗色只是叠了一层黑"与"暗色把品牌色丢了"两种假绿）
#   ⑧ 撤销 → `HABIT_LOG` 多**恰好 1 条 DEL**、`连续` 回到 0；随后**笔记本**同步后
#      读得到这条 HABIT 与那次打卡的痕迹（跨设备，不是本机自说自话）
#   ⑨ 这一批证据图**不许有"同一屏连拍两次"**（按内容哈希两两对账，不是按文件名）。
#      实测撞过：`4-checked` 与 `5-list-after-checkin` 逐字节相同（同一秒、同一 md5），
#      因为两张之间**没有导航** —— 同一屏连拍了两次。每张自己的判据（非空白 / 数得出主蓝 /
#      暗色翻面）全过，所以"九张图"里其实只有八屏，而输出上看不出差别。
#      🔴 这是 §7 元规则二的一个新面目：**逐张合格的判据，合起来挡不住"重复交证据"**。
#      ⚠️ 但它**只**回答"有没有重复采集"，不回答"每屏内容都不同"：⑥ 那一对
#      （`5-list-after-checkin` ↔ `6-list-after-restart`）**按设计就应当同屏** —— 重启前后
#      内容不许变，变的只有系统状态栏的时钟。所以这一对**显式豁免**在成对判据之外
#      （07 03:1x 人逐张看图照出来的：那两张的字节差就是 3:08 → 3:09，
#      而"重启后状态还在"由 ⑥ 那条 aria 回读判据负责，不由图像负责）。
#      豁免是**按具体的一对**，不是"允许 N 对重复" —— 后者会把 4↔5 那一类真缺陷也放过。
#
# 🔴 ③⑤⑧ 三条都写成**数 op 的条数**，不是"有没有那条 op"。理由与
#    `verify-mobile-trash.sh` 第 6b 步同一条：一个用户意图 = 一个 op（AGENTS §3.4），
#    而"多写一条"在界面上**完全看不出来** —— 清单仍然显示连续 1 天。
#
# ⚠️ 载体：真模拟器 `emulator-5554` + 真服务端（**TEST_MODE**）+ 真笔记本设备
#    （`apps/node-host`，独立 SQLite 文件）。全部零 mock。
#    跑法（仓库根）：`bash scripts/verify-mobile-habits.sh`
#    前置：模拟器在跑、Postgres 在 5432、服务端在 3000（`PORT=…` 时改 `E2E_PORT`），
#          且**装的是当前源码的包**：`pnpm build:android && adb install -r …`
#          （或直接 `pnpm reinstall:mobile`）。
#    账号每轮新建并写入 /tmp/heyta_mobile_{token,email,e2ee}.txt。
#
# ⚠️ 标题必须 ASCII：`adb shell input text` 发不了非 ASCII（实测抛异常却可能退 0，
#    §7 第 43 条）。习惯名同理。
#
# ⚠️ **看退出码时不要接管道**（§7 第 45 条）：`bash 这个脚本 | tail` 之后 `$?` 是
#    `tail` 的。要判退出码就 `bash 脚本; echo $?`。
#
set -u
export PATH="/opt/homebrew/bin:$PATH"

# ── 先准备账号，再加载共享库（顺序不能反，理由见 verify-mobile-conflict.sh）──
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"
. "$(dirname "$0")/lib/apk-freshness.sh"

BUSY=$(another_mobile_e2e_running)
if [ -n "$BUSY" ]; then
  echo "❌ 这台设备上还有别的移动端验收在跑：$BUSY"
  echo "   两边都会 pm clear + 装包 + 按坐标点击，并行 = 互相清掉对方的现场。"
  exit 3
fi
step "负载门"
wait_for_quiet_host || exit 3

HEALTH=$(curl -s --noproxy '*' -m 5 "${HOST_SERVER}/health" 2>/dev/null)
if ! printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  echo "❌ 服务端没在 ${HOST_SERVER}（/health 返回：${HEALTH:-空}）—— 环境未就绪，**不是产品失败**"
  exit 3
fi
echo "   服务端就绪：${HOST_SERVER}"

LAPTOP_DB=/tmp/heyta-habits-laptop.sqlite
PHONE_DB=/tmp/heyta-habits-phone.sqlite
rm -f "$LAPTOP_DB" "$PHONE_DB"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
mkdir -p "$EVIDENCE"

# 🔴 装机判据 ① 的**配对**：APK 与"它是由哪一棵树打出来的"必须一起给。
#    默认是主检出；如果这一枚包是在**隔离载体**里打的（共享检出上有别线未提交改动时
#    就该这么做，否则包会把别人的 WIP 一起打进去），要把那一棵根一起指过来：
#      HEYTA_HABITS_APK=…/app-release.apk HEYTA_HABITS_APK_ROOT=…/载体 bash scripts/verify-mobile-habits.sh
#    ⚠️ 只指 APK 不指 ROOT 会让这条 mtime 对账拿**主检出的源码**去比**载体打的包** ——
#    那种比法两种结果都没有意义（别线刚存过盘就必然判"过期"，反之亦然）。
APK="${HEYTA_HABITS_APK:-$HEYTA_REPO_ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk}"
APK_ROOT="${HEYTA_HABITS_APK_ROOT:-$HEYTA_REPO_ROOT}"

# 🔴 复用 10-01 那批证据的**同一组文件名**：那 9 张本来就是这一面的装机判据，
#    只是当时没有产它们的装置。新装置产出的图应当**顶掉**旧图，而不是再起一套
#    前缀留下两份"哪个是当前的"要人猜。旧图在 git 里，随时可 diff 回来。
SHOTS=(1-empty 2-list 3-detail 4-checked 5-list-after-checkin 6-list-after-restart \
       7-dark-list 8-dark-detail 9-undo)

# ── 辅助 ────────────────────────────────────────────────────

phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heyta/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# 某实体某类 op 的条数。**读数拿不到不当作 0**：空串原样返回，调用方必须判空。
# ⚠️ JSON 路径是 `$.op.entityType`，不是 `$.entityType`（`data` 列是嵌套结构）。
# opType 传 `*` = 不按类型过滤（数"这个实体一共写了几条"，⑧ 那一档要的就是这个）。
op_count() {  # <sqlite 文件> <entityType> <opType|*> [entityId]
  local f=$1 et=$2 ot=$3 id=${4:-} q
  [ -f "$f" ] || { echo ""; return; }
  q="SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='$et'"
  [ "$ot" != "*" ] && q="$q AND json_extract(data,'\$.op.opType')='$ot'"
  [ -n "$id" ] && q="$q AND json_extract(data,'\$.op.entityId')='$id'"
  sqlite3 "$f" "$q;" 2>/dev/null | tr -d ' '
}

# 按 **resource-id** 定位（RN 的 `testID`）。
#
# 🔴 23:5x 实测的形状：这一枚 RN 版本在 uiautomator 里把 testID **原样**写进
#    `resource-id`，**不带** `com.heyta:id/` 包名前缀（真读数：
#    `resource-id="habit-row-habit-muwv7yba-2-qydvohv7"`）。按"包名:id/…"去拼会恒查不到，
#    而"找不到"会被读成"那一行没画出来" —— 那是假红，方向还会被引去怀疑产品。
#
# 🔴 为什么这一面要用它，而不是用文字：清单行与打卡按钮的 testID **带着习惯的 entityId**
#    （`habit-row-<id>` / `habit-checkin-<id>`）。按文字点只能证明"点到了一个叫这个名字的
#    东西"，按 id 点证明的是"点到的是**这一条**"—— 而"改了一条、另一条跟着变"正是这一面
#    要抓的错法，它在界面上和正常长得一样。
#    守卫与 lib 的 `desc-sane` 同一条理由：折叠线以下的节点**仍在无障碍树里**，但 bounds
#    是负高度，它的"中心"落在底部标签栏上，点下去切去了别的标签页。
xy_rid() {  # <testID>
  python3 - "$1" <<'PY'
import os, re, sys
want = 'resource-id="%s"' % sys.argv[1]
s = open(os.environ['UI_XML'], encoding='utf-8', errors='replace').read()
for m in re.finditer(r'<node[^>]*?>', s):
    tag = m.group(0)
    if want not in tag:
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    if y2 > y1 and (y1 + y2) // 2 < 2100:
        print(f"{(x1 + x2) // 2} {(y1 + y2) // 2}")
        break
PY
}

# 把某个 testID **滚进可点区域**再定位（详情面比一屏长，直接查会拿到被裁掉的那档坐标）。
scroll_to_rid() {  # <testID>
  for _ in 1 2 3 4 5 6; do
    dump
    XY=$(xy_rid "$1")
    if [ -n "$XY" ]; then printf '%s' "$XY"; return 0; fi
    $ADB shell input swipe 540 1900 540 1100 300; sleep 1.5
  done
  return 1
}

has_rid() {  # <testID> —— "这一面真的渲染了那个带 id 的节点"（存在性，不是坐标）
  grep -q "resource-id=\"$1\"" "$UI_XML" && echo 1 || echo 0; }

shot() {  # <名字> —— 落一张带序号前缀的 PNG，并且**必须**是非空白的
  # ⚠️ 两条 `local` 分开写：macOS 的 bash 3.2 在**同一条** `local a=1 b="…$a…"` 里
  #    求值 `b` 时 `a` 还没赋值，配上 `set -u` 直接 "unbound variable"（实测撞过）。
  local name=$1
  local out="$EVIDENCE/android-habits-$name.png"
  rm -f "$out"
  $ADB exec-out screencap -p > "$out" 2>/dev/null
  if [ ! -s "$out" ]; then bad "截图没落盘：$out"; return 1; fi
  # 逐行记账给第 11 步（重复检测）用。**不能**用空格拼一个列表：仓库路径本身带空格
  # （`All in one Data`），拼完就切不回原始路径了。
  SHOT_FILES="${SHOT_FILES:-}${out}"$'\n'
  echo "   📸 $out"
}

# 装机判据的**图像那一半**：非空白 + 数得出主蓝 + （暗色对照时）主色亮度真的翻面。
img_stats() {  # <路径> [对照路径] —— 打印 "modalLuminance blue blank"
  node --input-type=module -e '
    const m = await import("./scripts/screenshots/png-stats.mjs");
    const a = m.inspectPng(process.argv[1]);
    const blue = m.countBrandBlue ? m.countBrandBlue(process.argv[1]) : 0;
    let ref = "";
    if (process.argv[2]) {
      const b = m.inspectPng(process.argv[2]);
      ref = " refModal=" + b.modalLuminance;
    }
    console.log([a.modalLuminance, blue, m.looksBlank(a) ? 1 : 0].join(" ") + ref);
  ' "$@" 2>/dev/null
}

# 一条图判据：非空白、数得出主蓝。暗色那一档还要"主色亮度比亮色档低"。
judge_shot() {  # <标签> <路径> [暗色对照路径]
  local label=$1 path=$2 ref=${3:-} s blank blue modal refkv refmodal=""
  s=$(img_stats "$path" ${ref:+"$ref"}); [ -n "$s" ] || { bad "$label：png-stats 没读数（探针坏了，不算产品失败）"; return 1; }
  read -r modal blue blank refkv <<< "$s"
  # 🔴 对照那一段必须**解析成数**再比较。上一版把 `img_stats` 原样打印的
  #    `refModal=252` 直接塞进 `python3 -c "print(1 if $modal < $refmodal - 40…)"`，
  #    python 报 SyntaxError（`refModal=252` 不是表达式），命令替换得到**空串**，
  #    于是 `[ "" = "0" ]` 为假 ⇒ 这条判据**从来不成立**，而下面那行 ✅ 照样打印
  #    "亮度 12 vs refModal=252"。也就是说"暗色只是叠了一层黑"这一整类假绿
  #    在这一版里是**没有判据的**（§7 元规则二：一条永远通过的判据比没有判据更糟）。
  if [ -n "$ref" ]; then
    case "$refkv" in
      refModal=*) refmodal=${refkv#refModal=} ;;
      *) bad "$label：要了暗色对照，png-stats 却没给出对照读数（多出来的字段是「${refkv:-空}」）—— 判据没跑，不算产品失败"; return 1 ;;
    esac
    if [ "$modal" -ge "$((refmodal - 40))" ]; then
      bad "$label：暗色档主色亮度 $modal 没比亮色档 $refmodal 暗 40 以上 ⇒ 主题没真的翻面"; return 1
    fi
  fi
  if [ "$blank" = "1" ]; then bad "$label：截图是空白的"; return 1; fi
  if [ "${blue:-0}" -lt 1 ]; then bad "$label：数不出 heyta 主蓝（$blue）—— 装出来的不是我们的界面"; return 1; fi
  if [ -n "$refmodal" ]; then
    ok "$label：非空白 · 主蓝 $blue · 暗色亮度 $modal < 亮色 $refmodal − 40（翻面成立）"
  else
    ok "$label：非空白 · 主蓝 $blue"
  fi
}

# 按设计**应当同屏**的一对（⑥ 重启前后：状态在库里不在 React 里 ⇒ 界面内容不许变）。
# 这一对不进"两两不许字节相同"的集合，否则同一分钟内完成重启就会**假红**。
# 🔴 豁免按**具体的一对**写，不是"允许 N 对重复" —— 后者会把 4↔5 那一类真缺陷一并放过。
SHOT_EQUIV_A="5-list-after-checkin"
SHOT_EQUIV_B="6-list-after-restart"

judge_shot_set() {  # 这一批证据图不许有"同一屏连拍两次"（按内容哈希对账，不按文件名）
  # 🔴 逐张判据（非空白 / 数得出主蓝 / 暗色翻面）**合起来挡不住"同一屏连拍两次"**：
  #    两张一样的图各自都合格。实测 07 01:13:27 那两张 md5 逐字相同，而输出上没人变红。
  # ⚠️ 它回答的是"有没有重复采集"，**不**回答"每屏内容都不同"（见上面那对豁免）。
  local out n uniq dupes equiv
  out=$(printf '%s' "${SHOT_FILES:-}" | EQUIV_A="$SHOT_EQUIV_A" EQUIV_B="$SHOT_EQUIV_B" python3 -c '
import hashlib, sys, os, collections
paths = [l for l in sys.stdin.read().splitlines() if l.strip()]
names = collections.defaultdict(list)
for p in paths:
    names[hashlib.sha256(open(p, "rb").read()).hexdigest()].append(p.rsplit("/", 1)[-1])
a, b = os.environ["EQUIV_A"], os.environ["EQUIV_B"]
def stem(nm):  # 文件名可能带 .png，也可能带路径尾巴 —— 只按"包含"匹配
    return a in nm or b in nm
dupes, equiv = [], "absent"
for h, v in names.items():
    if len(v) < 2:
        continue
    if all(stem(x) for x in v) and any(a in x for x in v) and any(b in x for x in v):
        equiv = "same"      # 按设计应当同屏 ⇒ 不算重复交证据
    else:
        dupes += v
dupes = sorted(dupes)
if equiv == "absent":       # 两张各自都与其他不同 ⇒ 豁免对没撞车（正常）
    equiv = "differ"
print("N=%d UNIQ=%d DUPES=%s EQUIV=%s" % (len(paths), len(names), ",".join(dupes) or "-", equiv))
' 2>&1)
  n=$(printf '%s' "$out" | sed -n 's/.*N=\([0-9][0-9]*\).*/\1/p')
  uniq=$(printf '%s' "$out" | sed -n 's/.*UNIQ=\([0-9][0-9]*\).*/\1/p')
  dupes=$(printf '%s' "$out" | sed -n 's/.*DUPES=\([^ ]*\).*/\1/p')
  equiv=$(printf '%s' "$out" | sed -n 's/.*EQUIV=\([^ ]*\).*/\1/p')
  [ -n "$n" ] || { bad "重复检测探针没读数（原文：${out:-空}）—— 判据没跑，不算产品失败"; return 1; }
  if [ "$n" = "0" ]; then bad "没有任何一张证据图入账（账单 0 张）"; return 1; fi
  if [ "$dupes" != "-" ]; then
    bad "$n 张证据图只对应 $uniq 个不同内容 ⇒ 有重复交的证据：$dupes"
    return 1
  fi
  ok "$n 张证据图里没有重复采集（内容哈希 $uniq/$n；按设计同屏的那一对 $SHOT_EQUIV_A↔$SHOT_EQUIV_B：$equiv）"
}

apk_install_identity() {  # 设备上 com.heyta 的**安装身份**（两次时间戳）
  # 🔴 为什么需要它：`emulator-5554` 是**共享**设备（AGENTS §8 第 9 条要求独占验收）。
  #    实测 07 01:5x 那一趟：第 1–9 步全过，到第 10 步重新输入凭据时三个字段全部"找不到"，
  #    而界面回到了**首启欢迎遮罩** —— 现量 `dumpsys package com.heyta`：
  #    `firstInstallTime=lastUpdateTime=2026-10-07 01:58:11`（我自己那次安装在 01:53）。
  #    也就是说**另一会话在这台设备上卸装了一次**，把它的本地库与内存里的口令一起清掉了。
  #    那种红既不是产品缺陷也不是探针缺陷，是**载体被并发方换掉了**。
  #    所以：开局记一次身份，收尾再记一次；对不上 ⇒ **退 3（环境无效）**，
  #    绝不退 1 —— 退 1 会被重试台读成"这一格要人读的产品红"，也会写进台账变成一条假缺陷。
  $ADB shell dumpsys package com.heyta 2>/dev/null \
    | grep -oE '(firstInstallTime|lastUpdateTime)=[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8}' \
    | tr '\n' ' '
}

require_untouched_device() {  # <标签> —— 设备还是我开局那一台吗
  local now
  [ -n "${INSTALL_ID_START:-}" ] || { echo "     （没记到开局安装身份，跳过并发检测）"; return 0; }
  now=$(apk_install_identity)
  if [ "$now" != "$INSTALL_ID_START" ]; then
    echo "❌ 设备被并发方动过（$1）：开局 [$INSTALL_ID_START] → 现在 [$now]"
    echo "   ⇒ 本轮读数**作废**（不是产品失败，也不是探针失败）：另一会话在同一台 emulator 上重装了 com.heyta"
    exit 3
  fi
}

# 🔴 覆盖 lib 的 `step`：**每开一步先确认设备还是我开局那一台**。
#    只在第 10 步之前查一次不够 —— 实测 07 02:09 那一趟第 1–9 步全过、第 10 步"找不到入口"，
#    而 `logcat -b events` 显示 `02:09:24 am_kill … stop com.heyta due to deletePackageX`
#    （另一会话在我跑的中途把包装掉了）。**任何一步都可能被换掉**，
#    而"产品红"与"环境无效"必须分得开：退 1 会被重试台和台账都读成前者。
step() { require_untouched_device "开步之前"; printf '\n════ %s ════\n' "$1"; }

# 🔴 再收一层：**每一条红之前**先问"设备还是不是我开局那一台"。
#    只挂在 `step` 上有个粒度洞 —— 实测 07 02:1x 那一趟：第 6 步开始时身份对得上，
#    而 `02:16:10 firstInstallTime=lastUpdateTime`（另一会话在我**一步之内**把包装掉了）
#    ⇒ 滚不动、点不到，退 1。长步骤中间被换掉，开步那一次检查读不到。
#    判红之前再验一次，才把"别人的动作"与"产品的坏"真正分开。
bad() {
  if [ -n "${INSTALL_ID_START:-}" ]; then
    local now
    now=$(apk_install_identity)
    if [ "$now" != "$INSTALL_ID_START" ]; then
      echo "❌ 设备在判红之前已被并发方换掉：开局 [$INSTALL_ID_START] → 现在 [$now]"
      echo "   ⇒ 下面这条红**不记进产品缺陷**，本轮读数作废："
      echo "      $1"
      exit 3
    fi
  fi
  echo "   ❌ $1"
  FAIL=$((FAIL + 1))
}

# 底部 5 个 tab 的中心 x（1080 宽均分，见 verify-mobile-calendar.sh 那段推导）。
TAB_TASKS=108; TAB_CALENDAR=324; TAB_FOCUS=540; TAB_CATEGORIES=756; TAB_PROFILE=972
TAB_Y=2253

go_habits() {  # 我的 → 习惯（第二层；入口在 10-01 之后没挪过位置）
  $ADB shell input tap "$TAB_PROFILE" "$TAB_Y"; sleep 2
  # scroll_to_text 会把探到的坐标打到 stdout —— 不接走就会混进验收读数里
  scroll_to_text "习惯" >/dev/null
  xy=$(xy_text "习惯" 0); [ -n "$xy" ] || { bad "「我的」里找不到「习惯」入口"; return 1; }
  $ADB shell input tap $xy; sleep 3
  return 0
}

# ── 开始 ────────────────────────────────────────────────────

echo ""
echo "=== 移动端习惯屏装机验收（零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER   账号: $EMAIL"

HABIT_NAME="habits-e2e-$(date +%H%M%S)"

step "1. 装包并启动（① 装的是这一批源码）"
heyta_apk_freshness_guard "$APK" "习惯验收" "$APK_ROOT" || {
  echo "❌ APK 不比源码新 —— 先 pnpm build:android（或 reinstall:mobile）再跑这一条"
  exit 1
}
$ADB uninstall com.heyta >/dev/null 2>&1
INSTALL=$($ADB install -r -t "$APK" 2>&1)
case "$INSTALL" in
  *Success*) ok "全新安装：Success" ;;
  *) bad "安装失败：$(printf '%s' "$INSTALL" | head -2)"; exit 1 ;;
esac
INSTALL_ID_START=$(apk_install_identity)
echo "     开局安装身份：[${INSTALL_ID_START:-读不到}]"
launch_app; sleep 8
ensure_app_foreground || { blame_crash; exit 1; }
dismiss_permission_dialog
# ⚠️ 这里**不**单独调 `handle_privacy_consent`：`dismiss_welcome_if_present` 内部已经先按
#    规范候选（`同意并联网` / `只用本机`）收过一遍面板。裸调一次等于传了个空候选表 ——
#    它只会白等 10 秒并打印一行"面板在，但取不到候选按钮的坐标（候选：）"，
#    看着像缺陷其实是我少传了参数（同一族错误在下面的首次同步那段也犯过一次，已修）。
dismiss_welcome_if_present
require_screen

step "2. 配置同步凭据并首次同步"
configure_sync_credentials || exit 1
# 🔴 填完凭据**不等于**同步开始了：`configure_sync_credentials` 只负责把三个字段
#    填进去并确认"界面认为已配置"，真正发起同步要点「立即同步」那一下
#    （`verify-mobile-calendar.sh` 的第 3 步就是这一档）。少了它，下面等的
#    就不是"派生慢"而是"根本没人发起"，而两者的输出长得一样（§7 元规则一）。
$ADB shell input tap "$TAB_PROFILE" "$TAB_Y"; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  echo "     首次同步含一次纯 JS 的 Argon2id 派生，实测 30–900 秒 ⇒ 18 段 × 10 轮 × 5s"
  # 🔴 分段的唯一理由：**首启的隐私同意面板可以晚于开机那一次检查才出现**。
  #    实测 07 01:3x：启动时 `handle_privacy_consent` 等满 10 秒没见到面板（它只在
  #    真出现时才动作），于是脚本往下填凭据、点「立即同步」；而**第一次真要出网**时
  #    那张面板才盖上来 ⇒ 同步状态永远不会结算，`wait_synced` 空转 900 秒后报
  #    "首次同步未完成" —— 一条**长得像产品坏了**的假红（§7 元规则一：先怀疑探针）。
  #    所以每段之间重看一次面板；总预算不变（180 轮 × 5s）。
  T=""; seg=1
  while [ "$seg" -le 18 ]; do
    T=$(wait_synced 10)
    [ -n "$T" ] && break
    # 🔴 候选按钮的标签**必须逐字传给** `handle_privacy_consent`：它是 `for want in "$@"`，
    #    不传参就等于"面板在、但一个候选都没有"，于是每一段都只会打印
    #    `隐私同意面板在，但取不到候选按钮的坐标（候选：）` 而永远点不掉 ——
    #    实测 07 02:29 那一趟就是这么在第 2–18 段上空转的（我自己上一笔引入的缺陷）。
    handle_privacy_consent "${CONSENT_GATE_PREFERRED:-同意并联网}" "只用本机"
    if [ "${CONSENT_GATE_SEEN:-0}" = "1" ]; then
      if [ -n "${CONSENT_GATE_CHOSEN:-}" ]; then
        echo "     第 $seg 段被首启隐私同意面板挡住 ⇒ 已点「$CONSENT_GATE_CHOSEN」，继续等"
      else
        echo "     第 $seg 段：面板在但**没点到任何候选** ⇒ 这一段的等待等于白等，把界面打出来给人看"
        screen_txt
      fi
    fi
    seg=$((seg + 1))
  done
  if [ -n "$T" ]; then
    ok "首次同步完成（第 $seg 段内约 $T 秒；每段 50 秒）"
  else
    bad "首次同步未完成（900 秒，且每段之间都重看过同意面板）—— 这一条不能记成产品失败前先查面板"
    exit 1
  fi
else
  bad "找不到「立即同步」按钮 —— 凭据面板没走完，不是同步慢"
  exit 1
fi

step "3. ② 空态：习惯那一屏进得去，且空态文案在"
go_habits || exit 1
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
$ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_text '还没有习惯。添加一个开始打卡。')" = "1" ]; then
  ok "空态文案在（这一屏画出来了，不是白屏）"
else
  bad "空态文案不在 —— 入口接上了但那一屏没画对"
fi
shot 1-empty && judge_shot "①-② 空态图" "$EVIDENCE/android-habits-1-empty.png"

step "4. ③ 建一条习惯 → 本地库恰好 1 条 HABIT/CRT"
# 🔴 输入框只能按 **content-desc + class=EditText** 定位（`scroll_to_edit`/`xy_edit`），
#    不能按可见文本。实测这一屏的节点形状是：
#      TextView  text="新习惯名称"                          ← 标签，点它**不聚焦**
#      EditText  text="新习惯，例如「喝水」" desc="新习惯名称"  ← 占位符住在 text 上
#      Button                              desc="添加习惯"
#      TextView  text="添加习惯"                            ← 按钮**里面**那行字
#    上一版用 `xy_text "新习惯名称"` 命中的是那行标签 ⇒ 焦点从没进过输入框，
#    `input text` 把字打进了虚空（**它的退出码仍是 0**），标题一直是空，
#    于是"点了添加习惯"什么都没发生 —— 症状和"提交坏了"一模一样。
XY=$(scroll_to_edit "新习惯名称")
[ -n "$XY" ] || { bad "找不到新建习惯的输入框（只认 EditText，不认那行标签）"; screen_txt; exit 1; }
$ADB shell input tap $XY; sleep 1.2
disable_ime
clear_and_type "$HABIT_NAME" "新习惯名称"
# 🔴 点提交**之前**先读回输入框的实际内容，判据是**精确相等**。
#    没有这一步，"标题没输进去"会以"HABIT/ADD = 0"的面目出现，而那条读数
#    指向的是应用，真正坏的是探针（§7 元规则一：先怀疑探针）。
GOT=$(edit_value "新习惯名称" 2>/dev/null)
if [ "$GOT" = "$HABIT_NAME" ]; then ok "标题已进输入框：$HABIT_NAME"; else bad "输入框里是「${GOT:-空}」，不是「$HABIT_NAME」"; screen_txt; exit 1; fi
XY=$(scroll_to_desc "添加习惯")
[ -n "$XY" ] || { bad "「添加习惯」按钮滚不进可点区域"; screen_txt; exit 1; }
$ADB shell input tap $XY; sleep 3
# 🔴 打卡记录的 entityId 是 `habitLogId(habitId, date)` = `<habitId>:<YYYY-MM-DD>`，
#    日期取的是**设备本地日**（`toLocalDate(now())` 在设备上算）。后面 ⑤⑧ 两条要按
#    这个 id 数 op，所以期望值从设备时钟现取，不拿宿主机的日期去猜（跨零点时两者差一天，
#    而那条差异会被读成"没写进去"）。
DEV_DATE=$($ADB shell date +%Y-%m-%d 2>/dev/null | tr -d '\r')
[ -n "$DEV_DATE" ] || { bad "读不到设备日期，后面每条 op 判据的 entityId 都不可信"; exit 1; }
ok "设备日期 $DEV_DATE"
phone_db_pull
# 按**这一条习惯的名字**取它的 entityId（名字带时间戳 nonce，全局唯一），
# 并且只认 `CRT`：数"这个实体被建了几次"，而不是"库里有没有一个叫这名字的东西"。
HID=$(sqlite3 "$PHONE_DB" \
  "SELECT json_extract(data,'\$.op.entityId') FROM ops
    WHERE json_extract(data,'\$.op.entityType')='HABIT'
      AND json_extract(data,'\$.op.opType')='CRT'
      AND json_extract(data,'\$.op.payload.name')='$HABIT_NAME' LIMIT 1;" 2>/dev/null | tr -d ' \r')
BEFORE_H=$(op_count "$PHONE_DB" HABIT CRT "$HID")
# 🔴 数的是**这一条习惯**的 CRT 条数，不是"HABIT/CRT 有没有"：一个用户意图 = 一个 op
#    （AGENTS §3.4），而"多写一条"在界面上完全看不出来。
if [ "${BEFORE_H:-}" = "1" ]; then ok "手机本地库里这条习惯恰好 1 条 HABIT/CRT"; else bad "HABIT/CRT 条数 = ${BEFORE_H:-读不到}（期望 1）"; fi
[ -n "$HID" ] && ok "拿到习惯 entityId（${HID:0:8}…）" || { bad "拿不到习惯 entityId"; exit 1; }
LOG_ID="${HID}:${DEV_DATE}"

step "5. ④ 清单里那一行的 aria 数字与物化对得上"
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
# 🔴 先认**带 id 的那一行**，再认文字：`habit-row-<HID>` 在树里 = "物化出来的这条习惯
#    被画成了它自己那一行"。只看"屏幕上有这个名字"会放过"两行渲染成同一份状态"。
if [ "$(has_rid "habit-row-$HID")" = "1" ]; then
  ok "新建的那条出现在清单里（habit-row-<id> 在无障碍树里）"
else
  bad "清单里没有 habit-row-$HID —— 库里有一条，界面上却没有它那一行"
  screen_txt
fi
if [ "$(has_desc_sub '连续 0 天')" = "1" ]; then
  ok "行 aria 是「连续 0 天」（刚建、没打卡 —— 数字来自物化状态而不是写死的文案）"
else
  bad "行 aria 里没有「连续 0 天」"
fi
shot 2-list && judge_shot "④ 清单图" "$EVIDENCE/android-habits-2-list.png"

step "6. ⑤ 详情里点打卡 → HABIT_LOG/CRT 恰好 1 条，行 aria 变连续 1 天"
XY=$(xy_rid "habit-row-$HID")
[ -n "$XY" ] || XY=$(scroll_to_rid "habit-row-$HID")
[ -n "$XY" ] || { bad "清单里点不到那条（habit-row-$HID 滚六屏都不出现）"; exit 1; }
$ADB shell input tap $XY; sleep 3
require_screen
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
# 🔴 详情窗格必须**是这一条的**：`habit-detail` 是共享 `HabitBoard` 的根 testID，
#    而 `habit-checkin-<HID>` 里的 id 就是刚建那条的 entityId。两个都在，才说明
#    "点这一行 → 打开的是这一条的窗格"，而不是"打开了上一条的快照"。
[ "$(has_rid "habit-detail")" = "1" ] && ok "详情窗格渲染了（habit-detail 在树里）" || bad "详情窗格没渲染"
if [ "$(has_rid "habit-checkin-$HID")" != "1" ]; then
  bad "详情里没有 habit-checkin-$HID —— 窗格开错了对象，或打卡按钮没画出来"
  screen_txt; exit 1
fi
shot 3-detail && judge_shot "⑤ 详情图" "$EVIDENCE/android-habits-3-detail.png"
# 打卡前那一下的 aria 必须是"为它打卡"（不是"撤销…"）—— 这一条把"界面上这个圆点
# 是未打卡态"钉在文字上，而不是只看它有没有颜色。
[ "$(xy_desc "为「$HABIT_NAME」打卡")" != "" ] && ok "打卡按钮此刻说的是「为「…」打卡」（未打卡态）" \
  || bad "打卡按钮的 aria 不是「为「$HABIT_NAME」打卡」"
XY=$(scroll_to_rid "habit-checkin-$HID")
[ -n "$XY" ] || { bad "打卡按钮滚不进可点区域"; exit 1; }
$ADB shell input tap $XY; sleep 3
phone_db_pull
# entityId 是 `<习惯 id>:<设备日>`（见上面 `LOG_ID` 那段）。按它数才证明"写的是**今天这一格**"，
# 按习惯 id 数会恒为 0 —— 而 0 会被读成"没生效"。
if [ "$(op_count "$PHONE_DB" HABIT_LOG CRT "$LOG_ID")" = "1" ]; then
  ok "HABIT_LOG/CRT 恰好 1 条（entityId=${LOG_ID##*:}）"
else
  bad "HABIT_LOG/CRT 条数 = $(op_count "$PHONE_DB" HABIT_LOG CRT "$LOG_ID")（期望 1）"
fi
# 🔴 这张必须在**详情屏**上拍（还没点返回）。原先它和下面那张清单图连着排在一起，
#    中间没有导航 ⇒ 九张"证据"里有两张逐字节相同（md5 `218d003e2d…`，实测 07 01:13:27），
#    而每张自己的判据都过 —— 见第 11 步那条新判据。
shot 4-checked && judge_shot "⑤ 打卡后详情图" "$EVIDENCE/android-habits-4-checked.png"

step "7. 回清单：那一行必须变成「连续 1 天」"
# 🔴 用**界面自己的返回**（Screen 头部那颗「返回」），不用 KEYCODE_BACK：
#    详情与清单是同一路由里的两档视图，硬件后键归父导航管（它可能直接切走标签页），
#    用界面那颗才对着"用户以为的返回"。
XY=$(xy_desc "返回")
[ -n "$XY" ] || XY=$(scroll_to_desc "返回")
[ -n "$XY" ] || { bad "详情里没有「返回」"; exit 1; }
$ADB shell input tap $XY; sleep 2
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_desc_sub '连续 1 天')" = "1" ]; then ok "行 aria 变成「连续 1 天」"; else bad "行 aria 没变（还是 0 天？）"; screen_txt; fi
shot 5-list-after-checkin && judge_shot "⑤ 打卡后清单图" "$EVIDENCE/android-habits-5-list-after-checkin.png"

step "8. ⑥ 杀进程重开：状态必须在库里，不在 React 里"
$ADB shell am force-stop com.heyta; sleep 2
launch_app; sleep 8
ensure_app_foreground || { blame_crash; exit 1; }
go_habits || exit 1
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_desc_sub '连续 1 天')" = "1" ]; then
  ok "重启后仍是「连续 1 天」（本地优先：这条不依赖网络回来）"
else
  bad "重启后打卡痕迹没了"
fi
shot 6-list-after-restart && judge_shot "⑥ 重启后清单图" "$EVIDENCE/android-habits-6-list-after-restart.png"

step "9. ⑦ 暗色：同一屏 light/dark 的主色亮度必须真的翻面"
LIGHT_REF="$EVIDENCE/android-habits-6-list-after-restart.png"
$ADB shell cmd uimode night yes; sleep 3
$ADB shell am force-stop com.heyta; sleep 1
launch_app; sleep 8
ensure_app_foreground || blame_crash
go_habits || true
shot 7-dark-list
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
judge_shot "⑦ 暗色清单图" "$EVIDENCE/android-habits-7-dark-list.png" "$LIGHT_REF"
XY=$(xy_rid "habit-row-$HID"); [ -n "$XY" ] || XY=$(scroll_to_rid "habit-row-$HID")
[ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; } || bad "暗色档里点不进那条详情（habit-row-$HID 没出现）"
shot 8-dark-detail && judge_shot "⑦ 暗色详情图" "$EVIDENCE/android-habits-8-dark-detail.png" "$LIGHT_REF"
$ADB shell cmd uimode night no; sleep 2

step "10. ⑧ 撤销 → HABIT_LOG/DEL 恰好 1 条、连续回到 0，然后笔记本读得到"
$ADB shell am force-stop com.heyta; sleep 1
launch_app; sleep 8
ensure_app_foreground || blame_crash
go_habits || true
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
XY=$(xy_rid "habit-row-$HID"); [ -n "$XY" ] || XY=$(scroll_to_rid "habit-row-$HID")
[ -n "$XY" ] || { bad "撤销这一档点不进详情（habit-row-$HID 没出现）"; exit 1; }
$ADB shell input tap $XY; sleep 3
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
# 🔴 **同一颗按钮，两句 aria**：打过卡之后它必须说「撤销「…」今日打卡」。
#    这条不是装饰 —— 它证明界面读到的是"今天已经有记录"这个事实；如果 aria 还停在
#    「为「…」打卡」，那说明界面根本没收下那次写入，后面点下去就是**第二次打卡**。
[ "$(xy_desc "撤销「$HABIT_NAME」今日打卡")" != "" ] && ok "按钮已改口成「撤销「…」今日打卡」" \
  || { bad "按钮没改口（详情读到的还是「未打卡」那一档）"; exit 1; }
XY=$(scroll_to_rid "habit-checkin-$HID")
[ -n "$XY" ] || { bad "撤销那一下找不到按钮（habit-checkin-$HID 滚不进可点区域）"; exit 1; }
$ADB shell input tap $XY; sleep 3
phone_db_pull
LOG_DEL=$(op_count "$PHONE_DB" HABIT_LOG DEL "$LOG_ID")
if [ "${LOG_DEL:-}" = "1" ]; then ok "HABIT_LOG/DEL 恰好 1 条（软删除，不是物理删）"; else bad "HABIT_LOG/DEL 条数 = ${LOG_DEL:-读不到}（期望 1）"; fi
XY=$(xy_desc "返回"); [ -n "$XY" ] || XY=$(scroll_to_desc "返回")
[ -n "$XY" ] && { $ADB shell input tap $XY; sleep 2; }
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_desc_sub '连续 0 天')" = "1" ]; then ok "撤销后行 aria 回到「连续 0 天」"; else bad "撤销后 aria 没回到 0 天"; screen_txt; fi
shot 9-undo && judge_shot "⑧ 撤销后图" "$EVIDENCE/android-habits-9-undo.png"

# 🔴 「立即同步」这颗按钮住在**「我的」页**（H9 那一刀把顶栏的同步下移到这里），
#    而此刻界面还停在习惯屏 —— 直接调 `phone_sync` 会拿到
#    「desc 里既没有「立即同步」也没有「正在同步…」」，那条读数指向的是
#    **"同步坏了"**，真正缺的只是**先离开这一屏**。上一轮就是这么红的（00:1x 实测）。
XY=$(xy_desc "返回"); [ -n "$XY" ] || XY=$(scroll_to_desc "返回")
[ -n "$XY" ] || { bad "习惯屏的「返回」找不到，回不去「我的」—— 跨设备那一半没法发起"; exit 1; }
$ADB shell input tap $XY; sleep 2
dump
# 🔴 **重新输入凭据**，不是补一次点击：端到端加密口令按设计**只存在内存里**
#    （词条 `mobile.profile.password.hint` 逐字写着"应用重启后需要重新输入"），
#    而 ⑥⑦ 两条判据各自 `force-stop` 过一次 —— 所以到这一步设备**结构上不可能**再同步，
#    直到口令被重新输入。这一版一开始把它当成"同步卡住了"，`wait_synced` 空转到 180 轮
#    （900 秒）才红 —— 症状是"慢"，成因是"这条路根本不通"。
#    先例：`verify-mobile-account-erasure.sh` 每次重启之后都重新配一遍（7 次）。
require_untouched_device "第 10 步：决定要不要重新输入凭据之前"
if [ "$(has_desc "立即同步")" = "1" ] && [ "$(has_text "填好服务器地址与访问令牌后才能同步。")" != "1" ]; then
  ok "重启后凭据仍在（这一档不需要重新输入）"
else
  echo "     界面上凭据已失效（口令按设计只在内存）⇒ 重新输入一遍再发起同步"
  configure_sync_credentials
fi
phone_sync || bad "手机侧最终同步没完成（跨设备那一半只能等）"
ROUNDS="${HEYTA_HABITS_LAPTOP_ROUNDS:-120}"
i=0; seen=""
while [ "$i" -lt "$ROUNDS" ]; do
  laptop_raw sync >/dev/null 2>&1
  seen=$(op_count "$LAPTOP_DB" HABIT CRT "$HID")
  [ "${seen:-0}" != "0" ] && break
  i=$((i+1)); sleep 5
done
if [ "${seen:-0}" != "0" ]; then
  ok "笔记本读到了那条 HABIT（跨设备物化）"
  LOGS=$(op_count "$LAPTOP_DB" HABIT_LOG '*' "$LOG_ID")
  echo "   （笔记本侧这条打卡实体的 op 条数 = ${LOGS:-读不到}；打卡 + 撤销各 1 ⇒ 期望 2）"
  [ "${LOGS:-}" = "2" ] && ok "两次写入都到了对端" || bad "对端 HABIT_LOG 条数 = ${LOGS:-读不到}（期望 2）"
else
  bad "笔记本在 $((ROUNDS*5)) 秒里没读到那条习惯 —— 跨设备没闭环"
fi

step "11. ⑨ 这一批证据图不许有重复采集（内容哈希两两对账，不是按文件名）"
judge_shot_set
require_untouched_device "收尾：全部读数取完之后"

summary "移动端习惯屏装机验收"
