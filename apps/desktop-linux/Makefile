# Linux 原生壳（GTK4 + JavaScriptCore + SQLite）
#
#   make            构建 heyta-linux（窗口）与 heyta-smoke（无头冒烟）
#   make smoke      只跑无头冒烟
#
# 前置（Ubuntu/Debian）：
#   sudo apt-get install -y build-essential pkg-config \
#       libgtk-4-dev libjavascriptcoregtk-4.1-dev libsqlite3-dev
#
# 🔴 `libjavascriptcoregtk-4.1` 是 **WebKitGTK 里的 JS 引擎**，与 macOS 自带的是
#    同一个引擎家族。用它而不是另引一个 JS 运行时，意味着"引擎语义差异"这类坑
#    在两端只算一次。

PKGS   := gtk4 javascriptcoregtk-4.1 sqlite3
CFLAGS := -std=c11 -O2 -Wall -Wextra -Werror -D_POSIX_C_SOURCE=200809L $(shell pkg-config --cflags $(PKGS))
LDLIBS := $(shell pkg-config --libs $(PKGS)) -lm

CORE := src/heyta_driver.c src/heyta_host.c src/heyta_api.c

# bundle 由 `packages/app-host/scripts/build-native-bridge.mjs` 生成，
# 与 Windows / macOS 两个壳加载的是**同一个文件**。
BUNDLE := ../../packages/app-host/bridge-bundle/native-bridge.js

# 设计系统 token（P0-7，2026-10-01 UI 审计 G1）：GTK CSS 的 C 内嵌形态。
# 此前这个壳界面上没有任何一个像素来自设计系统，也没有任何门禁管它。
GTK_TOKENS := ../../packages/design-system/generated/heyta-tokens.h

.PHONY: all clean smoke check-bundle check-tokens

all: heyta-linux heyta-smoke

heyta-linux: $(CORE) src/main.c $(GTK_TOKENS) | check-bundle check-tokens
	$(CC) $(CFLAGS) -I../../packages/design-system/generated -o $@ $(CORE) src/main.c $(LDLIBS)

heyta-smoke: $(CORE) src/smoke.c | check-bundle
	$(CC) $(CFLAGS) -o $@ $^ $(LDLIBS)

# 缺 bundle 就**明确报错**，而不是等运行时白屏。
check-bundle:
	@test -f $(BUNDLE) || { \
	  echo "❌ 缺少 $(BUNDLE)"; \
	  echo "   先在仓库根跑：node packages/app-host/scripts/build-native-bridge.mjs"; \
	  exit 1; }

# 缺 token 头就**明确报错**：否则会是"能编但样式全丢"的静默失败。
check-tokens:
	@test -f $(GTK_TOKENS) || { \
	  echo "❌ 缺少 $(GTK_TOKENS)"; \
	  echo "   先跑：pnpm --filter @heyta/design-system run generate"; \
	  exit 1; }

smoke: heyta-smoke
	HEYTA_BRIDGE_BUNDLE=$(BUNDLE) ./heyta-smoke

clean:
	rm -f heyta-linux heyta-smoke
