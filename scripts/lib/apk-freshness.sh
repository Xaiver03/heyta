#!/bin/bash
# ============================================================================
# APK 新鲜度的**唯一**算法（单一所有者）。
#
# 为什么要有这个文件
# ------------------
# `§7 第 27 条`（"packages/ 改了、APK 里是旧 JS bundle，验收对旧代码报绿"）此前只有
# **一道**地方在判它：`verify-mobile-window-gate.sh` 的第 4 步。也就是说 ——
# 一个人**忘了跑闸门**、直接 `pnpm verify:mobile-trash`，脚本照样装包、照样跑完、
# 照样 32/32 全绿，而它验的是旧产物。那条防线当时只存在于"人记得先量一次"。
#
# 所以这里把判据本身搬进被约束的那一步：**装包之前当场判**，不依赖跑之前有没有人替它量。
# 同一个算法两处消费（闸门 + 真机验收脚本），因为"同一个判断写两遍"就是漂移的起点
# （AGENTS §3.2 那条门禁事故的形状）。
#
# 🔴 两个必须显式传的东西
#
# 1. **根**：算"最新源码"要在一棵树里扫。默认取仓库根，但留 `root` 实参给夹具用 ——
#    没有它就没法在不动真实工作树的前提下证这条判据能失败。
# 2. **APK 路径**：由调用方给（`lib/mobile-e2e.sh` 那份 $APK 是同一枚），
#    不在这个文件里再推导一次，否则又是第二套 $APK 定义。
#
# ⚠️ 取不到 mtime 一律**判红**，不按"新鲜"处理：空读数在这里和"确实没有比它更新的源码"
#    长得一模一样，而后者会直接放装包过去 —— 那是假绿的方向。
# ============================================================================

# 🔴 自锚：这个 lib 必须能在**没有被 `lib/mobile-e2e.sh` source** 的时候自己算出仓库根
#    （自检就是直接执行进来的）。留 env 覆盖口给跨树夹具。
HEYTA_REPO_ROOT="${HEYTA_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# 进入 APK 的源码面（Metro 打包真正会收进去的那些目录）。
#
# 🔴 这份清单**不再手抄**，由 `apps/mobile/package.json` 里那些 `workspace:` 依赖现推
#    （再加 `apps/mobile/src` 本身）。原来的手抄清单只有 4 个目录，而真正进 bundle 的有 10 个 ——
#    漏掉的六个里正好包括**销毁链**（`sync-client` / `app-host` / `storage`）与
#    **回收站四路**（`op-log`）所在的包：那几包的源码改了，这道门照样放行，
#    于是"装的是当前产物"这个结论是从一份不完整的输入集推出来的（§7 第 27 条的同一形状）。
#    手抄清单会随依赖变化而漂，而漂移的方向恰好是**假绿** —— 所以把"清单从哪来"换成读真源。
#
# ⚠️ 仍然保留 `HEYTA_APK_SOURCE_DIRS` 作为显式覆盖口（跨树夹具用）。它为空 = 现推；
#    现推失败（没有 node / 没有 package.json）⇒ 得到空集 ⇒ 下面按 rc 3「读不出数」拒绝装包，
#    **不按"没有比它更新的源码"处理**，与文件头那条"取不到一律判红"是同一条纪律。
heyta_apk_source_dirs() { # <root?> -> 回显空格分隔的相对目录清单（推不出则回空）
  local root="${1:-$HEYTA_REPO_ROOT}"
  node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1];
    const file = path.join(root, "apps/mobile/package.json");
    if (!fs.existsSync(file)) process.exit(0);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(0); }
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    const dirs = [];
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith("@heyta/") || !String(spec).startsWith("workspace:")) continue;
      const d = path.join("packages", name.slice("@heyta/".length), "src");
      if (fs.existsSync(path.join(root, d))) dirs.push(d);
    }
    if (fs.existsSync(path.join(root, "apps/mobile/src"))) dirs.unshift("apps/mobile/src");
    process.stdout.write([...new Set(dirs)].sort().join(" "));
  ' "$root" 2>/dev/null
}

heyta_apk_dirs_for() { # <root?> -> 本次比较实际扫的目录（覆盖口优先，否则按那一棵根现推）
  if [ -n "${HEYTA_APK_SOURCE_DIRS:-}" ]; then printf '%s' "$HEYTA_APK_SOURCE_DIRS"; else heyta_apk_source_dirs "${1:-$HEYTA_REPO_ROOT}"; fi
}

HEYTA_APK_SOURCE_DIRS="${HEYTA_APK_SOURCE_DIRS:-}"

