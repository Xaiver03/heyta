/* 实现说明见 heyta_notify.h 文件头（四值映射 / 零新依赖 / show() 返回 false 的纪律）。 */

#include "heyta_notify.h"

#include <gio/gio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── D-Bus 的形状（freedesktop Notifications 规范）────────────────────
 *
 *   Notify(s app_name, u replaces_id, s app_icon,
 *          s summary, s body, a(s) actions, a{sv} hints, i expire_timeout) → (u id)
 *
 * expire_timeout 传 **0**：提醒不该自己消失，用户不关它就一直在 ——
 * 与"投不出去不许记账"是同一条纪律的两面。
 * actions / hints 传空数组（NULL ⇒ g_variant_new 生成空容器）：
 * 动作按钮要在页侧路由回 op-log，那是另一条线，这里不假装支持。 */
#define BUS_DEST "org.freedesktop.Notifications"
#define BUS_PATH "/org/freedesktop/Notifications"
#define APP_NAME "heyta"
/* 6h 上限是 JS 的 MAX_WAKE_SLEEP_MS 已经裁过的；这里是**防御性下限收口**，
 * 不是第二次业务判定 —— 真漂开了，症状只会是"睡过头"，挡它一眼的成本比低。 */
#define WAKE_CAP_MS (6 * 60 * 60 * 1000)

typedef enum {
    CH_UNTRIED = 0,     /* 'default'：本次运行还没试过（只作内部初值，见头文件映射） */
    CH_GRANTED = 1,     /* 通知服务器对 GetCapabilities 应了话 */
    CH_UNSUPPORTED = 2  /* 没有会话总线 / 服务不在 */
} ChannelState;

static ChannelState g_channel = CH_UNTRIED;
static GDBusConnection *g_conn = NULL; /* 进程级持有，不释放（探针的生命周期 = 进程） */

/* 掐表：全进程只许存在这一枚（heyta_notify_arm 的幂等门）。 */
static guint g_wake_source = 0;

/* ── 小工具（与 driver/host 同一族：借引擎解析，C 里不手写 JSON）──── */

static char *js_value_to_c(JSContextRef ctx, JSValueRef value) {
    if (value == NULL) return NULL;
    JSStringRef js = JSValueToStringCopy(ctx, value, NULL);
    if (js == NULL) return NULL;
    size_t size = JSStringGetMaximumUTF8CStringSize(js);
    char *buf = malloc(size);
    if (buf != NULL) JSStringGetUTF8CString(js, buf, size);
    JSStringRelease(js);
    return buf;
}

static JSValueRef engine_json_parse(JSContextRef ctx, const char *json) {
    JSObjectRef global = JSContextGetGlobalObject(ctx);
    JSStringRef json_key = JSStringCreateWithUTF8CString("JSON");
    JSValueRef json_obj = JSObjectGetProperty(ctx, global, json_key, NULL);
    JSStringRelease(json_key);
    if (json_obj == NULL || !JSValueIsObject(ctx, json_obj)) return NULL;

    JSStringRef parse_key = JSStringCreateWithUTF8CString("parse");
    JSValueRef parse_fn = JSObjectGetProperty(ctx, (JSObjectRef)json_obj, parse_key, NULL);
    JSStringRelease(parse_key);
    if (parse_fn == NULL || !JSValueIsObject(ctx, parse_fn)) return NULL;

    JSStringRef text = JSStringCreateWithUTF8CString(json != NULL ? json : "null");
    JSValueRef arg = JSValueMakeString(ctx, text);
    JSStringRelease(text);
    /* parse 抛异常（非法 JSON）时返回 NULL（exception 出参没给）⇒ 调用方按"读不到"处理。 */
    return JSObjectCallAsFunction(ctx, (JSObjectRef)parse_fn, (JSObjectRef)json_obj, 1, &arg, NULL);
}

static JSValueRef object_field(JSContextRef ctx, JSValueRef object, const char *key) {
    if (object == NULL || !JSValueIsObject(ctx, object)) return NULL;
    JSStringRef name = JSStringCreateWithUTF8CString(key);
    JSValueRef value = JSObjectGetProperty(ctx, (JSObjectRef)object, name, NULL);
    JSStringRelease(name);
    return value;
}

