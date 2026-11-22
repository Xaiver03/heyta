# heyta Linux 原生窗口壳（GTK3 + WebKit2GTK-4.0）—— 面向国产信创系统
#
# 前置（Debian 10 / 麒麟 / UOS 20 等 GTK3 环境）：
#   sudo apt-get install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.0-dev
#
#   make         构建 heyta-linux-gtk3

PKGS   := gtk+-3.0 webkit2gtk-4.0
CFLAGS := -std=c11 -O2 -Wall -Wextra -Werror -D_POSIX_C_SOURCE=200809L $(shell pkg-config --cflags $(PKGS))
LDLIBS := $(shell pkg-config --libs $(PKGS)) -lm

.PHONY: all clean

all: heyta-linux-gtk3

heyta-linux-gtk3: src/main.c
	$(CC) $(CFLAGS) -o $@ src/main.c $(LDLIBS)

clean:
	rm -f heyta-linux-gtk3
