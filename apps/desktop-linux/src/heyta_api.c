#include "heyta_api.h"

#include "heyta_host.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct HeytaApi {
    HeytaHost *host;
};

/* ── 借引擎解析结果（不在 C 里手写 JSON）──────────────────────────── */

/* JSON 文本 → JS 值。 */
static JSValueRef parse_json(HeytaApi *api, const char *json) {
    JSContextRef ctx = heyta_host_context(api->host);
    JSObjectRef global = JSContextGetGlobalObject(ctx);
    JSStringRef json_key = JSStringCreateWithUTF8CString("JSON");
    JSValueRef json_obj = JSObjectGetProperty(ctx, global, json_key, NULL);
    JSStringRelease(json_key);
    if (json_obj == NULL || !JSValueIsObject(ctx, json_obj)) return NULL;

    JSStringRef parse_key = JSStringCreateWithUTF8CString("parse");
    JSValueRef parse_fn = JSObjectGetProperty(ctx, (JSObjectRef)json_obj, parse_key, NULL);
    JSStringRelease(parse_key);
    if (parse_fn == NULL || !JSValueIsObject(ctx, parse_fn)) return NULL;

    JSStringRef text = JSStringCreateWithUTF8CString(json);
    JSValueRef arg = JSValueMakeString(ctx, text);
    JSStringRelease(text);
    return JSObjectCallAsFunction(ctx, (JSObjectRef)parse_fn, (JSObjectRef)json_obj, 1, &arg, NULL);
}

static JSValueRef object_field(HeytaApi *api, JSValueRef object, const char *key) {
    if (object == NULL || !JSValueIsObject(heyta_host_context(api->host), object)) return NULL;
    JSContextRef ctx = heyta_host_context(api->host);
    JSStringRef name = JSStringCreateWithUTF8CString(key);
    JSValueRef value = JSObjectGetProperty(ctx, (JSObjectRef)object, name, NULL);
    JSStringRelease(name);
    return value;
}

static char *field_string(HeytaApi *api, JSValueRef object, const char *key) {
    JSValueRef value = object_field(api, object, key);
    JSContextRef ctx = heyta_host_context(api->host);
    if (value == NULL || JSValueIsNull(ctx, value) || JSValueIsUndefined(ctx, value)) return NULL;
    JSStringRef js = JSValueToStringCopy(ctx, value, NULL);
    size_t size = JSStringGetMaximumUTF8CStringSize(js);
    char *out = malloc(size);
    JSStringGetUTF8CString(js, out, size);
    JSStringRelease(js);
    return out;
}

/* 拼一个只含一个字符串字段的参数对象，例如 {"title":"..."}。
 * 转义**只有 heyta_js_string_literal 一份** —— 这里以前自己抄了一遍，
 * 而且抄漏了 < 0x20 的控制字符（标题里真有控制字符时拼出的是**非法 JSON**）。 */
static char *arg_with_string(const char *key, const char *value) {
    char *literal = heyta_js_string_literal(value);
    size_t need = strlen(key) + strlen(literal) + 16;
    char *out = malloc(need);
    snprintf(out, need, "{\"%s\":%s}", key, literal);
    free(literal);
    return out;
}

/* ── 生命周期 ───────────────────────────────────────────────────── */

HeytaApi *heyta_api_create(const char *bundle_path, const char *db_path,
                           char *errbuf, size_t errlen) {
    HeytaHost *host = heyta_host_create(bundle_path, db_path, errbuf, errlen);
    if (host == NULL) return NULL;
    HeytaApi *api = calloc(1, sizeof *api);
    if (api == NULL) {
        snprintf(errbuf, errlen, "内存不足");
        heyta_host_destroy(host);
        return NULL;
    }
    api->host = host;
    return api;
}

bool heyta_api_open(HeytaApi *api, const char *db_path, char *out, size_t out_len,
                    char *errbuf, size_t errlen) {
    char *arg = arg_with_string("dbPath", db_path);
    char *result = heyta_host_call(api->host, "open", arg, errbuf, errlen);
    free(arg);
    if (result == NULL) return false;

    JSValueRef parsed = parse_json(api, result);
    char *client_id = field_string(api, parsed, "clientId");
    free(result);
    if (client_id == NULL) {
        snprintf(errbuf, errlen, "open 的结果里没有 clientId");
        return false;
    }
    snprintf(out, out_len, "%s", client_id);
    free(client_id);
    return true;
}

bool heyta_api_list_tasks(HeytaApi *api, HeytaTaskList *out, char *errbuf, size_t errlen) {
    out->items = NULL;
    out->count = 0;

    char *result = heyta_host_call(api->host, "listTasks", "{}", errbuf, errlen);
    if (result == NULL) return false;

    JSContextRef ctx = heyta_host_context(api->host);
    JSValueRef parsed = parse_json(api, result);
    free(result);
    JSValueRef tasks = object_field(api, parsed, "tasks");
    if (tasks == NULL || !JSValueIsArray(ctx, tasks)) {
        snprintf(errbuf, errlen, "listTasks 的结果里没有 tasks 数组");
        return false;
    }

    /* 🔴 `JSObjectGetArrayLength` 是 **macOS 专有**的（Linux 的 JSC 没有）。
     *    读 `length` 属性两端都能用，而且语义一样。 */
    JSStringRef length_key = JSStringCreateWithUTF8CString("length");
    JSValueRef length_value = JSObjectGetProperty(ctx, (JSObjectRef)tasks, length_key, NULL);
    JSStringRelease(length_key);
    unsigned count = (unsigned)JSValueToNumber(ctx, length_value, NULL);
    HeytaTask *items = calloc(count > 0 ? count : 1, sizeof *items);
    if (items == NULL) {
        snprintf(errbuf, errlen, "内存不足");
        return false;
    }

    for (unsigned i = 0; i < count; ++i) {
        JSValueRef item = JSObjectGetPropertyAtIndex(ctx, (JSObjectRef)tasks, i, NULL);
        items[i].id = field_string(api, item, "id");
        items[i].title = field_string(api, item, "title");
        JSValueRef done = object_field(api, item, "done");
        items[i].done = (done != NULL) && JSValueToBoolean(ctx, done);
    }

    out->items = items;
    out->count = count;
    return true;
}

