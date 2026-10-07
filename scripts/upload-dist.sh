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
# 🔴 **按端合并，不是整批重写。** 五端的产物不落在同一轮里（iOS 走 TestFlight、
#    Linux 的验装晚一天），而落地页读的是**这一份**清单。整批重写的失效形态是：
#    第二批只带 android ⇒ `latest.json` 里的 macos 条目消失 ⇒ 页面上一秒还有按钮、下一秒没了，
#    而桶里那个字节仍然在、仍然能下。没人会想到是"另一批上传"把它抹掉的。
#    版本号因此是**每个文件自己的**（`files.<端>.version`），批次号只作为"最新一轮"的抬头。
python3 - "$STAGE" "$VERSION" "$BASE_URL" "$PREFIX" "${UPLOADED_PLATFORM[@]}" <<'PYJSON'
import json, re, sys, datetime, hashlib, pathlib, urllib.request

stage, version, base, prefix, platforms = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
latest_url = f"{base}/{prefix}/latest/latest.json"

def fetch_existing():
    try:
        with urllib.request.urlopen(latest_url, timeout=20) as res:
            return json.loads(res.read().decode())
    except Exception as exc:  # 第一次发布、或桶里还没有：从空清单开始（这是可见的，不是静默的）
        print(f"  （读不到现有 latest.json：{type(exc).__name__} ⇒ 按首轮处理）")
        return {}

doc = fetch_existing()
files = dict(doc.get("files") or {})

def backfill(platform, entry):
    """合并进来的旧条目若没有 `version`，从它**自己的文件名**里取。

    🔴 不能让它继承本轮的批次号：那会把去年试传的 `heyta-0.0.0-dev-android.apk`
    说成 1.0.0，落地页于是给一个预发布的字节配上正式通道的说法 —— 而 `check-downloads.mjs`
    的臂 D 正是这么发现的（本轮实测：合并后第一次跑就报红）。
    文件名读不出版本的，就**留着不填**：宁可让臂 D 继续响，也不猜一个。
    """
    if entry.get("version"):
        return entry
    m = re.match(r"^heyta-(.+?)-" + re.escape(platform) + r"\.[A-Za-z0-9]+$", str(entry.get("name") or ""))
    if m:
        entry = dict(entry)
        entry["version"] = m.group(1)
        entry["releasedAt"] = entry.get("releasedAt") or doc.get("releasedAt") or ""
    return entry

files = {k: backfill(k, v) for k, v in files.items()}
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
for p in platforms:
    matches = list(pathlib.Path(stage).glob(f"heyta-{version}-{p}.*"))
    f = matches[0]
    files[p] = {
        "name": f.name,
        "url": f"{base}/{prefix}/latest/{f.name}",
        "versionedUrl": f"{base}/{prefix}/{version}/{f.name}",
        "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
        "size": f.stat().st_size,
        # 🔴 版本挂在**文件**上：合并后的清单里，各端来自不同轮，一个批次号盖不住它们。
        "version": version,
        "releasedAt": now,
    }
out = {"version": version, "releasedAt": now, "files": files}
# channels（TestFlight 那类人工登记的入口）由本脚本**原样保留**，绝不凭空生成。
if doc.get("channels"):
    out["channels"] = doc["channels"]
(pathlib.Path(stage) / "latest.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
print(f"  latest.json：本轮 {len(platforms)} 端，合并后共 {len(files)} 端"
      + (f"，保留通道 {len(out['channels'])} 枚" if out.get('channels') else ""))
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

# ---- 刷新落地页那份快照（**发布动作的一部分**，不是可选的收尾）----
# 落地页的下载按钮只读 apps/landing/src/site/release-manifest.json，而那份是桶里 latest.json
# 的逐字抄件。这一行不在，"传上去了但页面还说着去年的版本"就成了静默失效：
# 页面照样渲染、照样能点，只是那个字节已经不属于这一轮。
echo "=== 刷新落地页快照 ==="
if node apps/landing/scripts/gen-downloads.mjs && node scripts/check-downloads.mjs; then
  echo "  ✅ 快照已对齐；记得把 apps/landing/src/site/release-manifest.json 与生成的入口一起入库"
else
  echo "  🔴 快照刷新或下载面门禁失败 —— 包已经在桶里了，但页面还不知道。先修这一步再宣布发布完成。"
  exit 1
fi
