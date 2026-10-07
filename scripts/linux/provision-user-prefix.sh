#!/usr/bin/env bash
# Linux 壳编译依赖的**无 sudo** 供给路线：把 .deb 闭包下载并解到用户态前缀里，
# 产出一句 `source` 就可用的环境文件。
#
#   bash scripts/linux/provision-user-prefix.sh              # 下载 + 解包 + 建链 + 写 env + 自验
#   bash scripts/linux/provision-user-prefix.sh --verify     # 只体检已就位的前缀
#   bash scripts/linux/provision-user-prefix.sh --prefix=/path
#
# 为什么要有这一枚（而不是只用 `setup-build-host.sh --step gtk`）：
# 那条走 `apt-get install`，**要 sudo**，而这台载体上 sudo 需要交互口令 ⇒ 编译腿只能等人。
# 本脚本一个字节都不改系统状态：不写 apt 的已装记录、不碰 /usr、不需要 root。
# 撤销就是把那一枚前缀目录删掉，仅此一处。
#
# 🔴 三个实测才知道的坑，脚本里逐个处理了（不要"顺手简化"掉）：
#
#  ① Ubuntu 的 `.pc` 把 `prefix` 硬编成 `/usr` ⇒ 从前缀里跑 pkg-config，`--cflags`
#     返回 `-I/usr/include/gtk-4.0`（那里没有头文件，编译以 `fatal error: gtk/gtk.h`
#     收尾，而 pkg-config 自己**退 0**）。解法是 `PKG_CONFIG_SYSROOT_DIR=<前缀>/root`：
#     它给每条路径加前缀 —— 这是为交叉编译设计的机制，不是我自己发明的写法。
#  ② `apt-get install --print-uris` **只列需要下载的那部分**：运行时库本机已装，
#     所以不在清单里。于是解出来的 -dev 包里那些 `libgtk-4.so → libgtk-4.so.1`
#     的软链全是悬空的，链接期报 `找不到 -lgtk-4` —— 此时 -I 已经对了，
#     看起来像"包没解全"。解法：把悬空链指到系统里那一份运行时库（只写自己的前缀）。
#  ③ 从非标准位置跑的 pkg-config 本体还要一条 `LD_LIBRARY_PATH` ——
#     `libpkgconf.so.3` 随包解在前缀里，系统里没有。症状是每条查询都打
#     `error while loading shared libraries`，容易被读成"这些模块都不存在"。
#
# 依赖清单**同源**：模块名从 `apps/desktop-linux/Makefile` 的 `PKGS :=` 现读，
# 包名映射只在 `scripts/linux/shell-modules.mjs` 一份。所以批二往 Makefile 加
# WebKitGTK 之后，这里会跟着一起装，不需要改本脚本。

set -euo pipefail

if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "❌ 需要 bash 4+（用到 mapfile）。这台是 ${BASH_VERSION} —— macOS 自带的 3.2 跑不了本脚本。" >&2
  exit 1
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PREFIX=${HEYTA_LINUX_PREFIX:-$HOME/heyta-linux-prefix}
MODE=provision
WITH_X11=0

for a in "$@"; do
  case "$a" in
    --verify) MODE=verify ;;
    --with-x11) WITH_X11=1 ;;
    --prefix=*) PREFIX=${a#*=} ;;
    *) echo "未知参数：${a}（可用：--verify / --with-x11 / --prefix=<目录>）" >&2; exit 1 ;;
  esac
done

DEBS=$PREFIX/debs
ROOTFS=$PREFIX/root
ENVFILE=$PREFIX/env.sh

