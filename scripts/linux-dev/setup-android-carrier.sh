#!/usr/bin/env bash
#
# `linux-dev` 上的 Android 构建载体前置 —— 检查缺什么、能补的补上，全程幂等。
# =============================================================================
#
# 为什么需要它：`scripts/run-gradle.mjs` 只负责"把源码送过去 + 在那台机器上跑 gradle"，
# 它**不装机**。而 2026-10-28 首趟真构建就是逐件补齐下面这些才打出 APK 的 ——
# 不写成一枚脚本，下一位只会照着报错重新推导一遍。
#
#   ① JDK 17：RN 0.84 的 gradle-plugin 里有 `kotlin { jvmToolchain(17) }`。机器上只有
#      JDK 21 时 Gradle 去问它自己钉的 `foojay-resolver-convention:0.5.0`，而那枚插件在
#      Gradle 9 上必崩（`JvmVendorSpec.IBM_SEMERU` 在 Gradle 8.10 已被移除）。
#      实测形状是 `BUILD FAILED in 39s` 且**只报那一句** —— 它不是构建的 bug，是载体缺 JDK 17。
#      ⚠️ 命令行 `-D` 给不进去（那一层读不到这个属性），必须落在 `gradle.properties` 里。
#   ② NDK 27.1.12297006：`apps/mobile/android/build.gradle` 把 `ndkVersion` 写死了，
#      而 AGP **不会**自己下 NDK。这枚包还要 CMake（`op-sqlite` 走 prefab），首趟实测
#      AGP 会自己经镜像装好 CMake —— 所以这里检查 NDK，CMake 缺席只报不拦。
#   ③ Gradle 9.0.0 的 wrapper 发行包：services.gradle.org 直连实测 ~46 KB/s（130MB ⇒ 45 分钟），
#      腾讯云镜像 3.6 MB/s。预置进**载体自己的** wrapper 缓存，并把 sha256 对回官方 `.sha256`。
#   ④ 载体自己的 `GRADLE_USER_HOME`：那台机器上原本躺着**别的项目**的
#      `~/.gradle/init.d/tfa-mirror.gradle`，heyta 首趟构建实际是靠它才解析到 Maven 的。
#      那种依赖不在任何清单里，别人删掉它我们就莫名其妙红 ⇒ 本载体的镜像与缓存全部落在
#      `$GRADLE_USER_HOME` 这一枚私有目录里，镜像规则由 `run-gradle.mjs` 用 `-I` 显式传。
#
# 🔴 下载的东西一律**对账**，不"能解开就算"：
#   · NDK 对 `repository2-3.xml` 里**该枚包自己那一段**的 size + sha1。取法要看清：
#     `<archives>` 里 linux / macosx / windows 三枚挨着排，按"文件名之后 400 字符"抓
#     会抓到**邻居**包的值（2026-10-28 实测错过一次）。r27b-linux 的真实值写死在下面，
#     换版本时按注释里的命令重新取，不要照抄任何一句话说它是多少。
#   · gradle 发行包对 `services.gradle.org/distributions/gradle-<ver>-bin.zip.sha256`。
#
# 用法（在载体机上跑；从本机则 `ssh linux-dev 'bash -s' < 本文件`）：
#   bash scripts/linux-dev/setup-android-carrier.sh          # 补齐
#   bash scripts/linux-dev/setup-android-carrier.sh --show    # 只报告，一个字节都不写
#
# 回退（逐项点名）：删 `$HEYTA_JDK17_DIR`、删 `$GRADLE_USER_HOME`、
#   删 `$ANDROID_SDK_ON_HOST/ndk/<rev>`。本脚本不往那台机器的 `~/.gradle` 与 `~/.bashrc` 写任何东西。

set -uo pipefail

SHOW=0
[ "${1:-}" = "--show" ] && SHOW=1

