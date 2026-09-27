#!/bin/bash
#
# 移动端冲突解决闭环验收（真机/模拟器，零 mock）
# ================================================
#
# 🔴 为什么必须有这个脚本
#
# 单元测试证明不了**接线**。`conflict-view.spec.ts` 能证明"取不到对端时不标较新"，
# 但它证明不了「逐条处理」按钮真的打开了界面、面板上的按钮真的把**那一处**冲突
# 带着正确的 `opId` 交给了 `resolveConflict`。
# 这两件事之间隔着 React 的 props 和一个 Modal —— 而那正是最容易接错的地方
# （我写第一版时就把一个字段全空的假对象传了进去，类型检查全绿而解决必然失败）。
#
# 所以这个脚本走完整的真实路径：
#
#   真模拟器 → 真点击 → 真 SQLite → 真 HTTP → 真服务端 → 真 Postgres
#
# 而且**冲突是真的造出来的**，不是构造的 `ConflictInfo`：
#
#   1. 手机建任务并同步                                 → 服务端 {phone:1}
#   2. 「笔记本」（node-host）同步下载它，改标题，同步   → 服务端 {phone:1, laptop:1}
#   3. 手机**在没下载到笔记本那条的前提下**勾完成        → 本地 {phone:2}（并发）
#   4. 手机同步 → 上传被 CONFLICT_CONCURRENT 拒绝        → 手机上出现 1 处冲突
#   5. 在界面上点「逐条处理」→ 点「保留这一版」           → 双端收敛到同一个值
#
# 第 3 步是关键：两端对同一个实体各自改了一次、且互不知情 —— 这才是真冲突。
#
# ═════════════════════════════════════════════════════════════════════════
# 🔴 三个 adb 陷阱（都实测踩过，每一个都会让脚本"看起来通过"）
#
# 1. **`input text` 不能输入非 ASCII。** 底层 `sendText` 对中文直接抛
#    `NullPointerException: Attempt to get length of null array`，
#    而且**退出码不一定是非零** —— 于是下一步报"创建失败"，方向直接偏到应用上。
#    所以这里的标题一律 ASCII。
# 2. **标签与输入框的 `content-desc` 是同一个字符串。** 只按 desc 找会命中
#    输入框**上方**的标签，点它不会聚焦；随后的 `input text` 打到没有焦点的界面上，
#    而脚本一路报 ✅（实测：令牌和口令两个字段其实都是空的）。
#    必须用 `class="android.widget.EditText"` 把两者分开。
# 3. **`cmd | tail -1` 的退出码是 `tail` 的。** 用它判断子命令成败永远为真。
#    子命令的成败只能从它的 JSON 输出里读。
# ═════════════════════════════════════════════════════════════════════════
#
# 用法：
#   bash scripts/verify-mobile-conflict.sh
#
# 前置：模拟器在跑、Postgres 在 5432、服务端在 3000（**TEST_MODE**）。
#       账号由本脚本调用 `/api/test/create-user` **每轮新建**并写入
#       /tmp/heyta_mobile_{token,email,e2ee}.txt —— 不需要事先准备。
#       想复用现有账号排查问题：`HEYTA_E2E_KEEP_ACCOUNT=1 bash ...`


# ── 先准备账号，再加载共享库 ────────────────────────────────
#
# 🔴 顺序**不能反**：共享库在 source 的那一刻就把
# `/tmp/heyta_mobile_{token,email,e2ee}.txt` 读进常量里了。
# 先 source 再建号，拿到的仍是上一个号（而且是个跑过很多轮的号）。
#
# 每轮换新号的**理由**写在 `lib/mobile-e2e-fresh-account.sh` 的文件头里：
# 账号的 client 数每轮 +2，越过 `MAX_VECTOR_CLOCK_SIZE = 20` 之后每个向量时钟
# 都被裁剪，本设备的写入会被服务端永久判成并发。那位"看起来像手机的锅"的
# "手机没有报冲突"就是这么来的。
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1

