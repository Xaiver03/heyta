#!/usr/bin/env bash
# 只读探针：取 Playwright Chromium 在这台 Linux 上真正缺的动态库清单。
# 用途：把 scripts/linux/setup-build-host.sh 的 --step browser 从"猜的包名"换成有出处的闭包。
# 不装任何东西、不写系统。
set -uo pipefail

CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
CHROME=$(find "$CACHE" -maxdepth 3 -type f -name chrome 2>/dev/null | head -1)
if [ -z "$CHROME" ]; then
  echo "CHROME=NOT_FOUND cache=$CACHE"
  exit 0
fi
echo "CHROME=$CHROME"
echo "=== ldd 里 not found 的 soname ==="
MISS=$(ldd "$CHROME" 2>/dev/null | awk '/not found/ {print $1}' | sort -u)
if [ -z "$MISS" ]; then
  echo "MISSING=0 —— 运行库齐了"
else
  echo "$MISS"
  echo "MISSING=$(printf '%s\n' "$MISS" | wc -l | tr -d ' ')"
fi
echo "=== 每枚 soname 属于哪个发行版包（dpkg -S；取不到就写 UNKNOWN）==="
for lib in $MISS; do
  owner=$(dpkg -S "$lib" 2>/dev/null | head -1 | cut -d: -f1)
  printf '%-28s %s\n' "$lib" "${owner:-UNKNOWN}"
done
echo "=== 真启动一次，取原话报错 ==="
# 🔴 从 e2e 工作区里跑，而且要 require `@playwright/test` —— e2e 的 package.json 只声明了它，
#    `playwright` 那枚是它的传递依赖，**没有**链到顶层 node_modules（实测：顶层只有 1 条目 @playwright）。
#    拿 `require('playwright')` 探会读到 MODULE_NOT_FOUND，那是探针写错，不是这台机缺东西
#    （这个坑我自己踩了一次，别第二次）。
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ ! -d "$REPO/e2e" ]; then
  echo "无 e2e 目录（$REPO/e2e），跳过启动探测"
  exit 0
fi
cd "$REPO/e2e"
node -e '
const mod = process.env.PW_MODULE || "@playwright/test";
const { chromium } = require(mod);
chromium
  .launch({ args: ["--no-sandbox"] })
  .then(async (b) => {
    const p = await b.newPage();
    await p.setContent("<h1 id=x>heyta</h1>");
    console.log("LAUNCH=OK text=" + (await p.textContent("#x")));
    await b.close();
  })
  .catch((e) => {
    console.log("LAUNCH=FAIL " + String(e).split("\n")[0].slice(0, 220));
    process.exitCode = 1;
  });
' 2>&1 | tail -3