SDK="${ANDROID_SDK_ON_HOST:-$HOME/.local/opt/android-sdk}"
GRADLE_USER_HOME="${HEYTA_ANDROID_GRADLE_HOME_ON_HOST:-$HOME/.heyta-android-gradle}"
JDK17_DIR="${HEYTA_JDK17_DIR:-$HOME/.local/opt/jdk17-heyta}"
GRADLE_VER=9.0.0
NDK_REV=27.1.12297006
NDK_SHA1=6fc476b2e57d7c01ac0c95817746b927035b9749
NDK_SIZE=663976775
JDK17_URL='https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/linux/OpenJDK17U-jdk_x64_linux_hotspot_17.0.21_9.tar.gz'
NDK_URL='https://mirrors.cloud.tencent.com/AndroidSDK/android-ndk-r27b-linux.zip'
GRADLE_URL='https://mirrors.cloud.tencent.com/gradle/gradle-'"$GRADLE_VER"'-bin.zip'

# wrapper 的缓存目录名 = distributionUrl 的 MD5 按 36 进制编码（`PathAssembler.getHash` 的形状）。
# URL 改了这里必须跟着改，否则预置的那份没人读，症状是"构建挂在 46 KB/s 的下载上"。
GRADLE_URL_OFFICIAL='https://services.gradle.org/distributions/gradle-'"$GRADLE_VER"'-bin.zip'
WRAPPER_DIST_DIR="$GRADLE_USER_HOME/wrapper/dists/gradle-$GRADLE_VER-bin/$(printf %s "$GRADLE_URL_OFFICIAL" | md5sum | awk '{print $1}' | python3 -c 'import sys;n=int.from_bytes(bytes.fromhex(sys.stdin.read().strip()),"big");d="0123456789abcdefghijklmnopqrstuvwxyz";s=""
while n:s=d[n%36]+s;n//=36
print(s)')"

printf '=== 载体：%s ｜ SDK=%s ｜ 私有 GRADLE_USER_HOME=%s ===\n' "$(hostname)" "$SDK" "$GRADLE_USER_HOME"
[ "$SHOW" = 1 ] && printf '（--show：只报告，不写任何东西）\n'

fail=0
want() { printf '  → %s\n' "$1"; }
bad() { printf '  🔴 %s\n' "$1"; fail=1; }

# ── ① JDK 17 ────────────────────────────────────────────────────────────
printf '\n=== ① JDK 17（RN 的 jvmToolchain(17)）===\n'
if [ -x "$JDK17_DIR/bin/javac" ]; then
  printf '  [ok] %s\n' "$("$JDK17_DIR/bin/java" -version 2>&1 | head -1)"
elif [ "$SHOW" = 1 ]; then
  want "这里会装 JDK 17 到 ${JDK17_DIR}（约 185 MB）"
else
  mkdir -p "$JDK17_DIR" &&
    curl -fL --retry 3 --retry-delay 2 -o /tmp/heyta-carrier-jdk17.tar.gz "$JDK17_URL" &&
    tar -xzf /tmp/heyta-carrier-jdk17.tar.gz -C "$JDK17_DIR" --strip-components=1 &&
    rm -f /tmp/heyta-carrier-jdk17.tar.gz
  if [ -x "$JDK17_DIR/bin/javac" ]; then
    printf '  [ok] 装好：%s\n' "$("$JDK17_DIR/bin/java" -version 2>&1 | head -1)"
  else
    bad "JDK 17 没装上（${JDK17_DIR}）"
  fi
fi

# ── ② NDK ──────────────────────────────────────────────────────────────
printf '\n=== ② NDK %s（build.gradle 的 ndkVersion 写死）===\n' "$NDK_REV"
# 重新取官方清单里这一枚的 size/sha1（换版本时用这条，别抄上面的常数）：
#   curl -sS https://dl.google.com/android/repository/repository2-3.xml |
#     tr -d "\n" | grep -oE "<remotePackage path=\"ndk;$NDK_REV\".{0,1200}?android-ndk-r27b-linux\.zip" |
#     grep -oE "<size>[0-9]+|<checksum[^>]*>[0-9a-f]{40}"
if [ -f "$SDK/ndk/$NDK_REV/source.properties" ]; then
  if grep -q "Pkg.Revision = $NDK_REV" "$SDK/ndk/$NDK_REV/source.properties"; then
    printf '  [ok] %s\n' "$SDK/ndk/$NDK_REV"
  else
    bad "$SDK/ndk/$NDK_REV/source.properties 里的 Pkg.Revision 不是 ${NDK_REV}（解包解歪了，按注释核对）"
  fi