fail() { echo "❌ $*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || fail "本脚本只在 Linux 上有意义（当前 $(uname -s)）；mac 上用 Xcode 自带的那套。"
command -v dpkg >/dev/null || fail "没有 dpkg —— 这台不是 Debian/Ubuntu？"
command -v node >/dev/null || fail "没有 node：依赖清单同源在 scripts/linux/shell-modules.mjs，取不到就没法往下走。"

mapfile -t DEV_PKGS < <(node "$ROOT/scripts/linux/shell-modules.mjs" --debs)
[ "${#DEV_PKGS[@]}" -gt 0 ] || fail "依赖清单取到 0 条 —— 先跑 node scripts/linux/shell-modules.mjs --pairs 看它报什么。"
# pkg-config 是查询工具本体（Makefile 的 \$(shell pkg-config ...) 与壳门禁都靠它），
# 它不对应任何 Makefile 模块，所以单独列。
PKGS=("${DEV_PKGS[@]}" pkg-config)
# `--with-x11`：把 Xvfb 也解进前缀，给"窗口取证"用（壳自己出 PNG，不需要 ImageMagick）。
# 它**不是**编译依赖，所以默认不装 —— 装了就进同一枚前缀、同一条 env。
if [ "$WITH_X11" = 1 ]; then
  PKGS+=(xvfb)
  echo "  · --with-x11：额外带上 Xvfb（窗口取证用）"
fi
echo "清单同源取到 ${#PKGS[@]} 枚 apt 包：${PKGS[*]}"

if [ "$MODE" = verify ]; then
  [ -f "$ENVFILE" ] || fail "没有 $ENVFILE —— 先不带 --verify 跑一次。"
  # shellcheck disable=SC1090
  source "$ENVFILE"
  n=0
  for m in $(node "$ROOT/scripts/linux/shell-modules.mjs"); do
    v=$(pkg-config --modversion "$m" 2>&1) || fail "pkg-config 查不到 ${m}：$v"
    echo "  ✅ $m = $v"
    n=$((n + 1))
  done
  [ "$n" -gt 0 ] || fail "一条模块都没验到（Makefile 的 PKGS 是空的？）。"
  echo "✅ 前缀可用：$n 枚模块都查得到。环境文件：source $ENVFILE"
  exit 0
fi

mkdir -p "$DEBS" "$ROOTFS"

# ① 取闭包清单（只读，不装）。rc 单独判：包名不存在时 apt 退 100，
#    而管道尾的 sed 照样退 0 —— 那时清单是空的，别把它报成"源有问题"。
LIST=/tmp/heyta-prefix-uris.$$.tsv
trap 'rm -f "$LIST"' EXIT
if ! apt-get install --print-uris -qq --no-install-recommends "${PKGS[@]}" > "$LIST" 2>/tmp/heyta-prefix-apt.$$.err; then
  echo "apt-get --print-uris 失败，原文：" >&2
  cat /tmp/heyta-prefix-apt.$$.err >&2
  rm -f /tmp/heyta-prefix-apt.$$.err
  fail "闭包取不全就停下来 —— 拿半份清单去编译，报出来的错会比这一条难归因得多。"
fi
mapfile -t TSV < <(sed -E "s/^'([^']+)' ([^ ]+).*/\1\t\2/" "$LIST")
rm -f /tmp/heyta-prefix-apt.$$.err
[ "${#TSV[@]}" -gt 0 ] || fail "apt-get 退 0 但一条 URI 都没给 —— 这些包在源里都已是最新且已安装？（那本来就不用装）"
echo "闭包 ${#TSV[@]} 个 .deb"

# ② 下载（下过就跳过，可重复跑）
ok=0; cached=0; bad=0
for row in "${TSV[@]}"; do
  uri=${row%%$'\t'*}; name=${row##*$'\t'}
  case "$uri" in
    http*/*) ;;
    *) bad=$((bad + 1)); echo "  ⚠️ 解析不出 URI：$row" >&2; continue ;;
  esac
  if [ -s "$DEBS/$name" ]; then cached=$((cached + 1)); continue; fi
  if curl -fsSL --retry 2 -o "$DEBS/$name" "$uri"; then ok=$((ok + 1)); else bad=$((bad + 1)); echo "  ❌ 下载失败：$uri" >&2; fi
done
[ "$bad" -eq 0 ] || fail "有 $bad 个包没取到。闭包不全的编译会报成\"某个库找不到\"，比这一条更难归因。"
[ $((ok + cached)) -gt 0 ] || fail "一个 .deb 都没落到 ${DEBS}。"
echo "下载 $ok 个（复用 $cached 个），失败 $bad 个"

# ③ 解包到用户态前缀
extracted=0
for d in "$DEBS"/*.deb; do
  [ -e "$d" ] || continue
  dpkg -x "$d" "$ROOTFS"
  extracted=$((extracted + 1))
done
[ "$extracted" -gt 0 ] || fail "没有 .deb 可解。"
PC_COUNT=$(find "$ROOTFS" -name '*.pc' | wc -l)
[ "$PC_COUNT" -gt 0 ] || fail "解完了但前缀里 0 枚 .pc —— 清单里根本没有 -dev 包（跑 --pairs 核对）。"
echo "解包 $extracted 个 .deb，$PC_COUNT 枚 .pc"

# ④ 坑 ②：把悬空的 lib*.so 软链指到系统里已有的运行时库
MULTIARCH=$(dpkg-architecture -qDEB_HOST_MULTIARCH 2>/dev/null || echo "$(uname -m)-pc-linux-gnu")
LINKDIR=$ROOTFS/usr/lib/$MULTIARCH
relinked=0; still=0; pass=0
if [ -d "$LINKDIR" ]; then
  # 走**最多三趟**直到没有进展：包内还有相对链（实测的 `libpng.so -> libpng16.so`），
  # 一趟的顺序不保证先修被指向的那条，于是"这一条定位不到"其实是假警报。
  while [ "$pass" -lt 3 ]; do
    pass=$((pass + 1)); progress=0
    while IFS= read -r l; do
      b=$(basename "$l")
      matched=""
      for cand in /usr/lib/$MULTIARCH/"$b".* /lib/$MULTIARCH/"$b".*; do
        [ -e "$cand" ] || continue
        matched=$cand
        break
      done
      [ -n "$matched" ] || continue
      ln -sfn "$matched" "$l"
      progress=$((progress + 1))
    done < <(find "$LINKDIR" -maxdepth 1 -type l ! -exec test -e {} \; -print)
    relinked=$((relinked + progress))
    [ "$progress" -gt 0 ] || break
  done
  still=$(find "$LINKDIR" -maxdepth 1 -type l ! -exec test -e {} \; -print | wc -l)
fi
echo "重建悬空软链 $relinked 条（$pass 趟），复核仍悬空 $still 条"
# 🔴 这条 ⚠️ 以前会**打印一张空列表**：计数在修链当下判，而复核时那条已由包内相对链解析了。
#    报数量的语句必须用**复核后**的那个数、并且只在它非空时才列内容。
if [ "$still" -gt 0 ]; then
  echo "  ⚠️ 下面 $still 条链对应的运行时库本机确实没有；编译若报 missing library，先看它们：" >&2
  find "$LINKDIR" -maxdepth 1 -type l ! -exec test -e {} \; -print | sed "s#.*/#    #" | head -20
fi

# ⑤ 环境文件（坑 ① 与 ③ 的落地处）
cat > "$ENVFILE" <<EOF
# 由 scripts/linux/provision-user-prefix.sh 生成。用法：
#   source $ENVFILE
# 撤销：rm -rf $PREFIX
export HEYTA_LINUX_PREFIX=$PREFIX
export PATH=$ROOTFS/usr/bin:\$PATH
export PKG_CONFIG_PATH=$ROOTFS/usr/lib/$MULTIARCH/pkgconfig:$ROOTFS/usr/share/pkgconfig
export LD_LIBRARY_PATH=$ROOTFS/usr/lib/$MULTIARCH\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}
export PKG_CONFIG_SYSROOT_DIR=$ROOTFS
EOF
echo "写好环境文件：$ENVFILE"

# ⑥ 当场自验。脚本本身没有 export 过这四条，所以这里 source 成功 == 新开一个 shell source 成功。
source "$ENVFILE"
n=0
for m in $(node "$ROOT/scripts/linux/shell-modules.mjs"); do
  v=$(pkg-config --modversion "$m" 2>&1) || fail "环境文件写好了但 pkg-config 查不到 ${m}：$v"
  echo "  ✅ $m = $v"
  n=$((n + 1))
done
[ "$n" -gt 0 ] || fail "自验一条都没跑（Makefile 的 PKGS 是空的？）。"

echo "✅ 前缀就位：${PREFIX}（$n 枚模块可查）"
echo "   跑门禁：source $ENVFILE && HEYTA_REQUIRE_LINUX_SHELL=1 pnpm check:linux-shell"
