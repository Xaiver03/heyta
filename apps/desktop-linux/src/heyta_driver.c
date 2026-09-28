#include "heyta_driver.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* 信封的键。⚠️ 改它必须同步改 `packages/app-host/src/native-bridge.ts`。 */
#define DRIVER_ERROR_KEY "__heytaDriverError"

struct HeytaDriver {
    sqlite3 *db;
    JSContextRef ctx;
    JSObjectRef json_object;    /* 缓存的全局 JSON 对象 */
};

/* ── 小工具 ───────────────────────────────────────────────────────── */

static char *xstrdup(const char *s) {
    if (s == NULL) return NULL;
    size_t n = strlen(s) + 1;
    char *out = malloc(n);
    if (out != NULL) memcpy(out, s, n);
    return out;
}

/* JSStringRef → 新分配的 UTF-8 C 字符串（调用方 free）。 */
static char *js_string_to_c(JSStringRef js) {
    if (js == NULL) return xstrdup("");
    size_t size = JSStringGetMaximumUTF8CStringSize(js);
    char *buf = malloc(size);
    if (buf == NULL) return xstrdup("");
    JSStringGetUTF8CString(js, buf, size);
    return buf;
}

static char *js_value_to_c(JSContextRef ctx, JSValueRef value) {
    if (value == NULL) return xstrdup("");
    JSStringRef js = JSValueToStringCopy(ctx, value, NULL);
    char *out = js_string_to_c(js);
    JSStringRelease(js);
    return out;
}

/* 出错时构造信封。
 *
 * 🔴 **必须借引擎转义，不能 snprintf 拼。** SQLite 的错误消息里**带双引号**：
 *      near "THIS": syntax error
 *    直接拼进 JSON 会得到一个**语法坏掉**的信封；而 TS 侧的 throwIfDriverError
 *    解析失败时会当成"不是信封"而放过 —— 于是**错误被静默吞掉**，
 *    比抛异常危险得多。这里是本轮真的踩到并修掉的一个坑。
 */
static char *stringify(HeytaDriver *d, JSValueRef value);   /* 前向声明 */

static char *error_envelope(HeytaDriver *d, const char *message) {
    const char *text = (message != NULL) ? message : "unknown";
    if (d != NULL && d->ctx != NULL && d->json_object != NULL) {
        JSContextRef ctx = d->ctx;
        JSObjectRef obj = JSObjectMake(ctx, NULL, NULL);
        JSStringRef key = JSStringCreateWithUTF8CString(DRIVER_ERROR_KEY);
        JSStringRef ms = JSStringCreateWithUTF8CString(text);
        JSValueRef value = JSValueMakeString(ctx, ms);
        JSStringRelease(ms);
        JSObjectSetProperty(ctx, obj, key, value, kJSPropertyAttributeNone, NULL);
        JSStringRelease(key);
        return stringify(d, obj);
    }
    /* 引擎还没就绪（只在极早期的失败里）：宁可少给信息，也不给坏 JSON。 */
    size_t need = strlen(DRIVER_ERROR_KEY) + 48;
    char *out = malloc(need);
    if (out != NULL) snprintf(out, need, "{\"" DRIVER_ERROR_KEY "\":\"(engine not ready)\"}");
    return out;
}

/* ── 用引擎做 JSON 转换（不写 C 的 JSON 代码）────────────────────── */

/* 调全局 JSON 的某个方法（"parse" / "stringify"）。 */
static JSValueRef call_json_method(HeytaDriver *d, const char *method,
                                   size_t argc, const JSValueRef argv[]) {
    JSContextRef ctx = d->ctx;
    if (d->json_object == NULL) return NULL;

    JSStringRef name = JSStringCreateWithUTF8CString(method);
    JSValueRef fn = JSObjectGetProperty(ctx, d->json_object, name, NULL);
    JSStringRelease(name);
    if (fn == NULL || !JSValueIsObject(ctx, fn)) return NULL;

    return JSObjectCallAsFunction(ctx, (JSObjectRef)fn, d->json_object, argc, argv, NULL);
}

