# heyta Linux 原生窗口壳（GTK3 + WebKit2GTK-4.0 + 原生 SQLite 数据桥）
#
# 复用 ../desktop-linux/src 的引擎层（JavaScriptCore + SQLite 驱动 + native-bridge 门面），
# 只替换 GTK/WebKit 那一层（GTK4/webkitgtk-6.0 → GTK3/webkit2gtk-4.0）。
#
# 前置（Debian 10 / 麒麟 / UOS 20 等 GTK3 环境）：
#   sudo apt-get install -y build-essential pkg-config libgtk-3-dev \
#       libwebkit2gtk-4.0-dev libjavascriptcoregtk-4.0-dev libsqlite3-dev
#
#   node ../../packages/app-host/scripts/build-native-bridge.mjs   # 生成 native-bridge.js
#   make                                                            # 产出 heyta-linux-gtk3

PKGS   := gtk+-3.0 webkit2gtk-4.0 javascriptcoregtk-4.0 sqlite3 gio-2.0
CFLAGS := -std=c11 -O2 -Wall -Wextra -Werror -D_POSIX_C_SOURCE=200809L -I../desktop-linux/src $(shell pkg-config --cflags $(PKGS))
LDLIBS := $(shell pkg-config --libs $(PKGS)) -lm

CORE := ../desktop-linux/src/heyta_driver.c ../desktop-linux/src/heyta_host.c \
        ../desktop-linux/src/heyta_api.c ../desktop-linux/src/heyta_notify.c

.PHONY: all clean

all: heyta-linux-gtk3

heyta-linux-gtk3: src/main.c $(CORE)
	$(CC) $(CFLAGS) -o $@ src/main.c $(CORE) $(LDLIBS)

clean:
	rm -f heyta-linux-gtk3
