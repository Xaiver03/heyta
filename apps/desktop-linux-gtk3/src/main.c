/*
 * heyta Linux 原生窗口壳 —— GTK3 + WebKit2GTK-4.0，带原生 SQLite 数据桥（惰性初始化）
 * ==================================================================================
 *
 * 目标：在只带 GTK3 / WebKit2GTK-4.0 的国产信创 Linux（银河麒麟、统信 UOS 20 等）
 * 上提供原生窗口运行 heyta 界面，并让数据真正落库。
 *
 * 数据桥：页侧 `window.__heytaHostStoragePort`（本壳注入）→ postMessage 到
 * `webkit.messageHandlers.heytaStorage` → C 侧首次收到消息时**惰性**创建
 * `HeytaApi`（JSC + native-bridge.js + 原生 SQLite 驱动）→ 把响应 postMessage 回页侧。
 * 页面因此走 sqlite 后端（~/.local/share/heyta/heyta.sqlite），不依赖 OPFS。
 *
 * 惰性初始化的理由：启动时就创建 JSGlobalContext 会与 WebKit 的 web 进程初始化抢资源，
 * 实测会导致页面根本不触发 load。把 api 建在第一封存储消息到达时，启动路径只剩 WebKit。
 *
 * 复用（与本文件同编译，来自 ../desktop-linux/src）：heyta_host.c / heyta_driver.c /
 * heyta_api.c / heyta_notify.c。
 *
 * 环境变量：
 *   HEYTA_WEB_DIST       共享 UI 目录，默认 /opt/apps/heyta/web-dist
 *   HEYTA_BRIDGE_BUNDLE  native-bridge.js，默认 <exe 目录>/native-bridge.js
 *   HEYTA_DB             数据库路径，默认 $HOME/.local/share/heyta/heyta.sqlite
 *   HEYTA_PORT           本地静态服务端口，默认 27190
 *   HEYTA_EXIT_AFTER_MS  非零则到点自动退出（无头验证用）
 *   HEYTA_NO_BRIDGE / HEYTA_NO_HANDLER / HEYTA_NO_SHIM  诊断开关（正式不设）
 *
 * 无头验证：加载完成打印 `HEYTA_WEBVIEW_READY title=<标题>`；开库成功打印
 * `STORAGE_HOST=on STORE_CLIENT_ID=<id>…`。
 */
#include "heyta_api.h"
#include "heyta_host.h" /* heyta_js_string_literal */

#include <gtk/gtk.h>
#include <jsc/jsc.h>
#include <webkit2/webkit2.h>

#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

#define HANDLER_NAME "heytaStorage"

static pid_t g_server_pid = -1;
static HeytaApi *g_api = NULL;
static bool g_store_opened = false;
static unsigned long g_msg_count = 0;
static char g_bundle[1200];
static char g_db[1024];

static const char *PORT_SHIM =
    "window.__heytaHostStoragePort = {"
    "  postMessage: function (message) {"
    "    window.webkit.messageHandlers." HANDLER_NAME ".postMessage(JSON.stringify(message));"
    "  },"
    "  addEventListener: function (type, listener) {"
    "    window.addEventListener(type, listener);"
    "  },"
    "};";

static void ensure_dir(const char *path) { g_mkdir_with_parents(path, 0700); }

static void run_js(WebKitWebView *view, const char *script) {
  webkit_web_view_run_javascript(view, script, NULL, NULL, NULL);
}

static void exe_dir(char *out, size_t outlen) {
  char path[1024];
  ssize_t n = readlink("/proc/self/exe", path, sizeof path - 1);
  if (n <= 0) {
    snprintf(out, outlen, ".");
    return;
  }
  path[n] = '\0';
  char *slash = strrchr(path, '/');
  if (slash == NULL) {
    snprintf(out, outlen, ".");
    return;
  }
  *slash = '\0';
  snprintf(out, outlen, "%s", path);
}

static void on_probe_done(GObject *obj, GAsyncResult *res, gpointer data) {
  (void)data;
  GError *err = NULL;
  WebKitJavascriptResult *r = webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(obj), res, &err);
  if (r != NULL) {
    JSCValue *v = webkit_javascript_result_get_js_value(r);
    char *s = jsc_value_to_string(v);
    fprintf(stdout, "PROBE %s\n", s != NULL ? s : "(null)");
    fflush(stdout);
    g_free(s);
    webkit_javascript_result_unref(r);
  } else {
    fprintf(stdout, "PROBE_ERR %s\n", err != NULL ? err->message : "?");
    fflush(stdout);
    if (err != NULL) g_error_free(err);
  }
}

