#!/usr/bin/env bash
#
# 把**当前工作树**同步到 Windows 打包机，并给出"远端字节 = 本地现在"的判据。
# =====================================================================
#
# 为什么抽成独立文件：`scripts/reinstall-all.sh`（四端重装）、
# `scripts/verify-windows-shell-journey.mjs`（Windows 旅程验收）与
# `scripts/run-gradle.mjs`（Android 在 Mac/Linux 上改为远程构建）都要把源码送过去，
# 而这几件事**必须**用同一份同步 + 对账逻辑 —— 一旦两份，就会漂移成
# "一个脚本送了新树、另一个送了旧树"，正是 §7 第 82 条记录的那次事故形状。
#
# 🔴 2026-10-04 Android 构建统一到 windows-pc；**2026-10-28 起载体换成 `linux-dev`**
# （见 [docs/runbooks/android-build-on-linux-dev.md](../../docs/runbooks/android-build-on-linux-dev.md)）。
# 旧载体那一侧的历史实测仍在
# [android-build-on-windows.md](../../docs/runbooks/android-build-on-windows.md) §七，不重写。
# 收口点在 `scripts/run-gradle.mjs`（`pnpm build:android{,:debug,:bundle}` 与
# `clean:android` 全部经过它），而它需要的是**同一套**"送过去 + 对账"，只是
# 构建输入不同：MSIX 那一腿要 `apps/web/dist` 与桥的 bundle，Android 那一腿要
# `packages/*/dist`（Metro 打的是它们，AGENTS §6.1「先 `pnpm -r build`」的理由）。
# ⇒ 所以把公共那半抽成 `_heyta_windows_sync_push`（清单 → tar → scp → **tar 哈希对账**
#   → 远端先清后解），两个入口各自只保留**自己那批构建输入**与**自己的锚点判据**。
#   刻意不把 Windows 那三条锚点（`index.html` / `native-bridge.js` / chunk 数）搬到
#   Android 上：它们对 APK 什么都不证明；Android 那条对账是 **tar 的 sha256**
#   —— 它说的是"远端解包的字节 == 我本地打的那一包"，与建的是哪个产物无关。
#
# ⚠️ 调用方必须**在仓库根**、且**已经 `cd` 到仓库根**再 source 本文件并调用
#    `sync_windows_sources <host>`：它用 `git ls-files` 列举清单。
#
# ⚠️ 本仓库一律按 **bash 3.2**（macOS 自带）写：不用 `declare -A`。
#
# 用法（从 bash 调用）：
#   source scripts/lib/sync-build-sources.sh
#   sync_windows_sources windows-pc                    # MSIX / 桌面壳那一腿（含原有三条对账）
#   sync_windows_sources_for_android windows-pc        # Android 构建那一腿（带 packages/*/dist）
#
# ⚠️ 路径清单用**空格分隔**，因此仓库相对路径里不许有空格（今天的清单里没有；
#    tar 的 `-T` 那份是按行读的，不受这条限制影响）。

# 🔴 远端仓库根与远端 tar 名。**默认值逐字等于本文件历史上硬编码的那两个值** ——
#    留成变量只是为了让 Android 那一腿用**不同名**的临时文件，避免两条腿并发时
#    互相覆盖 `/tmp/heyta-src.tar.gz` 和远端 `C:/src/heyta-src.tar.gz`。
HEYTA_WINDOWS_REPO_ROOT="${HEYTA_WINDOWS_REPO_ROOT:-C:\\src\\heyta}"

# 🔴 本地的**临时落点**可覆盖（`HEYTA_SYNC_TMP_DIR`，默认 `/tmp` ⇒ 单会话时路径**逐字不变**）。
#    为什么现在补：本文件把 tar 包 / 清单 / 打包日志三处写成固定 `/tmp` 路径，而
#    仓库 2026-10 起的固定做法是**在隔离检出里并行跑**（四端重装 / Android 远程构建），
#    两条会话同时送源码就会互相覆盖；更要紧的是它产出的 `heyta-src*.tar.gz` 是
#    **456M 级**的中间物，而**没有任何一层会清它**（`rm` 只在成功路径上、且不清 tar）。
#    同族先例与清理入口：`HEYTA_REINSTALL_TMP_DIR`（`reinstall-all.sh`）、
#    `HEYTA_IOS_DERIVED`（`verify-mobile-ios*.sh`）、`HEYTA_MACOS_DIST_DIR`，
#    以及 `scripts/clean-build-tmp.sh`（按年龄 + 分类清 `/tmp` 的 heyta 残留）。
#    ⚠️ 换落点后远端那两枚 tar 名**不受影响**（它们由 `$suffix` 决定，与本地目录无关）。
HEYTA_SYNC_TMP_DIR="${HEYTA_SYNC_TMP_DIR:-/tmp}"

