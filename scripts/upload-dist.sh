#!/bin/bash
# 把一轮打包产物上传到 COS 分发桶（heyta-dist-1380503169），产出校验与清单。
#
#   scripts/upload-dist.sh --version 0.1.0 --file macos=路径 --file android=路径 ...
#
# 产物布局（桶内）：
#   app-releases/heyta/<version>/heyta-<version>-<platform>.<ext>   按版本归档
#   app-releases/heyta/latest/  同一批文件（固定名，落地页指向这里）
#   app-releases/heyta/latest/latest.json                          版本/URL/sha256 清单
#
# 每一步都会验证：上传后用**匿名** HEAD 回读（公开读是分发的前提，
# 授权态下的成功不算数）；content-length 与本地不一致直接退出 1。
#
# 依赖：coscli（~/.coscli/config.yaml 已含 heyta-dist bucket）、shasum、python3、curl。
set -euo pipefail

BUCKET="heyta-dist-1380503169"
REGION="ap-guangzhou"
BASE_URL="https://${BUCKET}.cos.${REGION}.myqcloud.com"
PREFIX="app-releases/heyta"
STAGE="$(mktemp -d /tmp/heyta-dist.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

VERSION=""
FILES=()   # platform=path
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --file) FILES+=("$2"); shift 2 ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

[ -n "$VERSION" ] || { echo "🔴 缺 --version"; exit 2; }
[ ${#FILES[@]} -gt 0 ] || { echo "🔴 缺 --file 平台=路径（可多次）"; exit 2; }

declare -a UPLOADED_NAME=() UPLOADED_PLATFORM=() UPLOADED_SHA=() UPLOADED_SIZE=()

# 🔴 字节数要一条两边都认的取法。实测（06 15:4x，Ubuntu 24.04）：`stat -f%z` 在 GNU 上 rc=1、
#    stdout 全空，只留一行 `stat: 无效的选项 -- %` —— 而本脚本 `set -euo pipefail`，
#    于是上传在第一个产物那里当场死，症状是一行 stat 用法错，看不出"这脚本没打算在 Linux 跑"。
#    GNU 在前（`stat -c %s` 在 BSD 上真的 rc=1，所以兜底会被走到）。
file_size() { # <file> -> 字节数
  local v
  v=$(stat -c %s "$1" 2>/dev/null) || v=""
  [ -n "$v" ] || v=$(stat -f%z "$1" 2>/dev/null) || v=""
  [ -n "$v" ] || { echo "🔴 取不到字节数：$1（两种 stat 形状都失败）"; exit 1; }
  printf '%s' "$v"
}

for entry in "${FILES[@]}"; do
  platform="${entry%%=*}"
  src="${entry#*=}"
  [ -f "$src" ] || { echo "🔴 文件不存在：$src"; exit 1; }
  case "$src" in
    *.zip) ext=zip ;; *.dmg) ext=dmg ;; *.apk) ext=apk ;;
    *.msix) ext=msix ;; *.msixbundle) ext=msixbundle ;; *.deb) ext=deb ;;
    *) echo "🔴 不认识的产物类型（只收 zip/dmg/apk/msix/msixbundle/deb）：$src"; exit 2 ;;
  esac
  name="heyta-${VERSION}-${platform}.${ext}"
  cp "$src" "$STAGE/$name"
  sha=$(shasum -a 256 "$STAGE/$name" | awk '{print $1}')
  size=$(file_size "$STAGE/$name")
  UPLOADED_NAME+=("$name"); UPLOADED_PLATFORM+=("$platform")
  UPLOADED_SHA+=("$sha"); UPLOADED_SIZE+=("$size")
done

# ---- latest.json（版本清单；落地页/脚本按平台取 URL 与校验和）----
python3 - "$STAGE" "$VERSION" "${UPLOADED_PLATFORM[@]}" <<'PYJSON'
import json, sys, datetime
stage, version, platforms = sys.argv[1], sys.argv[2], sys.argv[3:]
base = "https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta"
import hashlib, pathlib
files = {}
for p in platforms:
    name = f"heyta-{version}-{p}"
    matches = list(pathlib.Path(stage).glob(name + ".*"))
    f = matches[0]
    files[p] = {
        "name": f.name,
        "url": f"{base}/latest/{f.name}",
        "versionedUrl": f"{base}/{version}/{f.name}",
        "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
        "size": f.stat().st_size,
    }
doc = {"version": version, "releasedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "files": files}
(pathlib.Path(stage) / "latest.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
PYJSON

# ---- 上传（版本目录 + latest 目录）----
upload_one() {
  local name="$1" dest="$2" cache="$3"
  coscli cp "$STAGE/$name" "cos://${BUCKET}/${PREFIX}/${dest}/${name}" \
    --meta "Cache-Control:${cache}" -e "cos.${REGION}.myqcloud.com" >/dev/null
  # 🔴 用**匿名** HEAD 验证 —— 带授权的成功证明不了公开读。
  local len size
  len=$(curl -sI "${BASE_URL}/${PREFIX}/${dest}/${name}" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)
  size=$(file_size "$STAGE/$name")
  if [ -z "$len" ] || [ "$len" != "$size" ]; then
    echo "🔴 匿名回读失败：${dest}/${name}（HEAD content-length='${len}'，本地=${size}）"
    exit 1
  fi
  echo "  ✅ ${dest}/${name}（${size} 字节，匿名可读）"
}

echo "=== 上传（版本 ${VERSION}）==="
for i in "${!UPLOADED_NAME[@]}"; do
  upload_one "${UPLOADED_NAME[$i]}" "$VERSION" "max-age=31536000, immutable"
  upload_one "${UPLOADED_NAME[$i]}" "latest" "max-age=300"
done
upload_one "latest.json" "latest" "max-age=300"

echo ""
echo "=== 公开下载 URL ==="
for i in "${!UPLOADED_NAME[@]}"; do
  echo "  ${UPLOADED_PLATFORM[$i]}: ${BASE_URL}/${PREFIX}/latest/${UPLOADED_NAME[$i]}"
  echo "      sha256 ${UPLOADED_SHA[$i]}"
done
echo "  清单: ${BASE_URL}/${PREFIX}/latest/latest.json"