static char *field_string(JSContextRef ctx, JSValueRef object, const char *key) {
    JSValueRef value = object_field(ctx, object, key);
    if (value == NULL || JSValueIsNull(ctx, value) || JSValueIsUndefined(ctx, value)) return NULL;
    return js_value_to_c(ctx, value);
}

/* ── 通道探测 ─────────────────────────────────────────────────────── */

static const char *channel_status(void);
static bool port_open_settings(void);

static void probe_channel(void) {
    g_channel = CH_UNTRIED;
    GError *error = NULL;
    if (g_conn == NULL) {
        g_conn = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
        if (g_conn == NULL) {
            printf("NOTIFY_CHANNEL=unsupported bus=%s\n",
                   error != NULL ? error->message : "(unknown)");
            g_clear_error(&error);
            fflush(stdout);
            g_channel = CH_UNSUPPORTED;
            return;
        }
    }
    /* GetCapabilities 是"这台机上有没有通知服务器"的最便宜一问（不弹任何 UI）。 */
    GVariant *reply = g_dbus_connection_call_sync(
        g_conn, BUS_DEST, BUS_PATH, BUS_DEST, "GetCapabilities", NULL,
        G_VARIANT_TYPE("(as)"), G_DBUS_CALL_FLAGS_NONE, 3000, NULL, &error);
    if (error != NULL) {
        printf("NOTIFY_CHANNEL=unsupported service=%s\n", error->message);
        g_clear_error(&error);
        fflush(stdout);
        g_channel = CH_UNSUPPORTED;
        return;
    }
    g_variant_unref(reply);
    printf("NOTIFY_CHANNEL=granted\n");
    fflush(stdout);
    g_channel = CH_GRANTED;
}

/* 第一次被问到就完成探测并缓存（映射理由全文在 heyta_notify.h 文件头）。 */
static const char *channel_status(void) {
    if (g_channel == CH_UNTRIED) probe_channel();
    return g_channel == CH_GRANTED ? "granted" : "unsupported";
}

/* ── show()：一条 Notify，失败必须回 false ─────────────────────────── */

/* 交给系统的那一段。**端口与页侧那条腿共用**这一份 —— 全壳只有这里会发 Notify，
 * 于是"两条路会不会弹两遍"这个问题结构上不存在。
 * `source` 只进日志（`port` = 壳自己的循环投的，`page` = 页侧问壳要的那一次），
 * 为的是证据里能分清是哪条腿弹的。 */
static bool notify_deliver(const char *title, const char *body, const char *source) {
    bool ok = false;
    (void)channel_status(); /* 确保已探测（幂等；映射见头文件），下面的读数才是本次运行的事实 */
    if (g_channel == CH_GRANTED) {
        GError *error = NULL;
        GVariant *params = g_variant_new(
            "(susssasa{sv}i)", APP_NAME, (guint32)0, "",
            title != NULL ? title : "heyta", body != NULL ? body : "",
            NULL /* actions：空 */, NULL /* hints：空 */, (gint32)0 /* 不过期 */);
        GVariant *reply = g_dbus_connection_call_sync(
            g_conn, BUS_DEST, BUS_PATH, BUS_DEST, "Notify", params,
            G_VARIANT_TYPE("(u)"), G_DBUS_CALL_FLAGS_NONE, 5000, NULL, &error);
        if (error != NULL) {
            printf("NOTIFY_SHOW_FAIL=source=%s dbus=%s\n", source, error->message);
            g_clear_error(&error);
            /* 服务器可能半路死了：打回未探测，下一次询问会重新探（可自愈的读数）。 */
            g_channel = CH_UNTRIED;
        } else if (reply == NULL) {
            printf("NOTIFY_SHOW_FAIL=source=%s empty-reply\n", source);
            g_channel = CH_UNTRIED;
        } else {
            guint32 id = 0;
            g_variant_get(reply, "(u)", &id);
            g_variant_unref(reply);
            /* id 0 = 服务器按规范拒投（例如被用户的通知开关在服务端侧挡住）。
             * 🔴 这里必须回 false：回 true 等于替用户把这条提醒记成已投。 */
            if (id == 0) {
                printf("NOTIFY_SHOW_FAIL=source=%s server-returned-id-0\n", source);
            } else {
                printf("NOTIFY_SHOW=ok source=%s id=%u\n", source, id);
                ok = true;
            }
        }
    } else {
        printf("NOTIFY_SHOW_FAIL=source=%s channel-unsupported\n", source);
    }
    fflush(stdout);
    return ok;
}

