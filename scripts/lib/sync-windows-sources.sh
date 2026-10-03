#!/usr/bin/env bash
#
# 把**当前工作树**同步到 Windows 打包机，并给出"远端字节 = 本地现在"的判据。
# =====================================================================
#
# 为什么抽成独立文件：`scripts/reinstall-all.sh`（四端重装）与
# `scripts/verify-windows-shell-journey.mjs`（Windows 旅程验收）都要把源码送过去，
# 而这两件事**必须**用同一份同步 + 对账逻辑 —— 一旦两份，就会漂移成
# "一个脚本送了新树、另一个送了旧树"，正是 §7 第 82 条记录的那次事故形状。
#
# ⚠️ 调用方必须**在仓库根**、且**已经 `cd` 到仓库根**再 source 本文件并调用
#    `sync_windows_sources <host>`：它用 `git ls-files` 列举清单。
#
# ⚠️ 本仓库一律按 **bash 3.2**（macOS 自带）写：不用 `declare -A`。
#
# 用法（从 bash 调用）：
#   source scripts/lib/sync-windows-sources.sh
#   sync_windows_sources windows-pc

sync_windows_sources() {
  local host="$1"
  local tarball=/tmp/heyta-src.tar.gz
  local list=/tmp/heyta-src-files.txt
  # 🔴 桥的 bundle 是**构建产物、不入库**，而 `pnpm -r build` 不生成它 ⇒ 干净检出里
  #    它不存在，下面那句 `printf` 把它无条件写进清单，tar 直接
  #    `Cannot stat: No such file or directory`（2026-10-02 在隔离检出里实测）。
  #    与 mac 段 `package-app.sh` 同一处置：在这里现生成，不指望"本机跑过壳门禁"。
  local repo_root
  repo_root="$(git rev-parse --show-toplevel)" || return 1
  if ! node "$repo_root/packages/app-host/scripts/build-native-bridge.mjs"; then
    echo "  🔴 生成 bridge bundle 失败（packages/app-host/scripts/build-native-bridge.mjs）"
    return 1
  fi
  # 两个显式追加的构建输入**不过**上面那道"实际存在"过滤，所以单独验一次：
  # 缺了要指名道姓地红，而不是留一条 tar 的 errno。
  local p
  for p in apps/web/dist packages/app-host/bridge-bundle/native-bridge.js; do
    [ -e "$p" ] || { echo "  🔴 构建输入不存在：$p —— 不打包（宁可不装，也不装旧产物）"; return 1; }
  done
  # tar 读的是**工作树内容**（不是 git 对象），所以未提交改动、未跟踪的新文件都在。
  # ⚠️ 被删掉的跟踪文件不能进清单（tar 会直接失败）—— 过滤成"实际存在"的路径。
  {
    { git ls-files; git ls-files --others --exclude-standard; } |
      while IFS= read -r f; do [ -e "$f" ] && printf '%s\n' "$f"; done
    printf '%s\n' apps/web/dist
    # 🔴 **桥的 bundle 也必须送过去**（2026-09-30 补的一个真漏子）：
    #    它是构建产物、**不入库**，而 `HeytaWindows.csproj` 只"拷贝已存在的那个"
    #    （缺了才报错）。同步不带它 ⇒ Windows 上会**静默用旧桥**，
    #    症状是"本地明明改了 TS，装出来的壳却没有那个函数"。
    #    与 `apps/web/dist` 是同一条理由：产物也是构建输入，也要新鲜度对账。
    printf '%s\n' packages/app-host/bridge-bundle/native-bridge.js
  } > "$list"
  # COPYFILE_DISABLE：不带 AppleDouble（`._*`）过去，远端解包才干净。
  if ! COPYFILE_DISABLE=1 tar -czf "$tarball" -T "$list" > /tmp/heyta-src-tar.log 2>&1; then
    echo "  🔴 打源码包失败（/tmp/heyta-src-tar.log）"
    return 1
  fi
  echo "  ✅ 源码包 $(du -h "$tarball" | cut -f1)（跟踪 + 未跟踪 + web-dist + bridge-bundle）"
  if ! scp -q "$tarball" "$host:C:/src/heyta-src.tar.gz"; then
    echo "  🔴 源码包送不过去（$host 不可达？）"
    return 1
  fi
  # ⚠️ **覆盖式解包，不删远端整棵树** —— 那棵树里有 node_modules 与 dotnet 依赖，
  #    整棵删掉重建会把"打包"变成"重装工具链"。
  # 🔴 但 `apps/web/dist` 是**构建产物目录**，必须**先清再解**：vite 的 chunk 名带内容哈希，
  #    覆盖式解包对它等于**只增不减** —— 2026-10-03 实测远端 `assets/` 里躺着 26 个
  #    `index-*.js`（本地 7 个，跨 9/27→10/3 六次构建），而 `package-msix.ps1` 把整份
  #    `web-dist` 搬进包 ⇒ 装出来的包带着 ~19 枚没人引用的旧 chunk。今天行为没坏
  #    （index.html 按哈希引用），坏的是"清旧包"这一环在 Windows 段只到 .appx 层、
  #    没到同步源层：**一旦有什么按旧哈希去取，包里就真躺着那份旧代码。**
  if ! ssh -o ConnectTimeout=10 "$host" \
    'powershell -NoProfile -Command "Remove-Item -Recurse -Force C:\src\heyta\apps\web\dist -ErrorAction SilentlyContinue"; tar -xzf C:\src\heyta-src.tar.gz -C C:\src\heyta'; then
    echo "  🔴 远端解包失败（清旧 apps/web/dist + tar）"
    return 1
  fi
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