_mtime() { # <file> -> 回显 mtime（整数）；失败回显空
  local v
  v=$(stat -f %m "$1" 2>/dev/null) || v=""
  [ -n "$v" ] || v=$(stat -c %Y "$1" 2>/dev/null) || v=""
  printf '%s' "$v"
}

# <apk> <root?> -> 回显 "<apk_mtime> <source_mtime>"，取不到的一侧是空串。
# 第二行回显到 stderr 的是**用的哪一棵根**，为了跨树比较时读数里带得出来。
heyta_apk_pair() {
  local apk="$1" root="${2:-$HEYTA_REPO_ROOT}"
  local am sm dirs
  dirs=$(heyta_apk_dirs_for "$root")
  [ -f "$apk" ] && am=$(_mtime "$apk") || am=""
  [ -n "$dirs" ] || { printf '%s %s\n' "${am:-}" ""; return 0; }
  sm=$(cd "$root" 2>/dev/null && find $dirs \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' \
    -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  [ -n "$sm" ] || sm=$(cd "$root" 2>/dev/null && find $dirs \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' \
    -exec stat -c %Y {} + 2>/dev/null | sort -rn | head -1)
  printf '%s %s\n' "${am:-}" "${sm:-}"
}

# <apk> <root?> -> rc 0 新鲜 / 1 比源码旧 / 2 APK 不存在 / 3 读不出数
heyta_apk_is_fresh() {
  local pair am sm
  pair=$(heyta_apk_pair "$1" "${2:-$HEYTA_REPO_ROOT}")
  am=${pair%% *}
  sm=${pair##* }
  [ -n "$am" ] || return 2
  [ -n "$sm" ] || return 3
  [ "$sm" -le "$am" ] && return 0
  return 1
}

# 🔴 真机验收脚本用的那道门：装包之前当场判。
# <apk> <脚本名> <root?> -> rc 0 可以装 / 1 拒绝装
heyta_apk_freshness_guard() {
  local apk="$1" who="$2" root="${3:-$HEYTA_REPO_ROOT}"
  local am sm rc dirs_note
  heyta_apk_is_fresh "$apk" "$root"; rc=$?
  read -r am sm < <(heyta_apk_pair "$apk" "$root")
  # 扫的目录集打进读数：它是这条判据的**输入集**，不随输出一起打印的话，
  # "清单被缩回去"这一步在输出上完全看不出来（臂 7 守的就是这一步）。
  if [ -n "${HEYTA_APK_SOURCE_DIRS:-}" ]; then
    dirs_note="覆盖口 HEYTA_APK_SOURCE_DIRS（${HEYTA_APK_SOURCE_DIRS}）"
  else
    dirs_note="现推：$(heyta_apk_dirs_for "$root")"
  fi
  echo "   APK $([ -n "$am" ] && date -r "$am" '+%F %T' || echo "（不存在）") / 最新源码 $([ -n "$sm" ] && date -r "$sm" '+%F %T' || echo "（读不出）")"
  echo "   （扫的是 $root 下：${dirs_note}）"
  case $rc in
    0) echo "   ✅ 装的是当前源码的产物"; return 0 ;;
    2) echo "   🔴 $who 拒绝装包：APK 不存在（${apk}）"; echo "      先 pnpm --filter @heyta/ui build && pnpm build:android"; return 1 ;;
    3) echo "   🔴 $who 拒绝装包：**读不出源码 mtime**。这里不按「新鲜」处理 ——";
       echo "      空读数与「确实没有比它更新的源码」在输出上长得一样，而后者会放装包过去（假绿方向）。";
       [ -n "${HEYTA_APK_SOURCE_DIRS:-}" ] || echo "      现推清单是空的 ⇒ 检查 node 在不在 PATH 上、$root/apps/mobile/package.json 在不在";
       return 1 ;;
    *) echo "   🔴 $who 拒绝装包：APK 比源码旧 —— 跑它验的是旧 bundle（§7 第 27 条）";
       echo "      先 pnpm --filter @heyta/ui build && pnpm build:android";
       echo "      确实要验旧产物才写 HEYTA_ALLOW_STALE_APK=1（那一条会被打印成取证，不会悄悄过去）";
       if [ "${HEYTA_ALLOW_STALE_APK:-0}" = "1" ]; then
         echo "   ⚠️ 已用 HEYTA_ALLOW_STALE_APK=1 放行 —— 本轮结论**不适用于当前源码**"
         return 0
       fi
       return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# 自检：三臂夹具 + **接线臂**。
