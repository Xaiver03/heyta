/* 一次性诊断装置（**不属于产品**，默认 `make` 不构建它）：
 * 只用 GTK4 + WebKitGTK 6.0，加载三种 URL，把每一次信号与 JS 往返都打印出来。
 *
 * 它回答的是一枚很窄的问题：在这台载体上（Xvfb、无终端会话、经 ssh 启动），
 * `webkit_web_view_load_uri()` 之后**任何**加载信号会不会发出来 ——
 * 与本壳的自定义 scheme、存储端口、探针都无关。
 * 先怀疑探针（AGENTS §7 元规则 1）：壳里"一次回调都不发"这件事，
 * 可能怪壳，也可能怪这台机的渲染路径。这一枚把两者分开。
 *
 * 构建与跑法见 docs/runbooks/linux-dev-box.md 的 M2 那一节。
 */
#include <gtk/gtk.h>
#include <jsc/jsc.h>
#include <webkit/webkit.h>

#include <stdio.h>
#include <stdlib.h>

static int ticks;
static GMainLoop *loop;

static void on_load(WebKitWebView *view, WebKitLoadEvent event, gpointer user_data) {
    (void)user_data;
    static const char *names[] = {"started", "redirected", "committed", "finished"};
    printf("PROBE_LOAD=%s uri=%s\n", (event >= 0 && event <= 3) ? names[event] : "?",
           webkit_web_view_get_uri(view) != NULL ? webkit_web_view_get_uri(view) : "(空)");
    fflush(stdout);
}

static gboolean on_failed(WebKitWebView *view, WebKitLoadEvent event, gchar *uri,
                          GError *error, gpointer user_data) {
    (void)view;
    (void)event;
    (void)user_data;
    printf("PROBE_LOAD_FAILED=%s ｜ %s\n", uri != NULL ? uri : "(未知)",
           error != NULL ? error->message : "(没有错误文本)");
    fflush(stdout);
    return FALSE;
}

static void on_scheme(WebKitURISchemeRequest *request, gpointer user_data) {
    (void)user_data;
    const char *uri = webkit_uri_scheme_request_get_uri(request);
    printf("PROBE_SCHEME_REQ=%s\n", uri != NULL ? uri : "(未知)");
    fflush(stdout);
    static const char body[] = "<!doctype html><title>probe-scheme</title><h1>scheme ok</h1>";
    GInputStream *stream =
        g_memory_input_stream_new_from_data(body, (gssize)sizeof body - 1, NULL);
    webkit_uri_scheme_request_finish(request, stream, (gint64)(sizeof body - 1), "text/html");
    g_object_unref(stream);
}

static void js_done(GObject *source, GAsyncResult *result, gpointer user_data) {
    (void)source;
    GError *error = NULL;
    JSCValue *value = webkit_web_view_evaluate_javascript_finish(WEBKIT_WEB_VIEW(user_data),
                                                                 result, &error);
    if (error != NULL) {
        printf("PROBE_JS_ERR=%s\n", error->message);
        g_error_free(error);
    } else {
        char *text = value != NULL ? jsc_value_to_string(value) : NULL;
        printf("PROBE_JS=%s\n", text != NULL ? text : "(空值)");
        g_free(text);
        if (value != NULL) g_object_unref(value);
    }
    fflush(stdout);
}

/* ADR-0042 §3 第 5 条写的是"Linux（GTK4）放弃玻璃（无 backdrop blur 能力）"。
 * M2 之后 Linux 的内容面渲染在 **WebKitGTK** 里，那句话的主语已经换了一层 ——
 * `PROBE_BACKDROP=1` 取的就是这一层对 `backdrop-filter` 的读数。
 * ⚠️ 它回答的是"这一版 WebKit 认不认这个属性"，**不**回答"在 cairo 软件合成下真会不会糊"
 *    （Xvfb 里没有 GPU，见 runbook §5.7 那条 GTK4 退回 cairo 的记录）—— 后者要另取。 */
static void backdrop_done(GObject *source, GAsyncResult *result, gpointer user_data) {
    (void)source;
    (void)user_data;
    GError *error = NULL;
    JSCValue *value =
        webkit_web_view_evaluate_javascript_finish(WEBKIT_WEB_VIEW(user_data), result, &error);
    if (error != NULL) {
        printf("PROBE_BACKDROP_ERR=%s\n", error->message);
        g_error_free(error);
    } else {
        char *text = value != NULL ? jsc_value_to_string(value) : NULL;
        printf("PROBE_BACKDROP=%s\n", text != NULL ? text : "(空值)");
        g_free(text);
        if (value != NULL) g_object_unref(value);
    }
    fflush(stdout);
}

static const char BACKDROP_JS[] =
    "JSON.stringify({bf:CSS.supports('backdrop-filter','blur(20px)'),"
    "webkitBf:CSS.supports('-webkit-backdrop-filter','blur(20px)'),"
    "ua:navigator.userAgent})";

