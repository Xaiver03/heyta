#!/usr/bin/env bash
#
# §3.4 五条规则的变异臂（S1 那句"穷尽"的读数，不是形容词）
# =============================================================================
#
# 计划 `docs/plans/capture-ticktick-alignment-2026-11.md` S1 那一格写的是
# "node 单测**穷尽** §3.4 五条规则"。有具名用例 ≠ 穷尽：
# 一条断言若绑在别的东西上，把规则翻过来它照样绿。
#
# 所以这枚装置逐条把 `packages/ui/src/capture/model.ts` 里那条规则的实现**改反**，
# 跑 `capture-model.spec.ts`，要求：
#   ① 该条规则对应的用例真的红；
#   ② 还原后整文件全绿。
# 两件事都成立才叫"这条规则被钉住了"。
#
# 用法：
#   bash research/tools/mutation-rigs/capture-override-contract-arms.sh
#
# 🔴 安全形状（与同目录别的臂一致）：
#   · 起手 `cp` 一份 `.mut-bak`，**还原只从 `.mut-bak`**，不从 git（共享工作树里
#     `git checkout --` 会连别人未提交的行一起顶掉）；
#   · `trap` 收尾还原，中途失败也不把变异留在树上；
#   · 打变异那一步交给 `capture-override-contract-mutate.mjs`：`--from` 一处都没命中
#     就退 1，调用方**判红**而不是跳过 —— 否则"实现改名了"会被读成"这枚臂过了"。
#   · 仓库根是**上三级**（本脚本住在 research/tools/mutation-rigs/）；起手就验
#     `model.ts` 存不存在，不存在直接停。第一版写成上两级，五枚臂全打在
#     不存在的文件上而脚本照样跑完 —— 载体路径算错在臂类装置里特别隐蔽，
#     它不会让构建失败，只会让每一枚臂变成空跑。
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MODEL="$ROOT/packages/ui/src/capture/model.ts"
BAK="$MODEL.mut-bak"
MUTATE="$HERE/capture-override-contract-mutate.mjs"

[ -f "$MODEL" ] || { echo "🔴 仓库根没对上：$MODEL 不存在"; exit 1; }
[ -f "$MUTATE" ] || { echo "🔴 少了打变异那一步：$MUTATE"; exit 1; }

restore() { [ -f "$BAK" ] && mv -f "$BAK" "$MODEL"; return 0; }
trap restore EXIT

FAILED=0

# 🔴 判绿只认**退出码**。第一版去 grep 输出里那行 "Tests 59 passed"，
#    而那行里夹着 ANSI 转义（`Tests \e[22m \e[1m\e[32m59 passed`），
#    `Tests +[0-9]+` 永远不命中 ⇒ 明明全绿却被报成"树上有残留"。
#    解析装饰过的文本会造出这种假红；退出码不会。
SPEC_LOG="$ROOT/.run-logs/capture-contract-arms/vitest.log"
mkdir -p "$(dirname "$SPEC_LOG")"
run_spec() { (cd "$ROOT" && pnpm --filter @heyta/ui exec vitest run tests/capture-model.spec.ts > "$SPEC_LOG" 2>&1); return $?; }

# arm <契约名> <要看到的用例子串> <from> <to>
arm() {
  local name="$1" want="$2" from="$3" to="$4"
  restore
  cp "$MODEL" "$BAK"
  if ! node "$MUTATE" --path "$MODEL" --from "$from" --to "$to"; then
    echo "❌ ${name}：变异没打上（实现形状变了，这枚臂已经在量别的东西）"
    FAILED=$((FAILED+1)); restore; return
  fi
  run_spec
  local out; out="$(cat "$SPEC_LOG")"
  if printf '%s' "$out" | grep -qF "$want"; then
    echo "✅ $name —— 把实现翻反后，对应用例真的红了"
  else
    echo "❌ $name —— 实现翻反后「${want}」没红 ⇒ 这条规则其实没被钉住"
    FAILED=$((FAILED+1))
  fi
  restore
}

echo "════ §3.4 五条规则 + 一条额外约束 · 变异臂 6 枚（仓库根 ${ROOT}）════"

arm "契约1 打字解析值 = 胶囊默认值" \
  "契约 1" \
  "return { date: parsed.dueDate, time: parsed.dueTime, source: 'parsed' };" \
  "return { date: parsed.dueDate, time: undefined, source: 'parsed' };"

arm "契约2 覆盖盖过解析值（且不吞字）" \
  "契约 2" \
  "if (captureOverrideValid(override, signature)) {" \
  "if (false && captureOverrideValid(override, signature)) {"

arm "契约3 清除把被消费的字送回标题" \
  "契约 3" \
  "next.push({ field: match.field, raw: match.raw });" \
  "void match;"

arm "契约4 片段变了 ⇒ 覆盖作废" \
  "契约 4" \
  "override.boundTo === signature" \
  "true"

arm "额外约束（不在 §3.4 五条里）：覆盖只管截止，优先级仍走解析" \
  "契约 5" \
  "...(parsed.priority !== undefined ? { priority: parsed.priority } : {})," \
  "...(due.source === 'override' || parsed.priority === undefined ? {} : { priority: parsed.priority }),"

# 🔴 这一枚是**补上的真 §3.4 第 5 条**。前五枚臂里编号"契约5"那条其实不是 §3.4 的第 5 条
# （那条讲的是"覆盖不许把优先级一起接管"，是覆盖态的额外约束），
# 而 §3.4 第 5 条——**同字段第二条仍"未采用"**——以前**没有任何臂翻过它**：
# 有具名用例（A 组那条）≠ 把实现翻反它照样绿。审计这一步就是为了抓这种"数着五条、其实缺一条"。
arm "§3.4 第5条 同字段第二条仍「未采用」（把分类翻反）" \
  "同一字段出现两次：第二条是" \
  "if (match.applied) return 'ignore';" \
  "return 'ignore';"

restore
if run_spec; then
  echo "✅ 还原后整文件全过（vitest rc=0）"
else
  echo "❌ 还原后仍红 ⇒ 树上有残留，查 ${MODEL}（日志 ${SPEC_LOG}）"
  FAILED=$((FAILED+1))
fi
[ -f "$BAK" ] && { echo "❌ 还留着一份 $BAK"; FAILED=$((FAILED+1)); }

if [ "$FAILED" -eq 0 ]; then echo "✅ §3.4 五条规则各有臂（1..4 + 第5条）+ 一条额外约束，6 枚全部量到红"; exit 0; fi
echo "🔴 ${FAILED} 格不对"; exit 1
