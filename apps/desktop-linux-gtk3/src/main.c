/*
 * heyta Linux 原生窗口壳 —— GTK3 + WebKit2GTK-4.0
 * =================================================
 *
 * 目标：在只带 GTK3 / WebKit2GTK-4.0 的国产信创 Linux（银河麒麟 V10、统信 UOS 20 等）
 * 上提供**原生窗口**运行 heyta 界面。现有 apps/desktop-linux 是 GTK4 + WebKitGTK 6.0，
 * 这些系统没有该栈，故本壳改用 GTK3 + WebKit2GTK-4.0（三套目标系统均具备）。
 *
 * 形态：原生 GTK3 窗口 + 系统 WebKitGTK 4.0 渲染 apps/web 的共享 UI。
 * 本地静态服务由本进程 fork `python3 -m http.server` 提供（WebKit 需要 http 源，
 * file:// 下 SPA/模块会因同源策略失败）。数据存放在 WebView 的本地存储里。
 *
 * 环境变量：
 *   HEYTA_WEB_DIST       共享 UI 目录，默认 /opt/apps/heyta-web/web-dist
 *   HEYTA_PORT           本地静态服务端口，默认 27190
 *   HEYTA_EXIT_AFTER_MS  非零则到点自动退出（无头验证用）
 *
 * 无头验证：WebView 加载完成时向 stdout 打印 `HEYTA_WEBVIEW_READY title=<标题>`。
 */
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

static pid_t g_server_pid = -1;

static void on_load_changed(WebKitWebView *wv, WebKitLoadEvent ev, gpointer data) {
  (void)data;
  if (ev == WEBKIT_LOAD_FINISHED) {
    const char *title = webkit_web_view_get_title(wv);
    fprintf(stdout, "HEYTA_WEBVIEW_READY title=%s\n", title != NULL ? title : "(none)");
    fflush(stdout);
  }
}

static gboolean on_timeout(gpointer data) {
  (void)data;
  gtk_main_quit();
  return G_SOURCE_REMOVE;
}

static void ensure_dir(const char *path) { g_mkdir_with_parents(path, 0700); }

static int start_server(const char *dir, int port) {
  pid_t pid = fork();
  if (pid == 0) {
    char portbuf[16];
    snprintf(portbuf, sizeof portbuf, "%d", port);
    execlp("python3", "python3", "-m", "http.server", portbuf, "--bind", "127.0.0.1",
           "--directory", dir, (char *)NULL);
    _exit(127);
  }
  if (pid < 0) return -1;
  g_server_pid = pid;
  sleep(1);
  return 0;
}

int main(int argc, char **argv) {
  const char *dir = getenv("HEYTA_WEB_DIST");
  if (dir == NULL) dir = "/opt/apps/heyta-web/web-dist";
  const char *port_s = getenv("HEYTA_PORT");
  int port = port_s != NULL ? atoi(port_s) : 27190;
  const char *exit_ms = getenv("HEYTA_EXIT_AFTER_MS");

  gtk_init(&argc, &argv);
  if (start_server(dir, port) != 0) {
    fprintf(stderr, "heyta: 无法启动本地静态服务(python3)\n");
    return 2;
  }

  /*
   * 🔴 必须用**持久化**的 WebsiteDataManager：heyta 的 Web 版把数据存在 OPFS
   * （navigator.storage.getDirectory）。若 WebView 落到 ephemeral（临时）模式，
   * OPFS 会初始化失败，界面报 "Could not initialize local storage"。
   * 这里显式给 base-data-directory / base-cache-directory，确保持久化。
   */
  const char *data_dir = getenv("HEYTA_DATA_DIR");
  char data_buf[512], cache_buf[512];
  if (data_dir == NULL) {
    const char *home = getenv("HOME");
    snprintf(data_buf, sizeof data_buf, "%s/.local/share/heyta", home != NULL ? home : "/tmp");
    data_dir = data_buf;
  }
  snprintf(cache_buf, sizeof cache_buf, "%s/cache", data_dir);
  ensure_dir(data_dir);
  ensure_dir(cache_buf);
  WebKitWebsiteDataManager *dm = webkit_website_data_manager_new(
      "base-data-directory", data_dir, "base-cache-directory", cache_buf, NULL);
  WebKitWebContext *ctx = webkit_web_context_new_with_website_data_manager(dm);
  /* 无隔离沙箱环境（如容器/精简系统）里，WebKit 的 bubblewrap 沙箱起不来会让
   * 本地存储初始化失败。显式关闭沙箱；桌面发行版上二者都可用。 */
  webkit_web_context_set_sandbox_enabled(ctx, FALSE);
  WebKitSettings *settings = webkit_settings_new();
  webkit_settings_set_enable_javascript(settings, TRUE);

  GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(win), "heyta");
  gtk_window_set_default_size(GTK_WINDOW(win), 1200, 800);

  WebKitWebView *wv_view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_context(ctx));
  webkit_web_view_set_settings(wv_view, settings);
  GtkWidget *wv = GTK_WIDGET(wv_view);
  g_signal_connect(wv, "load-changed", G_CALLBACK(on_load_changed), NULL);
  gtk_container_add(GTK_CONTAINER(win), wv);
  g_signal_connect(win, "destroy", G_CALLBACK(gtk_main_quit), NULL);

  char url[256];
  snprintf(url, sizeof url, "http://127.0.0.1:%d/", port);
  webkit_web_view_load_uri(WEBKIT_WEB_VIEW(wv), url);

  gtk_widget_show_all(win);
  if (exit_ms != NULL && atoi(exit_ms) > 0) g_timeout_add((guint)atoi(exit_ms), on_timeout, NULL);
  gtk_main();

  if (g_server_pid > 0) kill(g_server_pid, SIGTERM);
  return 0;
}