/* 把参数 JSON 文本（形如 "[1,\"a\"]"）解析成 JS 值。失败返回 NULL。 */
static JSValueRef parse_params(HeytaDriver *d, const char *params_json) {
    JSContextRef ctx = d->ctx;
    const char *text = (params_json == NULL) ? "[]" : params_json;
    JSStringRef js = JSStringCreateWithUTF8CString(text);
    JSValueRef value = JSValueMakeString(ctx, js);
    JSStringRelease(js);
    return call_json_method(d, "parse", 1, &value);
}

/* JS 值 → JSON 文本（调用方 free）。 */
static char *stringify(HeytaDriver *d, JSValueRef value) {
    if (value == NULL) return xstrdup("null");
    JSValueRef out = call_json_method(d, "stringify", 1, &value);
    return js_value_to_c(d->ctx, out);
}

/* ── 数 `?` 占位符（跳过单引号字符串；`''` 是转义的单引号）────────── */

static size_t count_placeholders(const char *sql) {
    size_t count = 0;
    bool in_string = false;
    for (const char *p = sql; *p != '\0'; ++p) {
        if (in_string) {
            if (*p == '\'') {
                if (p[1] == '\'') { ++p; }   /* 转义的单引号，留在字符串里 */
                else { in_string = false; }
            }
        } else if (*p == '\'') {
            in_string = true;
        } else if (*p == '?') {
            ++count;
        }
    }
    return count;
}

/* ── 准备语句并绑定参数 ─────────────────────────────────────────── */

static char *prepare_and_bind(HeytaDriver *d, const char *sql, const char *params_json,
                              sqlite3_stmt **out) {
    *out = NULL;

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(d->db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        return error_envelope(d, sqlite3_errmsg(d->db));
    }

    JSValueRef params = parse_params(d, params_json);
    size_t expected = count_placeholders(sql);
    size_t actual = 0;
    if (params != NULL && JSValueIsObject(d->ctx, params)) {
        JSObjectRef arr = (JSObjectRef)params;
        if (JSValueIsArray(d->ctx, params)) {
            /* `JSObjectGetArrayLength` 是 macOS 专有；读 length 属性两端通用 */
            JSStringRef length_key = JSStringCreateWithUTF8CString("length");
            JSValueRef length_value = JSObjectGetProperty(d->ctx, arr, length_key, NULL);
            JSStringRelease(length_key);
            actual = (size_t)JSValueToNumber(d->ctx, length_value, NULL);
        }
    }

    if (expected != actual) {
        sqlite3_finalize(stmt);
        char buf[512];
        snprintf(buf, sizeof buf,
                 "SQL 里的占位符数（%zu）与参数个数（%zu）不一致：%s", expected, actual, sql);
        return error_envelope(d, buf);
    }

    for (size_t i = 0; i < actual; ++i) {
        JSValueRef item = JSObjectGetPropertyAtIndex(d->ctx, (JSObjectRef)params, (unsigned)i, NULL);
        int index = (int)(i + 1);

        if (item == NULL || JSValueIsNull(d->ctx, item) || JSValueIsUndefined(d->ctx, item)) {
            sqlite3_bind_null(stmt, index);
        } else if (JSValueIsBoolean(d->ctx, item)) {
            /* 与另两端一致：布尔存成 0/1 */
            sqlite3_bind_int64(stmt, index, JSValueToBoolean(d->ctx, item) ? 1 : 0);
        } else if (JSValueIsNumber(d->ctx, item)) {
            double number = JSValueToNumber(d->ctx, item, NULL);
            /* 与另两端一致：整数值按 int64 绑，否则比较与索引会退化 */
            if (number == (double)(long long)number) {
                sqlite3_bind_int64(stmt, index, (long long)number);
            } else {
                sqlite3_bind_double(stmt, index, number);
            }
        } else if (JSValueIsString(d->ctx, item)) {
            char *text = js_value_to_c(d->ctx, item);
            sqlite3_bind_text(stmt, index, text, -1, SQLITE_TRANSIENT);
            free(text);
        } else {
            sqlite3_finalize(stmt);
            return error_envelope(d, "不支持的参数类型（只接受 string/number/boolean/null）");
        }
    }

    *out = stmt;
    return NULL;
}

