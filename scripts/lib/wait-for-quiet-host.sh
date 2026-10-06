#!/usr/bin/env bash
#
# 设备验收开局前的**宿主机门**（负载 + 内存两格）：不达标就不开始，等满以"环境无效"结束。
# =====================================================================
#
# 为什么抽成独立文件（traps #168 末尾那条待办的落地）：它原先是
# `scripts/verify-mobile-restore.sh` 里的一个**私有函数**。判据本身是对的
# （实测两轮：load 62 / load 18 时 `uiautomator dump` 抓不到界面，把一次环境失效
# 打印成一堆产品缺陷），但它住在某一个脚本里 ⇒ 第二个想用的脚本只能**再抄一份**，
# 而漂移的判据比没有判据更糟（同一台机器上两个验收脚本对"现在能不能跑"给出不同答案）。
# 现在只有一个所有者，各脚本显式调用它 —— 定义是惰性的，不想被挡的脚本不 source 就行。
#
# ⚠️ 调用方约定（与 `mobile-e2e.sh` 同一条）：在仓库根、`set -u` 之后
#    `. "$(dirname "$0")/lib/wait-for-quiet-host.sh"`，然后
#    `wait_for_quiet_host || exit 3`。
#
# 🔴 **位置**：必须放在这一轮**任何破坏性或有时限的动作之前** —— 设备上的
#    `pm clear` / `install -r` / 建号都算。判据晚了，一轮无效的运行照样先把
#    别人的现场清掉（这条在 §7 里被记成"外部依赖的探测要放在破坏性步骤之前"）。
#
# 🔴 退出码是**调用方**给的 3，不是 1：`3 = 环境无效，不是产品失败`。
#    这条区分不能丢 —— 把它折成 1 就等于宣布"产品坏了"。
#
# 旋钮：`HEYTA_LOAD_GATE_WAIT`（秒，默认 900）—— 等满即放弃。
# 阈值：`hw.ncpu × 3/4`（本机 16 核 ⇒ 12）。不写死数字，理由同 §7：抄件会漂。
#
# 🔴 **两格门，不是一格**：负载过了还要过 `host_memory_gate`（见下）。这台机上的弹窗与失控
#    是内存形状的，而产品负责人的硬规矩第二条是「测试开始之前必须探查好系统还剩多少内存」——
#    那条规矩在此之前**没有装置**，只有这句注释。两格共用同一个等待预算与同一个 `HEYTA_LOAD_GATE_WAIT`，
#    等满两格任一不过 ⇒ 同样 `return 1`（环境无效），不降级、不硬起。
#
# 内存门旋钮：`HEYTA_MEM_GATE_MIN_PCT`（默认 10）—— **占物理内存的百分比**，不是 GB、不是 swap。
# 负载门旋钮：`HEYTA_LOAD_GATE_MAX`（整数）—— 要收紧阈值的调用方经它传，不在脚本里重新推导。
#
# 🔴 **调用方不许再自己读一遍负载/内存**。这里导出两个**一次性谓词**：
#    `host_load_gate`（判一次负载，阈值从 `hw.ncpu` 推导）与 `host_memory_gate`（判一次内存），
#    并各导出 `HOST_LOAD_READING` / `HOST_LOAD_LIMIT` / `HOST_MEM_READING` 三条现量，
#    供调用方**原样打印**（"判一次就走"的脚本要的就是这个，而不是内层那个会睡觉的循环）。
#    理由不是整洁：本仓实测有 **5 处**各自抄了 `uptime | sed … | awk …`，其中 2 处抄的正是
#    #168 点名的坏写法 —— 抄件会漂，而漂成坏写法的那两份**今天还在把负载印成一行谎话**。
#
# ⚠️ 本仓库一律按 **bash 3.2**（macOS 自带）写：不用 `declare -A`。
#
# 用法（从 bash 调用）：
#   . scripts/lib/wait-for-quiet-host.sh
#   wait_for_quiet_host || exit 3            # 要等人
#   host_load_gate || GATES="$GATES,load"    # 只判一次（读数在 HOST_LOAD_READING / HOST_LOAD_LIMIT）

