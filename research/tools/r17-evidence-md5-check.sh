#!/bin/bash
# 证据 README 里"记的 md5 == 盘上字节"的常驻对账。
#
# 为什么需要它（2026-10-04 05:3x / 05:4x 两轮实测）：
#   `apps/web/evidence/calendar-view-options/README.md` 与 `apps/web/evidence/calendar-day/README.md`
#   里记的 md5 与**盘上字节对不上** —— 01:34 另一条会话跑 e2e 时把同名 png 覆盖，
#   而"人看过那张图"与"图是当前的"那两句承诺**没有任何一层会为此变红**。
#   §6.2 规定一要求的是人真的看过那张图，前提是**看的和记的是同一份字节**。
#
# 认三种形状（现量：仓库里三种都在用；C 是 2026-10-04 12:0x 为 `calendar-day/` 那批新增的）：
#   A. `md5 -r` 裸形状：      `<32hex>  name.png`
#   B. markdown 表格形状：    反引号包的文件名 + 反引号包的 32 位 md5 那一列
#   C. 代码锚点形状：         `UIPIN name.png <7–40 hex> <决定形状的源码路径…>`
#      A/B 管**字节过期**（有人重跑 e2e 把图覆盖了）；C 管**主张过期**（字节没变，但
#      "这张图画的是当前交付形状"这句话底下的源码已经又动了）。
#      🔴 为什么必须要第三种：`calendar-day/` 那批按构造**不可能有常驻 md5** —— 12:0x 逐像素实测：
#      11:55 那趟重跑与 HEAD 的字节差异**只有 468/3686400 枚像素，全落在任务名那一行**
#      （`en-day-589776` → `en-day-083090`，每趟随机）。给这种图钉 md5 = 造一条每跑必红的判据，
#      而 §8.3 那条元规则说它会把人训练成忽略红。代码锚点不会：重跑不红，**界面代码动了才红**。
#      ⚠️ 第一版这里是 `COMMITPIN <png> <sha>`（比"最后一次动这张**图**的提交"），同一轮实测否证：
#      它把"有人重跑了 e2e"和"界面形状变了"混成同一个读数，而前者在这个仓库里每天几十次 ⇒ 常驻红。
#
# 🔴 **路径集里不收"整包高频表"——这条是 21:5x 现量教出来的，不是风格偏好**：
#   27 枚 UIPIN 的路径清单**每一条**都带着 `packages/i18n`。现量 `--all`：`14 目录 / 8 有红 / 27 枚 UISTALE`，
#   而 **27 枚点名的都是同一笔提交** `baf125e5`（20:45，"法务条款六份 + 中英词条"）—— 那笔在 i18n 里
#   动的是 `common.privacy.consent.*` 与 `site./web./mobile.` 的措辞，全仓只有**一行**提到 "calendar"，
#   还是那句列举功能名的隐私文案里的一个词 ⇒ **对这些图零像素影响**。
#   触发率现量：近 3 天 `packages/i18n` **78 笔**，同期 `packages/ui/src/calendar` **4 笔**（19:1）。
#   ⇒ 一枚"每 20 笔提交必红一次、且红得与图无关"的判据，正是本文件第 20 行自己写过的那种东西
#   （第一版 COMMITPIN 因同样的理由被否证过一回，这次是**同一个坑换了触发源**）。
#   摘掉之后：`14 目录 / 5 有红 / 14 枚 UISTALE`，剩下的 14 枚**全部点名 `39032107`**
#   （10-04 10:11 那笔把主区页头改成"动作整体可换行"的 CSS）—— 那才是"形状真的动过"。
#   文案那一半的覆盖不在这里，在**断言可见文字**的 e2e/单测里；别为了"看起来管得住文案"
#   把整包表塞回路径清单。常驻护栏：`research/tools/r17-pin-path-hygiene.sh`。
#
# 形状纪律：
#   - 一条都解析不到 = **探针坏**，不是"没有不一致" ⇒ exit 4（AGENTS §8.3：不能失败的判据比没有更糟）。
#   - 判绿只认退出码；报错同时走 stdout 与 stderr（§7 #45 那一族：`> out 2>/dev/null` 后空 stdout 与"干净"长得一样）。
#   - `--selftest` 是这条判据的**牙**：**十臂** —— md5 对照腿 0 枚 / md5 注入腿恰好 1 枚 /
#     表格形状解析到 1 条 / 表格形状注入腿恰好 1 枚 / UIPIN 正例 1 命中 / UIPIN 源码动了恰好 1 枚 UISTALE /
#     UIPIN 钉不存在的提交 rc=4 / UIPIN 路径集为空 rc=4（后两条是"判不了不许算绿"）/
#     🔴 **臂 9 是"有图没 README"那一档**：造一枚只放图不放 README 的证据目录 ⇒ `noreadme_dirs` 必须
#     恰好点名它、**且不点名同一棵树里有 README 的那枚**（点名=1 / 负对照=0 / 全集=1 三条一起 ——
#     少了"全集"那条，扫描范围整个坏掉返回空集也能骗过负对照），补上一份合法 README 后必须归零。
#     这一臂的由来：13:5x 现量 `apps/web/evidence/calendar-year/` 四张真浏览器截图**连 README 都没有**，
#     而 `ALL_GLOB` 走的是 `apps/*/evidence/*/README.md` —— **没有 README 的目录连被扫到的资格都没有**，
#     于是"这几张图是当前交付形状"这句话不在任何一格里变红（`dirs_scanned` 反而看着很健康）。
#     🔴 八臂**全部跑在合成夹具上**，一份现场字节都不读 —— 第一版的对照腿复制现场 README，
#     12:0x 现场被 11:55 那趟重跑顶掉一枚字节 ⇒ 对照腿自杀在 exit 4，**后面六臂一条没跑**。
#     🔴 **臂 10 测的是 `--all` 那一层自己**（靠 `--root <合成树>`）：ALLCHECK 整行逐字段相等
#     （3 扫 / 1 无 README / 1 零锚点 / 0 锚点判不了 / 1 条 md5 解析到）、无图的文本目录**不许**被点名、
#     两档棘轮各自把基线压到 0 都要能红、一枚判不了的锚点必须红、空树必须 rc=4。
#     这一臂的由来：`UNPINNED` 那一档（README 有、锚点 0 条、图 20 张）在 rc=4 上**谁都接不住**，
#     加它的时候只测 check_one_dir 等于没测 —— 坏的地方在计数与棘轮，不在单目录解析。
#   - `--all` 打印**分母**（扫了几份 README、解析出几条），只印"✅ 一致"而不印分母的判据不算判据。
set -u

