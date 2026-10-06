#!/bin/bash
# UIPIN 的**路径清单卫生**护栏（21:5x 现量之后加的常驻判据）。
#
# 现量（同一分钟，两条独立读数）：
#   · `r17-evidence-md5-check.sh --all` ⇒ `14 目录 / 8 有红 / 27 枚 UISTALE`，
#     而 27 枚点名的都是**同一笔提交** `baf125e5`（「法务条款六份 + 中英词条」）：
#     它在 `packages/i18n` 里动的是 `common.privacy.consent.*` 与 `site./web./mobile.` 的措辞，
#     全仓只有一行提到 calendar，还是隐私文案里列举功能名的一个词 ⇒ **对这些图零像素影响**。
#   · 触发率：近 3 天 `packages/i18n` 共 78 笔，同期 `packages/ui/src/calendar` 4 笔。
#   ⇒ 把整包词条表列进「决定这张图形状的路径」，得到的是一条**每二十笔提交必红一次、
#     且红得与图无关**的判据 —— 正是 `r17` 文件头为 COMMITPIN 写过的那种东西（同一枚坑换触发源）。
#     摘掉之后 `有红目录 8 → 5`、`UISTALE 27 → 14`，剩下的 14 枚全部点名 `39032107`
#     （那笔真的改了主区页头的换行行为）= 真信号。
#
# 为什么钉成常驻判据而不是「下次注意」：路径清单是**判断**，而判断会被人顺手补全 ——
#   「词条也算界面的一部分嘛」这句话每次都会重新出现一次。
# ⚠️ 这一条**不测提交频率**（那是上游状态，写进判据就变成「今天恰好如此」）：
#   它只钉下面这张 deny 表，表上每一行都带自己的现量理由；要新增条目就得先写理由。
#
# 退出码：0 = 干净 / 1 = 有 UIPIN 行带上了被禁路径 / 4 = 一枚 UIPIN 都没解析到（探针坏，不算绿）
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 4

TAB=$(printf '\t')
# 格式：`<路径><TAB><为什么它会把锚点变成常驻红>`
DENY=(
  "packages/i18n${TAB}整包中英词条表：近 3 天 78 笔（同期 packages/ui/src/calendar 只有 4 笔），且绝大多数提交与任何一张图的像素无关 ⇒ 见文件头那两条现量"
  "apps/web/src/App.tsx${TAB}外壳组合物、一天动好几笔；calendar-view-options/README.md 第 42–44 行早就为它写过同一条理由（当时是「刻意不收」，这里钉成「不许收」）"
)

# 🔴 `grep -rn` 会给每行加 `路径:行号:` 前缀 —— 不剥掉的话 `^UIPIN` 永不匹配（第一跑就是这么
#    以 rc=4「探针坏」收场的：这一格的自检不是装饰，它当场把"读空"和"读干净"分开了）。
#    剥完之后字段位次回到 `$2=UIPIN 的名字 $3=钉的提交 $4..=路径清单`。
PINS=$(grep -rn '^UIPIN [^ ]* [0-9a-f]\{7,40\} ' --include=README.md apps 2>/dev/null \
  | sed 's/^[^:]*:[0-9]*://')
N=$(printf '%s\n' "$PINS" | grep -c '^UIPIN ')
if [ "$N" = 0 ]; then
  echo "❌ 全仓解析到 0 枚 UIPIN ⇒ 探针坏（「没解析到」不能读成「没有违规」）" >&2
  exit 4
fi
echo "现量：UIPIN 行 ${N} 枚（分母）；被禁路径 $(printf '%s\n' "${DENY[@]}" | grep -c .) 条"

BAD=0
for d in "${DENY[@]}"; do
  p=${d%%${TAB}*}
  # 🔴 只认**空格分隔的整段路径**，不认子串：`packages/i18n/src/locales` 这种更窄的合法条目
  #     不该被这一条拦掉（拦了就会逼人把理由写歪）。
  HITS=$(printf '%s\n' "$PINS" | awk -v pat="$p" '{ for (i = 4; i <= NF; i++) if ($i == pat) { print; break } }')
  if [ -n "$HITS" ]; then
    BAD=$((BAD + 1))
    echo "   ❌ 被禁路径 ${p} 出现在 $(printf '%s\n' "$HITS" | grep -c .) 枚 UIPIN 上："
    printf '%s\n' "$HITS" | sed 's/^/        /' | cut -c1-150
    echo "      理由：${d#*${TAB}}"
  fi
done

if [ "$BAD" = 0 ]; then
  echo "✅ ${N} 枚 UIPIN 里没有一条带着会把锚点变成常驻红的路径"
  exit 0
fi
echo "❌ ${BAD} 条被禁路径被用到 ⇒ 形状锚点会红得与图无关（处置：把该路径从清单里摘掉，别把红当噪声留着）"
exit 1