elif [ "$SHOW" = 1 ]; then
  want "这里会下 NDK（约 664 MB）并解到 $SDK/ndk/$NDK_REV"
else
  Z=/tmp/heyta-carrier-ndk.zip
  # 断点续传：这台机对 dl.google.com 直连会在几十 MB 处被重置（2026-10-28 实测），
  # 所以循环到"尺寸等于官方值"为止 —— 只按**官方尺寸**收线，不按"curl 退出 0"收线。
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    have=$(stat -c %s "$Z" 2>/dev/null || echo 0)
    [ "$have" -ge "$NDK_SIZE" ] && break
    timeout 600 curl -sS -C - -o "$Z" "$NDK_URL" >/dev/null 2>&1
    printf '  … 第 %s 趟，已收 %s/%s B\n' "$i" "$(stat -c %s "$Z" 2>/dev/null || echo 0)" "$NDK_SIZE"
  done
  got=$(stat -c %s "$Z" 2>/dev/null || echo 0)
  if [ "$got" -ne "$NDK_SIZE" ]; then
    bad "NDK 只收到 $got/$NDK_SIZE B —— 尺寸不等于官方值，不停在这一步就是拿半包去解"
  elif [ "$(sha1sum "$Z" | awk '{print $1}')" != "$NDK_SHA1" ]; then
    bad "NDK 的 sha1 与官方清单不符（镜像给的字节不是 Google 那一包）"
    rm -f "$Z"
  else
    printf '  [ok] 对账通过（size=%s，sha1 与 repository2-3.xml 逐字相同）\n' "$got"
    rm -rf /tmp/heyta-carrier-ndk-x && mkdir -p /tmp/heyta-carrier-ndk-x
    unzip -q "$Z" -d /tmp/heyta-carrier-ndk-x && mkdir -p "$SDK/ndk" &&
      rm -rf "$SDK/ndk/$NDK_REV" &&
      mv /tmp/heyta-carrier-ndk-x/android-ndk-r27b "$SDK/ndk/$NDK_REV" &&
      rm -rf /tmp/heyta-carrier-ndk-x /tmp/heyta-carrier-ndk.zip &&
      printf '  [ok] 装到 %s\n' "$SDK/ndk/$NDK_REV"
  fi
fi

# ── ③ wrapper 的发行包 ──────────────────────────────────────────────────
printf '\n=== ③ Gradle %s 发行包（预置进载体私有的 wrapper 缓存）===\n' "$GRADLE_VER"
if [ -f "$WRAPPER_DIST_DIR/gradle-$GRADLE_VER-bin.zip.ok" ]; then
  printf '  [ok] 已预置：%s\n' "$WRAPPER_DIST_DIR"
elif [ "$SHOW" = 1 ]; then
  want "这里会下 gradle-$GRADLE_VER-bin.zip 并预置到 $WRAPPER_DIST_DIR"