# ── Android 载体的三枚默认值（2026-10-28 起，载体 = `linux-dev`）─────────────
# 🔴 **这三行是它们唯一的真源**。`scripts/run-gradle.mjs` 的默认值与设备侧脚本的
#    `ANDROID_HOST` / `ANDROID_SDK_ON_HOST` 必须逐字等于这里 —— 各写各的就会长成
#    "构建在 A 树、验收取 B 产物"（§7 第 82 条）。由 `check:android-gradle-remote` 的
#    G11 当场对账（含反向臂：漂回旧载体 `windows-pc` 也红）。
HEYTA_ANDROID_HOST="${HEYTA_ANDROID_HOST:-linux-dev}"
HEYTA_ANDROID_BUILD_ROOT="${HEYTA_ANDROID_BUILD_ROOT:-/home/xaiver/heyta-android-build}"
HEYTA_ANDROID_SDK_ON_HOST="${HEYTA_ANDROID_SDK_ON_HOST:-/home/xaiver/.local/opt/android-sdk}"
HEYTA_ANDROID_GRADLE_HOME="${HEYTA_ANDROID_GRADLE_HOME:-/home/xaiver/.heyta-android-gradle}"

# ── 内部实现（两半）：清单 + tar 打包是**共用**的，远端那一半按载体分 ────────
# 🔴 为什么拆：MSIX（windows-pc）与 Android（linux-dev）要送的构建输入不同、远端命令的
#    方言也不同（PowerShell vs bash），但"列清单 → 打 tar → 命名"这一段**必须只有一份**——
#    两份一定会漂成"一条腿送了新树、另一条送了旧树"（§7 第 82 条的原话形状）。
# $1 = extra_list（必须本地存在、额外写进清单的构建输入，空格分隔，可为空串）
# $2 = tag（临时文件名后缀；空串 = 沿用历史名 `heyta-src`）
# 结果写进 `HEYTA_SYNC_TARBALL` / `HEYTA_SYNC_LIST`（bash 动态作用域，调用方直接读）。
_heyta_sync_make_tar() {
  local extra_list="${1:-}"
  local tag="${2:-}"
  local suffix=""
  [ -n "$tag" ] && suffix="-$tag"
  HEYTA_SYNC_TARBALL="${HEYTA_SYNC_TMP_DIR%/}/heyta-src${suffix}.tar.gz"
  HEYTA_SYNC_LIST="${HEYTA_SYNC_TMP_DIR%/}/heyta-src${suffix}-files.txt"
  local list="$HEYTA_SYNC_LIST"
  if ! command -v git >/dev/null 2>&1; then
    echo "  🔴 没有 git —— 列不出清单"
    return 1
  fi
  # 🔴 `-c core.quotepath=false`：`git ls-files` 默认给**非 ASCII 名**加引号并转义
  #    （`"screenshots/landing/L01-\345\256\230\347\275\221\351\246\226\345\261\217.png"`），
  #    而下一句是 `[ -e "$f" ]` —— 那个带引号和反斜杠的字符串**不是路径**，于是这 108 枚
  #    文件在旧写法里**一条都进不了包，而且不报任何错**（现量：旧清单里 `grep -c '"'` = 0，
  #    `git ls-files | grep -c '"'` = 108）。这不只是取证图：`screenshots/**` 里那 24 枚
  #    中文名像素是 `apps/landing` 帮助图的**复制源**（`screenshots/` 不在构建根里，
  #    `public/` 才是，见 `apps/landing/src/site/helpFigures.ts` 的注释），
  #    远端构建若跑那一步复制就会**静默少图** —— 打进产物的东西少了一组，界面上不报错。
  # 清单：跟踪的 + 未跟踪且未忽略的（= **当前工作树**，含未提交改动），过滤成实际存在；
  # 再追加调用方指定的构建输入（它们被 gitignore，`git ls-files` 一条都抓不到）。
  #
  # 🔴 `evidence/` 那一片**不进包**（2026-10-14 现量后加的过滤）：清单 8263 条里
  #    4027 条是 `apps/*/evidence/**`、`e2e/**/evidence/**`、`docs/research/**/evidence/**`
  #    —— 它们是取证**输出**，没有一条是构建输入（判据：`grep -rIn --include=*.gradle
  #    --include=vite.config.* --include=tauri.conf.json --include=package.json "evidence"
  #    apps/ packages/ server/` ⇒ 空）。而这一族图包还在随每趟验收**只增**，于是包体
  #    一路涨到 **486 MB**：2026-10-14 00:0x 那条 Android 腿的 `scp -q` 就在 99.3%
  #    （483,446,127 / 486,746,666）上僵死 —— 5 分钟 10 次采样一字节没长，而 `scp -q`
  #    **没有超时**，构建会永远挂在步骤 2。这一步红不是远端故障，是**取证把构建通道吃掉了**。
  {
    { git -c core.quotepath=false ls-files; git -c core.quotepath=false ls-files --others --exclude-standard; } |
      while IFS= read -r f; do [ -e "$f" ] && printf '%s\n' "$f"; done |
      grep -vE '(^|/)evidence/'
    local p
    for p in $extra_list; do
      if [ ! -e "$p" ]; then
        echo "  🔴 构建输入不存在：${p} —— 不打包（宁可不装，也不装旧产物）"
        return 1
      fi
      printf '%s\n' "$p"
    done
  } > "$list"
  # COPYFILE_DISABLE：不带 AppleDouble（`._*`）过去，远端解包才干净。
  if ! COPYFILE_DISABLE=1 tar -czf "$HEYTA_SYNC_TARBALL" -T "$list" > "${HEYTA_SYNC_TMP_DIR%/}/heyta-src-tar.log" 2>&1; then
    echo "  🔴 打源码包失败（${HEYTA_SYNC_TMP_DIR%/}/heyta-src-tar.log）"
    return 1
  fi
  echo "  ✅ 源码包 $(du -h "$HEYTA_SYNC_TARBALL" | cut -f1)（清单 $(wc -l < "$list" | tr -d ' ') 条，含工作树未提交改动 + 构建输入）"
  return 0
}