bool heyta_api_add_task(HeytaApi *api, const char *title, char *out, size_t out_len,
                        char *errbuf, size_t errlen) {
    char *arg = arg_with_string("title", title);
    char *result = heyta_host_call(api->host, "addTask", arg, errbuf, errlen);
    free(arg);
    if (result == NULL) return false;

    JSValueRef parsed = parse_json(api, result);
    char *id = field_string(api, parsed, "id");
    free(result);
    if (id == NULL) {
        snprintf(errbuf, errlen, "addTask 的结果里没有 id");
        return false;
    }
    snprintf(out, out_len, "%s", id);
    free(id);
    return true;
}

/* 拼 {"<key>":"<value>","<bool_key>":true|false} */
static char *arg_string_and_bool(const char *key, const char *value,
                                 const char *bool_key, bool flag) {
    char *base = arg_with_string(key, value);          /* {"key":"value"} */
    size_t need = strlen(base) + strlen(bool_key) + 32;
    char *out = malloc(need);
    size_t len = strlen(base);
    base[len - 1] = '\0';                             /* 去掉末尾的 '}' */
    snprintf(out, need, "%s,\"%s\":%s}", base, bool_key, flag ? "true" : "false");
    free(base);
    return out;
}

bool heyta_api_set_task_done(HeytaApi *api, const char *id, bool done,
                             char *errbuf, size_t errlen) {
    char *arg = arg_string_and_bool("id", id, "done", done);
    char *result = heyta_host_call(api->host, "setTaskDone", arg, errbuf, errlen);
    free(arg);
    if (result == NULL) return false;
    free(result);
    return true;
}

bool heyta_api_remove_task(HeytaApi *api, const char *id, char *errbuf, size_t errlen) {
    char *arg = arg_with_string("id", id);
    char *result = heyta_host_call(api->host, "removeTask", arg, errbuf, errlen);
    free(arg);
    if (result == NULL) return false;
    free(result);
    return true;
}

/* ── M2：把壳变成**页侧真应用**的存储宿主 ─────────────────────────────
 *
 * 与 macOS 的 `ShellStorageHost` / Windows 的 `AppStorageHost` 同一形状，
 * 也只守那三条：只开 store 不建引擎、**不解析任何协议字段**、失败要说出来。
 */

/* `HeytaApp.openOpLog()`：打开库但**不建引擎**（引擎归页侧；两个引擎同库会各自为政）。
 * 幂等由 TS 保证。返回库自己那个 clientId（它是 LWW 的决胜依据，不许壳另算一个）。 */
bool heyta_api_open_store(HeytaApi *api, char *out, size_t out_len,
                          char *errbuf, size_t errlen) {
    char *result = heyta_host_call(api->host, "openOpLog", "{}", errbuf, errlen);
    if (result == NULL) return false;
    bool ok = false;
    JSValueRef parsed = parse_json(api, result);
    char *client_id = field_string(api, parsed, "clientId");
    if (client_id != NULL) {
        snprintf(out, out_len, "%s", client_id);
        ok = true;
    } else {
        snprintf(errbuf, errlen, "openOpLog 返回了但没有 clientId：%s", result);
    }
    free(client_id);
    free(result);
    return ok;
}

/* 把页侧经宿主边界发来的一条消息原样交给 TS，并把 TS 决定要回推的那些串
 * **原样**取回（`{"outboundJson":[...]}` 这段文本，壳不拆它）。
 * 壳若在 C 里拆 `outboundJson` 里的每一条，就等于在第三语言再实现一遍协议。 */
bool heyta_api_handle_host_message(HeytaApi *api, const char *message_json,
                                   char *out, size_t out_len,
                                   char *errbuf, size_t errlen) {
    char *arg = arg_with_string("messageJson", message_json);
    char *result = heyta_host_call(api->host, "handleHostMessage", arg, errbuf, errlen);
    free(arg);
    if (result == NULL) return false;
    if (strlen(result) + 1 > out_len) {
        snprintf(errbuf, errlen, "回推内容超出缓冲（%zu 字节 > %zu）", strlen(result), out_len);
        free(result);
        return false;
    }
    snprintf(out, out_len, "%s", result);
    free(result);
    return true;
}

void heyta_task_list_free(HeytaTaskList *list) {
    if (list == NULL) return;
    for (size_t i = 0; i < list->count; ++i) {
        free(list->items[i].id);
        free(list->items[i].title);
    }
    free(list->items);
    list->items = NULL;
    list->count = 0;
}

void heyta_api_destroy(HeytaApi *api) {
    if (api == NULL) return;
    heyta_host_destroy(api->host);
    free(api);
}