/* 顺序假设：打破加载的也许不是"存在第二个 JSC VM"，而是"它在 WebView 之前建"。
 * PROBE_JSC_LATE=1 把 JSCContext 的创建挪到第 3 拍（此时首屏早已加载完）。 */
static void make_jsc_late(void);
static void make_jsc_late(void) {
    JSCContext *ctx = jsc_context_new();
    JSCValue *v = jsc_context_evaluate(ctx, "1+1", -1);
    char *text = v != NULL ? jsc_value_to_string(v) : NULL;
    printf("PROBE_JSC_LATE=ctx=%s eval=%s\n", ctx != NULL ? "非空" : "空",
           text != NULL ? text : "(无值)");
    g_free(text);
    if (v != NULL) g_object_unref(v);
    if (ctx != NULL) g_object_unref(ctx);
    fflush(stdout);
}

static gboolean tick(gpointer user_data) {
    WebKitWebView *view = WEBKIT_WEB_VIEW(user_data);
    ticks += 1;
    if (ticks == 3 && getenv("PROBE_JSC_LATE") != NULL) make_jsc_late();
    printf("PROBE_TICK#%d uri=%s visible=%d mapped=%d progress=%.2f title=%s\n", ticks,
           webkit_web_view_get_uri(view) != NULL ? webkit_web_view_get_uri(view) : "(空)",
           gtk_widget_get_visible(GTK_WIDGET(view)),
           gtk_widget_get_mapped(GTK_WIDGET(view)),
           webkit_web_view_get_estimated_load_progress(view),
           webkit_web_view_get_title(view) != NULL ? webkit_web_view_get_title(view) : "(空)");
    fflush(stdout);
    webkit_web_view_evaluate_javascript(view, "document.readyState", -1, NULL, NULL, NULL,
                                        js_done, view);
    /* 三种 URL 依次试：每种给 4 拍。哪一种先出信号，责任就在哪一段。 */
    if (ticks == 4) webkit_web_view_load_uri(view, "about:blank");
    if (ticks == 8)
        webkit_web_view_load_uri(
            view, "data:text/html,<!doctype html><title>probe-data</title><h1>data ok</h1>");
    if (ticks == 12) webkit_web_view_load_uri(view, "heyta-probe://app/index.html");
    /* 第 14 拍：自定义 scheme 那一屏早已加载完，此时问属性最接近真实渲染上下文。 */
    if (ticks == 14 && getenv("PROBE_BACKDROP") != NULL)
        webkit_web_view_evaluate_javascript(view, BACKDROP_JS, -1, NULL, NULL, NULL,
                                            backdrop_done, view);
    if (ticks >= 16) {
        printf("PROBE_DONE\n");
        fflush(stdout);
        g_main_loop_quit(loop);
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

/* 4.1 那一代独有的老 C API。这里**故意不引它的头**（6.0 的同名类型会撞），
 * 只为把 `libjavascriptcoregtk-4.1.so.0` 拉进本进程，好测"两代 JSC 同时在场上"
 * 会不会让 WebKit 的加载停住 —— 壳正是这个形状（Makefile 的 PKGS 同时有 4.1 与 6.0）。 */
extern void *JSGlobalContextCreate(void *);

int main(void) {
    if (!gtk_init_check()) {
        printf("PROBE_NO_GTK=gtk_init_check 失败（DISPLAY=%s）\n",
               getenv("DISPLAY") != NULL ? getenv("DISPLAY") : "(未设置)");
        return 2;
    }
    printf("PROBE_ENV DISPLAY=%s GSK_RENDERER=%s WEBKIT_DISABLE_COMPOSITING_MODE=%s "
           "LIBGL_ALWAYS_SOFTWARE=%s sandbox_off=%s\n",
           getenv("DISPLAY") != NULL ? getenv("DISPLAY") : "(未设置)",
           getenv("GSK_RENDERER") != NULL ? getenv("GSK_RENDERER") : "(未设置)",
           getenv("WEBKIT_DISABLE_COMPOSITING_MODE") != NULL ? "1" : "(未设置)",
           getenv("LIBGL_ALWAYS_SOFTWARE") != NULL ? "1" : "(未设置)",
           getenv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS") != NULL ? "1" : "(未设置)");
    printf("PROBE_GDK_BACKEND=%s\n",
           G_OBJECT_TYPE_NAME(gdk_display_get_default()));
    fflush(stdout);

    if (getenv("PROBE_JSC41") != NULL) {
        void *ctx41 = JSGlobalContextCreate(NULL);
        printf("PROBE_JSC41=linked ctx=%s\n", ctx41 != NULL ? "非空" : "空");
        fflush(stdout);
    }
    /* 6.0 自带的**新** JSC API（`JSCContext` / `JSCValue`，glib 那一套）。
     * 壳里跑 TS 门面用的是**老** C API（`JSGlobalContextCreate`），而探针实测：
     * 老 API 一进场，WebView 就再也发不出任何加载信号。这一档测的就是"换成新 API
     * 是否绕得开"—— 绕得开，桥就该按 6.0 的原生形状重写；绕不开，引擎得挪出 UI 进程。 */
    if (getenv("PROBE_JSCGLIB") != NULL) {
        JSCContext *ctx = jsc_context_new();
        printf("PROBE_JSCGLIB=ctx=%s", ctx != NULL ? "非空" : "空");
        if (ctx != NULL) {
            JSCValue *v = jsc_context_evaluate(ctx, "1+1", -1);
            char *text = v != NULL ? jsc_value_to_string(v) : NULL;
            printf(" eval=%s", text != NULL ? text : "(无值)");
            g_free(text);
            if (v != NULL) g_object_unref(v);
            g_object_unref(ctx);
        }
        printf("\n");
        fflush(stdout);
    }

    WebKitWebContext *context = webkit_web_context_get_default();
    webkit_web_context_register_uri_scheme(context, "heyta-probe", on_scheme, NULL, NULL);
    WebKitSecurityManager *secmgr = webkit_web_context_get_security_manager(context);
    webkit_security_manager_register_uri_scheme_as_local(secmgr, "heyta-probe");
    webkit_security_manager_register_uri_scheme_as_secure(secmgr, "heyta-probe");
    /* PROBE_ISOLATED=1 复现壳里的第三档（display-isolated）—— 壳比本探针多这一句。 */
    if (getenv("PROBE_ISOLATED") != NULL)
        webkit_security_manager_register_uri_scheme_as_display_isolated(secmgr, "heyta-probe");

    /* 与壳同构的第二步：带 user-content-manager（注册消息处理器 + 文档创建期注入脚本）。
     * 用 PROBE_UCM=1 打开 —— 目的就是把"壳里没有任何加载信号"这件事拆成可二分的两半。 */
    WebKitUserContentManager *manager = NULL;
    if (getenv("PROBE_UCM") != NULL) {
        manager = webkit_user_content_manager_new();
        if (!webkit_user_content_manager_register_script_message_handler(manager, "heytaStorage",
                                                                        NULL)) {
            printf("PROBE_UCM_REGISTER_HANDLER=失败\n");
        }
        /* PROBE_SHIM=1 时注入一段与壳里同量级、同样形状的中转层（贴一份真实的
         * `window.webkit.messageHandlers` 包装 + 一段填充），测它会不会挡住加载。 */
        const char *shim_text = "window.__probeShim = 1;";
        if (getenv("PROBE_SHIM") != NULL) {
            GString *big = g_string_new("window.__heytaHostStoragePort={postMessage:function(m)"
                                        "{window.webkit.messageHandlers.heytaStorage.postMessage"
                                        "(JSON.stringify(m));},addEventListener:function(t,f)"
                                        "{this._h=this._h||[];this._h.push([t,f]);}};");
            for (int i = 0; i < 120; ++i)
                g_string_append_printf(big, "void /* 填充第 %d 行 */ __probe_pad%d;\n", i, i);
            shim_text = big->str;
        }
        WebKitUserScript *script = webkit_user_script_new(
            shim_text, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
            WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
        webkit_user_content_manager_add_script(manager, script);
        webkit_user_script_unref(script);
    }

    GtkWidget *view;
    if (manager != NULL) {
        view = GTK_WIDGET(g_object_new(WEBKIT_TYPE_WEB_VIEW, "user-content-manager", manager,
                                      "web-context", context, NULL));
        g_object_unref(manager);
    } else {
        view = GTK_WIDGET(g_object_new(WEBKIT_TYPE_WEB_VIEW, "web-context", context, NULL));
    }
    g_signal_connect(view, "load-changed", G_CALLBACK(on_load), NULL);
    g_signal_connect(view, "load-failed", G_CALLBACK(on_failed), NULL);

    /* PROBE_JSC_BETWEEN=1：壳要的正是这一档顺序 —— WebView 已经建好，
     * 但首屏还没开始加载，此时创建门面的 JSC 上下文。 */
    if (getenv("PROBE_JSC_BETWEEN") != NULL) make_jsc_late();

    const char *target = getenv("PROBE_URI") != NULL ? getenv("PROBE_URI") : "about:blank";

    GtkWidget *window = gtk_window_new();
    gtk_window_set_title(GTK_WINDOW(window), "heyta-webview-probe");
    gtk_window_set_default_size(GTK_WINDOW(window), 800, 600);

    /* PROBE_EARLY_LOAD=1 复现壳的顺序：先 load，再 set_child，再 present。 */
    if (getenv("PROBE_EARLY_LOAD") != NULL) {
        printf("PROBE_EARLY=1 uri=%s\n", target);
        webkit_web_view_load_uri(WEBKIT_WEB_VIEW(view), target);
    }
    gtk_window_set_child(GTK_WINDOW(window), view);
    gtk_window_present(GTK_WINDOW(window));
    if (getenv("PROBE_EARLY_LOAD") == NULL) {
        printf("PROBE_EARLY=0 uri=%s\n", target);
        webkit_web_view_load_uri(WEBKIT_WEB_VIEW(view), target);
    }
    loop = g_main_loop_new(NULL, FALSE);
    g_timeout_add(1000, tick, view);
    g_main_loop_run(loop);
    return 0;
}
