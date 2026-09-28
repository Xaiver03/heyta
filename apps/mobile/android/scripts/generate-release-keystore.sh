#!/bin/bash
# 生成 heyta 的**正式发布签名** keystore，并把它接到 Gradle（密钥文件与口令都不进仓库）。
#
# 🔴 纪律：
#   · keystore 与口令**只落在仓库之外**（~/.heyta-signing 与 ~/.gradle/gradle.properties）；
#   · **口令不打印到任何输出**（用 keytool 的 `:env` 修饰符传，避免出现在进程列表里）。
#
# ⚠️ 本轮踩过的坑（所以本脚本长这样）：
#   第一版在 `echo "... $GRADLE_PROPS （权限 600 ..."` 处崩了 ——
#   bash 把**紧跟变量的中文括号**当成了变量名的一部分（`$GRADLE_PROPS （`），
#   配合 `set -u` 直接 unbound variable 退出。后果是：
#   **keystore 生成了，但口令还没写下来，脚本就死了** ⇒ 那个 keystore 变成废的。
#   ⇒ 两条修法，都已落地：① 变量一律写 `${GRADLE_PROPS}`；
#     ② 结尾**验证**"存下来的口令真的能打开这个 keystore"，验不过就报错。
#
# 用法：bash apps/mobile/android/scripts/generate-release-keystore.sh
set -euo pipefail

SIGNING_DIR="${HOME}/.heyta-signing"
KEYSTORE="${SIGNING_DIR}/heyta-release.keystore"
GRADLE_PROPS="${HOME}/.gradle/gradle.properties"
ALIAS="heyta"

mkdir -p "${SIGNING_DIR}"
chmod 700 "${SIGNING_DIR}"

if [ -f "${KEYSTORE}" ]; then
  echo "⚠️  keystore 已存在，**不覆盖**（覆盖 = 换掉应用身份，已发布的包再也升不了级）："
  echo "    ${KEYSTORE}"
  echo "    要换请自己先备份并删掉它。"
  echo ""
  echo "（口令应在 ${GRADLE_PROPS} 里；若那里没有 HEYTA_RELEASE_*，"
  echo "  说明上一次生成中断了 —— 那个 keystore 是废的，请备份后删除再重跑本脚本。）"
  exit 0
fi

echo "=== 生成正式发布 keystore ==="
# 32 字节随机口令。**不 echo。**
export HEYTA_KEYSTORE_PASSWORD
HEYTA_KEYSTORE_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"

keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore "${KEYSTORE}" \
  -alias "${ALIAS}" \
  -keyalg RSA -keysize 4096 -sigalg SHA256withRSA \
  -validity 10000 \
  -dname "CN=heyta, OU=Mobile, O=Xiaoli Creativity Culture Industry, L=Hangzhou, ST=Zhejiang, C=CN" \
  -storepass:env HEYTA_KEYSTORE_PASSWORD \
  -keypass:env HEYTA_KEYSTORE_PASSWORD 2>&1 | sed 's/^/  /'

echo "  ✅ keystore 已生成：${KEYSTORE}"

# 接到 Gradle。**口令写进这个文件，而它不在仓库里。**
mkdir -p "$(dirname "${GRADLE_PROPS}")"
touch "${GRADLE_PROPS}"
chmod 600 "${GRADLE_PROPS}"
grep -v '^HEYTA_RELEASE_' "${GRADLE_PROPS}" > "${GRADLE_PROPS}.tmp" || true
mv "${GRADLE_PROPS}.tmp" "${GRADLE_PROPS}"
{
  echo ""
  echo "# heyta Android 正式发布签名（$(date +%Y-%m-%d) 生成；**本文件不进仓库**）"
  echo "# ⚠️ 备份 ${KEYSTORE} 与下面四项 —— keystore 丢了就再也发不了更新"
  echo "HEYTA_RELEASE_STORE_FILE=${KEYSTORE}"
  echo "HEYTA_RELEASE_STORE_PASSWORD=${HEYTA_KEYSTORE_PASSWORD}"
  echo "HEYTA_RELEASE_KEY_ALIAS=${ALIAS}"
  echo "HEYTA_RELEASE_KEY_PASSWORD=${HEYTA_KEYSTORE_PASSWORD}"
} >> "${GRADLE_PROPS}"
chmod 600 "${GRADLE_PROPS}"
echo "  ✅ 已写入 ${GRADLE_PROPS}（权限 600；口令未打印）"

# 🔴 **验证**：存下来的口令真的能打开这个 keystore 吗？
#    没有这一步，上面那次的失败方式（keystore 在、口令丢）会一直静默到出包才暴露。
echo ""
echo "=== 验证存下来的口令能打开 keystore ==="
if keytool -list -keystore "${KEYSTORE}" -storepass:env HEYTA_KEYSTORE_PASSWORD 2>/dev/null | grep -q "${ALIAS}"; then
  echo "  ✅ 口令可用，别名 ${ALIAS} 在位"
else
  echo "  🔴 口令打不开 keystore —— **这次生成是失败的**，请删除 keystore 后重跑" >&2
  exit 1
fi
unset HEYTA_KEYSTORE_PASSWORD

echo ""
echo "=== 产物 ==="
ls -la "${KEYSTORE}" | sed 's/^/  /'
grep -o '^HEYTA_RELEASE_[A-Z_]*' "${GRADLE_PROPS}" | sed 's/^/    /'
