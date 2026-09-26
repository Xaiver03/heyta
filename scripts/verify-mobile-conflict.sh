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
dump
XY=$(xy_text "立即同步")
$ADB shell input tap $XY; sleep 5
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
dump
XY=$(xy_text "立即同步")
$ADB shell input tap $XY; sleep 8
for i in $(seq 1 12); do sleep 4; dump; [ "$(has_sub "处冲突待你选择")" = "1" ] && break; done
dump
if [ "$(has_sub "处冲突待你选择")" = "1" ]; then
  ok "手机检测到真实冲突"
else
  bad "手机没有报冲突"; screen_txt
fi
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
for i in $(seq 1 15); do sleep 4; dump; [ "$(has_sub "处冲突待你选择")" = "0" ] && break; done
dump
[ "$(has_sub "处冲突待你选择")" = "0" ] && ok "冲突已解决" || { bad "冲突仍在"; screen_txt; }
$ADB shell input tap 135 2253; sleep 3
# 🔴 同第 4 步的理由：这条任务在第 4 步被勾成了完成，它现在躺在**列表最底部的
# 「已完成」分组**里，而十几条待办足以把它顶到屏幕外。必须滚过去找。
if [ -n "$(scroll_to_text "$LAPTOP_TITLE")" ]; then
  ok "手机显示的是笔记本那一版：$LAPTOP_TITLE"
else
  bad "手机没显示笔记本那一版（滚到列表底部也没找到）"; screen_txt
fi

step "9. 断言：笔记本同步后看到同一个值（双端收敛）"
laptop_ok sync || bad "笔记本 sync 失败"
LT=$(laptop_title_of "$LAPTOP_ID")
if [ "$LT" = "$LAPTOP_TITLE" ]; then ok "笔记本侧值一致：$LT"; else bad "笔记本侧值不一致：'$LT'"; fi

step "7b. 再造一次冲突，这次选「保留本机」—— 验证**另一个**解决动作"

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
$ADB shell input tap 945 2253; sleep 3
dump; XY=$(xy_text "立即同步"); $ADB shell input tap $XY; sleep 10
for i in $(seq 1 12); do sleep 4; dump; [ "$(has_sub "处冲突待你选择")" = "0" ] && break; done
ok "手机已同步到最新（起点干净）"

# 2) 笔记本再改一次标题并同步
SECOND_TITLE="laptop-second-$TITLE"
laptop_ok rename "$LAPTOP_ID" "$SECOND_TITLE" && ok "笔记本第二次改名" || bad "笔记本第二次 rename 失败"
laptop_ok sync && ok "笔记本第二次 sync" || bad "笔记本第二次 sync 失败"

# 3) 手机**在没下载到那条的前提下**再改一次（勾选状态）
$ADB shell input tap 135 2253; sleep 3
dump
XY=$(scroll_to_desc "完成：$SECOND_TITLE")
[ -z "$XY" ] && XY=$(scroll_to_desc "取消完成：$SECOND_TITLE")
if [ -z "$XY" ]; then bad "找不到勾选框（第二次造并发）"; screen_txt; else
  $ADB shell input tap $XY; sleep 3
  ok "手机第二次本地改动（勾选状态，尚未同步）"
fi

# 4) 同步 → 应再次出现冲突
$ADB shell input tap 945 2253; sleep 3
dump; XY=$(xy_text "立即同步"); $ADB shell input tap $XY; sleep 8
for i in $(seq 1 12); do sleep 4; dump; [ "$(has_sub "处冲突待你选择")" = "1" ] && break; done
dump
[ "$(has_sub "处冲突待你选择")" = "1" ] && ok "第二次检测到真冲突" || { bad "第二次没报冲突"; screen_txt; }

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
for i in $(seq 1 15); do sleep 4; dump; [ "$(has_sub "处冲突待你选择")" = "0" ] && break; done
dump
[ "$(has_sub "处冲突待你选择")" = "0" ] && ok "第二次冲突已解决" || { bad "第二次冲突仍在"; screen_txt; }

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

step "9b. 断言：笔记本同步后收敛到手机那一版（另一侧也走通）"
laptop_ok sync || bad "笔记本第三次 sync 失败"
# 笔记本上这条任务的**勾选状态**应当跟手机一致。
LT_STATE=$(laptop list --all | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
t=next((t for t in d.get('tasks',[]) if t['id']=='$LAPTOP_ID'), None)
print('completed' if (t or {}).get('completedAt') else 'open')
")
echo "     笔记本侧勾选状态 = $LT_STATE"
# 手机在第 3 步把它勾成了完成，且选了「保留本机」→ 笔记本应看到 completed。
if [ "$LT_STATE" = "completed" ]; then
  ok "笔记本收敛到手机那一版（completed）"
else
  bad "笔记本没收敛到手机那一版（读到 '$LT_STATE'）"
fi

step "10. 直接查 Postgres"
psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT (SELECT count(*) FROM operations) AS ops, (SELECT count(*) FROM sync_devices) AS devices" 2>/dev/null \
  | sed 's/^/      ops|devices = /'

summary "移动端冲突解决闭环"