# 常量、定位器、断言与"笔记本设备"辅助全部在共享库里 ——
# 另一个验收脚本（`verify-mobile-task-edit.sh`）用的是同一份。
. "$(dirname "$0")/lib/mobile-e2e.sh"

TITLE="conflict-e2e-$(date +%H%M%S)"
LAPTOP_TITLE="laptop-edited-$TITLE"
# ── 开始 ──────────────────────────────────────────────────
echo ""
echo "=== 移动端冲突解决闭环验收（真实模拟器 + 真服务端，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER   库: heyta_mobile_smoke"
echo "  账号: $EMAIL"
echo "  任务: $TITLE"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi

# 干净的笔记本设备：上次失败会留下一个改过名的任务，会让断言含混
rm -f "$LAPTOP_DB"

step "0. 装包并启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 🔴 清掉本地数据。上一次跑到一半会在 SQLite 里留下垃圾任务和待上传 op，
# 它们会在本次首次同步时一起上传，让"冲突数量"和标题断言全部含混。
# `pm clear` 等价于全新安装，是本脚本唯一能拿到确定初态的办法。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 12
[ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ] && ok "应用已启动" || bad "应用没起来"

# 🔴 **前置条件断言**：账号的 client 数必须还在 `MAX_VECTOR_CLOCK_SIZE` 之下。
# 一旦越过，向量时钟被裁剪 → 服务端拒绝本设备的**每一条**写入 →
# 后面所有冲突/收敛断言都不再有意义。让它在这里自己说出来，
# 而不是伪装成第 5 步的"手机没有报冲突"。
heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

step "1. 配置同步凭据"
configure_sync_credentials

step "2. 手机建任务并同步（第一次）"
$ADB shell input tap 135 2253; sleep 3   # 「任务」
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then bad "找不到新建按钮"; else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then bad "新建面板里找不到输入框"; else
    $ADB shell input tap $XY; sleep 1
    $ADB shell input text "$TITLE"; sleep 1.5
    dump
    [ "$(has_text "$TITLE")" = "1" ] && ok "标题已输入" || { bad "标题没输进去"; screen_txt; }
    # 这里曾经需要"先收键盘再点「添加」"：按钮就在面板底部，键盘盖在上面，
    # 按坐标点下去命中的是键盘（实测凭空输入了 "." 并顺手提交，标题变成
    # `conflict-e2e-010552.`）。现在整个验收期间 IME 都是关的，不存在这个问题。
    dump
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then bad "收键盘后找不到「添加」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
[ "$(has_text "$TITLE")" = "1" ] && ok "任务已创建：$TITLE" || { bad "任务没创建"; screen_txt; }

$ADB shell input tap 945 2253; sleep 3
ensure_phone_sync
sleep 5
echo "     首次同步含密钥派生，等待中…（最长等 900 秒）"
if ELAPSED=$(wait_synced 180); then
  # 回显耗时：同一份代码在 load 3 时约 40 秒，在 load 43–151 时实测超过 300 秒
  # （见共享库 `wait_synced` 的注释）。不回显的话，"慢"和"卡死"在日志里一模一样。
  ok "手机首次同步成功（耗时约 ${ELAPSED} 秒）"
else
  bad "首次同步没成功（已等 900 秒；状态见下）"
  screen_txt
fi

step "3. 笔记本：下载 → 改标题 → 同步"
LAPTOP_ID=$(laptop list | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((t['id'] for t in d.get('tasks',[]) if t['title']=='$TITLE'),''))
")
if [ -z "$LAPTOP_ID" ]; then
  laptop_ok sync || true
  LAPTOP_ID=$(laptop list | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((t['id'] for t in d.get('tasks',[]) if t['title']=='$TITLE'),''))