static gboolean do_probe(gpointer data) {
  WebKitWebView *v = WEBKIT_WEB_VIEW(data);
  const char *js =
      "JSON.stringify({shim: !!window.__heytaHostStoragePort,"
      " mh: !!(window.webkit && window.webkit.messageHandlers &&"
      " window.webkit.messageHandlers.heytaStorage),"
      " secure: window.isSecureContext, proto: location.protocol, bodylen: document.body ? document.body.innerText.trim().length : -1, rootKids: (document.getElementById(\"root\")||{childElementCount:-1}).childElementCount, hasCanvas: !!document.querySelector(\"canvas\")})";
  webkit_web_view_run_javascript(v, js, NULL, on_probe_done, NULL);
  return G_SOURCE_REMOVE;
}

static void on_load_changed(WebKitWebView *wv, WebKitLoadEvent ev, gpointer data) {
  (void)data;
  static const char *names[] = {"started", "redirected", "committed", "finished"};
  const char *name = (ev >= 0 && ev <= 3) ? names[ev] : "?";
  fprintf(stdout, "M2_LOAD=%s uri=%s\n", name,
          webkit_web_view_get_uri(wv) != NULL ? webkit_web_view_get_uri(wv) : "(空)");
  fflush(stdout);
  if (ev == WEBKIT_LOAD_FINISHED) {
    const char *title = webkit_web_view_get_title(wv);
    fprintf(stdout, "HEYTA_WEBVIEW_READY title=%s\n", title != NULL ? title : "(none)");
    fflush(stdout);
    run_js(wv, "document.documentElement.classList.add('heyta-shell');");
    if (getenv("HEYTA_PROBE") != NULL) g_timeout_add(2500, do_probe, wv);
  }
}

static gboolean on_load_failed(WebKitWebView *view, WebKitLoadEvent ev, gchar *uri, GError *error,
                               gpointer data) {
  (void)view; (void)ev; (void)data;
  fprintf(stdout, "M2_LOAD_FAILED=%s ｜ %s\n", uri != NULL ? uri : "?",
          error != NULL ? error->message : "?");
  fflush(stdout);
  return FALSE;
}

static gboolean on_timeout(gpointer data) {
  (void)data;
  gtk_main_quit();
  return G_SOURCE_REMOVE;
}

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

/* 惰性创建原生数据桥门面（首次存储消息时）。 */
static bool ensure_api(void) {
  if (g_api != NULL) return true;
  char err[2048] = {0};
  g_api = heyta_api_create(g_bundle, g_db, err, sizeof err);
  if (g_api == NULL) {
    fprintf(stdout, "STORAGE_ERROR=数据桥初始化失败：%s\n", err);
    fflush(stdout);
    return false;
  }
  fprintf(stdout, "BRIDGE_BUNDLE=%s\nDB=%s\n", g_bundle, g_db);
  fflush(stdout);
  return true;
}

static void on_storage_message(WebKitUserContentManager *manager,
                               WebKitJavascriptResult *result, gpointer user_data) {
  (void)manager;
  WebKitWebView *view = WEBKIT_WEB_VIEW(user_data);
  JSCValue *value = webkit_javascript_result_get_js_value(result);
  if (value == NULL || !jsc_value_is_string(value)) {
    fprintf(stdout, "STORAGE_ERROR=页侧消息不是字符串（shim 应 JSON.stringify）\n");
    fflush(stdout);
    return;
  }
  char *message_json = jsc_value_to_string(value);
  if (message_json == NULL) return;
  if (!ensure_api()) {
    g_free(message_json);
    return;
  }
  if (!g_store_opened) {
    char client_id[128] = {0};
    char err[2048] = {0};
    if (!heyta_api_open_store(g_api, client_id, sizeof client_id, err, sizeof err)) {
      fprintf(stdout, "STORAGE_ERROR=开库失败：%s\n", err);
      fflush(stdout);
      g_free(message_json);
      return;
    }
    g_store_opened = true;
    fprintf(stdout, "STORAGE_HOST=on STORE_CLIENT_ID=%s…\n", client_id);
    fflush(stdout);
  }
  char outbound[262144] = {0};
  char err[2048] = {0};
  if (!heyta_api_handle_host_message(g_api, message_json, outbound, sizeof outbound, err,
                                     sizeof err)) {
    fprintf(stdout, "STORAGE_ERROR=%s\n", err);
    fflush(stdout);
    g_free(message_json);
    return;
  }
  g_free(message_json);
  g_msg_count += 1;
  if (g_msg_count == 1) {
    fprintf(stdout, "STORAGE_MSG#1 handled\n");
    fflush(stdout);
  }
  char *literal = heyta_js_string_literal(outbound);
  size_t need = strlen(literal) + 256;
  char *script = malloc(need);
  if (script == NULL) { free(literal); return; }
  snprintf(script, need,
           "(() => { const batch = JSON.parse(%s);"
           "  for (const text of batch.outboundJson)"
           "    window.postMessage(JSON.parse(text), '*'); })();",
           literal);
  free(literal);
  run_js(view, script);
  free(script);
}