DEFAULT_DIRS="apps/web/evidence/calendar-view-options"
ALL_GLOB="apps/*/evidence/*/README.md"
# 🔴 "有图但没 README"那一档的**基线（只减不增）**。14:0x 现量 21 枚，逐枚都是**别的线的取证目录**。
#    14:1x 本线偿掉一枚（`apps/web/evidence/calendar-capture/` 补了 README + UIPIN）⇒ 现量 20。
#    （本线另外那两枚 `calendar-year` / `calendar-day-time` 在 13:5x 就补掉了，不在这笔账里。）
#    为什么是棘轮而不是"非 0 就红"：这条判据是 14:0x 新加的，现场存量债不归本线，
#    一上来就恒红 = 把别人欠的账变成自己的常驻红（§8.3：那会把人训练成忽略红）；
#    但**新增一枚就红**是立刻生效的 —— 那正是这一档唯一会悄悄变多的方向。
#    重新量基线（不要手改这个数）：
#      bash research/tools/r17-evidence-md5-check.sh --all | grep -c '^NOREADME '
NOREADME_MAX="${NOREADME_MAX:-20}"
# 🔴 第二档债：**有 README，但里面一条锚点都解析不到，而目录里有图**（形状上叫 EMPTY / rc=4）。
#    14:0x 现量 5 枚、合计 20 张截图（`apps/desktop-windows/evidence/storage-host` 2、
#    `apps/web/evidence/auth-journey` 8、`calendar-cells` 5、`calendar-week` 3、`email-chain` 2）。
#    这一档比"没 README"更隐蔽：目录**看着有文档**、`dirs_scanned` 也算它进去了，可它对那 20 张图
#    一条判据都不行使 —— 而 `EMPTY` 的 rc=4 在 --all 里既不进 ${TOTAL_BAD} 也不进任何计数，
#    也就是**过去这一档整个是隐身的**（本次加 NOREADME 那一档时才被照出来）。
#    14:1x 本线偿掉两枚（`calendar-cells` 5 张 + `calendar-week` 3 张补了 UIPIN）⇒ 现量 3 枚，
#    剩下三枚都归**别的线**：storage-host(2) / auth-journey(8) / email-chain(2)。
#    ⚠️ 纯文本/日志型证据目录（0 张图）不算债：那条锚点形状本来就不适用（实测
#    `apps/desktop-macos/evidence/storage-host` 20 个文件 0 张图 ⇒ 它报 EMPTY 是对的，但不点名）。
#    重新量基线（不要手改这个数）：
#      bash research/tools/r17-evidence-md5-check.sh --all | grep -c '^UNPINNED '
UNPINNED_MAX="${UNPINNED_MAX:-3}"
SELFTEST=0
ALL=0
DIRS=""

ALL_ROOT="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --selftest) SELFTEST=1; shift ;;
    --all) ALL=1; shift ;;
    # 🔴 `--root` 存在的唯一理由：让 --all 这一整段能跑在**合成夹具树**上（臂 10）。
    #    不加这个旋钮，自测就只能测 check_one_dir（单目录），而本工具**真正会漏的那一档**
    #    —— "某目录一条判据都不行使， yet 汇总行看着很健康" —— 是 --all 那一层的逻辑，
    #    测不到它就等于给最容易坏的那一层没有牙（§8.3 元规则）。
    #    默认 $PWD = 现场行为逐字不变。
    --root) ALL_ROOT="${2:-}"; [ -n "$ALL_ROOT" ] || { echo "❌ --root 后面要给目录" >&2; exit 1; }; shift 2 ;;
    --dir) DIRS="${DIRS} ${2:-}"; shift 2 ;;
    *) echo "❌ 未知参数：$1（只认 --selftest / --all / --root <树根> / --dir <证据目录>）" >&2; exit 1 ;;
  esac
done