")
fi
[ -n "$LAPTOP_ID" ] && ok "笔记本已同步到该任务（id=$LAPTOP_ID）" || bad "笔记本没看到手机那条任务"
if [ -n "$LAPTOP_ID" ]; then
  laptop_ok rename "$LAPTOP_ID" "$LAPTOP_TITLE" && ok "笔记本改了标题（暂未同步）" || bad "rename 失败"
  laptop_ok sync && ok "笔记本 sync 返回成功" || bad "笔记本 sync 失败"
  # 🔴 **`ok:true` 不等于"服务端收到了"。** 实测到过这样一次：
  #   客户端：`uploadStatus=uploaded`、`pending=0`、`sync` 返回 `{kind:'synced'}`
  #   服务端：该实体**一条笔记本的 op 都没有**（只有手机的 CRT + UPD）
  # 也就是说这次编辑被拒了，却被当成"已同步" —— 而用户什么提示都看不到。
  # 后果不只是这个脚本变红：**冲突根本没被造出来**，第 5 步会以
  # "手机没有报冲突"这种极具误导性的说法失败（看起来像手机的锅）。
  # 所以这里直接问服务端：那条改名 op 到底落库没有。
  SRV_UPD=$(psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
    "SELECT count(*) FROM operations WHERE entity_id='$LAPTOP_ID' AND op_type='UPD';" 2>/dev/null | tr -d ' ')
  if [ "${SRV_UPD:-0}" -ge 1 ]; then
    ok "笔记本的改动确实落到了服务端（该实体有 $SRV_UPD 条 UPD）"
  else
    bad "笔记本自称上传成功，但服务端该实体一条 UPD 都没有 —— 假绿，冲突造不出来"
    echo "      ⚠️ 这是产品缺陷（被拒的 op 被标成 uploaded），不是脚本问题；见 P2 计划 §2.6 的未决项"
  fi
fi

step "4. 手机在**没下载到笔记本那条**的前提下改同一实体（造真并发）"
$ADB shell input tap 135 2253; sleep 3
dump
# 🔴 点**勾选框**，不是任务行。行上的主操作已经改成"打开详情"，
# 点行会弹出详情面板而不会切换完成 —— 而这一步要的是一次**数据**改动。
# 🔴 必须滚：任务多起来之后，这一条会在屏幕外，它的 bounds 会变成负高度，
# 而 `xy_desc` 照样返回一个"中心点"坐标 —— 点下去什么都不会发生，
# 日志还写着"已点"。这是"在 dump 里 ≠ 可点"的第 N 次复现。
XY=$(scroll_to_desc "完成：$TITLE")
if [ -z "$XY" ]; then bad "找不到勾选框（无法制造本地改动）"; screen_txt; else
  $ADB shell input tap $XY; sleep 3
  dump
  # 🔴 验证状态**真的翻了**，而不是"点了就算成功"：
  # 点错位置时坐标照样取得到，只有断言能发现。
  # 🔴 **勾上之后这一条会移进「已完成」分组**（列表最底部），
  # 所以不能用 `has_desc` 在原地找翻转后的标签 —— 它已经不在那儿了。
  # 实测代价：这条断言连续两轮误报"勾选框点了但完成状态没变"，
  # 而把手机上的 op-log 拉下来一看，记着 `completedAt` 的那条 UPD
  # （`ts=1790365139579`）**早就写进去了**。
  # **断言查错了地方 = 假红，而假红会让人去改本来正确的代码。**
  if [ -n "$(scroll_to_desc "取消完成：$TITLE")" ]; then
    ok "手机本地勾了完成（本地 op，尚未同步）"
  else
    bad "勾选框点了但完成状态没变（滚到列表底部也没找到翻转后的标签）"
    screen_txt
  fi
fi

step "5. 手机同步 → 应出现冲突"
$ADB shell input tap 945 2253; sleep 3
ensure_phone_sync
sleep 8
C=$(wait_conflict)
case "$C" in
  conflict)  ok "手机检测到真实冲突" ;;
  uploading) bad "等满 360 秒手机仍在上传，无法判定是否存在冲突（环境问题，不是产品结论）"; screen_txt ;;
  *)         bad "同步已结算但没报冲突 —— 这才是真的「未触发冲突」"; screen_txt ;;
