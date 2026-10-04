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
# 🔴 2026-10-04：Android 构建统一到 windows-pc（见
# [docs/runbooks/android-build-on-windows.md](../../docs/runbooks/android-build-on-windows.md)）。
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
#   source scripts/lib/sync-windows-sources.sh
#   sync_windows_sources windows-pc                    # MSIX / 桌面壳那一腿（含原有三条对账）
#   sync_windows_sources_for_android windows-pc        # Android 构建那一腿（带 packages/*/dist）
#
# ⚠️ 路径清单用**空格分隔**，因此仓库相对路径里不许有空格（今天的清单里没有；
#    tar 的 `-T` 那份是按行读的，不受这条限制影响）。

# 🔴 远端仓库根与远端 tar 名。**默认值逐字等于本文件历史上硬编码的那两个值** ——
#    留成变量只是为了让 Android 那一腿用**不同名**的临时文件，避免两条腿并发时
#    互相覆盖 `/tmp/heyta-src.tar.gz` 和远端 `C:/src/heyta-src.tar.gz`。
HEYTA_WINDOWS_REPO_ROOT="${HEYTA_WINDOWS_REPO_ROOT:-C:\\src\\heyta}"

# ── 内部实现：清单 → tar → scp → tar 哈希对账 → 远端先清后解 ──────────────
# $1 = host
# $2 = extra_list：必须本地存在、额外写进清单的**构建输入**（空格分隔，可为空串）
# $3 = clean_list：远端解包前必须**先删掉**的路径（空格分隔，可为空串）
# $4 = tag：临时文件/远端 tar 的名字后缀。空串 = 沿用历史名 `heyta-src(.tar.gz)`
_heyta_windows_sync_push() {
  local host="$1"
  local extra_list="${2:-}"
  local clean_list="${3:-}"
  local tag="${4:-}"
  local suffix=""
  [ -n "$tag" ] && suffix="-$tag"
  local tarball="/tmp/heyta-src${suffix}.tar.gz"
  local list="/tmp/heyta-src${suffix}-files.txt"
  # 同一个包有两种路径形状：scp 走 SFTP，用正斜杠；cmd/tar 在 Windows 上，用反斜杠。
  # 默认（tag 为空）时这两个值**逐字等于本文件历史上硬编码的那两个**。
  local remote_tar_scp="C:/src/heyta-src${suffix}.tar.gz"
  local remote_tar_cmd="C:\\src\\heyta-src${suffix}.tar.gz"

  if ! command -v git >/dev/null 2>&1; then
    echo "  🔴 没有 git —— 列不出清单"
    return 1
  fi
  # 清单：跟踪的 + 未跟踪且未忽略的（= **当前工作树**，含未提交改动），过滤成实际存在；
  # 再追加调用方指定的构建输入（它们被 gitignore，`git ls-files` 一条都抓不到）。
  {
    { git ls-files; git ls-files --others --exclude-standard; } |
      while IFS= read -r f; do [ -e "$f" ] && printf '%s\n' "$f"; done
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
  if ! COPYFILE_DISABLE=1 tar -czf "$tarball" -T "$list" > /tmp/heyta-src-tar.log 2>&1; then
    echo "  🔴 打源码包失败（/tmp/heyta-src-tar.log）"
    return 1
  fi
  echo "  ✅ 源码包 $(du -h "$tarball" | cut -f1)（清单 $(wc -l < "$list" | tr -d ' ') 条，含工作树未提交改动 + 构建输入）"
  if ! scp -q "$tarball" "$host:$remote_tar_scp"; then
    echo "  🔴 源码包送不过去（$host 不可达？）"
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

# ── Android 构建那一腿的入口（run-gradle.mjs 在 Mac/Linux 上调它）──────────
# 送的构建输入是 `packages/*/dist`：Metro 打进 APK 的是**它们**，不是 `packages/*/src`
# （AGENTS §6.1「打包前必须先跑 `pnpm -r build`」的全部理由，§7 第 27 条那笔学费）。
# 对账用的是 tar 的 sha256（在 `_heyta_windows_sync_push` 里），不在这里加锚点 ——
# `apps/web/dist/index.html` 那一组对 APK 什么都不证明。
sync_windows_sources_for_android() {
  local host="$1"
  local dist_list="" d
  for d in packages/*/dist; do
    [ -d "$d" ] || continue
    dist_list="$dist_list $d"
  done
  if [ -z "$dist_list" ]; then
    echo "  🔴 本地一个 packages/*/dist 都没有 —— 先跑 pnpm -r build，否则远端拿不到构建输入"
    return 1
  fi
  _heyta_windows_sync_push "$host" "$dist_list" "$dist_list" "android" || return 1
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
  local local_hash remote_hash local_bridge remote_bridge
  local_hash="$(shasum -a 256 apps/web/dist/index.html | awk '{print $1}')"
  remote_hash="$(ssh -o ConnectTimeout=10 "$host" \
    "powershell -NoProfile -Command \"(Get-FileHash 'C:\\src\\heyta\\apps\\web\\dist\\index.html' -Algorithm SHA256).Hash\"" 2>/dev/null |
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
    "powershell -NoProfile -Command \"(Get-FileHash 'C:\\src\\heyta\\packages\\app-host\\bridge-bundle\\native-bridge.js' -Algorithm SHA256).Hash\"" 2>/dev/null |
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
    'powershell -NoProfile -Command "(Get-ChildItem C:\src\heyta\apps\web\dist\assets -Filter *.js -ErrorAction SilentlyContinue | Measure-Object).Count"' 2>/dev/null |
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