/* ── 投递的那一发（唯一一份）──────────────────────────────────────────
 *
 * 上面那四值映射讲完了"该不该响"，这里只管"怎么响"：一条 `Notify`，
 * 失败必须回 false —— 回 true 而系统没收到，等于替用户把这条提醒记成已投。
 */
static bool notify_send(const char *title, const char *body) {
    (void)channel_status(); /* 确保已探测（幂等；映射见头文件），下面的读数才是本次运行的事实 */
    if (g_channel != CH_GRANTED) {
        printf("NOTIFY_SHOW_FAIL=channel-unsupported\n");
        fflush(stdout);
        return false;
    }
    GError *error = NULL;
    GVariant *params = g_variant_new(
        "(susssasa{sv}i)", APP_NAME, (guint32)0, "",
        title != NULL ? title : "heyta", body != NULL ? body : "",
        NULL /* actions：空 */, NULL /* hints：空 */, (gint32)0 /* 不过期 */);
    GVariant *reply = g_dbus_connection_call_sync(
        g_conn, BUS_DEST, BUS_PATH, BUS_DEST, "Notify", params,
        G_VARIANT_TYPE("(u)"), G_DBUS_CALL_FLAGS_NONE, 5000, NULL, &error);
    if (error != NULL) {
        printf("NOTIFY_SHOW_FAIL=dbus=%s\n", error->message);
        g_clear_error(&error);
        /* 服务器可能半路死了：打回未探测，下一次询问会重新探（可自愈的读数）。 */
        g_channel = CH_UNTRIED;
        fflush(stdout);
        return false;
    }
    if (reply == NULL) {
        printf("NOTIFY_SHOW_FAIL=empty-reply\n");
        g_channel = CH_UNTRIED;
        fflush(stdout);
        return false;
    }
    guint32 id = 0;
    g_variant_get(reply, "(u)", &id);
    g_variant_unref(reply);
    /* id 0 = 服务器按规范拒投（例如被用户的通知开关在服务端侧挡住）。
     * 🔴 这里必须回 false：回 true 等于替用户把这条提醒记成已投。 */
    if (id == 0) {
        printf("NOTIFY_SHOW_FAIL=server-returned-id-0\n");
        fflush(stdout);
        return false;
    }
    printf("NOTIFY_SHOW=ok id=%u\n", id);
    fflush(stdout);
    return true;
}

static bool port_show(JSContextRef ctx, JSValueRef request_value) {
    if (request_value == NULL || !JSValueIsString(ctx, request_value)) {
        printf("NOTIFY_SHOW_FAIL=bad-arg(端口契约要求 show 收 JSON 字符串)\n");
        fflush(stdout);
        return false;
    }
    char *request_json = js_value_to_c(ctx, request_value);
    JSValueRef parsed = engine_json_parse(ctx, request_json);
    free(request_json);
    char *title = field_string(ctx, parsed, "title");
    char *body = field_string(ctx, parsed, "body");
    bool ok = notify_send(title, body);
    free(title);
    free(body);
    return ok;
}

/* ── openSettings()：逐个试**已知 DE**的入口，一个都没有就回 false ─────
 *
 * 🔴 freedesktop 没有"打开通知设置"的通用 URI —— 把某一家的路径写成普适答案，
 *    症状是"别的桌面上点了没反应还回 true"。所以这是一张**候选表**：
 *    命中谁就用谁，全落空就响亮地说没有。
 * ⚠️ `g_app_info_create_command_line` 在 glib 2.91 起进废弃序列；
 *    载体（Ubuntu 24.04 = glib 2.80）上还不是警告。若将来 -Werror 因废弃红，
 *    换 `g_app_info_launch` + `G_APP_INFO_CREATE_FLAGS_…` 那一族，不要静音警告。 */

