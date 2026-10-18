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
# 依赖：coscli（🔴 分发桶在**另一个账号**里，要用第二份配置 —— 见下面 COSCLI_CONFIG）、shasum、python3、curl。
set -euo pipefail

BUCKET="heyta-dist-1445543984"
REGION="ap-guangzhou"
# 🔴 **分发必须走自定义域名，不走桶默认域名**（2026-10-18）：
#   COS 对默认域名上的 .apk/.ipa 直接回 `403 DownloadForbidden`
#   （"not allowed to be distributed in a public network using COS default domain"）。
#   `dl.waytofuture.cn` 已 CNAME 到本桶并在桶上绑定为自定义域名 —— 同一条字节，
#   换主机名就能公开下发。改这里一处，`latest.json` 里所有平台的 URL 一起跟着走。
# 🔴 **分发走自定义域名**（2026-10-18 打通）：
#   COS 对**默认域名**上的 `.apk` 回 `403 DownloadForbidden`（连带签名的 GET 也封），
#   正解是自定义域名 —— 而它有一条行政前提：**「域名 + 该域名的 ICP 备案 + 桶」必须同一账号**。
#   当日的做法：把分发桶从账号 100044381704 **搬到**拥有 `waytofuture.cn` 与其备案的
#   账号 100050005585（`heyta-dist-1445543984`），再绑 `dl.waytofuture.cn` + 证书。
#   ⇒ 实测：`http(s)://dl.waytofuture.cn/...apk` 回 **206**，默认域名仍 403。
#   判据见 `pnpm verify:downloads-servable`（它真发 GET，不认 HEAD）。
# ⚠️ **2026-10-18 的状态**：域名绑定与证书（CertId bf4wtvOI）都已就位，`http` 实测 206，
#   而 **COS 侧的 TLS 还没下发**（`openssl s_client -servername dl.waytofuture.cn` 拿到的仍是
#   COS 通配证书 ⇒ https 回 000）。跑之前先验一次：
#     curl -s -o /dev/null -w '%{http_code}\n' -r 0-0 \
#       http://dl.waytofuture.cn/app-releases/heyta/latest/heyta-1.0.1-test.20261008.4-android.apk
#   ⚠️ 不要把 scheme 降成 http —— `releaseManifest()`（apps/landing/src/site/downloads.ts）
#   在 url 不是 https 时**直接抛错**，落地页会整页炸（实测 15 项测试红）。
BASE_URL="https://dl.waytofuture.cn"
PREFIX="app-releases/heyta"
STAGE="$(mktemp -d /tmp/heyta-dist.XXXXXX)"
# 🔴 分发桶属于账号 100050005585，而默认的 ~/.cos.yaml 是另一个账号的 ⇒ 必须显式给配置
COSCLI_CONFIG="${HEYTA_COSCLI_CONFIG:-$HOME/.config/heyta/coscli-waytofuture.yaml}"
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