# 目录里有几张图片。两档债（无 README / README 零锚点）都用它做"这张判据适用不适用"的分界：
# 纯文本型证据目录不该被点名。⚠️ 单一实现 —— 计数逻辑写两遍就是漂移的起点。
count_images() {
  local d="$1" n=0 f
  [ -d "$d" ] || { echo 0; return; }
  for f in "$d"/*; do
    [ -f "$f" ] || continue
    case "${f##*.}" in
      png|jpg|jpeg|webp|PNG|JPG|JPEG|WEBP) n=$((n + 1)) ;;
    esac
  done
  echo "$n"
}

# 有图、**没有 README** 的证据目录 ⇒ 这些图一条常驻判据都没有。
# $1 = 根（--all 传 ${PWD}，自测传合成夹具目录）。输出每行 `<目录> <图片枚数>`。
# 🔴 为什么单独列：`ALL_GLOB` 只认得到**有 README 的目录**，所以"没写 README"这件事在
#    `dirs_scanned` 上完全隐身 —— 它不是"没有不一致"，是**根本没看**。13:5x 现量：
#    `calendar-year/` 四张真浏览器截图就这么藏了一整天。
# ⚠️ 只数图片：纯文本/日志型证据目录（没有图）不该被这条点名。
noreadme_dirs() {
  local root="${1:-$PWD}" d imgs rel
  for d in "$root"/apps/*/evidence/*/; do
    [ -d "$d" ] || continue
    [ -f "${d}README.md" ] && continue
    imgs=$(count_images "$d")
    [ "$imgs" = "0" ] && continue
    # 打**相对路径**：绝对路径里带仓库目录名（本机那个路径还有空格），既难读也没法拿去 grep
    rel=${d#"$root"/}
    printf '%s %s\n' "${rel%/}" "$imgs"
  done
}

# 从一行 `DIRCHECK …` 里取一个数字字段。两个分支（--all 与点名）共用这一把尺 ——
# 🔴 原来 --all 里那两条 sed 是一把手抄了两遍的形状，而点名分支根本没有取数，
#    于是它的绿行只能写"逐条相同"这种**没有分母**的口吻（臂 11 的由来）。
dfield() { printf '%s\n' "$1" | sed -n "s/^DIRCHECK .* ${2}=\\([0-9]*\\) .*/\\1/p"; }

# 对一份 README 逐条对账；stdout 打印 `OK <名>（<md5>）` 或 `MISMATCH <名>：…`
# 返回：0 全对 / 1 有不一致 / 4 这份里解析到 0 条
check_one_dir() {
  rd="$1"
  readme="$rd/README.md"
  if [ ! -f "$readme" ]; then
    echo "SKIP ${rd}（没有 README.md）"
    echo "DIRCHECK ${rd} entries=0 mismatch=0 pins=0 md5bad=0 pinbad=0 pinunknown=0"
    return 4
  fi
  entries=$(grep -E -e '^([0-9a-f]{32}  [^ ]+\.(png|jpg|jpeg|webp))$' \
                   -e '^\| `[^`]+\.(png|jpg|jpeg|webp)` \| `[0-9a-f]{32}`' "$readme" || true)
  n=$(printf '%s\n' "$entries" | grep -c . || true)
  # 形状 C：`UIPIN <name.png> <pin-sha> <决定这张图形状的源码路径…>` —— 钉的是**代码锚点**：
  #   "这张图所主张的那个界面形状，对应到 <pin-sha> 那一批代码"。判据 = 声明的那组路径里
  #   **最后一次动它们的提交**必须是 pin 的祖先或就是 pin；动了 ⇒ UISTALE（要重看/重拍）。
  #   为什么需要第三种：`calendar-day/` 那五张与两枚 `day-en-*` 按构造**不可能有常驻 md5**
  #   （图里带每趟随机的任务名 `en-day-<6 位>`，12:0x 实测：11:55 那趟重跑与 HEAD 的字节差异
  #   **只在那一行任务名上**，468/3686400 枚像素）—— 给它们钉 md5 就是造一条**每跑必红**的判据，
  #   而 §8.3 那条元规则说那种判据会把人训练成忽略它。代码锚点不会：重跑不红，**界面代码动了才红**。
  #   ⚠️ 第一版这里是 `COMMITPIN <png> <sha>`（比"最后一次动这张**图**的提交"），12:0x 实测否证：
  #      它把"有人重跑了 e2e"和"界面形状变了"混成同一个读数，而前者在这个仓库里每天几十次
  #      ⇒ 常驻红。形状主张的锚是**源码的提交**，不是**截图的提交**。
  pins=$(grep -E '^UIPIN [^ ]+\.(png|jpg|jpeg|webp) [0-9a-f]{7,40} ' "$readme" || true)
  pn=$(printf '%s\n' "$pins" | grep -c . || true)
  if [ "$n" = "0" ] && [ "$pn" = "0" ]; then
    echo "EMPTY ${rd}（README 里解析到 0 条 md5 条目、0 条 UIPIN）"
    # 🔴 **必须照样打 DIRCHECK**（臂 10 抓到的：这一版以前在这里直接 return，
    #    而 --all 的 UNPINNED 计数是从 DIRCHECK 的 entries=/pins= 两个字段读的 ⇒
    #    字段不存在 ⇒ 这一档**永远数到 0**，判据看着装了牙其实一条都没接住）。
    #    约定：check_one_dir **只要跑到底就打 DIRCHECK**，判决走返回值、账目走这一行。
    echo "DIRCHECK ${rd} entries=0 mismatch=0 pins=0 md5bad=0 pinbad=0 pinunknown=0"
    return 4
  fi
  bad=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      '|'*)
        # 表格形状：| `name.png` | `md5` | ...
        name=$(printf '%s' "$line" | sed -n 's/^| `\([^`]*\)` | `\([0-9a-f]\{32\}\)`.*/\1/p')
        want=$(printf '%s' "$line" | sed -n 's/^| `\([^`]*\)` | `\([0-9a-f]\{32\}\)`.*/\2/p')
        ;;
      *)
        want=${line%%  *}
        name=${line#*  }
        ;;
    esac
    if [ -z "$name" ] || [ -z "$want" ]; then
      echo "MISMATCH ${rd}：解析出一条但取不到文件名或指纹（探针没接上，不能据此判绿）"
      bad=$((bad + 1))
      continue
    fi
    p="$rd/$name"
    if [ ! -f "$p" ]; then
      echo "MISMATCH ${name}：README 记了它，盘上没有这个文件（${rd}）"
      bad=$((bad + 1))
      continue
    fi
    got=$(md5 -q "$p")
    if [ "$got" != "$want" ]; then
      echo "MISMATCH ${name}：README=${want} 盘上=${got} —— 记的与被记的不是同一份字节"
      bad=$((bad + 1))
    else
      echo "OK ${name}（${got}）"
    fi
  done <<EOF3
$entries
EOF3
  pbad=0; punk=0
  # UIPIN 的路径是**仓库根相对**的，所以 git 必须在仓库根上跑；$rd 是子目录时
  # `git -C "$rd" log -- packages/ui/...` 会把 pathspec 解成 `$rd/packages/ui/...` ⇒ 恒空。
  root=$(git -C "$rd" rev-parse --show-toplevel 2>/dev/null)
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    name=$(printf '%s' "$line" | awk '{print $2}')
    want=$(printf '%s' "$line" | awk '{print $3}')
    paths=$(printf '%s' "$line" | cut -d' ' -f4-)
    if [ -z "$name" ] || [ -z "$want" ] || [ -z "$paths" ]; then
      echo "PINUNKNOWN ${rd}：解析出一条 UIPIN 但取不到 文件名/提交号/路径集（探针没接上，不能据此判绿）"
      punk=$((punk + 1)); continue
    fi
    p="$rd/$name"
    if [ ! -f "$p" ]; then
      echo "UISTALE ${name}：README 钉了 ${want}，但盘上没有这个文件（${rd}）"
      pbad=$((pbad + 1)); continue
    fi
    if [ -z "$root" ]; then
      echo "PINUNKNOWN ${name}：$rd 不在任何 git 树里 ⇒ 代码锚点判不了（不算绿）"
      punk=$((punk + 1)); continue
    fi
    # 浅克隆是**载体**判不了，不是锚点写错。这一档仍然红（判不了就不许报绿），
    # 但要把话说清：CI 的 actions/checkout 默认 fetch-depth=1，接进链之前要先给那一步 full history，
    # 否则这道门会在 CI 里**每枚锚点都红**，而红的原因跟任何人的改动都无关。
    if [ ! -e "$root/.git/shallow" ]; then
      SHALLOW_HINT=""
    else
      SHALLOW_HINT="⚠️ 这棵树是浅克隆 ⇒ 是**载体判不了**，不是锚点写错：先给 CI 的 checkout 加 fetch-depth: 0。"
    fi
    if ! git -C "$root" cat-file -e "${want}^{commit}" 2>/dev/null; then
      echo "PINUNKNOWN ${name}：钉的 ${want} 在这棵树里不是一笔提交（写错了 / 被 rebase 掉了）${SHALLOW_HINT}⇒ 判不了，不算绿"
      punk=$((punk + 1)); continue
    fi
    if ! git -C "$root" merge-base --is-ancestor "$want" HEAD 2>/dev/null; then
      echo "PINUNKNOWN ${name}：钉的 ${want:0:10} 不是 HEAD 的祖先（在别的分支上 ⇒ 这一份字节里没有它）"
      punk=$((punk + 1)); continue
    fi
    newest=$(git -C "$root" log -1 --format=%H -- $paths 2>/dev/null)
    if [ -z "$newest" ]; then
      echo "PINUNKNOWN ${name}：声明的路径集一条都没匹配到提交（路径写错了？⇒ 这条锚点是空的，不能判绿）"
      punk=$((punk + 1)); continue
    fi
    if git -C "$root" merge-base --is-ancestor "$newest" "$want" 2>/dev/null; then
      echo "UIOC ${name}（决定形状的源码最后一次动它是 ${newest:0:10} ≤ 钉的 ${want:0:10}）"
    else
      echo "UISTALE ${name}：钉 ${want:0:10}，但源码里决定这张图形状的路径已在 ${newest:0:10} 之后又动过 ⇒ 形状主张已过期，要重看并重钉"
      pbad=$((pbad + 1))
    fi
  done <<EOF4
$pins
EOF4
  echo "DIRCHECK ${rd} entries=${n} mismatch=$((bad + pbad)) pins=${pn} md5bad=${bad} pinbad=${pbad} pinunknown=${punk}"
  if [ "$((bad + pbad))" != "0" ]; then return 1; fi
  [ "$punk" = "0" ] && return 0 || return 4
}