else
  OFFICIAL_SHA=$(timeout 40 curl -sSL "$GRADLE_URL_OFFICIAL.sha256" 2>/dev/null | tr -cd '0-9a-f' | head -c 64)
  mkdir -p "$WRAPPER_DIST_DIR"
  # 🔴 与 NDK 同一件事：这台机对镜像的长连接会在几十 MB 处被**重置**（2026-10-28 实测：
  #    18.3 MB 处 `curl: (56) Recv failure: 连接被对方重置`）。所以按 `--continue-at -`
  #    续传到"尺寸不再增长且 sha256 对得上"为止，而不是指望单发跑完。
  DIST_ZIP="$WRAPPER_DIST_DIR/gradle-$GRADLE_VER-bin.zip"
  got_sha=''
  for i in 1 2 3 4 5 6 7 8; do
    before=$(stat -c %s "$DIST_ZIP" 2>/dev/null || echo 0)
    timeout 300 curl -sSL --continue-at - -o "$DIST_ZIP" "$GRADLE_URL" >/dev/null 2>&1
    after=$(stat -c %s "$DIST_ZIP" 2>/dev/null || echo 0)
    got_sha=$(sha256sum "$DIST_ZIP" 2>/dev/null | awk '{print $1}')
    [ "$got_sha" = "$OFFICIAL_SHA" ] && break
    printf '  … 第 %s 趟续传：%s → %s B\n' "$i" "$before" "$after"
    [ "$after" = "$before" ] && sleep 3
  done
  if [ -z "${OFFICIAL_SHA:-}" ]; then
    bad "取不到官方 sha256（$GRADLE_URL_OFFICIAL.sha256）—— 没有对账依据就不预置"
    rm -rf "$WRAPPER_DIST_DIR"
  elif [ "${got_sha:-}" != "$OFFICIAL_SHA" ]; then
    bad "发行包 sha256 与官方不符（got=${got_sha:-空}）—— 不写 .ok，构建会自己退回下载而不是拿一份对不上账的发行包"
    rm -f "$DIST_ZIP"
  else
    touch "$WRAPPER_DIST_DIR/gradle-$GRADLE_VER-bin.zip.ok"
    printf '  [ok] 对账通过（sha256=%s…）\n' "${got_sha:0:16}"
  fi
fi

# ── ④ 载体私有的 gradle.properties ─────────────────────────────────────
printf '\n=== ④ %s/gradle.properties（工具链钉子）===\n' "$GRADLE_USER_HOME"
GP="$GRADLE_USER_HOME/gradle.properties"
if [ -f "$GP" ] && grep -q '^org.gradle.java.installations.paths=' "$GP"; then
  printf '  [ok] 已钉住\n'
elif [ "$SHOW" = 1 ]; then
  want "这里会写 ${GP}（两行：installations.paths / auto-download=false）"
else
  mkdir -p "$GRADLE_USER_HOME"
  {
    echo '# heyta Android 载体（setup-android-carrier.sh 写入；回退＝删掉整个目录）'
    echo "# 本地有 JDK 17 ⇒ Gradle 不必去问 foojay 解析器（那枚插件在 Gradle 9 上会崩）。"
    echo "org.gradle.java.installations.paths=$JDK17_DIR"
    echo 'org.gradle.java.installations.auto-download=false'
  } > "$GP"
  printf '  [ok] 写了 %s\n' "$GP"
fi

# ── ⑤ 可达性（只读，用来解释"为什么要镜像"）───────────────────────────
printf '\n=== ⑤ 出口可达性（只读）===\n'
# 🔴 探的是**一枚真实工件的元数据**，不是仓库根：目录根返回 404 是"没有索引页"，
#    把它印成"404"会被读成"这条路不通"，而它恰恰是通的（2026-10-28 实测就是这样误读过一次）。
for u in \
  'https://maven.google.com/com/android/tools/build/gradle/maven-metadata.xml' \
  'https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml' \
  'https://maven.aliyun.com/repository/google/com/android/tools/build/gradle/maven-metadata.xml' \
  'https://services.gradle.org/distributions/gradle-'"$GRADLE_VER"'-bin.zip.sha256'; do
  code=$(timeout 25 curl -sSL -o /dev/null -w '%{http_code}' "$u" 2>/dev/null)
  printf '  %s\n     -> %s\n' "$u" "${code:-超时/不通}"
done

printf '\n=== 收尾 ===\n'
if [ "$fail" = 0 ]; then
  printf 'CARRIER=READY host=%s root=%s\n' "$(hostname)" "$GRADLE_USER_HOME"
  printf '  下一步：本机跑 pnpm build:android（收口点是 scripts/run-gradle.mjs）\n'
  printf '  回退：rm -rf %s %s %s/ndk/%s\n' "$JDK17_DIR" "$GRADLE_USER_HOME" "$SDK" "$NDK_REV"
else
  printf 'CARRIER=INCOMPLETE（上面有 🔴）—— 不要绕过它去本机建包\n'
fi
exit "$fail"