/* 起一个已知的 DE 设置程序。找不到二进制 ⇒ false（不许"启动了"再回 true）。 */
static bool spawn_program(const char *program, const char *arg) {
    char *found = g_find_program_in_path(program);
    if (found == NULL) return false;
    g_free(found);
    /* argv 里不放 NULL 之外的空串：`gnome-control-center` 收到空参数会退回总面板，
     * 那就把"直达通知那一栏"这件事悄悄做坏了。 */
    const char *argv[4];
    int argc = 0;
    argv[argc++] = program;
    if (arg != NULL && arg[0] != '\0') argv[argc++] = arg;
    argv[argc] = NULL;
    GError *error = NULL;
    /* ⚠️ 这一版的 `g_spawn_async` 在 `error` 之前多一枚 `child_pid` 出参（8 个参数）。
     * 不需要子句柄 ⇒ 传 NULL；也就不能用 `DO_NOT_REAP_CHILD`（那要求调用方负责回收，
     * 而设置程序是"起了就归桌面管"的那种子进程 —— 留着它会攒僵尸）。 */
    if (!g_spawn_async(NULL, (char **)argv, NULL, G_SPAWN_SEARCH_PATH,
                       NULL, NULL, NULL, &error)) {
        printf("REMINDER_SETTINGS_TRY=%s %s\n", program, error != NULL ? error->message : "(unknown)");
        g_clear_error(&error);
        return false;
    }
    return true;
}

static bool port_open_settings(void) {
    /* ① 通用档：谁注册了 x-scheme-handler/notifications 谁接（多数桌面没注册，试一下无害）。 */
    GError *error = NULL;
    if (g_app_info_launch_default_for_uri("notifications://", NULL, &error)) {
        printf("REMINDER_SETTINGS=ok scheme=notifications://\n");
        fflush(stdout);
        return true;
    }
    g_clear_error(&error);
    /* ②–④ 逐家已知入口（每行只对该 DE 成立，不是普适断言）。
     * 🔴 用**程序名 + 参数**而不是 desktop id：desktop id 那一族的 API
     *   （`g_desktop_app_info_new`）住在 `gio-unix-2.0`，而本壳只链 gio ——
     *   为这一格多引一份依赖不划算，而"这台机器上有没有那个二进制"本来就是
     *   这一跳真正要问的问题（`g_find_program_in_path` 直接答它）。 */
    static const struct { const char *program; const char *arg; } tries[] = {
        { "gnome-control-center", "notifications" },
        { "systemsettings", "kcm_notifications" },
        { "xfce4-settings-manager", NULL }, /* 兜底：开总面板，不假装直达 */
    };
    for (size_t i = 0; i < sizeof tries / sizeof tries[0]; ++i) {
        if (spawn_program(tries[i].program, tries[i].arg)) {
            printf("REMINDER_SETTINGS=ok program=%s\n", tries[i].program);
            fflush(stdout);
            return true;
        }
    }
    printf("REMINDER_SETTINGS=none(本机没找到任何已知 DE 的通知设置入口)\n");
    fflush(stdout);
    return false;
}

/* ── 端口注入（与 heyta_driver.c 的 install_method 同一形状）───────── */

enum PortMethod {
    PORT_AUTHORIZATION_STATUS = 1,
    PORT_REQUEST_AUTHORIZATION = 2,
    PORT_SHOW = 3,
    PORT_OPEN_SETTINGS = 4,
};

typedef struct {
    int kind;
} PortRef;