# ---- Android：签名身份是**外向承诺**，不是构建细节 --------------------------
# 为什么这一条住在这里而不是 `check:downloads`：臂 A–D 全是**离线结构**门禁，
# 而"这一枚 APK 是谁签的"只能读字节本身。落地页给不给按钮由清单决定，
# 清单由这一支脚本写 —— 所以"不许把调试签名的包发到公网"这件事只有在这一刻拦得住。
#
# 为什么必须拦：`build.gradle` 在四个发布 keystore 键任一缺失时，把 release 变体
# 挂到 `signingConfigs.debug` 上（AGENTS §6.1 那条注记）。也就是说
# **`pnpm build:android` 成功、产物合法、能装能跑，而它是调试签名的**。
# 直链一旦发出去，换正式签名时访客必须先卸载 —— 对本地优先的应用那等于丢数据。
find_apksigner() {
  local c
  c=$(command -v apksigner 2>/dev/null) && { printf '%s' "$c"; return 0; }
  for c in "${ANDROID_HOME:-/nonexistent}"/build-tools/*/apksigner \
           "$HOME/Library/Android/sdk"/build-tools/*/apksigner \
           /opt/homebrew/share/android-commandlinetools/build-tools/*/apksigner; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

assert_android_release_signature() { # <apk> —— 读不出签名就拒绝，不静默放行
  local apk="$1" bin dn
  if ! bin=$(find_apksigner); then
    echo "🔴 要发 android 产物，但这台机上找不到 apksigner —— **拒绝发布**这一枚。"
    echo "   （找不到工具 = 读不出签名 = 证明不了它是正式签名。装 SDK build-tools 或设 ANDROID_HOME）"
    exit 1
  fi
  dn=$("$bin" verify --print-certs "$apk" 2>&1 | grep -m1 'certificate DN' || true)
  if [ -z "$dn" ]; then
    echo "🔴 apksigner 读不出 $apk 的签名（未签名或工具报错）—— 拒绝发布"
    exit 1
  fi
  if printf '%s' "$dn" | grep -q 'Android Debug'; then
    echo "🔴 这一枚是**调试签名**：$dn"
    echo "   直链发出去之后，换正式签名时访客必须先卸载 —— 本地优先的应用那等于丢数据。"
    echo "   补签（密钥不出机）：apksigner sign --ks <发布库> --ks-key-alias <别名> --out <目标> $apk"
    echo "   见 docs/runbooks/app-distribution.md §3.1"
    exit 1
  fi
  echo "  ✅ android 签名身份：${dn#*: }"
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
  # 只有 android 走这一道；其它端不碰 apksigner（这台机可能根本没装 SDK）。
  if [ "$platform" = android ] && [ "$ext" = apk ]; then
    # 🔴 **两道**，各挡一半（2026-10-16 加第二道）：
    #   ① `assert_android_release_signature` 挡"**忘了配发布签名**"（DN 里出现 `Android Debug`）；
    #   ② `verify-android-signing-identity.mjs` 挡"**签的不是我们那张**" —— 任何非调试证书
    #      都能过第一道，而换一张的症状与调试签名**一模一样**：已装用户升级要先卸载 ⇒ 丢数据。
    #      它比对的是**证书 SHA-256**（不是 DN），期望值取自这台机上那张发布 keystore
    #      （`HEYTA_RELEASE_STORE_FILE`，与 `build.gradle` 同源，刻意不进仓库）。
    assert_android_release_signature "$src"
    if ! node scripts/verify-android-signing-identity.mjs "$src"; then
      echo "  🔴 这枚 APK 的签名身份不是我们那张发布证书 —— **拒绝发布**这一枚。"
      echo "     读不出身份（没有 apksigner / 读不到发布 keystore）同样按拒绝处理："
      echo "     **证明不了**不是**通过**（见对账件 B14：'跳过 = 退出 0'那一族坑）。"
      exit 1
    fi
  fi
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
# 把**桶里那一刻**的清单落一份到暂存区：下面由 bash 调 `check-release-version-guard.mjs`
# 拿它做"不许倒号"的对账。判据本体住在那份 Node 脚本里（可离线逐臂自检），
# 这里只负责把活数据喂给它 —— **判据只有一份**。
(pathlib.Path(stage) / ".published.json").write_text(json.dumps(doc, ensure_ascii=False))
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

# 🔴 **"不许倒号"不在这里判** —— 判据本体在 `scripts/check-release-version-guard.mjs`
# （那里能**离线逐臂自检**，而且门禁 `check:release-version-guard` 会断言本脚本**真的调了它**）。
# 见下面 heredoc 之后那一段：本脚本只负责把**桶里那一刻**的清单喂给它。
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

# ---- 🔴 版本守卫：**上传之前**拦倒号 ----------------------------------------
#
# 判据本体在 `check-release-version-guard.mjs`（可离线逐臂自检；门禁
# `check:release-version-guard` 会断言这一行**存在**）。这里只把桶里那一刻的
# 清单喂给它 —— **判据只有一份**。
#
# 来历（2026-10-16 实测）：根 `package.json` 是 `0.1.0`，而桶里已发出
# `1.0.1-test.20261008.4`。照根取号的下一批会让 `latest.json` 的顶层版本
# **往回走**，而没有任何一层会报错 —— 落地页按钮指向更小的版本，用户装到旧字节。
GUARD_PLATFORM_ARGS=()
for p in "${UPLOADED_PLATFORM[@]}"; do GUARD_PLATFORM_ARGS+=(--platform "$p"); done
node "$(dirname "$0")/check-release-version-guard.mjs" \
  --version "$VERSION" \
  --manifest "$STAGE/.published.json" \
  "${GUARD_PLATFORM_ARGS[@]}"

# ---- 上传（版本目录 + latest 目录）----
upload_one() {
  local name="$1" dest="$2" cache="$3"
  coscli -c "$COSCLI_CONFIG" cp "$STAGE/$name" "cos://${BUCKET}/${PREFIX}/${dest}/${name}" \
    --meta "Cache-Control:${cache}" -e "cos.${REGION}.myqcloud.com" >/dev/null
  # 🔴🔴 用**匿名 GET（只取 1 字节）**验证，**不能用 HEAD**。带授权的成功证明不了公开读，
  # 而 HEAD 的成功**同样**证明不了 —— 这是实测过的，不是洁癖：
  #
  #   2026-10-16 实测，同一个 URL（COS **默认域名**上的 APK）：
  #     HEAD → 200 + 正确的 `Content-Length`
  #     GET  → **403** `<Code>DownloadForbidden</Code>`
  #            （"The APK/IPA file is not allowed to be distributed in a public
  #              network using COS default domain, please use custom domain instead."）
  #
  # 本脚本原来的回读正是 `curl -sI`（HEAD）⇒ **这条判据对 APK 恒绿**，
  # 于是"公开可读"这件事在最需要它的时候是假的，而**没有任何一层会说话**。
  #
  # `-r 0-0` 拿回一个字节：`Content-Range` 里带着**对象总大小**，
  # 既证明"匿名真的读得到正文"，又能拿它与本地逐字节对账。
  local url headers code total size
  url="${BASE_URL}/${PREFIX}/${dest}/${name}"
  size=$(file_size "$STAGE/$name")
  headers=$(curl -s -D - -o /dev/null -r 0-0 "$url" | tr -d '\r')
  code=$(printf '%s\n' "$headers" | awk 'tolower($1) ~ /^http\// {print $2; exit}')
  # ⚠️ 整行按 `/` 切，**不能**用 `$2` —— `Content-Range: bytes 0-0/2958227` 的
  # `$2` 是 `bytes` 而不是范围；那样切出来是空的，于是回退到分片响应的
  # `Content-Length: 1`，**每个健康对象都会被判成"大小不符"**。
  # （这条是 2026-10-16 拿活的 dmg 实测出来的：错版本会把门禁从"永远绿"翻成"永远红"。）
  total=$(printf '%s\n' "$headers" | awk 'tolower($1)=="content-range:" {n=split($0,a,"/"); gsub(/[ \t\r]/,"",a[n]); print a[n]; exit}')
  if [ -z "$total" ]; then
    # 服务端忽略了 Range（回 200 全量）—— 退回 Content-Length；**仍然是 GET**。
    total=$(printf '%s\n' "$headers" | awk 'tolower($1)=="content-length:" {print $2}' | tail -1)
  fi

  if [ "$code" != "200" ] && [ "$code" != "206" ]; then
    echo "🔴 匿名 GET 回读失败：${dest}/${name}（HTTP ${code:-<无响应>}）"
    printf '%s\n' "$headers" | sed -n '1,8p'
    echo "   （HEAD 可能仍是 200 —— 那是这条判据存在的全部理由）"
    exit 1
  fi
  if [ -z "$total" ] || [ "$total" != "$size" ]; then
    echo "🔴 匿名回读大小不符：${dest}/${name}（远端=${total:-<无>}，本地=${size}）"
    exit 1
  fi
  echo "  ✅ ${dest}/${name}（${size} 字节，匿名 GET 可读，HTTP ${code}）"
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

# ---- 收尾：**页面现在会给的那一整批**，真的都下得到吗 ----------------------
#
# ⚠️ 上面 `upload_one` 的回读只管**这一轮刚上传的那几枚**。而 `latest.json` 是**按端合并**的
# （见 `app-distribution.md` §3 的"两处与直觉不同的形状"第 1 条），所以页面同时还会给
# **别端更早几轮的条目** —— 那些没人再看一眼，而桶上的策略**可以在上传之后才变**。
# A1 正是这个形状：字节在、`HEAD` 还 200、而 `GET` 403，于是页面上留着一个点了下不动的按钮。
#
# 这一行读的是**落地页依赖的那份清单**（不是本轮的上传列表），所以它管的是访客会撞上的那一批。
# 失败**不拦发布**（包已经在桶里、快照也已经对齐），但必须**响亮**：它是一条要人去处理的读数，
# 不是可以静默收工的收尾。
echo "=== 页面当前会给的那一批，逐条验可取性 ==="
if node scripts/verify-downloads-servable.mjs; then
  echo "  ✅ 页面上每一枚产物都匿名可取"
else
  echo "  🔴 页面上有下不动的产物 —— **发布不算完成**：要么把它放到能公开读的地方，"
  echo "     要么把那一端从清单里拿掉。⚠️ 别拿 HEAD 复核（这个桶上 HEAD 与 GET 会给不同答案）。"
  exit 1
fi