if [ "$SELFTEST" = "1" ]; then
  D=$(mktemp -d /tmp/ht-r17-md5.XXXXXX)
  trap 'rm -rf "$D"' EXIT
  # 🔴 对照腿**不复制现场 README**（第一版是复制的，12:0x 现场被另一条会话 11:55 那趟 e2e 重写了
  #    一枚字节 ⇒ 对照腿 rc=1 ⇒ 装置在 exit 4 处自杀，**后面六臂一条没跑**）。
  #    教训：**牙的检查不能被它要保护的那份现场卡住** —— 现场红是判据该红，那是另一件事（跑 --all）。
  #    装置腿只用自己造的合成夹具；现场状态由 default/`--all` 那条路负责报。
  mkdir -p "$D/raw"
  printf 'HT-RAW-A' > "$D/raw/a.png"
  printf '%s  a.png\n' "$(md5 -q "$D/raw/a.png")" > "$D/raw/README.md"
  echo "== selftest 对照腿（合成夹具，未变异）=="
  check_one_dir "$D/raw" >"$D/ctrl.out" 2>&1
  CTRL_RC=$?
  CTRL_N=$(grep -c '^MISMATCH ' "$D/ctrl.out")
  echo "   ctrl rc=${CTRL_RC} MISMATCH行数=${CTRL_N}"
  if [ "$CTRL_RC" != "0" ] || [ "$CTRL_N" != "0" ]; then
    echo "❌ 对照腿坏了：合成夹具应当 rc=0 且零枚不一致（这是装置坏，不是判据红）" >&2
    sed 's/^/      /' "$D/ctrl.out" >&2
    exit 4
  fi
  printf 'x' >> "$D/raw/a.png"
  echo "== selftest 变异腿（给 raw/a.png 追加 1 字节）=="
  check_one_dir "$D/raw" >"$D/mut.out" 2>&1
  MUT_RC=$?
  MUT_N=$(grep -c '^MISMATCH ' "$D/mut.out")
  echo "   mut rc=${MUT_RC} MISMATCH行数=${MUT_N}"
  sed 's/^/      /' "$D/mut.out"
  if [ "$MUT_RC" = "0" ] || [ "$MUT_N" != "1" ]; then
    echo "❌ 变异腿没红（rc=${MUT_RC}，枚数=${MUT_N}，期望 rc!=0 且恰好 1 枚）⇒ 这条对账没有牙" >&2
    exit 1
  fi
  # 第三臂：表格形状也得解析得到（否则 --all 那一半是空的却看起来像"没有不一致"）
  T=$(mktemp -d /tmp/ht-r17-tbl.XXXXXX)
  mkdir -p "$T/apps/web/evidence/tableshape"
  printf '| `a.png` | `%s` | 说明 |\n' "$(printf 'A' | md5 -q)" > "$T/apps/web/evidence/tableshape/README.md"
  printf 'A' > "$T/apps/web/evidence/tableshape/a.png"
  echo "== selftest 表格形状臂 =="
  check_one_dir "$T/apps/web/evidence/tableshape" >"$T/tbl.out" 2>&1
  TBL_RC=$?
  TBL_N=$(grep -c '^DIRCHECK .*entries=1' "$T/tbl.out")
  echo "   tbl rc=${TBL_RC} entries=1 命中=${TBL_N}"
  sed 's/^/      /' "$T/tbl.out"
  if [ "$TBL_RC" != "0" ] || [ "$TBL_N" != "1" ]; then
    echo "❌ 表格形状臂坏了（rc=${TBL_RC}，entries=1 命中=${TBL_N}）⇒ --all 那一半没有牙" >&2
    rm -rf "$T"
    exit 1
  fi
  # 第四臂：表格形状也要**能红**（只证明解析到，不证明检测得到）
  printf 'B' >> "$T/apps/web/evidence/tableshape/a.png"
  check_one_dir "$T/apps/web/evidence/tableshape" >"$T/tbl2.out" 2>&1
  T2_RC=$?
  T2_N=$(grep -c '^MISMATCH ' "$T/tbl2.out")
  echo "   tbl2（表格形状注入腿）rc=${T2_RC} MISMATCH行数=${T2_N}"
  sed 's/^/      /' "$T/tbl2.out"
  # ⚠️ 这里原来紧跟一句 `rm -rf "$T"`，而臂 9 的**负对照腿**要用的就是这棵树里"已经有 README"
  #    的那枚（tableshape）—— 提前删掉后 `grep -c tableshape` 恒 0，负对照变成**永远通过**的判据。
  #    删除挪到臂 9 之后。
  if [ "$T2_RC" = "0" ] || [ "$T2_N" != "1" ]; then
    echo "❌ 表格形状注入腿没红（rc=${T2_RC}，枚数=${T2_N}）⇒ 解析得到但检不出来" >&2
    rm -rf "$T"
    exit 1
  fi
  # ── 臂 5–8：形状 C（UIPIN 代码锚点）。这四臂各自盯一条分支，因为这一路要救的现场是
  #    **"每跑必变的字节"**（钉 md5 会常驻红），只证"解析得到"而不证"代码动了会红"的话，
  #    它就是一条永远绿的装饰（§8.3 元规则）。
  P=$(mktemp -d /tmp/ht-r17-pin.XXXXXX)
  # 🔴 桩 repo 必须**与本机 git 全局配置解耦**：`commit.gpgsign=true` 或全局 `core.hooksPath`
  #    会让这里的 commit 失败，而失败是**无声的**（SEED 变空串 ⇒ 臂 5 的 sha 写成 8 个空格）。
  GITP="git -C $P -c commit.gpgsign=false -c core.hooksPath=$P/nohooks -c user.name=t -c user.email=t@t"
  $GITP init -q 2>/dev/null
  $GITP commit -q --allow-empty -m seed 2>/dev/null
  SEED=$(git -C "$P" log -1 --format=%H)
  [ -n "$SEED" ] || { echo "❌ 臂5 的 git 桩起不来（SEED 为空）⇒ 这四臂的读数全是假的" >&2; rm -rf "$P"; exit 4; }
  mkdir -p "$P/ui"; printf 'a{color:red}\n' > "$P/ui/a.css"
  $GITP add ui/a.css 2>/dev/null; $GITP commit -q -m ui-1 2>/dev/null
  printf 'PIN-X' > "$P/x.png"
  $GITP add x.png 2>/dev/null; $GITP commit -q -m shot 2>/dev/null
  AT=$(git -C "$P" log -1 --format=%H)
  printf 'UIPIN x.png %s ui/a.css\n' "$AT" > "$P/README.md"
  echo "== selftest 臂5 UIPIN 正例（源码最后一次动它 ≤ 钉的那笔）=="
  check_one_dir "$P" >"$P/p1.out" 2>&1
  P1=$?
  OK1=$(grep -c '^UIOC ' "$P/p1.out")
  echo "   臂5 rc=${P1} UIOC=${OK1}（pin=${AT:0:8}）"
  sed 's/^/      /' "$P/p1.out"
  if [ "$P1" != "0" ] || [ "$OK1" != "1" ]; then
    echo "❌ 臂5 坏了（rc=${P1}，UIOC=${OK1}）⇒ 正例都过不了，这条判据一律会红，等于没有" >&2
    rm -rf "$P"; exit 4
  fi
  # 臂 6：**决定形状的源码又动了一笔** ⇒ 必须恰好 1 枚 UISTALE。
  #   这一臂同时是"为什么不用图片提交号当锚"的反证：这里 x.png 的字节**一个字都没变**，
  #   而主张已经过期 —— 只有源码锚点看得见这件事。
  XMD5_BEFORE=$(md5 -q "$P/x.png")
  printf 'a{color:blue}\n' > "$P/ui/a.css"
  $GITP add ui/a.css 2>/dev/null; $GITP commit -q -m ui-2 2>/dev/null
  echo "== selftest 臂6 UIPIN 源码动了（图字节没变）=="
  check_one_dir "$P" >"$P/p2.out" 2>&1
  P2=$?
  ST6=$(grep -c '^UISTALE ' "$P/p2.out")
  SAME=no; [ "$XMD5_BEFORE" = "$(md5 -q "$P/x.png")" ] && SAME=yes
  echo "   臂6 rc=${P2} UISTALE=${ST6}（x.png 字节与臂5 那趟相同=${SAME}）"
  sed 's/^/      /' "$P/p2.out"
  if [ "$P2" = "0" ] || [ "$ST6" != "1" ]; then
    echo "❌ 臂6 没红（rc=${P2}，枚数=${ST6}）⇒「界面代码已经动了」这件事检不出来" >&2
    rm -rf "$P"; exit 1
  fi
  # 臂 7：钉了一笔**不存在**的提交 ⇒ 判不了（rc=4），不许悄悄算绿
  printf 'UIPIN x.png %s ui/a.css\n' "0000000000000000000000000000000000000000" > "$P/README.md"
  echo "== selftest 臂7 UIPIN 指向不存在的提交（判不了 ≠ 绿）=="
  check_one_dir "$P" >"$P/p3.out" 2>&1
  P3=$?
  UK7=$(grep -c '^PINUNKNOWN ' "$P/p3.out")
  echo "   臂7 rc=${P3} PINUNKNOWN=${UK7}"
  sed 's/^/      /' "$P/p3.out"
  if [ "$P3" != "4" ] || [ "$UK7" != "1" ]; then
    echo "❌ 臂7 坏了（rc=${P3}，期望 4；PINUNKNOWN=${UK7}，期望 1）⇒「钉了个查不到的提交」会被读成「一致」" >&2
    rm -rf "$P"; exit 1
  fi
  # 臂 8：声明的**路径集是空的**（写错路径 ⇒ 恒不匹配）⇒ 同样必须 rc=4
  printf 'UIPIN x.png %s ui/does-not-exist.css\n' "$AT" > "$P/README.md"
  echo "== selftest 臂8 UIPIN 路径集不匹配任何提交 =="
  check_one_dir "$P" >"$P/p4.out" 2>&1
  P4=$?
  UK8=$(grep -c '路径集一条都没匹配到' "$P/p4.out")
  echo "   臂8 rc=${P4} 空路径集命中=${UK8}"
  sed 's/^/      /' "$P/p4.out"
  if [ "$P4" != "4" ] || [ "$UK8" != "1" ]; then
    echo "❌ 臂8 坏了（rc=${P4}，期望 4；命中=${UK8}，期望 1）⇒ 一条**空的**锚点会被读成绿" >&2
    rm -rf "$P"; exit 1
  fi
  rm -rf "$P"
  # 臂 9：有图但**没有 README** 的证据目录必须被点名，补上合法 README 后必须归零。
  #   🔴 两腿都要：只有"点名"那一腿时，一条恒报"有"的实现也能骗过（它照样红）；
  #      归零那一腿才证明这条判据认得"已经补好了"这个状态，不会变成常驻红。
  #   负对照用同一棵夹具树里**已经有 README** 的那枚（tableshape）—— 它不该出现在清单里。
  mkdir -p "$T/apps/web/evidence/noreadme"
  printf 'Z' > "$T/apps/web/evidence/noreadme/z.png"
  echo "== selftest 臂9 有图无 README（点名腿 + 负对照腿）=="
  NRS=$(noreadme_dirs "$T" | grep -c 'tableshape' || true); NRS=${NRS:-0}
  NR1=$(noreadme_dirs "$T" | grep -c 'evidence/noreadme ' || true); NR1=${NR1:-0}
  NRT=$(noreadme_dirs "$T" | grep -c . || true); NRT=${NRT:-0}
  echo "   点名 noreadme=${NR1}（要 1）  负对照 tableshape=${NRS}（要 0）  全集=${NRT}（要 1）"
  # 🔴 这一臂**当场抓出了本函数自己的一个 bug**：第一版打印的是**绝对路径**（`$root` 拼出来的），
  #    而 `grep 'evidence/noreadme$'` 里那个 `$` 永远撞不到 —— 因为每行末尾是**图片枚数**不是路径。
  #    症状是"点名腿=0 ⇒ 臂红"，看起来像"这一档不存在"。⇒ 判"函数没找到"之前先确认
  #    **我拿去比的那一列是不是它真的打印过的那一列**（本文件形状：`<相对目录> <枚数>`，所以要带尾空格）。
  # 🔴 第三腿（全集=1）才是"负对照有牙"的证明：只 grep tableshape=0 的话，**扫描范围整个坏掉**
  #    （返回空集）也能骗过。这里 tableshape 有图也有 README，和 noreadme 在同一棵夹具树里，
  #    所以"全集恰好 1 枚"同时钉住了"扫到了它"和"因为它有 README 而不点名它"。
  if [ "$NR1" != "1" ] || [ "$NRS" != "0" ] || [ "$NRT" != "1" ]; then
    echo "❌ 臂9 坏了（点名=${NR1} 负对照=${NRS} 全集=${NRT}，期望 1/0/1）⇒ 「有图没 README」会被 --all 读成「没有不一致」" >&2
    rm -rf "$T"; exit 1
  fi
  printf '%s  z.png\n' "$(md5 -q "$T/apps/web/evidence/noreadme/z.png")" > "$T/apps/web/evidence/noreadme/README.md"
  NR2=$(noreadme_dirs "$T" | grep -c . || true); NR2=${NR2:-0}
  echo "   补上合法 README 之后再数：${NR2}（要 0）"
  if [ "$NR2" != "0" ]; then
    echo "❌ 臂9 的归零腿坏了（补了 README 还点名）⇒ 这条会变成一堵永远绿不了的墙" >&2
    rm -rf "$T"; exit 1
  fi
  rm -rf "$T"
  # ── 臂 10：**--all 那一层自己**跑在合成夹具树上。
  #   为什么单独立一臂而不是只测 check_one_dir：本工具**真正会漏的两档债**（有图无 README、
  #   有 README 零锚点）都长在 --all 的计数与棘轮里，而 check_one_dir 只负责单目录。
  #   只测后者 = 给最容易坏的那一层没有牙（§8.3）。这也需要 `--root` 这个旋钮。
  #   夹具四枚目录各自钉住一条：noreadme(图,无 README) / unpinned(图,README 零锚点) /
  #   anchored(图,md5 对得上) / txtonly(**无图**,README 零锚点 ⇒ 不该被点名)。
  SELF_PATH=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
  U=$(mktemp -d /tmp/ht-r17-all.XXXXXX)
  mkdir -p "$U/apps/web/evidence/noreadme" "$U/apps/web/evidence/unpinned" \
           "$U/apps/web/evidence/anchored" "$U/apps/web/evidence/txtonly"
  printf 'Z' > "$U/apps/web/evidence/noreadme/z.png"
  printf 'A1' > "$U/apps/web/evidence/unpinned/a.png"; printf 'A2' > "$U/apps/web/evidence/unpinned/b.png"
  printf '这是取证说明，没有锚点行。\n' > "$U/apps/web/evidence/unpinned/README.md"
  printf 'C' > "$U/apps/web/evidence/anchored/c.png"
  printf '%s  c.png\n' "$(md5 -q "$U/apps/web/evidence/anchored/c.png")" > "$U/apps/web/evidence/anchored/README.md"
  printf 'run log\n' > "$U/apps/web/evidence/txtonly/run.log"
  printf '只有文字证据，也没有锚点。\n' > "$U/apps/web/evidence/txtonly/README.md"
  echo "== selftest 臂10 --all 层（合成夹具；棘轮设成现场枚数）=="
  NOREADME_MAX=1 UNPINNED_MAX=1 bash "$SELF_PATH" --all --root "$U" >"$U/a10.out" 2>"$U/a10.err"
  A10_RC=$?
  A10=$(grep '^ALLCHECK ' "$U/a10.out")
  echo "   rc=${A10_RC}  ${A10}"
  sed 's/^/      /' "$U/a10.out"
  # 🔴 逐字段比，不写"包含关键字"式的断言：整行相等才能同时钉住"多算了"和"少算了"
  #    （只 grep dirs_unpinned=1 的话，unpinned 数到 3 也照样过 —— 而 3 说明它把有锚点的也算进去了）
  WANT="ALLCHECK dirs_scanned=3 entries_parsed=1 pins_parsed=0 dirs_with_mismatch=0 dirs_without_readme=1 noreadme_baseline=1 dirs_unpinned=1 unpinned_baseline=1 dirs_with_broken_pin=0"
  if [ "$A10_RC" != "0" ] || [ "$A10" != "$WANT" ]; then
    echo "❌ 臂10 对照腿坏了（rc=${A10_RC}）" >&2
    echo "   期望：${WANT}" >&2
    echo "   实得：${A10}" >&2
    rm -rf "$U"; exit 4
  fi
  # 负对照腿：无图的 txtonly 不许被点名（否则纯文本证据目录会变成补不完的债）
  # 负对照腿：无图的 txtonly 不许被**点名**（否则纯文本证据目录会变成补不完的债）。
  #   ⚠️ 只数 NOREADME/UNPINNED 那两种点名行：txtonly 一定会打印一行 `EMPTY`（那是事实陈述，
  #   不是债），拿整行 grep 文件名会把它自己的 EMPTY 行算成"被点名"⇒ 负对照假红。
  TX=$(grep -cE '^(UNPINNED|NOREADME) [^ ]*txtonly' "$U/a10.out"); TX=${TX:-0}
  echo "   负对照 txtonly 命中=${TX}（要 0）"
  if [ "$TX" != "0" ]; then
    echo "❌ 臂10 负对照坏了：0 张图的目录也被点名 ⇒ 基线会被文本型证据推着涨" >&2
    rm -rf "$U"; exit 1
  fi
  # 棘轮牙腿 1：把 NO README 那一档的基线压到 0 ⇒ 必须红，且红的是那一档
  NOREADME_MAX=0 UNPINNED_MAX=1 bash "$SELF_PATH" --all --root "$U" >/dev/null 2>"$U/a10_r1.err"
  R1=$?
  N1=$(grep -c '有图但没 README 的证据目录 1 枚 > 基线 0' "$U/a10_r1.err"); N1=${N1:-0}
  echo "   棘轮腿1（NOREADME_MAX=0）rc=${R1}（要 1）消息命中=${N1}（要 1）"
  if [ "$R1" = "0" ] || [ "$N1" != "1" ]; then
    echo "❌ 臂10 的 NOREADME 棘轮没牙 ⇒ 新增一枚无 README 的截图也不会红" >&2
    rm -rf "$U"; exit 1
  fi
  # 棘轮牙腿 2：UNPINNED 那一档同理（这一档以前连判据都没有，牙必须逐档验，不能验一档推断另一档）
  NOREADME_MAX=1 UNPINNED_MAX=0 bash "$SELF_PATH" --all --root "$U" >/dev/null 2>"$U/a10_r2.err"
  R2=$?
  N2=$(grep -c '0 条锚点的证据目录 1 枚 > 基线 0' "$U/a10_r2.err"); N2=${N2:-0}
  echo "   棘轮腿2（UNPINNED_MAX=0）rc=${R2}（要 1）消息命中=${N2}（要 1）"
  if [ "$R2" = "0" ] || [ "$N2" != "1" ]; then
    echo "❌ 臂10 的 UNPINNED 棘轮没牙 ⇒「有文档、没判据」新增也不会红" >&2
    rm -rf "$U"; exit 1
  fi
  # PINBROKEN 腿：锚点解析到了但判不了（/tmp 夹具不在 git 树里 ⇒ 必然 PINUNKNOWN）⇒ 必须点名并红
  mkdir -p "$U/apps/web/evidence/brokenpin"
  printf 'B' > "$U/apps/web/evidence/brokenpin/b.png"
  printf 'UIPIN b.png %s packages/ui/src/calendar/CalendarBoard.tsx\n' "$(printf 'x' | md5 -q)" \
    > "$U/apps/web/evidence/brokenpin/README.md"
  NOREADME_MAX=1 UNPINNED_MAX=1 bash "$SELF_PATH" --all --root "$U" >"$U/a10_bp.out" 2>"$U/a10_bp.err"
  R3=$?
  N3=$(grep -c '^PINBROKEN ' "$U/a10_bp.out"); N3=${N3:-0}
  echo "   PINBROKEN 腿 rc=${R3}（要 1）点名=${N3}（要 1）"
  if [ "$R3" = "0" ] || [ "$N3" != "1" ]; then
    echo "❌ 臂10 的 PINBROKEN 腿坏了（rc=${R3} 点名=${N3}）⇒ 一条查不到的锚点会被读成「已有判据」" >&2
    rm -rf "$U"; exit 1
  fi
  # 前提腿：一棵没有证据 README 的树 ⇒ 必须 rc=4（"没扫到"不许被读成"扫了且干净"）
  E=$(mktemp -d /tmp/ht-r17-empty.XXXXXX); mkdir -p "$E/apps"
  bash "$SELF_PATH" --all --root "$E" >/dev/null 2>&1
  R4=$?
  echo "   前提腿（空树）rc=${R4}（要 4）"
  rm -rf "$U" "$E"
  if [ "$R4" != "4" ]; then
    echo "❌ 臂10 前提腿坏了（rc=${R4}，期望 4）⇒ 扫描没接上时会判绿" >&2
    exit 1
  fi
  # ── 臂 11：**点名分支的作用域自述**。它救的是"绿行没有分母"这一格 ——
  #   02:1x 现场：裸跑（默认只扫 DEFAULT_DIRS 一枚）打印 `✅ 证据 README 的 md5 与盘上字节逐条相同`，
  #   而同一分钟 `--dir apps/web/evidence/calendar-day` 报 mismatch=6 / pinbad=5。
  #   那句 ✅ 说的其实是"我扫的这一枚没问题"，但输出上**和"全树都干净"长得一模一样**（同族：
  #   「空测量看着最干净」、作用域打空的命令照样 rc=0）。所以这一臂不测对账逻辑，
  #   只测**这句话有没有把范围说出来**，并且让那个数字跟着树变（跟着变才证明它是现量的、不是抄的）。
  W=$(mktemp -d /tmp/ht-r17-scope.XXXXXX)
  for n in d1 d2 d3; do
    mkdir -p "$W/apps/web/evidence/$n"
    printf 'IMG-%s' "$n" > "$W/apps/web/evidence/$n/p.png"
    printf '%s  p.png\n' "$(md5 -q "$W/apps/web/evidence/$n/p.png")" > "$W/apps/web/evidence/$n/README.md"
  done
  echo "== selftest 臂11 点名分支的作用域自述 =="
  bash "$SELF_PATH" --root "$W" --dir "$W/apps/web/evidence/d1" >"$W/o1" 2>&1
  S1=$?
  L1=$(sed -n '/^✅/p' "$W/o1")
  echo "   腿1（只扫 1／树里 3）rc=${S1} 行：${L1}"
  # 三条都要命中：扫了几份、树里共几份、未扫几份 —— 少任何一条这句话仍能读成全树口吻
  M1=0
  printf '%s' "$L1" | grep -q '扫 1 份' && M1=$((M1+1))
  printf '%s' "$L1" | grep -q '共 3 份' && M1=$((M1+1))
  printf '%s' "$L1" | grep -q '未扫 2 份' && M1=$((M1+1))
  if [ "$S1" != "0" ] || [ "$M1" != "3" ]; then
    echo "❌ 臂11 腿1 坏了（rc=${S1} 三个数字命中=${M1}，要 0/3）⇒ 点名范围的绿行仍会被读成全树干净" >&2
    rm -rf "$W"; exit 1
  fi
  # 腿2（变异）：往树里**加一份**证据 README ⇒ 「共/未扫」必须各加一。
  #   这一腿证明那两个数是现量数出来的：写成常量的实现过不了这里。
  mkdir -p "$W/apps/web/evidence/d4"
  printf 'IMG-d4' > "$W/apps/web/evidence/d4/p.png"
  printf '%s  p.png\n' "$(md5 -q "$W/apps/web/evidence/d4/p.png")" > "$W/apps/web/evidence/d4/README.md"
  bash "$SELF_PATH" --root "$W" --dir "$W/apps/web/evidence/d1" >"$W/o2" 2>&1
  S2=$?
  L2=$(sed -n '/^✅/p' "$W/o2")
  echo "   腿2（树里加了 d4 ⇒ 应读成 共 4／未扫 3）rc=${S2} 行：${L2}"
  if [ "$S2" != "0" ] || ! printf '%s' "$L2" | grep -q '共 4 份' || ! printf '%s' "$L2" | grep -q '未扫 3 份'; then
    echo "❌ 臂11 腿2 坏了（rc=${S2}）⇒ 分母没跟着树走，是抄下来的数字" >&2
    rm -rf "$W"; exit 1
  fi
  # 腿3（负对照）：把四份**全点名** ⇒ 未扫必须归零；不归零说明"扫过的"没被从分母里扣掉，
  #   下一位会看见"未扫 4"而以为全树还欠着账。
  bash "$SELF_PATH" --root "$W" --dir "$W/apps/web/evidence/d1" --dir "$W/apps/web/evidence/d2" \
    --dir "$W/apps/web/evidence/d3" --dir "$W/apps/web/evidence/d4" >"$W/o3" 2>&1
  S3=$?
  L3=$(sed -n '/^✅/p' "$W/o3")
  echo "   腿3（全点名）rc=${S3} 行：${L3}"
  if [ "$S3" != "0" ] || ! printf '%s' "$L3" | grep -q '未扫 0 份'; then
    echo "❌ 臂11 腿3 坏了（rc=${S3}）⇒ 已扫的没有从分母里扣掉，绿行会长期谎称还欠账" >&2
    rm -rf "$W"; exit 1
  fi
  rm -rf "$W"
  echo "SELFTEST=OK（对照 0 枚 / 变异恰好 1 枚 / 表格形状解析到 1 条 / 表格形状注入腿恰好 1 枚 / UIPIN 正例 1 命中 / 源码动了恰好 1 枚 UISTALE / 假提交号 rc=4 / 空路径集 rc=4 / 有图无 README 点名 1·负对照 0·全集 1 且补好后归零 / --all 层：ALLCHECK 逐字段相等 + 文本目录不点名 + 两档棘轮各自能红 + PINBROKEN 能红 + 空树 rc=4 / 点名层：扫了几·共几·未扫几 三个数字随树变且全点名归零）"
  exit 0
