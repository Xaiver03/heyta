/* M2 的实现侧。设计约束与"为什么长这样"都写在 heyta_web.h 的文件头。 */

#include "heyta_web.h"
#include "heyta_host.h" /* heyta_js_string_literal —— 转义只有这一份 */

#include <webkit/webkit.h> /* GTK4 原生那一档（6.0）；`webkit2gtk-4.1` 的头按 GTK3 编，会撞 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define SCHEME "heyta-local"
#define URI_BASE SCHEME "://app/"
#define HANDLER_NAME "heytaStorage"

struct HeytaWeb {
    GtkWidget *widget;
    HeytaApi *api;
    char root[1024];
    /* 页侧一上来就要存储，而"开库"只需要做一次（TS 侧幂等，这里也记一次）。 */
    bool store_opened;
    bool settled;
    guint probe_source;
};

/* ── 产物目录解析 ─────────────────────────────────────────────────────── */

/* 候选路径逐个试；判据是**里面真的有 index.html**，不是"目录存在"。
 * 目录存在而 index.html 缺失是真实发生过的形态（`vite build` 半途失败、
 * 或打包时只拷了目录名），那种时候必须说"没找到产物"，而不是"找到了"。 */
static bool has_index(const char *dir) {
    char probe[1200];
    snprintf(probe, sizeof probe, "%s/index.html", dir);
    return access(probe, R_OK) == 0;
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

const char *heyta_web_resolve_root(char *why, size_t whylen) {
    static char root[2048];
    char dir[1024];
    exe_dir(dir, sizeof dir);

    const char *from_env = getenv("HEYTA_WEB_ROOT");
    /* 用 g_strdup_printf 而不是定长 snprintf 拼：拼接长度不可证时 gcc 的
     * -Wformat-truncation 会直接把本壳编死（-Werror），而"截断"确实是我们该知道的事。 */
    char *cand[4];
    cand[0] = from_env != NULL ? g_strdup(from_env) : NULL;
    cand[1] = g_strdup_printf("%s/web-dist", dir);
    /* 🔴 cand[2] 是 **两级** `../`：exe 装在 `/usr/lib/heyta`，而共享 UI 按 FHS 装在
     * `/usr/share/heyta/web-dist`。写成一级 `../` 得到的是 `/usr/lib/share/…` —— 这一格
     * 从来没被任何判据跑到过（`.deb` 此前根本不装 web-dist，开发树跑的是 cand[0]/cand[3]），
     * 所以它错得毫无症状。判据就是 P4 那一次"从解包后的树里跑装出来的那份"，见 runbook §5.9。 */
    cand[2] = g_strdup_printf("%s/../../share/heyta/web-dist", dir);
    cand[3] = g_strdup_printf("%s/../../apps/web/dist", dir);

    const char *hit = NULL;
    for (int i = 0; i < 4; ++i) {
        if (cand[i] == NULL || cand[i][0] == '\0') continue;
        if (!has_index(cand[i])) continue;
        hit = cand[i];
        break;
    }

    if (hit == NULL) {
        if (why != NULL && whylen > 0) {
            snprintf(why, whylen,
                     "四处都没找到带 index.html 的共享 UI 产物：%s / %s / %s / %s"
                     "（先 `pnpm --filter @heyta/web build`，或设 HEYTA_WEB_ROOT=<apps/web/dist>）",
                     cand[0] != NULL ? cand[0] : "(HEYTA_WEB_ROOT 未设)",
                     cand[1], cand[2], cand[3]);
        }
    } else {
        snprintf(root, sizeof root, "%s", hit);
    }
    for (int i = 0; i < 4; ++i) g_free(cand[i]);
    return hit == NULL ? NULL : root;
}

/* ── 自定义 scheme：把 heyta-local://app/<路径> 映射到产物目录 ────────── */

/* 给错 MIME 的症状是白屏而控制台才有原因：`type="module"` 的脚本被拒。
 * 表与 macOS 的 `HeytaSchemeHandler.mimeType` 逐项对齐。 */
static const char *mime_for(const char *path) {
    const char *dot = strrchr(path, '.');
    if (dot == NULL) return "application/octet-stream";
    if (!strcmp(dot, ".html")) return "text/html";
    if (!strcmp(dot, ".js") || !strcmp(dot, ".mjs")) return "text/javascript";
    if (!strcmp(dot, ".css")) return "text/css";
    if (!strcmp(dot, ".json") || !strcmp(dot, ".webmanifest")) return "application/json";
    if (!strcmp(dot, ".svg")) return "image/svg+xml";
    if (!strcmp(dot, ".png")) return "image/png";
    if (!strcmp(dot, ".jpg") || !strcmp(dot, ".jpeg")) return "image/jpeg";
    if (!strcmp(dot, ".woff2")) return "font/woff2";
    if (!strcmp(dot, ".ico")) return "image/x-icon";
    return "application/octet-stream";
}

/* 🔴 路径必须锁在产物目录里。页面是我们自己打包的那份，但"锁死"不是靠信任它：
 * `heyta-local://app/../../../../etc/passwd` 这种请求一旦被规范化放过，
 * 这个 scheme 就变成任意文件读。判定用**规范化后的前缀**，不查 `..` 字符串 ——
 *  `%2e%2e` 之类的变形最终也要落到同一个前缀判定上。 */
static bool path_under_root(const char *root, const char *joined) {
    char real_root[4096];
    char real_file[4096];
    if (strlen(joined) >= sizeof real_file) return false;
    if (realpath(root, real_root) == NULL) return false;
    /* 文件可能还不存在（404 那条），realpath 就返回 NULL ——
       这时退一步：对**父目录**做规范化再比前缀。 */
    if (realpath(joined, real_file) == NULL) {
        char parent[4096];
        snprintf(parent, sizeof parent, "%s", joined);
        char *slash = strrchr(parent, '/');
        if (slash == NULL) return false;
        *slash = '\0';
        if (realpath(parent, real_file) == NULL) return false;
        size_t plen = strlen(real_root);
        return strncmp(real_file, real_root, plen) == 0 &&
               (real_file[plen] == '\0' || real_file[plen] == '/');
    }
    size_t plen = strlen(real_root);
    return strncmp(real_file, real_root, plen) == 0 &&
           (real_file[plen] == '\0' || real_file[plen] == '/');
}

static void on_scheme_request(WebKitURISchemeRequest *request, gpointer user_data) {
    const char *root = (const char *)user_data;
    const char *rel = webkit_uri_scheme_request_get_path(request);
    char *file = (rel == NULL || rel[0] == '\0' || !strcmp(rel, "/"))
        ? g_strdup_printf("%s/index.html", root)
        : g_strdup_printf("%s%s", root, rel);

    if (!path_under_root(root, file)) {
        printf("M2_SCHEME_DENY=%s\n", rel != NULL ? rel : "(根)");
        fflush(stdout);
        GError *error = g_error_new(WEBKIT_NETWORK_ERROR, WEBKIT_NETWORK_ERROR_FAILED,
                                    "拒绝越过共享 UI 产物目录：%s", rel);
        webkit_uri_scheme_request_finish_error(request, error);
        g_error_free(error);
        g_free(file);
        return;
    }

    gsize length = 0;
    gchar *bytes = NULL;
    if (!g_file_get_contents(file, &bytes, &length, NULL)) {
        printf("M2_SCHEME_MISS=%s\n", rel != NULL ? rel : "(根)");
        fflush(stdout);
        GError *error = g_error_new(WEBKIT_NETWORK_ERROR, WEBKIT_NETWORK_ERROR_FILE_DOES_NOT_EXIST,
                                    "产物里没有这个文件：%s", rel);
        webkit_uri_scheme_request_finish_error(request, error);
        g_error_free(error);
        g_free(file);
        return;
    }
    g_free(file);

    /* 送出去的字节数与 MIME 一起留痕：只有"请求到了壳"这一格的话，
     * "给了空文件"" MIME 给错 ⇒ `type=module` 被拒"这两种形态在日志里看不出来。 */
    printf("M2_SCHEME_REQ=%s %zuB %s\n", rel != NULL ? rel : "(根)", (size_t)length,
           mime_for(rel));
    fflush(stdout);

    /* 🔴 **这一格是 M2 在 Linux 上真正的断点**：共享产物里的入口脚本是
     * `<script type="module" crossorigin src="/assets/….js">`，`crossorigin` 让这一发
     * 变成 CORS 请求，而 `webkit_uri_scheme_request_finish()` 那条**什么响应头都不给** ⇒
     * 没有 `Access-Control-Allow-Origin` ⇒ 模块被拦。拦的时候页侧是**静默**的：
     * 不抛 `window.onerror`、不进 `console.error`、`#root` 永远是空的 ——
     * 实测读数就是这一族：`port=1 posts=0 mounted=0 root=1 scripts=1 err=无`，
     * 而那条 2.2 MB 的 `.js` 明明已经被壳取出来并交出去了。
     * macOS 那份方案从一开始就带这一句（`HeytaMacApp.swift` 里
     * `headerFields: ["Content-Type": …, "Access-Control-Allow-Origin": "*"]`），
     * 所以这不是新开决定，是把同一份承诺在第三个宿主上兑现。 */
    GInputStream *stream = g_memory_input_stream_new_from_data(bytes, (gssize)length, g_free);
    SoupMessageHeaders *headers = soup_message_headers_new(SOUP_MESSAGE_HEADERS_RESPONSE);
    soup_message_headers_append(headers, "Access-Control-Allow-Origin", "*");
    WebKitURISchemeResponse *response =
        webkit_uri_scheme_response_new(stream, (gint64)length);
    webkit_uri_scheme_response_set_content_type(response, mime_for(rel));
    webkit_uri_scheme_response_set_http_headers(response, headers);
    webkit_uri_scheme_request_finish_with_response(request, response);
    /* 归属：这里放下我们自己那两份引用（`response` 与 `headers`）。
     * ⚠️ 头文件没写明 `set_http_headers` 到底取不取引用，所以这一句的正确性只能靠行为：
     * 每一发请求都新建这两个对象，跑一整趟启动（几十发）看有没有崩溃/乱码。 */
    g_object_unref(response);
    g_object_unref(headers);
    g_object_unref(stream);
}

static gboolean take_snapshot_later(gpointer user_data);
static void mark_shell_class(HeytaWeb *web);

/* ── 存储宿主端口 ─────────────────────────────────────────────────────── */

/* 页侧看到的端口形状**只有这两样**（`postMessage` + `addEventListener`），
 * 因为页侧的线码端口 `createOpLogWirePort` 就只认这两样 —— 与 macOS 那份逐字同构。
 * 差别只有一处：这里把消息先 `JSON.stringify` 再过 WebKit 的消息通道，
 * 因为 C 侧拿到 JSCValue 时读对象要 `JSON.stringify` 一遍才行，而串是原样可读的。
 * 这属于"每平台各自的搬运方式"，不是第二套协议。 */
static const char *PORT_SHIM =
    "window.__heytaHostStoragePort = {"
    "  postMessage: function (message) {"
    "    window.webkit.messageHandlers." HANDLER_NAME ".postMessage(JSON.stringify(message));"
    "  },"
    "  addEventListener: function (type, listener) {"
    "    window.addEventListener(type, listener);"
    "  },"
    "};";

/* 🔴 取证用的页侧错误收集器 —— **只在 `HEYTA_WEB_PROBE=1` 时注入**，产品路径里没有它。
 * 理由是 AGENTS §6.2 规定一第 3 条那句老话："白窗口的根因几乎只在这里现形"，
 * 而 WebKitGTK 6.0 **不把 console 递给宿主**，所以只能在文档创建之前自己装一个。
 * 它只往一个数组里 push，不改任何行为；探针那一行把前两条带出来。 */
static const char *ERROR_RECORDER =
    "window.__heytaPageErrors = [];"
    "function __heytaNote(t){"
    "  if (window.__heytaPageErrors.length < 12) window.__heytaPageErrors.push(String(t).slice(0, 300));"
    "}"
    "window.addEventListener('error', function (e) {"
    "  __heytaNote('error: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + e.lineno);"
    "});"
    "window.addEventListener('unhandledrejection', function (e) {"
    "  var r = e.reason; __heytaNote('reject: ' + ((r && r.message) ? r.message : String(r)));"
    "});"
    "(function () { var ce = console.error; console.error = function () {"
    "  __heytaNote('console: ' + Array.prototype.join.call(arguments, ' '));"
    "  return ce.apply(this, arguments);"
    "}; })();"
    /* 端口有没有被**用过**是这一族最关键的一格：`port=1` 只证明 shim 注进去了，
     * 不证明页侧走到了用它的那条分支。所以在 shim 之后包一层计数器。 */
    "(function () { var p = window.__heytaHostStoragePort; if (!p) return;"
    "  p.__posts = 0; var pm = p.postMessage;"
    "  p.postMessage = function (m) { p.__posts++; __heytaNote('post: ' + String(m).slice(0, 140));"
    "    return pm.call(p, m); };"
    "})();"
    "window.__heytaConsoleProbe = function (level) { var f = console[level];"
    "  console[level] = function () { __heytaNote(level + ': ' + Array.prototype.join.call(arguments, ' '));"
    "    return f.apply(this, arguments); }; }; window.__heytaConsoleProbe('log');"
    "window.__heytaConsoleProbe('warn');"
    /* Worker 与 service worker 都在这一档里留痕：自定义 scheme 下它们能不能起得来，
     * 是"页侧静默等死"这一族里最常见的一种成因（起不来时不抛错，只是永远不 resolve）。 */
    "(function () { if (!window.Worker) return; var W = window.Worker;"
    "  window.Worker = function (u, o) { __heytaNote('worker: ' + String(u));"
    "    var w = new W(u, o);"
    "    w.addEventListener('error', function (e) {"
    "      __heytaNote('worker-error: ' + String(u) + ' ' + String((e && e.message) || ''));"
    "    });"
    "    return w; };"
    "  window.Worker.prototype = W.prototype; })();"
    "(function () { var sw = navigator.serviceWorker; if (!sw || !sw.register) return;"
    "  var r = sw.register.bind(sw); sw.register = function (u, o) {"
    "    __heytaNote('sw-register: ' + String(u)); return r(u, o); }; })();";

/* 首屏探针：读的是**页侧自己上报的事实**，不是"界面上有字"。
 * `__heytaStorage.backend` 由 `initOpLog()` 写下（既有那一处，不新增第二套），
 * 所以这一行同时回答了"用的是哪份存储"和"应用真挂载了"。
 * `posts=` 那一格分的是"端口注入了但页侧没用过"与"页侧用了而壳没答"——
 * 这两种失败在只有 `port=`/`mounted=` 的日志里长得一模一样。
 * 返回**一行纯文本**而不是 JSON：C 侧要判断的只有"落定了没有"，
 * 而在 C 里解析 JSON 就等于把协议的读法搬到第三语言去实现一遍。 */
static const char *PROBE_JS =
    "`port=` + (globalThis.__heytaHostStoragePort ? 1 : 0)"
    " + ` posts=` + ((globalThis.__heytaHostStoragePort || {}).__posts || 0)"
    " + ` backend=` + ((globalThis.__heytaStorage || {}).backend || '')"
    " + ` clientId=` + ((globalThis.__heytaStorage || {}).clientId || '').slice(0, 8)"
    " + ` mounted=` + document.querySelectorAll('#root > *').length"
    " + ` root=` + (document.getElementById('root') ? 1 : 0)"
    " + ` scripts=` + document.querySelectorAll('script').length"
    " + ` res=` + performance.getEntriesByType('resource').length"
    " + ` notes=` + ((globalThis.__heytaPageErrors || []).length)"
    " + ` err=` + ((globalThis.__heytaPageErrors || []).slice(0, 4).join(' || ') || '无')"
    " + ` title=` + (document.title || '');";

/* 探针的每一发都打出来（`M2_PROBE#<第几发>=`），失败形态才看得见：
 * "一直 port=0" = shim 没注进去；"port=1 backend= 且不变化" = 页侧没走到存储初始化。 */
static int probe_attempt = 0;

static void evaluate_done(GObject *source, GAsyncResult *result, gpointer user_data) {
    HeytaWeb *web = user_data;
    WebKitWebView *view = WEBKIT_WEB_VIEW(source);
    GError *error = NULL;
    JSCValue *value = webkit_web_view_evaluate_javascript_finish(view, result, &error);
    if (error != NULL) {
        printf("M2_PROBE#%d_ERROR=%s\n", probe_attempt, error->message);
        fflush(stdout);
        g_error_free(error);
        return;
    }
    if (value == NULL) return;
    char *text = jsc_value_to_string(value);
    g_object_unref(value);
    if (text == NULL) return;

    printf("M2_PROBE#%d=%s\n", probe_attempt, text);
    fflush(stdout);

    /* 落定的判据：端口在、后端**报得出名字**、而且真挂载出了节点。
     * 三个都要 —— 只有前两个时界面仍可能是一片空白。
     * 用 sscanf 取字段值，不解析整条协议：这串文本是壳自己探针的产物，
     * 而 `backend` 的取值（`sqlite` / `indexeddb` / 空）**就是要区分的三档**。 */
    int port = 0, mounted = 0;
    char backend[32] = {0};
    const char *p = strstr(text, "port=");
    const char *b = strstr(text, "backend=");
    const char *m = strstr(text, "mounted=");
    if (p != NULL) port = atoi(p + 5);
    if (b != NULL) sscanf(b + 8, "%31[^ ]", backend);
    if (m != NULL) mounted = atoi(m + 8);
    web->settled = port == 1 && backend[0] != '\0' && mounted > 0;
    g_free(text);
}

static gboolean probe_tick(gpointer user_data);

/* 🔴 探针是**轮询**的，不是一次性的。
 * 理由与 macOS 侧逐字相同："固定 sleep 在慢机器上假失败、在快机器上白等"，
 * 而"等 load-changed 到 finished 再探"还多一条：加载**可以永远不来**（网络挂了、
 * scheme 没答、渲染进程没起），那种情况下事件驱动的一次性探针**一个字都不报**，
 * 取证侧只能看到"日志停在那一行"。轮询每一拍都留痕，于是"没落定"是一个**读数**
 * 而不是一次沉默。
 * ⚠️ 这里原先写的是"6.0 不再发 `load-changed`（类结构里只剩 load_failed 那一族 vfunc）" ——
 *    那句是**没取证就写下的**，实测否证：`g_signal_lookup("load-changed", WEBKIT_TYPE_WEB_VIEW)`
 *    在这一版里查得到（该类共 112 个信号），而今天的读数是 `load-changed` **会**发
 *    （门面创建顺序改对之后 `M2_LOAD=started/committed/finished` 都出来了）。
 *    留着这行是为了让后来者认出那个形状：**"探针没收到"从来不是"信号不存在"的证据**。 */
static void probe_start(HeytaWeb *web) {
    if (web->probe_source != 0) return;
    web->probe_source = g_timeout_add(500, probe_tick, web);
}

static void run_evaluate(const char *script, WebKitWebView *view) {
    webkit_web_view_evaluate_javascript(view, script, -1, NULL, NULL, NULL, NULL, NULL);
}

/* 页侧消息 → TS → 回推**每一串**。回推一次做完（把 TS 返回的整个数组交给页面自己循环），
 * 这样 C 侧既不必拆 JSON、也不需要知道"这回该回几条"。 */
/* 🔴 6.0 把这个回调的参数从 `WebKitJavascriptResult*`（4.1 的包装）换成了**裸的
 * `JSCValue*`** —— 照 4.1 的写法抄，编译期就断在这里。 */
static void on_storage_message(WebKitUserContentManager *manager,
                               JSCValue *value,
                               gpointer user_data) {
    (void)manager;
    HeytaWeb *web = user_data;

    if (!jsc_value_is_string(value)) {
        printf("STORAGE_ERROR=页侧消息不是字符串（shim 应当先 JSON.stringify）\n");
        fflush(stdout);
        return;
    }
    char *message_json = jsc_value_to_string(value);
    if (message_json == NULL) return;

    if (!web->store_opened) {
        char client_id[128] = {0};
        char err[2048] = {0};
        if (!heyta_api_open_store(web->api, client_id, sizeof client_id, err, sizeof err)) {
            printf("STORAGE_ERROR=开库失败：%s\n", err);
            fflush(stdout);
            g_free(message_json);
            return;
        }
        web->store_opened = true;
        printf("STORAGE_HOST=on STORE_CLIENT_ID=%s…\n", client_id);
        fflush(stdout);
    }

    char outbound[262144] = {0};
    char err[2048] = {0};
    if (!heyta_api_handle_host_message(web->api, message_json, outbound, sizeof outbound,
                                       err, sizeof err)) {
        /* 失败**必须说出来**：静默会让页侧永远等一个不来的响应（那是"卡在启动"那一族）。 */
        printf("STORAGE_ERROR=%s\n", err);
        fflush(stdout);
        g_free(message_json);
        return;
    }
    g_free(message_json);

    char *literal = heyta_js_string_literal(outbound);
    size_t need = strlen(literal) + 256;
    char *script = malloc(need);
    snprintf(script, need,
             "(() => { const batch = JSON.parse(%s);"
             "  for (const text of batch.outboundJson)"
             "    window.postMessage(JSON.parse(text), '*'); })();",
             literal);
    free(literal);
    run_evaluate(script, WEBKIT_WEB_VIEW(web->widget));
    free(script);
}

/* 🔴 加载失败**必须**说出来。只接 `WEBKIT_LOAD_FINISHED` 的那一版在这里栽过：
 * 窗口正常起来、尺寸正常、进程退 0，而**一个字的结果都没有** —— 因为主资源根本没加载成，
 * 那条路径上没有任何一行输出。"证据缺失"和"证据是绿的"在输出上长得一样，
 * 而前者更容易被读成后者（§7 元规则 1：先怀疑探针）。 */
/* `load-changed` 在 6.0 里**是**存在的（实测 `g_signal_lookup` 给出发号 112）。
 * 上一轮我因为"日志里一个字都没有"就断言它没了 —— 那是错的：真正的原因是
 * 加载从未发起（自定义 scheme 的请求一次都没到壳），所以任何信号都不该被期待。
 * 留这一档追踪器，正是为了下一次能一眼分清"没发起"和"发起了没走完"。 */
static void on_load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer user_data) {
    (void)user_data;
    static const char *names[] = {"started", "redirected", "committed", "finished"};
    const char *name = (event >= 0 && event <= 3) ? names[event] : "?";
    printf("M2_LOAD=%s uri=%s\n", name, webkit_web_view_get_uri(view));
    fflush(stdout);
    if (event == WEBKIT_LOAD_FINISHED) mark_shell_class(user_data);
}

