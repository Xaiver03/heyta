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

# ---------------------------------------------------------------------------
# 🔴 **内容章**：源码"最后一次被改变"的时刻，而不是"最后一次被碰"的时刻。
#
# 为什么上面那把 mtime 尺在这一档上不够用（2026-10-06 rig47b 现量，记在 traps #346）：
#   `mutate-egress-wording.mjs` 那类变异门禁跑完会把源码**逐字节还原**，而还原是一次写 ——
#   mtime 被抬到还原那一刻，内容却等于 HEAD。iOS 载体因此打印
#   「装的是旧产物：源码最新 X > bundle Y」，把一条**内容上完全成立**的结论判成红，
#   而它拒的是装包，于是没有任何一格能自愈（同一份文件在 git 里逐字相同）。
#   `run-gradle.mjs` / `mutate-egress-wording.mjs` 的文件头都写明这条尺会被这里消费，
#   所以这不是"探针没考虑到"，是**两把尺量的是两件不同的事**：
#     · APK 侧要防的是"产物没跟着源码重建" ⇒ mtime 尺够用（APK 的 mtime 由构建回写）；
#     · 而"源码最后改变的时刻"必须只看**内容**，否则任何一次原地重写都会伪装成新改动。
#
# 算法：`git log -1 --format=%ct -- <源面>` 给"已提交那部分"的最后改变时刻，
#   再用 `git status --porcelain` 列出**未提交**的那几枚（含未跟踪）取其文件 mtime，
#   两者取大 —— 未提交的内容改动必须算数（否则 `pnpm reinstall:all` 验的是 HEAD 而不是
#   当前工作树，而那正是 §6.1.1 第 82 条抓过的形状）。
#   取不到章（不是 git 树 / 没有那两条路径的提交）⇒ **返回 rc 1**，调用方按"没有输入"处理，
#   与文件头"取不到一律判红、不按新鲜"是同一条纪律。
# ---------------------------------------------------------------------------
heyta_src_content_stamp() { # <root?> -> 回显 epoch；取不到回 rc 1
  local root="${1:-$HEYTA_REPO_ROOT}" newest c f
  newest=$(git -C "$root" log -1 --format=%ct -- apps/mobile/src packages 2>/dev/null)
  case "$newest" in (''|*[!0-9]*) return 1 ;; esac
  # `s/^.* -> //` 让改名行取**新路径**；被删的那枚 stat 不到，自然跳过。
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    c=$(stat -f %m "$root/$f" 2>/dev/null) || c=$(stat -c %Y "$root/$f" 2>/dev/null) || c=""
    case "$c" in (''|*[!0-9]*) continue ;; esac
    [ "$c" -gt "$newest" ] && newest="$c"
  done <<EOF2
$(git -C "$root" status --porcelain -z -- apps/mobile/src packages 2>/dev/null | tr '\0' '\n' | sed -E 's/^.{3}//; s/^.* -> //')
EOF2
  printf '%s' "$newest"
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
# 🔴 **产物归属章**：这枚 iOS 产物是**哪一棵树、哪一版源码**打出来的。
#
# 为什么内容章不够（2026-10-06 rig64 现量）：`/tmp/heyta-ios-release` 是**跨树默认**的
#   `-derivedDataPath`，两棵树（主检出与隔离 worktree）打的包落在同一个目录里。
#   那一趟 A 树（另一条会话，HEAD 90232ce0）刚重装完，B 树（含选中态那处修复）的验收
#   紧接着跑：新鲜度门按**时间戳先后**放行（bundle 19:18 > 内容章 18:40 —— B 树的章当然
#   早于 A 树刚写完的 bundle），第 3 步随即红在「设置面里读不到「启用 AI 功能」」。
#   时间戳回答的是"新不新"，**答不了"是谁的"**；而"不是我的"这一档在纯时间比较下
#   恰好长得像"更新"，于是这道门把污染打印成了放行。
#
# 记的三样：`root=`（哪一棵树）、`head=`（哪一笔，只作读数用）、`src=`（那一版源码的内容章）。
#   🔴 **判的是 root + 内容章，不判 head**：同一批字节可以有两种读法
#   （"提交前后各一枚" 与 "内容一字未动"），拿 head 判会把一条内容上成立的产物判成红 ——
#   恒红的尺比没有尺更坏（rig47b 那条教训的原样形状）。章取不到 ⇒ rc 3，按"没有输入"拒绝。
# ---------------------------------------------------------------------------
heyta_ios_owner_marker() { # <derived> -> 回显标记文件路径
  printf '%s/.heyta-build-owner' "${1%/}"
}

# <derived> <root> -> rc 0 写成 / 1 写不出（章取不到、目录不存在）
heyta_ios_owner_write() {
  local derived="$1" root="${2:-$HEYTA_REPO_ROOT}" marker stamp head
  [ -d "$derived" ] || return 1
  marker=$(heyta_ios_owner_marker "$derived")
  stamp=$(heyta_src_content_stamp "$root") || return 1
  head=$(git -C "$root" rev-parse HEAD 2>/dev/null) || head=""
  {
    printf 'root=%s\n' "$root"
    printf 'head=%s\n' "$head"
    printf 'src=%s\n' "$stamp"
  } > "$marker" || return 1
  return 0
}

# <derived> <root> -> rc 0 归属成立 / 1 归属不符（树或源码版不同）/ 2 没有章 / 3 读不出输入
# 读数**自己打印**四个值（章里那两枚 + 现在这两枚）：拒绝的理由必须在输出里可读，
# 只给一个 rc 的话，下一个排查的人会把它当成"脚本坏了"而不是"装错了树"。
heyta_ios_owner_check() {
  local derived="$1" root="${2:-$HEYTA_REPO_ROOT}" marker built_root built_head built_stamp now_stamp
  marker=$(heyta_ios_owner_marker "$derived")
  if [ ! -f "$marker" ]; then
    echo "   ❌ 产物归属：$marker 不存在 ⇒ 不知道这枚产物是哪一棵树打的。"
    echo "      这**不是**新鲜度问题：时间戳回答「新不新」，回答不了「是谁的」；"
    echo "      而共享构建目录 /tmp/heyta-ios-release 上，别棵树刚打的包比本树的源码还新。"
    echo "      要对当前产物取读数：在本树跑 pnpm reinstall:mobile --only ios（或先跑 verify-mobile-ios.sh 那趟构建）。"
    return 2
  fi
  built_root=$(sed -n 's/^root=//p' "$marker" | head -1)
  built_head=$(sed -n 's/^head=//p' "$marker" | head -1)
  built_stamp=$(sed -n 's/^src=//p' "$marker" | head -1)
  now_stamp=$(heyta_src_content_stamp "$root") || {
    echo "   ❌ 产物归属：本树（${root}）的内容章取不到 ⇒ 这条判据没有输入，不按「归属成立」处理。"
    return 3
  }
  if [ "$built_root" != "$root" ]; then
    echo "   ❌ 产物归属：构建目录里那枚是**别一棵树**打的 —— 章中 root=${built_root:-空}，本树 root=$root"
    echo "      那棵树的 HEAD=${built_head:-空}；本轮结论若出自它，写的就不是本树的源码。"
    return 1
  fi
  if [ "$built_stamp" != "$now_stamp" ]; then
    echo "   ❌ 产物归属：树对了，但源码版不对 —— 章中 src=${built_stamp:-空}，本树现在 src=$now_stamp"
    echo "      ⇒ 那之后本树的源码又变过（或那枚根本是另一版），这枚产物不是当前产物。"
    return 1
  fi
  echo "   ✅ 产物归属：$derived 里那枚是 **本树**（${root##*/} @ ${built_head:-?}，内容章 ${now_stamp}）打的"
  return 0
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

  # 臂 9：内容章不许被"只碰不改"推进（rig47b 那条假红的机制本身）。
  #   变异门禁把源码**逐字节还原**时 mtime 被抬起来、内容仍等于 HEAD，旧的 mtime 尺于是把
  #   一条内容上成立的结论打印成「装的是旧产物」，而它拒的是装包 ⇒ 没有任何一格能自愈。
  # 臂 10：同一枚文件真的改内容（不提交）⇒ 章必须跟着走，且逐字等于那枚文件的 mtime。
  #   没有这一臂，臂 9 的"不动"也可能来自"章什么都没读到"
  #   （一条恒不成立的判据比没有判据更糟 —— §7 元规则二）。
  local stamp_base stamp_touch stamp_edit git_ok=0
  if git -C "$root" init -q 2>/dev/null \
     && printf 'a\n' > "$src_dir/StampProbe.tsx" \
     && git -C "$root" add -A \
     && git -C "$root" -c user.name=selftest -c user.email=selftest@local commit -q -m fixture >/dev/null 2>&1; then
    git_ok=1
  fi
  if [ "$git_ok" != 1 ]; then
    echo "   🔴 臂 9/10 没有输入：夹具里建不出 git 树（git 不在 PATH？）⇒ 内容章没被量过"; fail=1
  else
    stamp_base=$(heyta_src_content_stamp "$root") || stamp_base=""
    touch -t 203801010000 "$src_dir/StampProbe.tsx"          # 只碰，内容一字不改
    stamp_touch=$(heyta_src_content_stamp "$root") || stamp_touch=""
    if [ -n "$stamp_base" ] && [ "$stamp_touch" = "$stamp_base" ]; then
      echo "   ✅ 臂 9 原地重写（内容 == HEAD）不推进内容章（章 ${stamp_base}）"
    else
      echo "   🔴 臂 9 存活：只 touch 就把章从「${stamp_base:-空}」推进到「${stamp_touch:-空}」"; fail=1
    fi
    printf 'b\n' > "$src_dir/StampProbe.tsx"                  # 真改内容，不提交
    # 🔴 改完内容还要把 mtime **钉到一个与提交时刻不可能相等的值**：写文件本身会把
    #    mtime 刷成"现在"，而"现在"与刚才那发的提交时刻只差几秒 —— 于是"章 == 文件 mtime"
    #    这句会在两种实现下都成立（读文件的、读提交的），臂自己就废了（§7 元规则二）。
    touch -t 203801010000 "$src_dir/StampProbe.tsx"
    stamp_edit=$(heyta_src_content_stamp "$root") || stamp_edit=""
    if [ -n "$stamp_edit" ] && [ "$stamp_edit" = "$(_mtime "$src_dir/StampProbe.tsx")" ] \
       && [ "$stamp_edit" != "$stamp_base" ]; then
      echo "   ✅ 臂 10 未提交的内容改动算数（章 $stamp_edit == 那枚文件的 mtime，且不等于提交章 ${stamp_base}）"
    else
      echo "   🔴 臂 10 坏了：改了内容而章读成「${stamp_edit:-空}」，期望逐字等于文件 mtime「$(_mtime "$src_dir/StampProbe.tsx")」且不等于提交章「${stamp_base:-空}」"; fail=1
    fi
  fi

  # 臂 11：构建目录里**没有**归属章 -> 必须 rc=2 拒绝（不是"没有判据就放行"）。
  local derived_dir ownB rc_owner marker_owner out_owner
  derived_dir="$root/derived-fixture"
  mkdir -p "$derived_dir"
  heyta_ios_owner_check "$derived_dir" "$root" >/dev/null 2>&1; rc_owner=$?
  if [ "$rc_owner" = "2" ]; then
    echo "   ✅ 臂 11 无归属章的构建目录被拒（rc=2）"
  else
    echo "   🔴 臂 11 存活：没有归属章却读成 rc=${rc_owner}（期望 2=拒绝）"; fail=1
  fi

  # 臂 12：同一棵树、同一版源码写的章 -> 必须放行（证明这条判据不是恒红）。
  if heyta_ios_owner_write "$derived_dir" "$root" \
     && heyta_ios_owner_check "$derived_dir" "$root" >/dev/null 2>&1; then
    echo "   ✅ 臂 12 本树 + 当前源码版放行（不是恒红）"
  else
    echo "   🔴 臂 12 坏了：本树刚写的章，自己判不过"; fail=1
  fi

  # 臂 13：拿**另一棵树**去判同一枚章 -> 必须拒，且输出里两枚 root 都读得到。
  #   这一臂量的就是 rig64 的形状：A 树的产物落在跨树共享的 /tmp/heyta-ios-release，
  #   B 树的时间戳门把它打印成"更新、放行"。夹具 rootB 是 root 的**逐字节副本**
  #   （`cp -p` 保 mtime ⇒ 两棵树的内容章相等）⇒ 这一臂的红只能来自"树"这一维。
  ownB=$(mktemp -d)/treeB
  if cp -Rp "$root" "$ownB" 2>/dev/null; then
    out_owner=$(heyta_ios_owner_check "$derived_dir" "$ownB" 2>&1); rc_owner=$?
    if [ "$rc_owner" = "1" ] && printf '%s' "$out_owner" | grep -q "别一棵树" \
       && printf '%s' "$out_owner" | grep -qF "$ownB"; then
      echo "   ✅ 臂 13 别棵树的产物被拒（rc=1），拒绝理由带得出那棵树的路径"
    else
      echo "   🔴 臂 13 存活：拿另一棵树判同一枚章读成 rc=${rc_owner}，输出：${out_owner:-（空）}"; fail=1
    fi
    rm -rf "$(dirname "$ownB")"
  else
    echo "   🔴 臂 13 没有输入：夹具里复制不出第二棵树 ⇒ 「哪一棵树」这一维没被量过"; fail=1
  fi

  # 臂 14：树对了，但那之后**本树源码内容又变了** -> 必须拒。
  #   没有这一臂，臂 12 的"放行"可能来自"章里那个 src= 从来没被比较"。
  printf 'c\n' > "$src_dir/StampProbe.tsx"
  touch -t 203801010100 "$src_dir/StampProbe.tsx"
  if heyta_ios_owner_check "$derived_dir" "$root" >/dev/null 2>&1; then
    echo "   🔴 臂 14 存活：源码又变了而归属章仍判成立（src= 那一位没参与比较）"; fail=1
  else
    echo "   ✅ 臂 14 源码版不符被拒（章里的 src= 是承重的）"
  fi

  # 臂 15（接线）：两枚**写方**与一枚**读方**都必须在调用，缺一臂就红。
  #   抽进 lib 而不确认调用方真的在调 = 新写一份没人执行的更漂亮版本（§3.5 那条教训的形状）。
  marker_owner=0
  grep -q "heyta_ios_owner_write" "$HEYTA_REPO_ROOT/scripts/reinstall-all.sh" \
    || { echo "   🔴 臂 15 断了：reinstall-all.sh 没写归属章"; marker_owner=1; }
  grep -q "heyta_ios_owner_write" "$HEYTA_REPO_ROOT/scripts/verify-mobile-ios.sh" \
    || { echo "   🔴 臂 15 断了：verify-mobile-ios.sh 没写归属章"; marker_owner=1; }
  grep -q "heyta_ios_owner_check" "$HEYTA_REPO_ROOT/scripts/verify-mobile-ios-ai.sh" \
    || { echo "   🔴 臂 15 断了：verify-mobile-ios-ai.sh 没判归属章"; marker_owner=1; }
  [ "$marker_owner" = 0 ] && echo "   ✅ 臂 15 两枚写方 + 一枚读方确有调用点" \
    || fail=1

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