int main(int argc, char **argv) {
  const char *dir = getenv("HEYTA_WEB_DIST");
  if (dir == NULL) dir = "/opt/apps/heyta/web-dist";
  const char *port_s = getenv("HEYTA_PORT");
  int port = port_s != NULL ? atoi(port_s) : 27190;
  const char *exit_ms = getenv("HEYTA_EXIT_AFTER_MS");

  gtk_init(&argc, &argv);

  const char *data_dir = getenv("HEYTA_DATA_DIR");
  char data_buf[512];
  if (data_dir == NULL) {
    const char *home = getenv("HOME");
    snprintf(data_buf, sizeof data_buf, "%s/.local/share/heyta", home != NULL ? home : "/tmp");
    data_dir = data_buf;
  }
  ensure_dir(data_dir);
  const char *db_env = getenv("HEYTA_DB");
  if (db_env != NULL) {
    snprintf(g_db, sizeof g_db, "%s", db_env);
  } else {
    snprintf(g_db, sizeof g_db, "%s/heyta.sqlite", data_dir);
  }
  const char *bundle_env = getenv("HEYTA_BRIDGE_BUNDLE");
  if (bundle_env != NULL && bundle_env[0] != '\0') {
    snprintf(g_bundle, sizeof g_bundle, "%s", bundle_env);
  } else {
    char ed[1024];
    exe_dir(ed, sizeof ed);
    snprintf(g_bundle, sizeof g_bundle, "%s/native-bridge.js", ed);
  }

  if (start_server(dir, port) != 0) {
    fprintf(stderr, "heyta: 无法启动本地静态服务(python3)\n");
    return 2;
  }

  char cache_buf[600];
  snprintf(cache_buf, sizeof cache_buf, "%s/cache", data_dir);
  ensure_dir(cache_buf);
  WebKitWebsiteDataManager *dm = webkit_website_data_manager_new(
      "base-data-directory", data_dir, "base-cache-directory", cache_buf, NULL);
  WebKitWebContext *ctx = webkit_web_context_new_with_website_data_manager(dm);
  webkit_web_context_set_sandbox_enabled(ctx, FALSE);

  GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(win), "heyta");
  gtk_window_set_default_size(GTK_WINDOW(win), 1200, 800);

  WebKitWebView *wv_view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_context(ctx));
  GtkWidget *wv = GTK_WIDGET(wv_view);
  WebKitSettings *settings = webkit_settings_new();
  webkit_settings_set_enable_javascript(settings, TRUE);
  webkit_web_view_set_settings(wv_view, settings);
  fprintf(stdout, "VIEW_CREATED\n");
  fflush(stdout);

  WebKitUserContentManager *manager = webkit_web_view_get_user_content_manager(wv_view);
  if (getenv("HEYTA_NO_BRIDGE") == NULL) {
    if (getenv("HEYTA_NO_HANDLER") == NULL) {
      if (!webkit_user_content_manager_register_script_message_handler(manager, HANDLER_NAME)) {
        fprintf(stderr, "heyta: 注册消息处理器 %s 失败\n", HANDLER_NAME);
        return 4;
      }
      g_signal_connect(manager, "script-message-received::" HANDLER_NAME,
                       G_CALLBACK(on_storage_message), wv);
    }
    if (getenv("HEYTA_NO_SHIM") == NULL) {
      WebKitUserScript *shim = webkit_user_script_new(
          PORT_SHIM, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
          WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
      webkit_user_content_manager_add_script(manager, shim);
      webkit_user_script_unref(shim);
    }
  }
  g_signal_connect(wv, "load-changed", G_CALLBACK(on_load_changed), NULL);
  g_signal_connect(wv, "load-failed", G_CALLBACK(on_load_failed), NULL);
  gtk_container_add(GTK_CONTAINER(win), wv);
  g_signal_connect(win, "destroy", G_CALLBACK(gtk_main_quit), NULL);

  char url[256];
  snprintf(url, sizeof url, "http://127.0.0.1:%d/", port);
  fprintf(stdout, "LOAD_CALLED %s\n", url);
  fflush(stdout);
  webkit_web_view_load_uri(wv_view, url);

  gtk_widget_show_all(win);
  if (exit_ms != NULL && atoi(exit_ms) > 0) g_timeout_add((guint)atoi(exit_ms), on_timeout, NULL);
  gtk_main();

  if (g_api != NULL) heyta_api_destroy(g_api);
  if (g_server_pid > 0) kill(g_server_pid, SIGTERM);
  return 0;
}