esac
[ "$(has_text "逐条处理")" = "1" ] && ok "冲突入口按钮已出现" || bad "没有「逐条处理」按钮"

step "6. 打开冲突界面，核对两侧内容都摆出来了"
# 「我的」屏很长，冲突通知在折叠线以下 —— 必须先滚进可点区再点
XY=$(scroll_to_text "逐条处理")
if [ -z "$XY" ]; then bad "点不到「逐条处理」（滚动后仍不可点）"; else
  $ADB shell input tap $XY; sleep 4
  dump
  L=$(has_text "本机"); R=$(has_text "其他设备")
  [ "$L" = "1" ] && [ "$R" = "1" ] && ok "并排显示了两侧（本机 / 其他设备）" || bad "两侧没同时出现（本机=$L 其他设备=$R）"
  N=$(grep -o 'text="保留这一版"' /tmp/ui.xml | wc -l | tr -d ' ')
  [ "$N" -ge 2 ] && ok "两个「保留这一版」按钮都在（$N 个）" || bad "保留按钮数量不对（$N）"
  [ "$(has_text "取不到这一侧的版本")" = "1" ] && bad "不该出现「取不到」——两端都应取得到" || ok "两侧都取到了版本"
  [ "$(has_text "$LAPTOP_TITLE")" = "1" ] && ok "界面上能看到对端那一版的内容" || bad "看不到对端内容"
  # 🔴 全中文界面：服务端那句英文诊断（`Concurrent modification detected for TASK:...`）
  # 曾经直接显示在这一行上。这是移动端真机验收抓到的真实缺陷 ——
  # 根因是 `reason`（英文诊断）被当成 `errorCode`（机器可读编码）用了。
  if [ "$(has_sub "Concurrent")" = "0" ] && [ "$(has_sub "detected for")" = "0" ]; then
    ok "冲突界面没有漏出服务端的英文诊断"
  else
    bad "界面上出现了英文诊断"
  fi
  screen_txt
fi

step "7. 点「保留这一版」（选**其他设备**那一侧）"
# 两个按钮同名，按 x 排序：左 = 本机，右 = 其他设备
XY=$(xy_text "保留这一版" 1)
if [ -z "$XY" ]; then bad "取不到第二个「保留这一版」按钮"; else
  echo "     点击 ($XY)"
  $ADB shell input tap $XY; sleep 10
  ok "已点击「保留这一版」"
fi

step "8. 断言：冲突消失，且手机上的值等于笔记本那一版"
# 🔴 判"冲突消失"必须**先切到「我的」页**，不能在别的页上找"没有这段文字"。
#    第一版直接 `has_sub "处冲突待你选择" = 0`，而那一刻屏幕在「任务」页 ——
#    冲突提示本来就不在那，于是**假阳性** `✅ 冲突已解决`。
#    同一步的下一条却报 `❌ 手机没显示笔记本那一版`，7b 的屏幕又明确写着
#    `• 有 1 处冲突待你选择`：三条证据互相矛盾，真相是解决根本没生效。
RESOLVE_REMOTE_OK=0
# 7b–9b 的级联闸门开关。这里显式初始化：脚本本身没开 `set -u`（空值安全），
# 但以后谁加上 `set -u` 时，未初始化会直接炸 —— 不值得留这个雷。
SKIPPED_MACHINE_LOCAL=0
for i in $(seq 1 15); do
  if [ "$(conflict_pending)" = "0" ]; then RESOLVE_REMOTE_OK=1; break; fi
  sleep 4
done
if [ "$RESOLVE_REMOTE_OK" = "1" ]; then
  ok "冲突已解决"
else
  bad "冲突仍在（「我的」页上仍有「有 N 处冲突待你选择」）"; screen_txt
