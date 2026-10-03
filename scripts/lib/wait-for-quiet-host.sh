#!/usr/bin/env bash
#
# 设备验收开局前的**宿主机负载门**：负载不达标就不开始，等满以"环境无效"结束。
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
# ⚠️ 本仓库一律按 **bash 3.2**（macOS 自带）写：不用 `declare -A`。
#
# 用法（从 bash 调用）：
#   . scripts/lib/wait-for-quiet-host.sh
#   wait_for_quiet_host || exit 3

wait_for_quiet_host() {
  local cores limit waited=0 load gap
  gap="${HEYTA_LOAD_GATE_INTERVAL:-30}"
  cores=$(sysctl -n hw.ncpu)
  limit=$((cores * 3 / 4))
  while :; do
    # 🔴 读的是 `uptime`，不是 `sysctl -n vm.loadavg`：后者输出带花括号，而 traps #168 实测过
    #    那种"剥花括号"的写法（`tr -d '{} '`）**把分隔符连同三个值粘成一个非法整数**，
    #    于是比较恒假、循环恒睡 —— 坏了 15 轮没人发现。手写等待循环 = 把别人踩平的坑重新踩。
    load=$(uptime | sed 's/.*load averages: //' | awk '{print int($1)}')
    if [ "$load" -le "$limit" ]; then
      echo "   负载 $load ≤ ${limit}（$cores 核 × 3/4），开始"
      return 0
    fi
    if [ "$waited" -ge "${HEYTA_LOAD_GATE_WAIT:-900}" ]; then
      echo "   ❌ 等满 ${HEYTA_LOAD_GATE_WAIT:-900}s 负载仍是 $load —— 本轮不跑（环境无效，不是产品失败）" >&2
      return 1
    fi
    echo "   负载 $load > ${limit}，等 ${gap}s（累计 ${waited}s）"
    sleep "$gap"
    waited=$((waited + gap))
  done
}