#
# 接线臂存在的理由：把判据抽进 lib 而不确认调用方真的在调它，就等于新写了一份
# **没人执行的更漂亮版本**（AGENTS §3.5 那条教训的原话形状）。
# 拿掉 `verify-mobile-trash.sh` 里那一行调用 ⇒ 这一臂必须转红。
# ---------------------------------------------------------------------------
heyta_apk_freshness_selftest() {
  local root apk src_dir fail=0
  root=$(mktemp -d)
  mkdir -p "$root/apps/mobile/src" "$root/apps/mobile/android/app/build/outputs/apk/release"
  # 夹具的"真源"：一份 apps/mobile/package.json 加三个 workspace 包的 src 目录。
  # 臂 6/7/8 全部依赖它 —— 清单改成现推之后，**输入集本身**成了被量的对象，
  # 所以夹具必须能表达"某个包的源码比 APK 新，但它不在旧的手抄清单里"这个形状。
  cat > "$root/apps/mobile/package.json" <<'JSON'
{
  "name": "fixture-mobile",
  "dependencies": {
    "@heyta/op-log": "workspace:*",
    "@heyta/sync-client": "workspace:*",
    "@heyta/app-host": "workspace:*",
    "react-native": "0.84.1"
  }
}
JSON
  mkdir -p "$root/packages/op-log/src" "$root/packages/sync-client/src" "$root/packages/app-host/src"
  # 自检量的是**现推**那一档 ⇒ 临时清空覆盖口，收尾还原（否则调用方设了覆盖口时
  # 臂 6 量的就不是同一条路径了）。
  local saved_dirs="${HEYTA_APK_SOURCE_DIRS:-}"
  HEYTA_APK_SOURCE_DIRS=""
  src_dir="$root/apps/mobile/src"
  apk="$root/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"

  # 臂 1：源码比 APK 新 -> 必须判旧（rc=1，且 guard 拒绝）
  printf 'x\n' > "$src_dir/FreshnessProbe.ts"
  touch -t 202601010000 "$apk"
  touch -t 202609010000 "$src_dir/FreshnessProbe.ts"
  heyta_apk_is_fresh "$apk" "$root"; [ $? -eq 1 ] \
    && echo "   ✅ 臂 1 旧 bundle 被判出" || { echo "   🔴 臂 1 存活：APK 比源码旧却没被判出"; fail=1; }
  heyta_apk_freshness_guard "$apk" "selftest" "$root" >/dev/null 2>&1; [ $? -eq 1 ] \
    && echo "   ✅ 臂 1b guard 拒绝装包" || { echo "   🔴 臂 1b 存活：guard 放行了旧包"; fail=1; }

  # 臂 2：APK 比源码新 -> 必须放行（证明这条判据不是恒红）
  touch -t 202610010000 "$apk"
  heyta_apk_is_fresh "$apk" "$root"; [ $? -eq 0 ] \
    && echo "   ✅ 臂 2 新 bundle 放行（不是恒红）" || { echo "   🔴 臂 2 坏了：新鲜也被拒"; fail=1; }

  # 臂 3：APK 不存在 -> rc=2（与"旧"是两种原因，不许合并）
  rm -f "$apk"
  heyta_apk_is_fresh "$apk" "$root"; [ $? -eq 2 ] \
    && echo "   ✅ 臂 3 不存在单独成档" || { echo "   🔴 臂 3 坏了：不存在的 APK 被读成别的"; fail=1; }

  # 臂 4：接线 —— 真实脚本里必须有那一发调用
  if grep -q "heyta_apk_freshness_guard" "$HEYTA_REPO_ROOT/scripts/verify-mobile-trash.sh"; then
    echo "   ✅ 臂 4 verify-mobile-trash.sh 里确有调用点"
  else
    echo "   🔴 臂 4 断了：脚本没调用这道门（那这条判据等于没装）"
    fail=1
  fi

  # 臂 4b：第二枚消费者也要钉住，并且**顺手挡一句假话** ——
  #   `verify-mobile-notes.sh:101` 那段注释原先写"自检：heyta-apk-guard-fixture.sh 按标记抽同一段跑"，
  #   而 10-05 现量全仓 `find . -name "*apk-guard*"` **0 命中**：那枚夹具从来没存在过。
  #   "有一枚夹具会检查这段接线"是注释里的声称，不是事实；把它换成真的这一臂。
  if grep -q "heyta_apk_freshness_guard" "$HEYTA_REPO_ROOT/scripts/verify-mobile-notes.sh"; then
    echo "   ✅ 臂 4b verify-mobile-notes.sh 里确有调用点"
  else
    echo "   🔴 臂 4b 断了：verify-mobile-notes.sh 没调用这道门（它会装包，读数是旧产物的）"
    fail=1
  fi

  # 臂 5：注入的根必须真的被用 —— 算出来的"最新源码"要逐字等于**夹具里那个文件**的 mtime。
  # 不这么判的话，"传了根参数"与"其实又去扫了真实工作树"在输出上长得一样（跨树比较最阴的一种）。
  local expect got
  expect=$(_mtime "$src_dir/FreshnessProbe.ts")
  got=$(heyta_apk_pair "$root/does-not-exist.apk" "$root"); got=${got##* }
  if [ -n "$expect" ] && [ "$got" = "$expect" ]; then
    echo "   ✅ 臂 5 读数来自注入的根（$got == 夹具文件 mtime）"
  else
    echo "   🔴 臂 5 坏了：注入根后算出的是「${got:-空}」，与夹具文件 mtime「${expect:-空}」不一致"; fail=1
  fi

  # 臂 6（**加宽输入集**这一档的牙）：一枚比 APK 新的源码放进 `packages/op-log/src` ——
  # 那个包**不在**旧的手抄清单里。旧输入集会读成"新鲜"，现推的必须读成"旧"。
  touch -t 202610010000 "$apk"          # APK 比 apps/mobile/src 那枚（0901）新
  printf 'y\n' > "$root/packages/op-log/src/DestructionProbe.ts"
  touch -t 202610020000 "$root/packages/op-log/src/DestructionProbe.ts"
  heyta_apk_is_fresh "$apk" "$root"; [ $? -eq 1 ] \
    && echo "   ✅ 臂 6 销毁链接线所在的包（op-log）改了会被判旧 —— 旧手抄清单量不到这一档" \
    || { echo "   🔴 臂 6 存活：packages/op-log/src 比 APK 新却没被判出（输入集又缩回去了）"; fail=1; }

  # 臂 7：现推清单按真源推 —— 夹具里三个 @heyta workspace 包都有 src，加 apps/mobile/src 应是 4 条，
  # 且**必须**含 packages/op-log/src。条数不对或不含 ⇒ 推导被换回手抄/被缩窄。
  local derived_list derived_count
  derived_list=$(heyta_apk_dirs_for "$root")
  derived_count=$(printf '%s\n' $derived_list | grep -c .)
  if [ "$derived_count" = "4" ] && printf '%s\n' "$derived_list" | grep -q "packages/op-log/src"; then
    echo "   ✅ 臂 7 现推得到 $derived_count 条且含 op-log（${derived_list}）"
  else
    echo "   🔴 臂 7 坏了：现推得到 ${derived_count} 条「${derived_list:-空}」（期望 4 条且含 packages/op-log/src）"; fail=1
  fi

  # 臂 8（与臂 6 **配对**的对照）：同一条夹具、只换"输入集"那一颗旋钮 ——
  # 显式收窄回旧的手抄四条 ⇒ 臂 6 那枚新文件看不见 ⇒ 必须回到 rc=0。
  # 没有这一臂，"臂 6 现在会红"与"我把判据改坏了"在输出上分不开（配对要来自结构关系，不是距离）。
  local rc8
  HEYTA_APK_SOURCE_DIRS="apps/mobile/src packages/ui/src packages/i18n/src packages/domain/src"
  heyta_apk_is_fresh "$apk" "$root"; rc8=$?
  HEYTA_APK_SOURCE_DIRS=""
  if [ "$rc8" = "0" ]; then
    echo "   ✅ 臂 8 收窄回旧清单后同一枚新文件看不见（rc=0）⇒ 臂 6 的红来自输入集本身"
  else
    echo "   🔴 臂 8 坏了：收窄回旧清单仍判旧（rc=${rc8}）⇒ 臂 6/8 这一对没配起来"; fail=1
  fi

  HEYTA_APK_SOURCE_DIRS="$saved_dirs"   # 还原调用方的覆盖口（自检不许留下状态）
  rm -rf "$root"
  # 分母从**这份文件里**现数，不写死（写过一次"5/5"，补臂之后就漂成了假分母）。
  # 只数**臂标签行**（`# 臂 N：` 或 `# 臂 N（`），不数散文里提到臂号的那些行 ——
  # 第一版用 `^  # 臂 [0-9]+` 把"臂 6/7/8 全部依赖它"也数了进去，分母多 2、读数 9 行却报 10/10。
  local total
  total=$(grep -cE '^  # 臂 [0-9]+[：(]' "${BASH_SOURCE[0]}")
  [ $fail -eq 0 ] && { echo "自检 $total 臂全过（臂 1、臂 4 各另带一发对照调用：1b/4b）"; return 0; } \
    || { echo "自检有臂存活（$total 臂 + 1b/4b 两发）"; return 1; }
}

# 直接执行（不是 source）时只给一条入口：自检。被 source 时什么都不做。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --self-test) heyta_apk_freshness_selftest; exit $? ;;
    *) echo "用法：source 这个文件，或 bash $0 --self-test"; exit 2 ;;
  esac
fi