/* ── 四个方法 ───────────────────────────────────────────────────── */

/* exec：无参数，可能多条语句。 */
static char *driver_exec(HeytaDriver *d, const char *sql) {
    char *err = NULL;
    if (sqlite3_exec(d->db, sql, NULL, NULL, &err) != SQLITE_OK) {
        char *out = error_envelope(d, err != NULL ? err : "unknown");
        sqlite3_free(err);
        return out;
    }
    return xstrdup("");
}

/* run：一条语句 + 参数，不取行。 */
static char *driver_run(HeytaDriver *d, const char *sql, const char *params_json) {
    sqlite3_stmt *stmt = NULL;
    char *err = prepare_and_bind(d, sql, params_json, &stmt);
    if (err != NULL) return err;

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE && rc != SQLITE_ROW) {
        return error_envelope(d, sqlite3_errmsg(d->db));
    }
    return xstrdup("");
}

/* all：一条语句 + 参数，行以 JSON 文本返回。
 *
 * 行是**用 JSC 的数组 API 直接建出来的** —— 不经手 C 的 JSON 转义。
 * 字符串值的转义规则因此与另两端逐字一致（都是引擎的规则）。 */
static char *driver_all(HeytaDriver *d, const char *sql, const char *params_json) {
    sqlite3_stmt *stmt = NULL;
    char *err = prepare_and_bind(d, sql, params_json, &stmt);
    if (err != NULL) return err;

    JSContextRef ctx = d->ctx;
    JSValueRef exception = NULL;
    JSObjectRef rows = JSObjectMakeArray(ctx, 0, NULL, &exception);
    if (exception != NULL) {
        sqlite3_finalize(stmt);
        return error_envelope(d, "建行数组失败");
    }

    size_t row_index = 0;
    for (;;) {
        int rc = sqlite3_step(stmt);
        if (rc == SQLITE_DONE) break;
        if (rc != SQLITE_ROW) {
            char *out = error_envelope(d, sqlite3_errmsg(d->db));
            sqlite3_finalize(stmt);
            return out;
        }

        JSObjectRef row = JSObjectMake(ctx, NULL, NULL);
        int columns = sqlite3_column_count(stmt);
        for (int c = 0; c < columns; ++c) {
            const char *name = sqlite3_column_name(stmt, c);
            JSStringRef key = JSStringCreateWithUTF8CString(name);
            JSValueRef value = NULL;

            switch (sqlite3_column_type(stmt, c)) {
            case SQLITE_NULL:
                value = JSValueMakeNull(ctx);
                break;
            case SQLITE_INTEGER:
                value = JSValueMakeNumber(ctx, (double)sqlite3_column_int64(stmt, c));
                break;
            case SQLITE_FLOAT:
                value = JSValueMakeNumber(ctx, sqlite3_column_double(stmt, c));
                break;
            case SQLITE_BLOB: {
                /* 与另两端一致：二进制以 base64 过边界。
                 * ⚠️ 目前仓库里没有一处把二进制写进库（加密是先 base64 再存的），
                 *    所以这条路径是"形状对齐"而不是"在用"。 */
                const unsigned char *blob = sqlite3_column_blob(stmt, c);
                int n = sqlite3_column_bytes(stmt, c);
                static const char *table =
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                size_t out_len = (size_t)((n + 2) / 3) * 4;
                char *b64 = malloc(out_len + 1);
                if (b64 == NULL) { value = JSValueMakeNull(ctx); break; }
                size_t k = 0;
                for (int i = 0; i < n; i += 3) {
                    unsigned v = (unsigned)blob[i] << 16;
                    if (i + 1 < n) v |= (unsigned)blob[i + 1] << 8;
                    if (i + 2 < n) v |= (unsigned)blob[i + 2];
                    b64[k++] = table[(v >> 18) & 63];
                    b64[k++] = table[(v >> 12) & 63];
                    b64[k++] = (i + 1 < n) ? table[(v >> 6) & 63] : '=';
                    b64[k++] = (i + 2 < n) ? table[v & 63] : '=';
                }
                b64[k] = '\0';
                JSStringRef s = JSStringCreateWithUTF8CString(b64);
                value = JSValueMakeString(ctx, s);
                JSStringRelease(s);
                free(b64);
                break;
            }
            default: {
                const unsigned char *text = sqlite3_column_text(stmt, c);
                JSStringRef s = JSStringCreateWithUTF8CString(text != NULL ? (const char *)text : "");
                value = JSValueMakeString(ctx, s);
                JSStringRelease(s);
                break;
            }
            }

            JSObjectSetProperty(ctx, row, key, value, kJSPropertyAttributeNone, NULL);
            JSStringRelease(key);
        }

        JSObjectSetPropertyAtIndex(ctx, rows, (unsigned)row_index, row, NULL);
        ++row_index;
    }

    sqlite3_finalize(stmt);
    return stringify(d, rows);
}