wait_for_quiet_host() {
  local waited=0 load_ok memv gap
  gap="${HEYTA_LOAD_GATE_INTERVAL:-30}"
  while :; do
    # 🔴 负载的**读法与阈值**都不在这里算：见下面的 `host_load_gate`。
    host_load_gate; load_ok=$?
    if [ "$load_ok" != 0 ]; then
      if [ "$waited" -ge "${HEYTA_LOAD_GATE_WAIT:-900}" ]; then
        echo "   ❌ 等满 ${HEYTA_LOAD_GATE_WAIT:-900}s 负载这格仍未过（现量 ${HOST_LOAD_READING}，阈值 ${HOST_LOAD_LIMIT}）—— 本轮不跑（环境无效，不是产品失败）" >&2
        return 1
      fi
      echo "   负载 ${HOST_LOAD_READING} 不达标（阈值 ${HOST_LOAD_LIMIT}），等 ${gap}s（累计 ${waited}s）"
      sleep "$gap"
      waited=$((waited + gap))
      continue
    fi
    # 🔴 负载过了**不等于能起跑**：这台机上的弹窗与失控都是内存形状（§见台账那三场），
    #    而产品负责人给这台机定的硬规矩第二条就是「一定要在测试开始之前探查好系统还剩多少内存」。
    #    原来这一格整个不存在 —— 也就是说那是一条**没有装置**的规矩（"我下次注意"不算交付）。
    if host_memory_gate; then
      echo "   负载 ${HOST_LOAD_READING} ≤ ${HOST_LOAD_LIMIT}，内存门也过 ⇒ 开始"
      return 0
    fi
    memv="${HOST_MEM_READING:-〈读不到〉}"
    if [ "$waited" -ge "${HEYTA_LOAD_GATE_WAIT:-900}" ]; then
      echo "   ❌ 等满 ${HEYTA_LOAD_GATE_WAIT:-900}s 内存仍不达标（现量 ${memv}）—— 本轮不跑（环境无效，不是产品失败）" >&2
      return 1
    fi
    echo "   负载已过但内存门未过（现量 ${memv}），等 ${gap}s（累计 ${waited}s）"
    sleep "$gap"
    waited=$((waited + gap))
  done
}