# ── 远端那一半（Windows 载体：MSIX / 桌面壳）───────────────────────────────
# ⚠️ 实参顺序**逐字保持原样**（host / extra_list / clean_list / tag）：MSIX 那一腿的调用点
#    一个字都不该因为 Android 换载体而动 —— 动了就是把两条无关的线搅在一起。
_heyta_windows_sync_push() {
  local host="$1"
  local clean_list="${3:-}"
  _heyta_sync_make_tar "${2:-}" "${4:-}" || return 1
  local tarball="$HEYTA_SYNC_TARBALL"
  # 同一个包有两种路径形状：scp 走 SFTP，用正斜杠；cmd/tar 在 Windows 上，用反斜杠。
  # 默认（tag 为空）时这两个值**逐字等于本文件历史上硬编码的那两个**。
  local suffix=""
  [ -n "${4:-}" ] && suffix="-${4}"
  local remote_tar_scp="C:/src/heyta-src${suffix}.tar.gz"
  local remote_tar_cmd="C:\\src\\heyta-src${suffix}.tar.gz"
  # 🔴 `scp` **默认没有超时**：2026-10-14 那趟 486 MB 的包就在 99.3% 上僵死（5 分钟 10 次
  #    采样一字节没长），整条远程构建永远挂在步骤 2 —— `-q` 只静音进度条，不会让它在
  #    通道断掉时退出。`ServerAlive*` 是给这条通道装一根"探到死就断"的线：15s 一发、
  #    连续 4 次没回应就退出 ⇒ 卡死变成**可重试的失败**，而不是无限等待。
  if ! scp -q -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
       "$tarball" "$host:$remote_tar_scp"; then
    # 🔴 旧文案在这里写的是「$host 不可达？」——那是把**没查过的事当疑问句印出来**，
    #    而答案代码当场就能取（2026-10-14 现量：同一趟的步骤 1 刚把 ssh 探测跑通过，
    #    8 分钟后 scp 断，而 ping 与 22 端口都还活着 ⇒ 是链路断，不是主机下线。
    #    当时只能人工 ping/nc 才知道这件事）。
    echo "  🔴 源码包送不过去（scp 失败）—— 当场分诊 $host 到底可达不可达"
    if ssh -o ConnectTimeout=10 -o BatchMode=yes "$host" 'echo ok' >/dev/null 2>&1; then
      echo "     ⇒ **ssh 现在建得起来** ⇒ 不是主机下线，是**传输通道**断了（链路抖动或拥塞）。"
      echo "       按瞬时网络重试即可；不要去动远端树，也不要动本机的网络配置。"
    else
      echo "     ⇒ **连 ssh 都建不起来** ⇒ 主机确实不可达（下线 / 网络不通），重试也不会好。"
    fi
    return 1
  fi
  # 🔴 先对账**这一整包**的哈希，再解包：远端拿到的一半是"上一个包"时，
  #    解包会把那棵树改成"两次构建的混合体"，而混合体在按文件的对账里可以逐项都对上。
  local local_tar_sha remote_tar_sha
  local_tar_sha="$(shasum -a 256 "$tarball" | awk '{print $1}')"
  remote_tar_sha="$(ssh -o ConnectTimeout=10 "$host" \
    "powershell -NoProfile -Command \"(Get-FileHash '$remote_tar_cmd' -Algorithm SHA256).Hash\"" 2>/dev/null |
    tr -d '\r' | grep -iE '^[0-9a-f]{64}$' | tail -1 | tr 'A-Z' 'a-z')"
  if [ -z "$remote_tar_sha" ]; then
    echo "  🔴 读不到远端源码包哈希（$host 上的 ${remote_tar_cmd}）—— 对账不成立，拒绝解包"
    return 1
  fi
  if [ "$local_tar_sha" != "$remote_tar_sha" ]; then
    echo "  🔴 远端源码包**不新鲜**：tar 的 sha256 对不上"
    echo "     local =${local_tar_sha:0:16}"
    echo "     remote=${remote_tar_sha:0:16}"
    echo "     —— 拒绝解包：那样远端是**上一批**的树（§7 第 82 条的形状）"
    return 1
  fi
  echo "  ✅ 远端收到的是这一包（tar sha256=${local_tar_sha:0:16}… 逐字相同）"
  # ⚠️ **覆盖式解包，不删远端整棵树** —— 那棵树里有 node_modules 与 dotnet 依赖，
  #    整棵删掉重建会把"打包"变成"重装工具链"。
  # 🔴 但**构建产物目录**必须**先清再解**：产物名带内容哈希，覆盖式解包对它等于
  #    **只增不减** —— 2026-10-03 实测远端 `apps/web/dist/assets/` 里躺着 26 个
  #    `index-*.js`（本地 7 个，跨 9/27→10/3 六次构建），而 `package-msix.ps1` 把整份
  #    `web-dist` 搬进包 ⇒ 装出来的包带着 ~19 枚没人引用的旧 chunk。今天行为没坏
  #    （index.html 按哈希引用），坏的是"清旧包"这一环只到包层、没到同步源层：
  #    **一旦有什么按旧哈希去取，包里就真躺着那份旧代码**（AGENTS §7 第 175 条）。
  #    Android 那一腿同理：`packages/*/dist` 里的 `*.d.ts` / chunk 改名后旧的一枚不会消失。
  local remove_cmds="" c
  for c in $clean_list; do
    remove_cmds="${remove_cmds}Remove-Item -Recurse -Force '${HEYTA_WINDOWS_REPO_ROOT}\\${c//\//\\}' -ErrorAction SilentlyContinue; "
  done
  if ! ssh -o ConnectTimeout=10 "$host" \
    "powershell -NoProfile -Command \"${remove_cmds}\"; tar -xzf $remote_tar_cmd -C $HEYTA_WINDOWS_REPO_ROOT"; then
    echo "  🔴 远端解包失败（清远端构建输入 + tar）"
    return 1
  fi
  return 0
}