/* Web 进程没了必须说出来。不接这一档的话，症状是"页面永远不落定"，
 * 而真相（渲染进程崩了/被沙箱挡了）一个字都不会出现在日志里。 */
static void on_web_process_terminated(WebKitWebView *view,
                                     WebKitWebProcessTerminationReason reason,
                                     gpointer user_data) {
    (void)view;
    (void)user_data;
    const char *which = "未知";
    switch (reason) {
    case WEBKIT_WEB_PROCESS_CRASHED: which = "崩溃"; break;
    case WEBKIT_WEB_PROCESS_EXCEEDED_MEMORY_LIMIT: which = "超出内存上限"; break;
    case WEBKIT_WEB_PROCESS_TERMINATED_BY_API: which = "被 API 终止"; break;
    default: break;
    }
    printf("M2_WEB_PROCESS_TERMINATED=%s\n", which);
    fflush(stdout);
}

static gboolean on_load_failed(WebKitWebView *view, WebKitLoadEvent event,
                               gchar *failing_uri, GError *error, gpointer user_data) {
    (void)event;
    (void)user_data;
    printf("M2_LOAD_FAILED=%s ｜ %s\n", failing_uri != NULL ? failing_uri : "(未知 URI)",
           error != NULL ? error->message : "(没有错误文本)");
    fflush(stdout);
    if (view != NULL) {
        const char *uri = webkit_web_view_get_uri(view);
        printf("M2_LOAD_FAILED_CURRENT=%s\n", uri != NULL ? uri : "(空)");
        fflush(stdout);
    }
    return FALSE; /* 交给 WebKit 自己渲染它的错误页 */
}