static JSValueRef port_call(JSContextRef ctx, JSObjectRef function, JSObjectRef thisObject,
                            size_t argc, const JSValueRef argv[], JSValueRef *exception) {
    (void)thisObject;
    (void)exception;
    PortRef *ref = (PortRef *)JSObjectGetPrivate(function);
    if (ref == NULL) return JSValueMakeUndefined(ctx);

    switch (ref->kind) {
    case PORT_AUTHORIZATION_STATUS:
    case PORT_REQUEST_AUTHORIZATION: {
        /* freedesktop 没有"再问一次会不一样"的询问：探测幂等，两个方法同答。
         * 留 requestAuthorization 在端口上是**契约形状**（native-bridge 的可选升级路），
         * 当前 bundle 不转发它 —— 升级因此在 authorizationStatus 里完成，见头文件。 */
        const char *status = channel_status();
        JSStringRef s = JSStringCreateWithUTF8CString(status);
        JSValueRef out = JSValueMakeString(ctx, s);
        JSStringRelease(s);
        return out;
    }
    case PORT_SHOW:
        return JSValueMakeBoolean(ctx, port_show(ctx, argc > 0 ? argv[0] : NULL));
    case PORT_OPEN_SETTINGS:
        return JSValueMakeBoolean(ctx, port_open_settings());
    default:
        return JSValueMakeUndefined(ctx);
    }
}

static void install_port_method(JSContextRef ctx, JSObjectRef target, const char *name, int kind) {
    PortRef *ref = malloc(sizeof *ref);
    ref->kind = kind;

    JSClassDefinition def = kJSClassDefinitionEmpty;
    def.className = "HeytaReminderMethod";
    def.callAsFunction = port_call;
    JSClassRef cls = JSClassCreate(&def);
    JSObjectRef fn = JSObjectMake(ctx, cls, ref);
    JSClassRelease(cls);

    JSStringRef key = JSStringCreateWithUTF8CString(name);
    JSObjectSetProperty(ctx, target, key, fn, kJSPropertyAttributeNone, NULL);
    JSStringRelease(key);
}

void heyta_notify_install_port(JSContextRef ctx) {
    JSObjectRef global = JSContextGetGlobalObject(ctx);
    JSObjectRef port = JSObjectMake(ctx, NULL, NULL);
    install_port_method(ctx, port, "authorizationStatus", PORT_AUTHORIZATION_STATUS);
    install_port_method(ctx, port, "requestAuthorization", PORT_REQUEST_AUTHORIZATION);
    install_port_method(ctx, port, "show", PORT_SHOW);
    install_port_method(ctx, port, "openSettings", PORT_OPEN_SETTINGS);

    JSStringRef key = JSStringCreateWithUTF8CString("__heytaReminderPort");
    JSObjectSetProperty(ctx, global, key, port, kJSPropertyAttributeNone, NULL);
    JSStringRelease(key);
}

/* ── 页侧那三条入口（`heyta_web.c` 的 heytaReminder 消息处理器用）─────────
 *
 * 与端口那四个方法**共用上面同一族实现**：这里不重发一条通知、不另判一次通道，
 * 只是把"引擎里的页面"与"WebView 里的页面"两种到达方式接到同一发上。
 */
const char *heyta_notify_permission(void) { return channel_status(); }

bool heyta_notify_show(const char *title, const char *body) { return notify_send(title, body); }

bool heyta_notify_open_settings(void) { return port_open_settings(); }

/* ── 掐表：全进程唯一一枚，逻辑只在这一处 ───────────────────────────── */

static gboolean wake_tick(gpointer user_data);

/* 读 JS 的 nextReminderWakeDelay()。⚠️ 走的是既有的 heyta_host_call 那一条路
 * （async/同步共用，见 heyta_host.c 文件头），不另起第二份 JS 调用通道。
 * 成功时 *out_ms >= 0 = 要睡多久；*out_ms = -1 = JS 说没有待排的（不排，防空转）。 */