# ── 远端那一半（POSIX 载体：Android 构建机 `linux-dev`）─────────────────────
# $1 = host；$2 = remote_root（绝对路径，由调用方给，见 `sync_android_sources`）
# $3 = clean_list；$4 = tag；$5 = extra_list
_heyta_posix_sync_push() {
  local host="$1"
  local remote_root="$2"
  local clean_list="${3:-}"
  local tag="${4:-}"
  _heyta_sync_make_tar "${5:-}" "$tag" || return 1
  local tarball="$HEYTA_SYNC_TARBALL"
  local suffix=""
  [ -n "$tag" ] && suffix="-$tag"
  local remote_tar="/tmp/heyta-src${suffix}.tar.gz"

  # 🔴 用 `rsync --partial` 而不是 `scp`：这条通道实测会**中途被对端关闭**
  #    （2026-10-28 现量：45 MB 的包 `ssh 'cat >'` 两次都在几十秒处断，`rsync` 第 3 趟续传完成）。
  #    `scp` 没有续传，也没有超时以外的恢复手段 —— 旧载体上那趟 486 MB 僵死就是同一族。
  if ! command -v rsync >/dev/null 2>&1; then
    echo "  🔴 本机没有 rsync —— 这条通道要的是**可续传**，不退回 scp（宁可红，不要半包）"
    return 1
  fi
  local attempt rc=1
  for attempt in 1 2 3; do
    if rsync -a --partial --timeout=60 -e "ssh -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4" \
         "$tarball" "$host:$remote_tar"; then rc=0; break; fi
    rc=$?
    [ "$attempt" -lt 3 ] && echo "  ⚠️ 第 $attempt 次送包失败（rsync rc=${rc}）—— 链路会断，按瞬时网络续传重试"
  done
  if [ "$rc" -ne 0 ]; then
    echo "  🔴 源码包送不过去（rsync 三次都失败，主机 ${host}）—— 当场分诊可达性"
    if ssh -o ConnectTimeout=10 -o BatchMode=yes "$host" 'echo ok' >/dev/null 2>&1; then
      echo "     ⇒ **ssh 建得起来** ⇒ 是**传输通道**断了（链路抖动/拥塞），不是主机下线。"
    else
      echo "     ⇒ **连 ssh 都建不起来** ⇒ 主机确实不可达，重试也不会好。"
    fi
    return 1
  fi

  # 🔴 先对账**这一整包**的哈希，再解包（与 Windows 那一腿同一判据、同一理由）：
  #    远端留着的是"上一个包"时，解包会把那棵树改成两次构建的混合体，
  #    而混合体在按文件的对账里可以逐项都对上。
  local local_tar_sha remote_tar_sha
  local_tar_sha="$(shasum -a 256 "$tarball" | awk '{print $1}')"
  remote_tar_sha="$(ssh -o ConnectTimeout=10 "$host" "sha256sum '$remote_tar' 2>/dev/null | cut -d' ' -f1" 2>/dev/null |
    tr -d '\r' | grep -iE '^[0-9a-f]{64}$' | tail -1 | tr 'A-Z' 'a-z')"
  if [ -z "$remote_tar_sha" ]; then
    echo "  🔴 读不到远端源码包哈希（$host 上的 ${remote_tar}）—— 对账不成立，拒绝解包"
    return 1
  fi
  if [ "$local_tar_sha" != "$remote_tar_sha" ]; then
    echo "  🔴 远端源码包**不新鲜**：tar 的 sha256 对不上"
    echo "     local =${local_tar_sha:0:16}"
    echo "     remote=${remote_tar_sha:0:16}"
    echo "     —— 拒绝解包：那样远端是**上一批**的树（§7 第 82 条的形状）"
    return 1
  fi
  echo "  ✅ 远端收到的是这一包（tar sha256=${local_tar_sha:0:16}… 逐字相同）"

  # ⚠️ 覆盖式解包，不删远端整棵树 —— 那棵树里有 node_modules 与 gradle 缓存。
  # 🔴 但**构建产物目录**必须先清再解（`packages/*/dist` 里改名后的旧 chunk 不会自己消失）。
  local remove_cmds="" c
  for c in $clean_list; do
    remove_cmds="${remove_cmds}rm -rf '${remote_root}/${c}'; "
  done
  if ! ssh -o ConnectTimeout=10 "$host" \
    "${remove_cmds}tar -xzf '$remote_tar' -C '$remote_root'"; then
    echo "  🔴 远端解包失败（清远端构建输入 + tar）"
    return 1
  fi
  return 0
}