fi
$ADB shell input tap 135 2253; sleep 3
# 🔴 同第 4 步的理由：这条任务在第 4 步被勾成了完成，它现在躺在**列表最底部的
# 「已完成」分组**里，而十几条待办足以把它顶到屏幕外。必须滚过去找。
if [ -n "$(scroll_to_text "$LAPTOP_TITLE")" ]; then
  ok "手机显示的是笔记本那一版：$LAPTOP_TITLE"
else
  bad "手机没显示笔记本那一版（滚到列表底部也没找到）"; screen_txt
  # 值也没收敛 → 这一轮「保留远端」整体不成立，后面不能再往下推
  RESOLVE_REMOTE_OK=0
fi

step "9. 断言：笔记本同步后看到同一个值（双端收敛）"
laptop_ok sync || bad "笔记本 sync 失败"
LT=$(laptop_title_of "$LAPTOP_ID")
if [ "$LT" = "$LAPTOP_TITLE" ]; then ok "笔记本侧值一致：$LT"; else bad "笔记本侧值不一致：'$LT'"; fi

step "7b. 再造一次冲突，这次选「保留本机」—— 验证**另一个**解决动作"

# 🔴 **级联闸门**：前面「保留远端」要是没成立，这一整段就没有意义。
#
#    实测（2026-09-26）：步骤 7 的那一下点击在高负载下**没生效**，
#    于是冲突一直在、值也没收敛。但脚本照旧往下跑，结果连爆 5 个失败
#    （干净起点没结算 / 找不到勾选框 / 第二次没报冲突 / 点不到逐条处理 / op 数没增加），
#    **每一个看起来都像「保留本机」坏了** —— 而真正坏的只是前面那一下点击。
#
#    这就是最贵的一类失败：不是"没测出来"，而是**测出来一个错的结论**。
#    所以前置不成立时必须**明确停机**，而不是继续推。
if [ "$RESOLVE_REMOTE_OK" != "1" ]; then
  echo ""
  echo "   ⛔ 跳过 7b–9b：「保留远端」前置未成立，无法得出关于「保留本机」的任何结论。"
  echo "      这不是「保留本机」失败 —— 是环境导致的前置步骤未完成（高负载下点击未生效）。"
  echo "      需要重跑；若重跑仍失败，再怀疑产品。"
  echo ""
  SKIPPED_MACHINE_LOCAL=1
fi

if [ "$SKIPPED_MACHINE_LOCAL" = "1" ]; then
  : # 跳过下面整段
else

# 🔴 为什么必须补这一段：
#    上面只验了「保留远端」。两个动作走的是**完全不同的代码路径**：
#      · 保留远端 = 丢弃本地待上传项（但**不删 op**）
#      · 保留本机 = **重新派发一个新 op**
#    只验一个就说"冲突解决闭环通了"，等于把另一半留成未测代码 ——
#    而它恰好是"重新派发"这种更容易写错的一侧（opId 要不要换？基线要不要更新？）。
#
# 造冲突的方式与第 2~5 步同构，但这次换一个字段（勾选状态），
# 这样即使标题那条已经收敛，也能再造一次真并发。

# 数服务端 op 数 —— 走 API 而不是 psql，免得依赖宿主机上 psql 在哪。
# 用 `--noproxy '*'`：本机 shell 设了 HTTP_PROXY，走代理会连不上本机服务端。
server_op_count() {
  curl -s --noproxy '*' -m 15 -H "Authorization: Bearer $TOKEN" \
    "$HOST_SERVER/api/sync/ops?sinceSeq=0&limit=500" \
    | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('ops') or []))" 2>/dev/null
}

