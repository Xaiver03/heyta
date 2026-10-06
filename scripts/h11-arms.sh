#!/bin/bash
# ============================================================================
# 工单 H11「外壳不滚（桌面那一半）」的臂台 —— 证明那三条判据**会红**。
#
# 🔴 为什么要有这一份，而不是"我跑过了"：AGENTS §7 元规则二 —— 一条判据能不能失败
#    只靠变异回答。本单的臂台跑出了两件事，都不是靠推理得到的：
#      · 臂 C（拿掉 `.ht-content` 的 `min-block-size: 0`）**存活**：13 条几何判据全绿
#        ⇒ 那一行声明没有任何判据需要它，已经从 `main-area.css` 删掉；
#      · 臂 D 第一版**没有**红在预期那一格：我原先写的理由是"把手命中带被
#        `overflow-x: clip` 裁掉一半"，探针实测两种形态下 `elementFromPoint` 都命中
#        把手自己 ⇒ 那句理由被否证，改判成可量的两件事（`overflow` 必须是 visible、
#        给 `.ht-main` 写 `scrollLeft` 必须读回 0），也就是现在的 W4。
#    两条都记在 `e2e/tests/shell-no-document-scroll.spec.ts` 的文件头。
#
# 用法（仓库根）：
#   bash scripts/h11-arms.sh                 # 需要 4418/4419 空着（见 e2e/playwright.parallel.config.ts）
#
# 🔴 这个脚本会**改源码再改回来**，所以它写过的每一个文件都必须是忽略态，否则跑一次
#    就往干净检出里丢一个未跟踪文件 —— 而 §6.1 的 Windows 源码同步集合正是
#    `git ls-files -co --exclude-standard` 形状（未跟踪非忽略都会被送出去）。
#    现量：`git check-ignore -v scripts/.h11-arms/main.orig.log` → `.gitignore:49:*.log`。
#    ⚠️ 这一条此前写的是"已被 .gitignore 的 `.*` 规则之外"，**那句是错的**：
#    仓库里没有那条规则，而备份文件当时叫 `base.orig`/`main.orig`，确实不受任何忽略规则保护。
#    现在备份也带 `.log` 后缀，靠的是 `*.log` 这一条。
#
# ⚠️ 每臂跑完立刻还原，还原用 md5 对账：不靠"应该还原了"。
#    取不到退出码就不要取 —— `bash 这个脚本 | tail` 之后 `$?` 是 `tail` 的（§7 第 45 条），
#    所以退出码全部由脚本自己 grep 日志里的 `RC=` 行，不经过管道。
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
E2E="$ROOT/e2e"
BASE="$ROOT/apps/web/src/styles/app/base.css"
MAIN="$ROOT/apps/web/src/styles/app/main-area.css"
SPEC=tests/shell-no-document-scroll.spec.ts
BK="$HERE/.h11-arms"
mkdir -p "$BK"
cp "$BASE" "$BK/base.orig.log"
cp "$MAIN" "$BK/main.orig.log"
B_MD5=$(md5 -q "$BK/base.orig.log")
M_MD5=$(md5 -q "$BK/main.orig.log")

restore() {
  cp "$BK/base.orig.log" "$BASE"
  cp "$BK/main.orig.log" "$MAIN"
  [ "$(md5 -q "$BASE")" = "$B_MD5" ] && [ "$(md5 -q "$MAIN")" = "$M_MD5" ] \
    || { echo "RESTORE_MISMATCH ⇒ 停在这里，不要把还原失败的读数当结论"; exit 1; }
}

# 断言 needle 在文件里恰好出现 want 次。少了 = 改错了地方，多了 = 会一次改到别人的行。
one() {
  local file="$1" needle="$2" want="$3" got
  # 🔴 用 `grep -F`：这些 needle 里有 `\{` 与 `\}`，在 BRE 下会被当成区间量词，
  #    报 "invalid repetition count(s)" —— 于是 got 是**空串**，
  #    而 `[ "" = 1 ]` 为假 ⇒ 臂台在还没变异之前就退出。空读数在这里必须响亮，不能沉默。
  got=$(grep -cF -- "$needle" "$file")
  [ "$got" = "$want" ] \
    || { echo "PRECOND_FAIL '$needle' 在 $(basename "$file") 里出现 ${got} 次，期望 ${want} 次"; exit 1; }
}

run() {
  local arm="$1"; shift
  ( cd "$E2E" && NO_COLOR=1 npx playwright test -c playwright.parallel.config.ts "$@" \
      --retries=0 > "$BK/$arm.log" 2>&1; echo "RC=$?" >> "$BK/$arm.log" )
  echo "── 臂 $arm -> $(grep -o 'RC=[0-9]*' "$BK/$arm.log" | tail -1)"
  grep -E '^  [0-9]+ (passed|failed)' "$BK/$arm.log" | sed 's/^/   /'
  grep -oE '✘ +[0-9]+ \[chromium\].*' "$BK/$arm.log" | sed 's/^/   RED /'
}

echo "=== H11 臂台（每臂都应当**红**；哪一臂全绿就说明那一格判据是装饰）==="

one "$BASE" '  height: 100dvh;' 1
perl -pi -e 's/^  height: 100dvh;$/  min-height: 100dvh;/' "$BASE"
run A-min-height "$SPEC"
restore

one "$BASE" '  grid-template-rows: minmax(0, 1fr);' 1
perl -pi -e 's/^  grid-template-rows: minmax\(0, 1fr\);\n//' "$BASE"
run B-auto-row "$SPEC"
restore

# 臂 D：把滚动从 `.ht-content` 搬到 `.ht-main`（"看起来更省事"的那个错误形状）。
# 期望红三格：W1（内容列不再是宿主）、W2（浮层跟着页头一起被滚走）、W4（.ht-main 变滚动容器）。
one "$MAIN" '  .ht-content {' 1
perl -pi -e 's/^  \.ht-content \{$/  .ht-main {/' "$MAIN"
run D-scroll-on-main "$SPEC" tests/detail-column-slot.spec.ts
restore

echo "=== 还原后跑一次阳性对照（四臂之外必须全绿，否则臂台自己坏了）==="
run RESTORED-POSITIVE "$SPEC"
echo "ARMS_DONE"