# ── 负载门（一次性谓词，不循环）─────────────────────────────────────
# 导出两条读数给调用方**原样打印**：`HOST_LOAD_READING`（现量）与 `HOST_LOAD_LIMIT`（阈值）。
# 它们存在的唯一理由：调用方自己再算一遍 `核数 × 3/4` 就是抄件，而抄件一定会漂 ——
# 实测本仓此刻有 5 处各自读过负载，其中 2 处（两条 account-erasure 验收）抄的正是
# `sysctl -n vm.loadavg | tr -d '{} '`，也就是 traps #168 点名**别再犯**的那种写法。
# 🔴 读的是 `uptime`，不是 `sysctl -n vm.loadavg`：后者输出带花括号，而 traps #168 实测过
#    那种"剥花括号"的写法（`tr -d '{} '`）**把分隔符连同三个值粘成一个非法整数**，
#    于是比较恒假、循环恒睡 —— 坏了 15 轮没人发现。手写等待循环 = 把别人踩平的坑重新踩。
# 🔴 读数不是整数 ⇒ 判**不过**并点名探针故障。原来这一层是漏的：`[ "$load" -gt "$limit" ]`
#    拿到非整数时自己报错返回 2，而调用方只看"否则放行"那一支 ⇒
#    **负载读不出来 = 放行**。这一族的其它地方都是反着钉的（读不到就判不过），这里是漏的那处。
# 旋钮：`HEYTA_LOAD_GATE_MAX`（整数）—— 要收紧阈值的调用方经它传（各脚本自己的旋钮名桥到
#    这里），不在脚本里重新推导一份。
host_load_gate() {
  local cores limit raw load
  HOST_LOAD_READING=''
  HOST_LOAD_LIMIT=''
  HOST_LOAD_VALUE=''
  cores=$(sysctl -n hw.ncpu)
  case "$cores" in
    '' | *[!0-9]*) echo "   ❌ 负载门：hw.ncpu=〈${cores:-空}〉非法 ⇒ 阈值推不出来，按探针故障处理（不放行）" >&2; return 1 ;;
  esac
  [ "$cores" -gt 0 ] || { echo "   ❌ 负载门：hw.ncpu=〈${cores}〉为 0 ⇒ 阈值恒 0，这条门永远开不了；按探针故障处理" >&2; return 1; }
  limit=$((cores * 3 / 4))
  case "${HEYTA_LOAD_GATE_MAX:-}" in
    '' | *[!0-9]*) ;;
    *) limit="${HEYTA_LOAD_GATE_MAX}" ;;
  esac
  HOST_LOAD_LIMIT="$limit"
  # 🔴 先**验字形**，再取整数部分。原来这里是 `awk '{print int($1)}'` 一步到位：
  #    `int()` 把 `junk` 折成 **0**（⇒ 负载探针整个读不出时"门大开着"），
  #    也把 traps #168 那串 `tr -d '{} '` 粘出来的 `31.4729.0034.04` 折成 **31**
  #    （⇒ 看着像个合法读数，实际是三个数糊在一起）。两种"探针坏了"都会被读成一个数。
  #    ⇒ 验字形只多一个 `[[ =~ ]]`（bash 3.2 实测可用），不验的代价就是 #168 那 15 轮。
  raw=$(uptime | sed 's/.*load averages: //' | awk '{print $1}')
  if ! [[ "$raw" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    HOST_LOAD_READING="load1=〈字形不合法：${raw:-空}〉"
    echo "   ❌ 负载门：uptime 的 1 分钟负载读出来是〈${raw:-空}〉，不是一个 'N' 或 'N.M' ⇒ 按探针故障处理（不放行；尤其不要把它当 0）" >&2
    return 1
  fi
  load=${raw%%.*}
  HOST_LOAD_VALUE="$load"
  HOST_LOAD_READING="load1=${load}（原始 ${raw}）"
  [ "$load" -gt "$limit" ] && return 1
  return 0
}

# ── 内存门（一次性谓词，不循环）──────────────────────────────────────
# 🔴 判据是**可回收占物理内存的百分比**，不是写死的 GB：写死 12GB 就是对某一台机器下断言
#    （本机 64GB 上宽裕，16GB 笔记本上永远够不着 ⇒ 一条永不成立的门，见 §7 那条"门要能开"）。
#    也**不拿 swap 当门**：macOS 的 swap 用出去就不回来，健康机器的 `vm.swapusage` 照样能显示 79%，
#    拿它设地板 = 把健康机器永久挡在门外（同一条教训记在 user 记忆里，这里是落地）。
# 阈值来源如实写清：默认 10% 是**定的默认值**，不是从被约束常量推出来的 ——
#    它的两个现量锚点是宿主那条 kill 线（`LIMIT_MB`，运行时读出来打在旁边，让人能否认）
#    与"单次测试最多占 1GB"这条当日规矩；两者都不构成算术推导，所以它是旋钮
#    （`HEYTA_MEM_GATE_MIN_PCT`），并且默认值在输出里**点名自己**。
# 🔴 读不到数字 ⇒ 判**不过**（探针坏不许冒充"内存够"），并把原因打出来。
host_memory_gate() {
  local need_gb total_mb free_pct reclaim_mb host_limit
  HOST_MEM_READING=''
  need_gb="${HEYTA_MEM_GATE_MIN_PCT:-10}"
  case "$need_gb" in
    '' | *[!0-9]*) echo "   ❌ 内存门：HEYTA_MEM_GATE_MIN_PCT=〈${need_gb}〉不是整数 ⇒ 按探针故障处理（不放行）" >&2; return 1 ;;
  esac
  # 主指标：`memory_pressure -Q` 的 free 百分比（macOS 自己的口径；只用这一条做判决）
  # 🔴 这里用**裸命令名**而不是 `/usr/bin/memory_pressure`，和上面 `uptime`/`sleep` 同一个理由：
  #    `scripts/mutate-closeout-gates.sh` 那套臂是靠**定义同名函数**来喂读数的，绝对路径会绕过函数
  #    查找 ⇒ 那条门就只能拿真机当时的内存做判据（机器一紧，臂就红在无关的事上；机器一松，
  #    "探针读不到要判不过"那一臂根本没法造）。PATH 里 /usr/bin 一定在，生产行为不变。
  free_pct=$(memory_pressure -Q 2>/dev/null | sed -n 's/.*memory free percentage: *\([0-9]\{1,\}\)%.*/\1/p' | head -1)
  if [ -z "$free_pct" ]; then
    echo "   ❌ 内存门：memory_pressure -Q 读不到 free 百分比 ⇒ 按探针故障处理（不许当成「内存够」）" >&2
    return 1
  fi
  # 参照读数（**不参与判决**，只为让人能否认归因）：可回收 MB 与宿主 kill 线。
  # 🔴 vm_stat 的行是 `Pages free:  4567.` —— 键要取**第二列**（`free:`），取第一列的话四行
  #    全叫 `Pages`、互相覆盖，最后只剩最后一次赋值（这类"键挑错列"的假 0 本仓记过不止一次）。
  reclaim_mb=$(vm_stat 2>/dev/null | awk -v ps="$(sysctl -n hw.pagesize)" '
    /page size of/ { next }
    { v = $NF; gsub(/[.]/, "", v); if (v ~ /^[0-9]+$/) s[$2] = v + 0 }
    END { p = ps / 1048576;
        printf "%.1f", (s["free:"] + s["purgeable:"] + s["speculative:"] + s["inactive:"]) * p }')
  total_mb=$(( $(sysctl -n hw.memsize) / 1048576 ))
  # 🔴 键路径是**嵌套**的：`LIMIT_MB` 住在 `EnvironmentVariables` 下面，直接写平键
  #    会以 "No value at that key path" 失败 ⇒ 那行参照读数永远印 `〈读不到〉`，
  #    而这正是"探针坏了看起来像没坏"的那一类（它不参与判决，所以不会拦人，只会让人以为宿主没设线）。
  host_limit=$(/usr/bin/plutil -extract EnvironmentVariables.LIMIT_MB raw -o - "$HOME/Library/LaunchAgents/com.rocalight.mem-enforce.plist" 2>/dev/null \
    || /usr/bin/plutil -extract LIMIT_MB raw -o - "$HOME/Library/LaunchAgents/com.rocalight.mem-enforce.plist" 2>/dev/null \
    || echo '〈读不到〉')
  HOST_MEM_READING="free ${free_pct}%（阈值 ${need_gb}%）· 可回收 ${reclaim_mb:-〈无〉}MB / 共 ${total_mb}MB · 宿主 kill 线 LIMIT_MB=${host_limit}"
  if [ "$free_pct" -lt "$need_gb" ]; then
    echo "   内存门：${HOST_MEM_READING} ⇒ 不达标（${free_pct}% < ${need_gb}%），本轮不跑"
    return 1
  fi
  echo "   内存门：${HOST_MEM_READING} ⇒ 过"
  return 0
}