# 1) 手机先同步到最新，作为干净起点
OPS_AT_CLEAN_START=$(server_op_count)
echo "     干净起点的服务端 op 数 = $OPS_AT_CLEAN_START"
$ADB shell input tap 945 2253; sleep 3
ensure_phone_sync; sleep 10
# 🔴 这里**必须断言同步真的结算了**，不能无条件 `ok`。
#    第一版写的是循环结束就 `ok "起点干净"` —— 那是个**永远不会失败的断言**：
#    超时和成功打出同一句话。日志里它一直显示 ✅，而紧接着就是
#    `❌ 第二次没报冲突` + 手机上"正在上传…"，说明"干净起点"根本不存在。
SYNC_SETTLED=0
for i in $(seq 1 90); do
  sleep 4; dump
  # 结算 = 既没有"正在上传"，也没有冲突待处理
  if [ "$(has_sub "正在上传")" = "0" ] && [ "$(has_sub "处冲突待你选择")" = "0" ]; then
    SYNC_SETTLED=1; break
  fi
done
if [ "$SYNC_SETTLED" = "1" ]; then
  ok "手机已同步到最新（起点干净）"
else
  bad "手机同步没有在 360 秒内结算（仍在上传或仍有冲突）——后续步骤的基线不可信"
  screen_txt
fi

# 2) 笔记本再改一次标题并同步
SECOND_TITLE="laptop-second-$TITLE"
laptop_ok rename "$LAPTOP_ID" "$SECOND_TITLE" && ok "笔记本第二次改名" || bad "笔记本第二次 rename 失败"
laptop_ok sync && ok "笔记本第二次 sync" || bad "笔记本第二次 sync 失败"
# 断言它**真的到了服务端**，而不是只看 sync 的返回码
OPS_AFTER_LAPTOP=$(server_op_count)
if [ "$OPS_AFTER_LAPTOP" -gt "$OPS_AT_CLEAN_START" ]; then
  ok "笔记本那条改名确实落到了服务端（op 数 $OPS_AT_CLEAN_START → $OPS_AFTER_LAPTOP）"
else
  bad "笔记本 sync 报成功，但服务端 op 数没变（$OPS_AT_CLEAN_START → $OPS_AFTER_LAPTOP）"
fi

# 3) 手机**在没下载到那条的前提下**再改一次（勾选状态）
#
# 🔴 这里必须用 `$LAPTOP_TITLE`（手机**当前**持有的那个标题），**不是** `$SECOND_TITLE`。
#    手机此刻还没下载笔记本刚做的那次改名，所以它界面上的任务仍然叫 `$LAPTOP_TITLE`
#    （第 7~9 步刚收敛到的那一版）。用 `$SECOND_TITLE` 去找勾选框会永远找不到 ——
#    第一版就是这么写的，日志里"找不到勾选框"旁边正好打印着旧标题，一眼能看出来。
#    这恰恰是**造真并发**的前提：手机在旧基线上改，笔记本在新基线上改。
$ADB shell input tap 135 2253; sleep 3
dump
# 🔴 **必须断言状态真的翻转了，不能只断言"点到了"。**
#
#    第一版这里只写了"找到勾选框 → 点 → ok"，于是它**通过了**，
#    但后面"第二次没报冲突"、`解决前服务端 op 数 = 4`（笔记本刚加过一条 op，
#    本该 ≥5）—— 两条证据合起来说明：**那一下根本没产生本地 op**。
#    没有本地改动，就没有并发，自然没有冲突。
#
#    这正是原脚本第 4 步注释里写过的坑：
#    「点错位置时坐标照样取得到，只有断言能发现」。
#    我在新代码里把它忘了，于是又踩了一次。
XY=$(scroll_to_desc "完成：$LAPTOP_TITLE")
TAP_LABEL="完成"
[ -z "$XY" ] && { XY=$(scroll_to_desc "取消完成：$LAPTOP_TITLE"); TAP_LABEL="取消完成"; }
if [ -z "$XY" ]; then bad "找不到勾选框（第二次造并发）"; screen_txt; else
  echo "     点的是「$TAP_LABEL：$LAPTOP_TITLE」@ $XY"
  $ADB shell input tap $XY; sleep 3
  # 翻转之后标签会变成**另一个**；而且这条会移进/移出「已完成」分组，
  # 所以要滚动去找，不能在原地找。
  if [ "$TAP_LABEL" = "完成" ]; then
    WANT_AFTER="取消完成：$LAPTOP_TITLE"
  else
    WANT_AFTER="完成：$LAPTOP_TITLE"
  fi
  if [ -n "$(scroll_to_desc "$WANT_AFTER")" ]; then
    ok "手机第二次本地改动（勾选状态已翻转，尚未同步）"
  else
    bad "勾选框点了但状态没变（滚遍列表也没找到「$WANT_AFTER」）—— 没有本地 op 就不会有冲突"
    screen_txt
  fi