static bool arm_next_wake(HeytaHost *host, long *out_ms) {
    *out_ms = -1;
    char err[1024] = {0};
    char *res = heyta_host_call(host, "nextReminderWakeDelay", "{}", err, sizeof err);
    if (res == NULL) {
        printf("REMINDERS_ARM=FAIL %s\n", err);
        fflush(stdout);
        return false;
    }
    JSContextRef ctx = heyta_host_context(host);
    JSValueRef parsed = engine_json_parse(ctx, res);
    free(res);
    JSValueRef delay = object_field(ctx, parsed, "delayMs");
    if (delay == NULL) {
        printf("REMINDERS_ARM=FAIL 结果里没有 delayMs（bundle 不是这一版的契约）\n");
        fflush(stdout);
        return false;
    }
    if (JSValueIsNull(ctx, delay) || JSValueIsUndefined(ctx, delay)) {
        printf("REMINDERS_ARM=none(没有未来待排的提醒)\n");
        fflush(stdout);
        return true;
    }
    double ms = JSValueToNumber(ctx, delay, NULL);
    if (ms < 0.0) ms = 0.0;
    if (ms > (double)WAKE_CAP_MS) ms = (double)WAKE_CAP_MS;
    *out_ms = (long)ms;
    g_wake_source = g_timeout_add((guint)*out_ms, wake_tick, host);
    printf("REMINDERS_ARM=%ld\n", *out_ms);
    fflush(stdout);
    return true;
}

static gboolean wake_tick(gpointer user_data) {
    HeytaHost *host = (HeytaHost *)user_data;
    g_wake_source = 0; /* 这一发正在执行；重排由下面这一处（唯一的）完成 */

    char err[1024] = {0};
    char *res = heyta_host_call(host, "deliverReminders", "{}", err, sizeof err);
    if (res != NULL) {
        printf("REMINDERS_PASS=%s\n", res);
        free(res);
    } else {
        /* 失败要说出来（"卡在启动"那一族的教训）：门面无宿主可投（close 之后 / 没 open）
         * 走这一条 —— 一次就停，不刷屏、也不假装绿。 */
        printf("REMINDERS_PASS=FAIL %s\n", err);
    }
    fflush(stdout);

    /* 重排只发生在这一处：JS 说没有待排的（-1）就**不排** ——
     * 与 startForegroundReminderLoop 的 arm() 同一语义，防空转。 */
    long ms = -1;
    (void)arm_next_wake(host, &ms);
    return G_SOURCE_REMOVE;
}

void heyta_notify_arm(HeytaHost *host) {
    if (host == NULL) return;
    if (g_wake_source != 0) return; /* 幂等门：全进程只许一枚这一族的定时器 */
    /* "bridge 开开后各跑一次"= 0ms 的第一发；后续重排全部发生在 wake_tick 里。 */
    g_wake_source = g_timeout_add(0, wake_tick, host);
}

void heyta_notify_disarm(void) {
    if (g_wake_source != 0) {
        g_source_remove(g_wake_source);
        g_wake_source = 0;
    }
}

/* ── 页侧那条腿（`heytaReminder` 消息通道）─────────────────────────────
 *
 * 三个入口与上面那四个端口方法是**同一份实现**（`notify_deliver` 只有一处会发 Notify），
 * 区别只在入参已经是普通 C 字符串 —— 消息由 WebKit 的 JSC 取出来，这里不再解析一遍。
 * ⚠️ 语义与判据一条都不改：读不到通道就报 `unsupported`（不是 `denied`），
 *    弹不出去就回 `false`（页侧因此**不写** `firedAt`，下一轮还会再试）。 */

const char *heyta_notify_page_permission(void) {
    /* freedesktop 没有 per-app 的批准开关，所以这一问就是探测本身（映射理由见文件头）。 */
    return channel_status();
}

bool heyta_notify_page_open_settings(void) { return port_open_settings(); }

bool heyta_notify_page_show(const char *occurrence_id, const char *title, const char *body) {
    /* occurrence_id 只进日志：系统那侧的去重靠 `Tag`/`replaces_id`，
     * 而真正的去重在页侧（`shown` 认领 + `firedAt` 回执），这里不重复实现一遍。 */
    printf("REMINDER_PAGE_SHOW=requested id=%s\n", occurrence_id != NULL ? occurrence_id : "");
    fflush(stdout);
    bool ok = notify_deliver(title, body, "page");
    printf("REMINDER_PAGE_SHOW=delivered=%s permission=%s\n", ok ? "true" : "false", channel_status());
    fflush(stdout);
    return ok;
}