# ── Android 构建那一腿的入口（run-gradle.mjs 在 Mac/Linux 上调它）──────────
# 送的构建输入是 `packages/*/dist`：Metro 打进 APK 的是**它们**，不是 `packages/*/src`
# （AGENTS §6.1「打包前必须先跑 `pnpm -r build`」的全部理由，§7 第 27 条那笔学费）。
# 对账用的是 tar 的 sha256（在 `_heyta_posix_sync_push` 里），不在这里加锚点 ——
# `apps/web/dist/index.html` 那一组对 APK 什么都不证明。
sync_android_sources() {
  local host="${1:-$HEYTA_ANDROID_HOST}"
  # 🔴 远端仓库根由**调用方**给（run-gradle 手里那份 `HEYTA_ANDROID_REMOTE_ROOT`）。
  #    为什么这条要紧：那一侧读 `HEYTA_ANDROID_REMOTE_ROOT`，这一侧读 `HEYTA_ANDROID_BUILD_ROOT`，
  #    两个默认值逐字相同 ⇒ 平时看不出问题；**只移一个**就变成"同步解包到 A、gradle 在 B 里构建"
  #    —— 与 §7 第 82 条同一种形状，只是搬到了远程路径上。
  #    不传（第二枚实参为空）时沿用本文件的默认值。
  #    `local` 是刻意的：bash 是动态作用域，被调的那一枚 push 读到的就是这一份，
  #    而函数返回后不会把值泄漏给调用方的 shell。
  #    `${2:-}` 这层中转也是刻意的：调用方普遍 `set -u`，直接写 `${2:-…}` 在未传第二枚实参时
  #    会先把 `$2` 当未绑定变量打死。
  local _android_remote_root="${2:-}"
  local HEYTA_ANDROID_BUILD_ROOT="${_android_remote_root:-$HEYTA_ANDROID_BUILD_ROOT}"
  local dist_list="" d
  for d in packages/*/dist; do
    [ -d "$d" ] || continue
    dist_list="$dist_list $d"
  done
  if [ -z "$dist_list" ]; then
    echo "  🔴 本地一个 packages/*/dist 都没有 —— 先跑 pnpm -r build，否则远端拿不到构建输入"
    return 1
  fi
  ssh -o ConnectTimeout=10 "$host" "mkdir -p '$HEYTA_ANDROID_BUILD_ROOT'" || {
    echo "  🔴 远端建不出 '$HEYTA_ANDROID_BUILD_ROOT' —— 载体根不可写，不猜第二个落点"
    return 1
  }
  _heyta_posix_sync_push "$host" "$HEYTA_ANDROID_BUILD_ROOT" "$dist_list" "android" "$dist_list" || return 1
  echo "  ✅ Android 构建输入已同步（$(printf '%s' "$dist_list" | wc -w | tr -d ' ') 个 packages/*/dist，远端已先清后解）"
  return 0
}