fi

# 4) 同步 → 应再次出现冲突
$ADB shell input tap 945 2253; sleep 3
ensure_phone_sync; sleep 8
#
# 🔴 **循环必须长到同步真的能跑完，而且必须能区分"还没跑完"和"真的没冲突"。**
#
#    实测（2026-09-26）：第一版只轮询 12×4=48 秒就放弃，于是打
#    `❌ 第二次没报冲突`。但日志紧接着的屏幕内容是
#        • 正在上传…   • 待上传 1 项
#    —— **手机上还在上传**。这台模拟器做一次同步要 160 秒
#    （Argon2id 纯 JS 派生 + 宿主机高负载），48 秒根本不够。
#
#    所以判据是**三态**，不是布尔：
#      出现冲突        → 成功
#      还在上传        → 继续等（不算失败）
#      结算了但无冲突  → **这才是真的失败**
CONFLICT_SEEN=0
C=$(wait_conflict)
case "$C" in
  conflict)  CONFLICT_SEEN=1; ok "第二次检测到真冲突" ;;
  uploading) bad "等满 360 秒手机仍在上传，无法判定是否存在冲突（环境问题，不是产品结论）"; screen_txt ;;
  *)         bad "同步已结算但没报冲突 —— 这才是真的「未触发冲突」"; screen_txt ;;
esac

# 5) 记下解决**之前**的服务端 op 数
OPS_BEFORE=$(server_op_count)
echo "     解决前服务端 op 数 = $OPS_BEFORE"

# 6) 打开冲突界面，点**左边**那个（本机）
XY=$(scroll_to_text "逐条处理")
if [ -z "$XY" ]; then bad "点不到「逐条处理」（第二次）"; else
  $ADB shell input tap $XY; sleep 4
  dump
  XY=$(xy_text "保留这一版" 0)   # 按 x 排序：第 0 个 = 本机
  if [ -z "$XY" ]; then bad "取不到第一个「保留这一版」（本机侧）"; else
    echo "     点击 (本机侧) $XY"
    $ADB shell input tap $XY; sleep 12
    ok "已点「保留这一版」（**本机**侧）"
  fi
fi

step "8b. 断言：冲突消失，且**派发了新 op**（保留本机 = 重新派发）"
# 🔴 同步骤 8：判"冲突消失"必须**先在「我的」页上找**，不能原地找"没有这段文字"。
#    这里原来写的是 `has_sub "处冲突待你选择" = "0"` —— 和步骤 8 一模一样的假阳性，
#    修步骤 8 时漏了这一处。
RESOLVE_LOCAL_OK=0
for i in $(seq 1 15); do
  if [ "$(conflict_pending)" = "0" ]; then RESOLVE_LOCAL_OK=1; break; fi
  sleep 4
done
if [ "$RESOLVE_LOCAL_OK" = "1" ]; then
  ok "第二次冲突已解决"
else
  bad "第二次冲突仍在"; screen_txt
fi

# 🔴 这是这一段**最核心**的断言。
#    「保留本机」的语义是**重新派发一个新 op**，所以服务端 op 数必须**增加**。
#    如果实现成了"只清掉冲突标记、不重发"，界面看起来完全正常（冲突没了），
#    但另一台设备**永远收不到**这一版 —— 那正是这个断言要拦住的。
OPS_AFTER=$(server_op_count)
echo "     解决后服务端 op 数 = $OPS_AFTER"
if [ -n "$OPS_BEFORE" ] && [ -n "$OPS_AFTER" ] && [ "$OPS_AFTER" -gt "$OPS_BEFORE" ]; then
  ok "服务端 op 数增加（$OPS_BEFORE → $OPS_AFTER）—— 确实**重新派发**了新 op"