/* ── 暴露成 JS：4 个可调用对象，各自知道自己是哪一个方法 ─────────── */

enum MethodKind { METHOD_EXEC = 1, METHOD_RUN = 2, METHOD_ALL = 3, METHOD_CLOSE = 4 };

typedef struct {
    HeytaDriver *driver;
    int kind;
} MethodRef;

static JSValueRef method_call(JSContextRef ctx, JSObjectRef function, JSObjectRef thisObject,
                              size_t argc, const JSValueRef argv[], JSValueRef *exception) {
    (void)thisObject;
    (void)exception;
    MethodRef *ref = (MethodRef *)JSObjectGetPrivate(function);
    if (ref == NULL) return JSValueMakeUndefined(ctx);

    HeytaDriver *d = ref->driver;
    char *result = NULL;

    if (ref->kind == METHOD_EXEC) {
        char *sql = (argc > 0) ? js_value_to_c(ctx, argv[0]) : NULL;
        result = driver_exec(d, sql != NULL ? sql : "");
        free(sql);
    } else if (ref->kind == METHOD_RUN) {
        char *sql = (argc > 0) ? js_value_to_c(ctx, argv[0]) : NULL;
        char *params = (argc > 1) ? js_value_to_c(ctx, argv[1]) : NULL;
        result = driver_run(d, sql != NULL ? sql : "", params);
        free(sql);
        free(params);
    } else if (ref->kind == METHOD_ALL) {
        char *sql = (argc > 0) ? js_value_to_c(ctx, argv[0]) : NULL;
        char *params = (argc > 1) ? js_value_to_c(ctx, argv[1]) : NULL;
        result = driver_all(d, sql != NULL ? sql : "", params);
        free(sql);
        free(params);
    } else {
        heyta_driver_close(d);
        result = xstrdup("");
    }

    JSValueRef out = JSValueMakeUndefined(ctx);
    if (result != NULL) {
        JSStringRef s = JSStringCreateWithUTF8CString(result);
        out = JSValueMakeString(ctx, s);
        JSStringRelease(s);
        free(result);
    }
    return out;
}

static void install_method(JSContextRef ctx, JSObjectRef target, const char *name,
                           HeytaDriver *driver, int kind) {
    MethodRef *ref = malloc(sizeof *ref);
    ref->driver = driver;
    ref->kind = kind;

    JSClassDefinition def = kJSClassDefinitionEmpty;
    def.className = "HeytaSqliteMethod";
    def.callAsFunction = method_call;
    JSClassRef cls = JSClassCreate(&def);
    JSObjectRef fn = JSObjectMake(ctx, cls, ref);   /* private = ref */
    JSClassRelease(cls);

    JSStringRef key = JSStringCreateWithUTF8CString(name);
    JSObjectSetProperty(ctx, target, key, fn, kJSPropertyAttributeNone, NULL);
    JSStringRelease(key);
}