static gboolean probe_tick(gpointer user_data) {
    HeytaWeb *web = user_data;
    probe_attempt += 1;
    /* 探针这一发本身也要留痕：只靠回调里那行打印的话，"evaluate 从未回调"
     * 与"探针根本没跑过"在日志里长得一模一样。 */
    printf("M2_TICK#%d uri=%s visible=%d\n", probe_attempt,
           webkit_web_view_get_uri(WEBKIT_WEB_VIEW(web->widget)) != NULL
               ? webkit_web_view_get_uri(WEBKIT_WEB_VIEW(web->widget))
               : "(空)",
           gtk_widget_get_visible(web->widget));
    fflush(stdout);
    /* 壳标记每一发都补一次（幂等）：6.0 没有可连的 load-changed，
     * 而 rail 顶部给窗口控件让位的那条样式挂在这个类名上。 */
    mark_shell_class(web);
    webkit_web_view_evaluate_javascript(WEBKIT_WEB_VIEW(web->widget), PROBE_JS, -1,
                                       NULL, NULL, NULL, evaluate_done, web);
    if (web->settled) {
        printf("M2_SETTLED_AFTER=%d发\n", probe_attempt);
        fflush(stdout);
        web->probe_source = 0;
        take_snapshot_later(user_data);
        return G_SOURCE_REMOVE;
    }
    if (probe_attempt >= 24) { /* 12 秒还没落定：别再等，交给取证那一侧判红 */
        printf("M2_SETTLE_TIMEOUT=24发之后仍未落定\n");
        fflush(stdout);
        web->probe_source = 0;
        take_snapshot_later(user_data);
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

/* 壳标记在每一发探针之前**幂等**地补一次，而不是只在 `load-changed` 到 finished 时打一次：
 * 加载可以永远不来（那样事件驱动的那一次就永不发生），而类名没打上时
 * rail 顶部给窗口控件让位的那条样式就丢 —— 每一拍补一次的成本是一次 no-op。 */
static void mark_shell_class(HeytaWeb *web) {
    run_evaluate("document.documentElement.classList.add('heyta-shell');",
                 WEBKIT_WEB_VIEW(web->widget));
}

/* ── 快照取证（不依赖任何 X 截图工具）────────────────────────────────── */

static void snapshot_done(GObject *source, GAsyncResult *result, gpointer user_data) {
    HeytaWeb *web = user_data;
    (void)source;
    GError *error = NULL;
    /* 🔴 6.0 的快照给的是 **GdkTexture**，不是 4.1 那套里的 cairo_surface_t ——
     *    照着旧档写会编译不过，而"照旧档写"正是这里最容易犯的错。 */
    GdkTexture *texture = webkit_web_view_get_snapshot_finish(WEBKIT_WEB_VIEW(web->widget),
                                                              result, &error);
    const char *path = getenv("HEYTA_LINUX_SNAPSHOT");
    if (path == NULL || path[0] == '\0') {
        if (texture != NULL) g_object_unref(texture);
        return;
    }
    if (error != NULL) {
        printf("M2_SNAPSHOT_FAIL=%s\n", error->message);
        g_error_free(error);
    } else if (texture == NULL) {
        printf("M2_SNAPSHOT_FAIL=快照返回空纹理\n");
    } else {
        /* 存 PNG：走 `..._to_png_bytes` 再落盘 —— `gdk_texture_save_to_png()` 在
         * 这一版 GTK 里已在废弃序列，而本壳是 `-Werror`，废弃警告就是失败。 */
        GBytes *png = gdk_texture_save_to_png_bytes(texture);
        if (png == NULL) {
            printf("M2_SNAPSHOT_FAIL=纹理转 PNG 失败\n");
        } else {
            gsize png_len = 0;
            const void *data = g_bytes_get_data(png, &png_len);
            if (data != NULL && g_file_set_contents(path, (const char *)data, (gssize)png_len, NULL)) {
                printf("M2_SNAPSHOT=%s %ux%u\n", path, gdk_texture_get_width(texture),
                       gdk_texture_get_height(texture));
            } else {
                printf("M2_SNAPSHOT_FAIL=写 PNG 失败：%s\n", path);
            }
            g_bytes_unref(png);
        }
    }
    fflush(stdout);
    if (texture != NULL) g_object_unref(texture);
}

/* ── 组装 ─────────────────────────────────────────────────────────────── */

HeytaWeb *heyta_web_new(const char *root, GtkWidget **widget, char *errbuf, size_t errlen) {
    if (root == NULL || widget == NULL) {
        snprintf(errbuf, errlen, "参数不完整（root/widget 有一个为空）");
        return NULL;
    }

    WebKitWebContext *context = webkit_web_context_get_default();
    webkit_web_context_register_uri_scheme(context, SCHEME, on_scheme_request,
                                           (gpointer)root, NULL);

    /* 🔴 6.0 里光注册处理程序**不够**：scheme 还得在安全管理器上声明成本地/安全上下文。
     *    "安全上下文"这一档不是可选的 —— 不声明它，`crypto.subtle` 与 E2EE 那条路径
     *    在页侧直接不存在，症状是"应用起来了但同步永远不动"。
     *    ⚠️ 但它**不**解决"加载根本不启动"：今天实测那件事另有成因（门面的 JSC 上下文
     *    先于 WebView 创建），见 `heyta_web.h` 与 runbook 的 M2 那一节。 */
    WebKitSecurityManager *secmgr = webkit_web_context_get_security_manager(context);
    webkit_security_manager_register_uri_scheme_as_local(secmgr, SCHEME);
    webkit_security_manager_register_uri_scheme_as_secure(secmgr, SCHEME);
    webkit_security_manager_register_uri_scheme_as_display_isolated(secmgr, SCHEME);
    /* 🔴 还差这一档：产物里的入口脚本与 storage worker 都带 `crossorigin`/`type: module`，
     *    那是**一次真正的 CORS 请求** —— 只声明 local+secure 不够，scheme 自己必须是
     *    CORS-enabled 的（`webkit_security_manager_register_uri_scheme_as_cors_enabled`）。
     *    实测分两半：只补响应头 `Access-Control-Allow-Origin` 时主文档的模块脚本能跑，
     *    但 `new Worker(…)` 那一发**根本不会走到壳的 scheme 处理程序**（请求日志里
     *    只有 index.html / .js / .css 三发），而 `migrateLegacyOpfsSqlite` 正等在这个
     *    worker 的 `ready` 上 ⇒ 启动静默卡死（`mounted=0`、`backend=` 空、零条页侧错误）。
     *    这一档是不是它的解药，由跑完的读数说 —— 别把声明当成结论。 */
    webkit_security_manager_register_uri_scheme_as_cors_enabled(secmgr, SCHEME);
    printf("M2_SCHEME_REGISTERED=%s local+secure+isolated+cors\n", SCHEME);
    fflush(stdout);

    WebKitUserContentManager *manager = webkit_user_content_manager_new();
    /* 第三个参数是 world name（NULL = 主世界），与页侧 `window.webkit.messageHandlers`
     * 出现的位置一致 —— 4.1 没有这一参数，6.0 有。 */
    if (!webkit_user_content_manager_register_script_message_handler(manager, HANDLER_NAME,
                                                                     NULL)) {
        g_object_unref(manager);
        snprintf(errbuf, errlen, "注册消息处理器 %s 失败", HANDLER_NAME);
        return NULL;
    }

    /* 🔴 必须在**文档创建时**注入：页侧在启动那刻就定了用哪份存储。
     * 只注主框架 —— 与 macOS 那份的 `forMainFrameOnly: true` 对齐。 */
    WebKitUserScript *shim = webkit_user_script_new(
        PORT_SHIM, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
        WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
    webkit_user_content_manager_add_script(manager, shim);
    webkit_user_script_unref(shim);

    /* 取证跑法才装页侧错误收集器（它必须在文档创建期就位，晚一拍就抓不到启动异常）。 */
    if (getenv("HEYTA_WEB_PROBE") != NULL) {
        WebKitUserScript *recorder = webkit_user_script_new(
            ERROR_RECORDER, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
            WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
        webkit_user_content_manager_add_script(manager, recorder);
        webkit_user_script_unref(recorder);
        printf("M2_PAGE_ERROR_RECORDER=1\n");
        fflush(stdout);
    }

    HeytaWeb *web = calloc(1, sizeof *web);
    web->api = NULL; /* 门面由调用方在 WebView 建好之后接上，见 heyta_web.h 那条顺序 */
    snprintf(web->root, sizeof web->root, "%s", root);

    /* 先接线再放手：`g_object_unref(manager)` 之后 WebView 是唯一持有者，
     * 但信号连的是 manager 本身 —— 连晚了那个 handler 就挂在别人的生命周期上。 */
    g_signal_connect(manager, "script-message-received::" HANDLER_NAME,
                     G_CALLBACK(on_storage_message), web);

    /* 6.0 没有 `..._new_with_user_content_manager` 这一族构造器（实测只有
     * `webkit_web_view_new`），走 GObject 构造属性。显式带上 context ——
     * 自定义 scheme 是注册在**那个** context 上的，不带上就等于加载一个没人接的协议。 */
    GtkWidget *view = GTK_WIDGET(g_object_new(WEBKIT_TYPE_WEB_VIEW,
                                              "user-content-manager", manager,
                                              "web-context", context,
                                              NULL));
    g_object_unref(manager); /* WebView 持有着它 */

    web->widget = view;
    *widget = view;

    g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), web);
    g_signal_connect(view, "load-failed", G_CALLBACK(on_load_failed), web);
    g_signal_connect(view, "web-process-terminated",
                     G_CALLBACK(on_web_process_terminated), web);

    return web;
}

void heyta_web_set_api(HeytaWeb *web, HeytaApi *api) {
    if (web != NULL) web->api = api;
}

/* 🔴 加载点与门面创建点都在**这一枚函数之后**，而顺序不是风格问题：
 *    JSC 上下文先于 WebView 存在时，WebKitGTK 6.0 一次加载信号都不发
 *    （helper 进程起来了、`get_uri()` 也返回目标 URI，但文档永远不启动）。
 *    最小复现装置 `src/webview-load-probe.c`，读数在 runbook 的 M2 那一节。 */
void heyta_web_load(HeytaWeb *web) {
    if (web == NULL || web->widget == NULL) return;
    char url[1100];
    snprintf(url, sizeof url, URI_BASE "index.html");
    webkit_web_view_load_uri(WEBKIT_WEB_VIEW(web->widget), url);
    printf("WEB_ROOT=%s\nM2_URL=%s\n", web->root, url);
    fflush(stdout);
    probe_start(web);
}

GtkWidget *heyta_web_widget(HeytaWeb *web) { return web == NULL ? NULL : web->widget; }

/* 快照**不能**紧接在 load-finished 之后取 —— 那时表面还是空的，取到一张
 * 合法但全白的 PNG，而"非空白"判据恰好会被全白挡住之外的东西糊弄（§7 第 82 条那一族）。
 * 所以延后一拍，并且把尺寸一起写进证据：`M2_SNAPSHOT=<路径> <宽>x<高>`。 */
static gboolean take_snapshot_later(gpointer user_data) {
    HeytaWeb *web = user_data;
    const char *path = getenv("HEYTA_LINUX_SNAPSHOT");
    if (path == NULL || path[0] == '\0') return G_SOURCE_REMOVE;
    webkit_web_view_get_snapshot(WEBKIT_WEB_VIEW(web->widget), WEBKIT_SNAPSHOT_REGION_VISIBLE,
                                 WEBKIT_SNAPSHOT_OPTIONS_NONE, NULL, snapshot_done, web);
    return G_SOURCE_REMOVE;
}

void heyta_web_probe(HeytaWeb *web) {
    if (web == NULL) return;
    mark_shell_class(web);
}

void heyta_web_free(HeytaWeb *web) {
    if (web == NULL) return;
    /* 不 unref widget：它已经进了窗口，所有权在 GtkWindow 那一侧。
     * 这里 free 的是这个记账结构本身。 */
    free(web);
}