else
  bad "服务端 op 数没有增加（$OPS_BEFORE → $OPS_AFTER）——「保留本机」没有重新派发"
fi

step "9b. 断言：笔记本同步后与手机**勾选状态一致**（另一侧也走通）"
laptop_ok sync || bad "笔记本第三次 sync 失败"

# 🔴 这里断言的是**两端一致**，不是某个写死的方向。
#    第 3 步是"翻转勾选"，翻转后的方向取决于之前是什么状态 ——
#    把期望值写死成 completed 是在赌一个我没验证过的前提。
#    真正的要求是**收敛**：两边看到同一个值。
#    所以先读手机**当前**是哪个标签，再去比对笔记本。
#
# 🔴 **必须先切回「任务」页。** 上一步判"冲突消失"用的是 `conflict_pending()`，
#    而它为了看到冲突提示会**导航到「我的」页**。留在那一页上 dump，
#    任务行当然一条都找不到 —— 实测报
#    `❌ 读不到手机侧勾选状态（两端的标签都没找到）`，屏幕 dump 里是
#    `• 状态`（「我的」页的字段），而两端其实都收敛了。
#    **在错误的屏幕上找东西，find 得再勤也没用。**
$ADB shell input tap 135 2253 >/dev/null 2>&1   # 「任务」tab
sleep 3
dump
PHONE_STATE=""
# 🔴 **两个标题都要查。** 冲突解决后手机上留的是哪个标题，取决于 op 的落地顺序：
#    「保留本机」重发的 op 带的是**手机那一版**的载荷，而手机在同步时**又下载了**
#    笔记本的第二次改名。谁最终胜出依赖向量时钟，不是测试该写死的前提。
#    实测（2026-09-26）：只查 `$LAPTOP_TITLE` 时报
#    `❌ 读不到手机侧勾选状态（两端的标签都没找到）` —— 而两边其实都收敛了，
#    只是手机显示的是另一个标题。**要断言的是勾选状态一致，不是标题是哪一个。**
for _t in "$LAPTOP_TITLE" "$SECOND_TITLE"; do
  [ -n "$PHONE_STATE" ] && break
  [ -n "$(scroll_to_desc "取消完成：$_t")" ] && PHONE_STATE="completed"
  [ -z "$PHONE_STATE" ] && [ -n "$(scroll_to_desc "完成：$_t")" ] && PHONE_STATE="open"
done
echo "     手机侧勾选状态 = ${PHONE_STATE:-（没读到）}"

LT_STATE=$(laptop list --all | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
t=next((t for t in d.get('tasks',[]) if t['id']=='$LAPTOP_ID'), None)
print('completed' if (t or {}).get('completedAt') else 'open')
")
echo "     笔记本侧勾选状态 = ${LT_STATE:-（没读到）}"

if [ -z "$PHONE_STATE" ]; then
  bad "读不到手机侧勾选状态（两端的标签都没找到）"; screen_txt
elif [ "$PHONE_STATE" = "$LT_STATE" ]; then
  ok "双端勾选状态一致（都是 $PHONE_STATE）——「保留本机」后另一侧也收敛了"
else
  bad "双端勾选状态不一致（手机=$PHONE_STATE 笔记本=$LT_STATE）"
fi
fi  # ← 对应 7b 开头的「保留远端前置未成立则跳过」闸门

step "10. 直接查 Postgres"
psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT (SELECT count(*) FROM operations) AS ops, (SELECT count(*) FROM sync_devices) AS devices" 2>/dev/null \
  | sed 's/^/      ops|devices = /'

summary "移动端冲突解决闭环"