sync_windows_sources() {
  local host="$1"
  # 🔴 桥的 bundle 是**构建产物、不入库**，而 `pnpm -r build` 不生成它 ⇒ 干净检出里
  #    它不存在，清单里那句无条件写进它的话会让 tar 直接
  #    `Cannot stat: No such file or directory`（2026-10-02 在隔离检出里实测）。
  #    与 mac 段 `package-app.sh` 同一处置：在这里现生成，不指望"本机跑过壳门禁"。
  local repo_root
  repo_root="$(git rev-parse --show-toplevel)" || return 1
  if ! node "$repo_root/packages/app-host/scripts/build-native-bridge.mjs"; then
    echo "  🔴 生成 bridge bundle 失败（packages/app-host/scripts/build-native-bridge.mjs）"
    return 1
  fi
  # 清单 + tar + scp + 对账 + 远端先清后解 = **公共那一枚**（Android 那一腿用的是同一个）。
  # 这里只声明本腿的构建输入与要清的目录：
  #   · `apps/web/dist` —— 共享 UI 产物（不入库，`pnpm -r build` 才生成）
  #   · `packages/app-host/bridge-bundle/native-bridge.js` —— 壳的桥（同上；2026-09-30
  #     漏过它 ⇒ Windows 静默用旧桥，症状是"改了 TS 而装出来的壳没那个函数"）
  # tag 传空串 = 临时文件与远端 tar 用历史名，Windows 那一腿的行为逐字不变。
  _heyta_windows_sync_push "$host" \
    "apps/web/dist packages/app-host/bridge-bundle/native-bridge.js" \
    "apps/web/dist" "" || return 1
  # 新鲜度判据：拿**两个构建输入**的哈希对账
  #   · `apps/web/dist/index.html` —— "装上的是不是当前 UI 产物"的锚点
  #   · `bridge-bundle/native-bridge.js` —— "壳里那份 TS 逻辑是不是当前源码"的锚点
  #     （2026-09-30 补：它不入库，早先同步不带 ⇒ 远端会静默用旧桥）
  # 🔴 这三枚锚点的远端路径**必须跟着 `$HEYTA_WINDOWS_REPO_ROOT`**：2026-10-25 它们写死成
  #    `C:\src\heyta`，于是换落点时"解包到 A、对账比 B"—— 隔离落点上明明解包成功
  #    （tar sha256 逐字相同）却报"远端不新鲜"；反过来说，两棵树恰好同字节时它会**假绿**。
  local local_hash remote_hash local_bridge remote_bridge
  local_hash="$(shasum -a 256 apps/web/dist/index.html | awk '{print $1}')"
  remote_hash="$(ssh -o ConnectTimeout=10 "$host" \
    "powershell -NoProfile -Command \"(Get-FileHash '${HEYTA_WINDOWS_REPO_ROOT}\\apps\\web\\dist\\index.html' -Algorithm SHA256).Hash\"" 2>/dev/null |
    tr -d '\r' | grep -iE '^[0-9a-f]{64}$' | tail -1 | tr 'A-Z' 'a-z')"
  if [ "$local_hash" != "$remote_hash" ]; then
    echo "  🔴 远端源码**不新鲜**：apps/web/dist/index.html 哈希对不上"
    echo "     local =${local_hash:0:16}"
    echo "     remote=${remote_hash:0:16}"
    echo "     —— 拒绝打包：那样装上的是旧产物（2026-09-30 就是这么骗过验收的）"
    return 1
  fi
  local_bridge="$(shasum -a 256 packages/app-host/bridge-bundle/native-bridge.js | awk '{print $1}')"
  remote_bridge="$(ssh -o ConnectTimeout=10 "$host" \
    "powershell -NoProfile -Command \"(Get-FileHash '${HEYTA_WINDOWS_REPO_ROOT}\\packages\\app-host\\bridge-bundle\\native-bridge.js' -Algorithm SHA256).Hash\"" 2>/dev/null |
    tr -d '\r' | grep -iE '^[0-9a-f]{64}$' | tail -1 | tr 'A-Z' 'a-z')"
  if [ "$local_bridge" != "$remote_bridge" ]; then
    echo "  🔴 远端**桥的 bundle 不新鲜**：native-bridge.js 哈希对不上"
    echo "     local =${local_bridge:0:16}"
    echo "     remote=${remote_bridge:0:16}"
    echo "     —— 拒绝打包：那样壳里跑的是**旧的 TS 逻辑**（改了桥却像没改）"
    return 1
  fi
  # 🔴 哈希对账只锚 `index.html`，它证明不了"目录里没留旧构建的 chunk"—— 而"只增不减"
  #    正是上面那次实测的形状。所以再要一条**按数量**的对账：本地与远端 `assets/*.js`
  #    的枚数必须相等，数不到也算红（数不到 = 对账不成立，不是"没问题"）。
  local local_chunks remote_chunks
  local_chunks="$(ls apps/web/dist/assets/*.js 2>/dev/null | wc -l | tr -d ' ')"
  remote_chunks="$(ssh -o ConnectTimeout=10 "$host" \
    "powershell -NoProfile -Command \"(Get-ChildItem ${HEYTA_WINDOWS_REPO_ROOT}\\apps\\web\\dist\\assets -Filter *.js -ErrorAction SilentlyContinue | Measure-Object).Count\"" 2>/dev/null |
    tr -d '\r' | grep -E '^[0-9]+$' | tail -1)"
  if [ -z "$remote_chunks" ]; then
    echo "  🔴 数不到远端 apps/web/dist/assets 的 chunk 数 —— 对账不成立，拒绝打包"
    return 1
  fi
  if [ "$local_chunks" != "$remote_chunks" ]; then
    echo "  🔴 远端 chunk 数 $remote_chunks ≠ 本地 $local_chunks ⇒ 远端目录里留着旧构建的产物"
    return 1
  fi
  echo "  ✅ 远端新鲜度对账通过（web-dist/index.html=${local_hash:0:16}… bridge=${local_bridge:0:16}… assets/*.js=${local_chunks} 枚一致）"
  return 0
}