fi


TOTAL_BAD=0
TOTAL_DIRS=0
TOTAL_ENTRIES=0
TOTAL_PINS=0
if [ "$ALL" = "1" ]; then
  # ⚠️ 这里原来是 `ls -d $ALL_GLOB` + `for r in $README_LIST` —— 靠"路径是相对的、不含空格"才没炸。
  #    加了 `--root`（自测传 /tmp 夹具；现场传的是**带空格的仓库绝对路径**）之后那条前提就没了，
  #    改成 find + 逐行读（IFS= read -r 不拆空格）。
  README_LIST=$(find "$ALL_ROOT/apps" -type f -path '*/evidence/*/README.md' 2>/dev/null | sort || true)
  [ -n "$README_LIST" ] || { echo "❌ 前提不成立：${ALL_ROOT}/apps 下按 ${ALL_GLOB} 的深度一份 README 都没找到 ⇒ 探针没接上" >&2; exit 4; }
  TOTAL_UNPINNED=0
  TOTAL_UNKNOWN=0
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    d=$(dirname "$r")
    TOTAL_DIRS=$((TOTAL_DIRS + 1))
    OUT=$(check_one_dir "$d"); RC=$?
    printf '%s\n' "$OUT"
    E=$(dfield "$OUT" entries)
    [ -n "$E" ] && TOTAL_ENTRIES=$((TOTAL_ENTRIES + E))
    Q=$(dfield "$OUT" pins)
    [ -n "$Q" ] && TOTAL_PINS=$((TOTAL_PINS + Q))
    if [ "$RC" = "1" ]; then TOTAL_BAD=$((TOTAL_BAD + 1)); fi
    # 🔴 第二档债：README 里 md5=0 且 UIPIN=0（check_one_dir 返回 4 / EMPTY），**而目录里有图**。
    #    这一档以前完全隐身 —— rc=4 既不进 ${TOTAL_BAD}，也没有任何别的计数接住它。
    #    判据从 check_one_dir 自己的解析结果里取（**不再写第二套正则**：同一个判断写两遍就是漂移的起点）。
    if [ -n "$E" ] && [ "$E" = "0" ] && [ "$Q" = "0" ]; then
      IM=$(count_images "$d")
      if [ "$IM" != "0" ]; then
        printf 'UNPINNED %s（%s 张图、README 里 0 条锚点 ⇒ 这些图没有常驻判据）\n' "${d#"$ALL_ROOT"/}" "$IM"
        TOTAL_UNPINNED=$((TOTAL_UNPINNED + 1))
      fi
    fi
    # 🔴 锚点**解析到了但用不了**（钉的提交不存在 / 不在 HEAD 祖先链上 / 路径集恒空）⇒ rc=4。
    #    这一档**不给基线**：现量 0 枚，所以"非 0 就红"立刻生效，而且它是"看起来有判据其实是空的"
    #    那一类里最坏的 —— 目录有 README、有 UIPIN 行、汇总里 pins_parsed 还把它们数进去了。
    UK=$(printf '%s\n' "$OUT" | sed -n 's/^DIRCHECK .* pinunknown=\([0-9]*\).*/\1/p')
    if [ -n "$UK" ] && [ "$UK" != "0" ]; then
      printf 'PINBROKEN %s（%s 条锚点判不了 ⇒ 不能算数）\n' "${d#"$ALL_ROOT"/}" "$UK"
      TOTAL_UNKNOWN=$((TOTAL_UNKNOWN + 1))
    fi
  done <<RL_BLOCK