/* ── 生命周期 ───────────────────────────────────────────────────── */

HeytaDriver *heyta_driver_open(const char *path, JSContextRef ctx, char *errbuf, size_t errlen) {
    sqlite3 *db = NULL;
    int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX;
    if (sqlite3_open_v2(path, &db, flags, NULL) != SQLITE_OK) {
        if (errbuf != NULL) {
            snprintf(errbuf, errlen, "打不开 SQLite（%s）：%s", path,
                     db != NULL ? sqlite3_errmsg(db) : "unknown");
        }
        sqlite3_close_v2(db);
        return NULL;
    }

    HeytaDriver *d = calloc(1, sizeof *d);
    if (d == NULL) {
        sqlite3_close_v2(db);
        if (errbuf != NULL) snprintf(errbuf, errlen, "内存不足");
        return NULL;
    }
    d->db = db;
    d->ctx = ctx;

    /* 缓存全局 JSON 对象（参数解析与行序列化都靠它） */
    JSObjectRef global = JSContextGetGlobalObject(ctx);
    JSStringRef json_name = JSStringCreateWithUTF8CString("JSON");
    JSValueRef json_value = JSObjectGetProperty(ctx, global, json_name, NULL);
    JSStringRelease(json_name);
    if (json_value != NULL && JSValueIsObject(ctx, json_value)) {
        d->json_object = (JSObjectRef)json_value;
    }

    /* 与另两端一致的 pragma */
    char *e1 = driver_exec(d, "PRAGMA foreign_keys=ON;");
    free(e1);
    if (strcmp(path, ":memory:") != 0) {
        char *e2 = driver_exec(d, "PRAGMA journal_mode=WAL;");
        free(e2);
    }
    return d;
}

bool heyta_driver_install(HeytaDriver *driver, JSContextRef ctx, char *errbuf, size_t errlen) {
    JSObjectRef global = JSContextGetGlobalObject(ctx);
    JSObjectRef driver_object = JSObjectMake(ctx, NULL, NULL);

    install_method(ctx, driver_object, "exec", driver, METHOD_EXEC);
    install_method(ctx, driver_object, "run", driver, METHOD_RUN);
    install_method(ctx, driver_object, "all", driver, METHOD_ALL);
    install_method(ctx, driver_object, "close", driver, METHOD_CLOSE);

    JSStringRef key = JSStringCreateWithUTF8CString("__heytaDriver");
    JSObjectSetProperty(ctx, global, key, driver_object, kJSPropertyAttributeNone, NULL);
    JSStringRelease(key);

    /* 门面要的是 `globalThis.__heytaDriverFactory` 是个**函数**，
     * 而 JSC 这边暴露的是对象 —— 补一行 JS 把工厂造出来。 */
    JSStringRef script = JSStringCreateWithUTF8CString(
        "globalThis.__heytaDriverFactory = () => globalThis.__heytaDriver;");
    JSStringRef url = JSStringCreateWithUTF8CString("heyta-driver-install.js");
    JSValueRef exception = NULL;
    JSEvaluateScript(ctx, script, NULL, url, 1, &exception);
    JSStringRelease(script);
    JSStringRelease(url);

    if (exception != NULL) {
        if (errbuf != NULL) snprintf(errbuf, errlen, "注入驱动工厂时 JS 抛了异常");
        return false;
    }
    return true;
}

void heyta_driver_close(HeytaDriver *driver) {
    if (driver == NULL) return;
    if (driver->db != NULL) sqlite3_close_v2(driver->db);
    driver->db = NULL;
}