$README_LIST
RL_BLOCK
  # 🔴 第二遍：有图但**没有 README** 的证据目录。上面那一遍的 glob 结构上看不见它们
  #    （`apps/*/evidence/*/README.md` 只列得到"已经有 README"的目录），
  #    所以"没写 README"这件事在 `dirs_scanned` 里是**隐身**的 —— 13:5x 现量：`calendar-year/` 四张图。
  TOTAL_NOREADME=0
  while IFS= read -r NR_LINE; do
    [ -n "$NR_LINE" ] || continue
    NR_D=${NR_LINE% *}; NR_N=${NR_LINE##* }
    echo "NOREADME ${NR_D}（${NR_N} 张图、没有 README.md ⇒ 这些图一条常驻判据都没有）"
    TOTAL_NOREADME=$((TOTAL_NOREADME + 1))
  done <<NR_BLOCK
$(noreadme_dirs "$ALL_ROOT")
NR_BLOCK
  echo "ALLCHECK dirs_scanned=${TOTAL_DIRS} entries_parsed=${TOTAL_ENTRIES} pins_parsed=${TOTAL_PINS} dirs_with_mismatch=${TOTAL_BAD} dirs_without_readme=${TOTAL_NOREADME} noreadme_baseline=${NOREADME_MAX} dirs_unpinned=${TOTAL_UNPINNED} unpinned_baseline=${UNPINNED_MAX} dirs_with_broken_pin=${TOTAL_UNKNOWN}"
  if [ "$((TOTAL_ENTRIES + TOTAL_PINS))" = "0" ]; then
    echo "❌ 前提不成立：${TOTAL_DIRS} 份 README 里解析到 0 条锚点（md5=0 且 UIPIN=0）⇒ 探针没接上，不能据此判绿" >&2
    exit 4
  fi
  # 🔴 棘轮，不是"非 0 就红"（理由写在文件头 NOREADME_MAX 那一段）：存量 21 枚是别的线的债，
  #    本线把它们变成常驻红 = 教人忽略红；而**新增**这一档才是会悄悄变多的方向，那一档立刻生效。
  if [ "$TOTAL_NOREADME" -gt "$NOREADME_MAX" ]; then
    echo "❌ 有图但没 README 的证据目录 ${TOTAL_NOREADME} 枚 > 基线 ${NOREADME_MAX} ⇒ 新增了没有常驻判据的截图。" >&2
    echo "   上面 NOREADME 那几行逐枚点了名。正确处置是**补 README（逐张写人看到的 + 钉 md5 或 UIPIN）**，" >&2
    echo "   不是把目录从扫描范围里剔掉，也不是把基线改大 —— 要改基线必须写明哪一枚债被谁偿掉了。" >&2
    exit 1
  fi
  if [ "$TOTAL_UNPINNED" -gt "$UNPINNED_MAX" ]; then
    echo "❌ 有图但 README 里 0 条锚点的证据目录 ${TOTAL_UNPINNED} 枚 > 基线 ${UNPINNED_MAX} ⇒ 新增了「有文档、没判据」的截图。" >&2
    echo "   这一档比 NOREADME 隐蔽：目录**有** README、dirs_scanned 也算它进去了，可那几张图一条判据都不行使。" >&2
    echo "   处置同上（逐张写人看到的 + 钉 md5 或 UIPIN）；改基线要写明哪一枚被偿掉了。" >&2
    exit 1
  fi
  if [ "$TOTAL_UNKNOWN" != "0" ]; then
    echo "❌ ${TOTAL_UNKNOWN} 个目录里的锚点**判不了**（钉的提交不存在／不在 HEAD 祖先链上／路径集恒空）。" >&2
    echo "   🔴 这一档没有基线，因为现量本来就是 0：一条查不到的锚点比没有锚点更糟 —— 它会被读成"已有判据"。" >&2
    exit 1
  fi
  [ "$TOTAL_BAD" = "0" ] && { echo "✅ ${TOTAL_ENTRIES} 条 md5 与盘上字节逐条相同，${TOTAL_PINS} 条 UIPIN 的代码锚点未被「决定形状的源码」越过（${TOTAL_DIRS} 份 README）"; exit 0; }
  echo "❌ ${TOTAL_BAD} 份 README 有锚点不一致（md5 要重取，代码锚点要重看并重钉）" >&2
  exit 1
fi

if [ -z "$DIRS" ]; then DIRS="$DEFAULT_DIRS"; fi
SCANNED=0
for d in $DIRS; do
  OUT=$(check_one_dir "$d"); RC=$?
  printf '%s\n' "$OUT"
  E=$(dfield "$OUT" entries); [ -n "$E" ] && TOTAL_ENTRIES=$((TOTAL_ENTRIES + E))
  Q=$(dfield "$OUT" pins);    [ -n "$Q" ] && TOTAL_PINS=$((TOTAL_PINS + Q))
  [ "$RC" != "0" ] && TOTAL_BAD=$((TOTAL_BAD + 1))
  SCANNED=$((SCANNED + 1))
done
# 🔴 **作用域自述**（臂 11）。这一条分支原来打印的是 `✅ 证据 README 的 md5 与盘上字节逐条相同`
#    —— 全树口吻，而它只扫 DEFAULT_DIRS **一枚**目录。2026-10-05 02:1x 现场：同一分钟
#    `--dir apps/web/evidence/calendar-day` 报 `entries=1 mismatch=6 pins=8 pinbad=5`，
#    裸跑却打印那句 ✅。两件事都不是"有人写错了一句 echo"那么简单：
#      · 默认作用域是**硬编码的一枚目录**，而树里有十几份证据 README ⇒ 新增目录永远落在scope 外；
#      · 绿行**没有分母**，所以"扫了 1 份"和"扫了全部"在输出上长得一模一样。
#    这里不改成全树扫（--all 才是那一层，文档里十几处引用的是它），改的是**让绿行说不出假话**：
#    报扫了几份、root 里共几份、没扫几份，并把 --all 指给下一位。
TREE_READMES=$(find "$ALL_ROOT/apps" -type f -path '*/evidence/*/README.md' 2>/dev/null | grep -c . || true)
TREE_READMES=${TREE_READMES:-0}
UNSCANNED=0
[ "$TREE_READMES" -gt "$SCANNED" ] && UNSCANNED=$((TREE_READMES - SCANNED))
SCOPE="作用域=点名：扫 ${SCANNED} 份／root 内共 ${TREE_READMES} 份证据 README ⇒ 未扫 ${UNSCANNED} 份（全树对账：--all）"
if [ "$TOTAL_BAD" != "0" ]; then
  echo "❌ ${TOTAL_BAD} 个证据目录有锚点不一致（README 要重取指纹/重钉代码锚点，且「人看过的那张图」要重看）—— ${SCOPE}" >&2
  exit 1
fi
echo "✅ 本次扫的 ${SCANNED} 份点名目录里 ${TOTAL_ENTRIES} 条 md5 与盘上字节逐条相同，${TOTAL_PINS} 条 UIPIN 的代码锚点都还没被源码越过 —— ${SCOPE}"
exit 0
