#include "heyta_host.h"

#include "heyta_driver.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct HeytaHost {
    JSGlobalContextRef ctx;
    HeytaDriver *driver;
};

static char *xstrdup(const char *s) {
    if (s == NULL) return NULL;
    size_t n = strlen(s) + 1;
    char *out = malloc(n);
    if (out != NULL) memcpy(out, s, n);
    return out;
}

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

/* 把 C 字符串嵌成 JS **字符串字面量**：用 JSON 编码（JSON 字符串正好是合法 JS 字面量），
 * 这样引号、反斜杠、换行、非 ASCII 都不会把脚本拼坏。
 * 非 ASCII 可打印字节原样透传（UTF-8 本身是合法 JS 源码），< 0x20 的控制字符转 \uXXXX。
 * 这一份是**唯一**的转义实现：UI 层往 WebView 回推响应时用它，别再抄第二份。 */
char *heyta_js_string_literal(const char *text) {
    /* 借引擎做：先构造一个 JS 字符串值，再用 JS_QuoteString？—— 直接用 JSON.stringify。 */
    size_t need = strlen(text) * 6 + 8;
    char *out = malloc(need);
    if (out == NULL) return xstrdup("\"\"");
    size_t k = 0;
    out[k++] = '"';
    for (const unsigned char *p = (const unsigned char *)text; *p != '\0'; ++p) {
        switch (*p) {
        case '"':  out[k++] = '\\'; out[k++] = '"';  break;
        case '\\': out[k++] = '\\'; out[k++] = '\\'; break;
        case '\n': out[k++] = '\\'; out[k++] = 'n';  break;
        case '\r': out[k++] = '\\'; out[k++] = 'r';  break;
        case '\t': out[k++] = '\\'; out[k++] = 't';  break;
        default:
            if (*p < 0x20) {
                k += (size_t)snprintf(out + k, need - k, "\\u%04x", *p);
            } else {
                out[k++] = (char)*p;   /* UTF-8 原样透传 */
            }
        }
    }
    out[k++] = '"';
    out[k] = '\0';
    return out;
}

static JSValueRef global_property(HeytaHost *host, const char *name) {
    JSObjectRef global = JSContextGetGlobalObject(host->ctx);
    JSStringRef key = JSStringCreateWithUTF8CString(name);
    JSValueRef value = JSObjectGetProperty(host->ctx, global, key, NULL);
    JSStringRelease(key);
    return value;
}

HeytaHost *heyta_host_create(const char *bundle_path, const char *db_path,
                             char *errbuf, size_t errlen) {
    FILE *f = fopen(bundle_path, "rb");
    if (f == NULL) {
        snprintf(errbuf, errlen, "打不开 bundle：%s", bundle_path);
        return NULL;
    }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size <= 0) {
        fclose(f);
        snprintf(errbuf, errlen, "bundle 是空的：%s", bundle_path);
        return NULL;
    }
    char *source = malloc((size_t)size + 1);
    if (source == NULL) {
        fclose(f);
        snprintf(errbuf, errlen, "内存不足（bundle %ld 字节）", size);
        return NULL;
    }
    size_t read_bytes = fread(source, 1, (size_t)size, f);
    fclose(f);
    source[read_bytes] = '\0';

    JSGlobalContextRef ctx = JSGlobalContextCreate(NULL);
    if (ctx == NULL) {
        free(source);
        snprintf(errbuf, errlen, "建不出 JavaScriptCore 上下文");
        return NULL;
    }

    HeytaHost *host = calloc(1, sizeof *host);
    host->ctx = ctx;

    char driver_error[512] = {0};
    host->driver = heyta_driver_open(db_path, ctx, driver_error, sizeof driver_error);
    if (host->driver == NULL) {
        snprintf(errbuf, errlen, "%s", driver_error);
        free(source);
        heyta_host_destroy(host);
        return NULL;
    }
    if (!heyta_driver_install(host->driver, ctx, driver_error, sizeof driver_error)) {
        snprintf(errbuf, errlen, "%s", driver_error);
        free(source);
        heyta_host_destroy(host);
        return NULL;
    }

    /* 执行 bundle。脚本出错时 JSC 会把异常写进 exception，**必须检查** ——
     * 否则会得到一个"看起来加载成功、其实什么都没定义"的上下文。 */
    JSStringRef js_source = JSStringCreateWithUTF8CString(source);
    JSStringRef url = JSStringCreateWithUTF8CString(bundle_path);
    JSValueRef exception = NULL;
    JSEvaluateScript(ctx, js_source, NULL, url, 1, &exception);
    JSStringRelease(js_source);
    JSStringRelease(url);
    free(source);

    if (exception != NULL) {
        char *message = js_value_to_c(ctx, exception);
        snprintf(errbuf, errlen, "执行 bundle 时 JS 抛了异常：%s", message);
        free(message);
        heyta_host_destroy(host);
        return NULL;
    }

    JSValueRef app = global_property(host, "HeytaApp");
    if (app == NULL || JSValueIsUndefined(ctx, app)) {
        snprintf(errbuf, errlen, "bundle 里没有 HeytaApp —— 打包入口/globalName 不对");
        heyta_host_destroy(host);
        return NULL;
    }
    return host;
}

JSContextRef heyta_host_context(HeytaHost *host) { return host->ctx; }

char *heyta_host_call(HeytaHost *host, const char *fn, const char *arg_json,
                      char *errbuf, size_t errlen) {
    char *literal = heyta_js_string_literal(arg_json != NULL ? arg_json : "{}");

    size_t need = strlen(fn) + strlen(literal) + 512;
    char *script = malloc(need);
    snprintf(script, need,
             "globalThis.__done=false; globalThis.__r=null; globalThis.__e=null; globalThis.__es=null;"
             "(async () => {"
             "  try { globalThis.__r = JSON.stringify(await HeytaApp.%s(JSON.parse(%s))); }"
             "  catch (error) {"
             "    globalThis.__e = String((error && error.message) || error);"
             "    globalThis.__es = String((error && error.stack) || '');"
             "  }"
             "  globalThis.__done = true;"
             "})();",
             fn, literal);
    free(literal);

    JSStringRef js = JSStringCreateWithUTF8CString(script);
    JSStringRef url = JSStringCreateWithUTF8CString("heyta-call.js");
    JSValueRef exception = NULL;
    JSEvaluateScript(host->ctx, js, NULL, url, 1, &exception);
    JSStringRelease(js);
    JSStringRelease(url);
    free(script);

    if (exception != NULL) {
        char *message = js_value_to_c(host->ctx, exception);
        snprintf(errbuf, errlen, "调 %s 时脚本本身抛了异常：%s", fn, message);
        free(message);
        return NULL;
    }

    /* 有界地泵微任务：再求值一小段，制造新的入口作用域来推进队列。 */
    for (int spin = 0; spin < 1000; ++spin) {
        JSValueRef done = global_property(host, "__done");
        if (done != NULL && JSValueToBoolean(host->ctx, done)) break;
        JSStringRef pump = JSStringCreateWithUTF8CString("0");
        JSStringRef pump_url = JSStringCreateWithUTF8CString("heyta-pump.js");
        JSEvaluateScript(host->ctx, pump, NULL, pump_url, 1, NULL);
        JSStringRelease(pump);
        JSStringRelease(pump_url);
    }

    JSValueRef done = global_property(host, "__done");
    if (done == NULL || !JSValueToBoolean(host->ctx, done)) {
        snprintf(errbuf, errlen, "%s 没有落定 —— 有真正的异步 IO 在等（本壳只支持同步驱动）", fn);
        return NULL;
    }

    JSValueRef error = global_property(host, "__e");
    if (error != NULL && JSValueIsString(host->ctx, error)) {
        char *message = js_value_to_c(host->ctx, error);
        char *stack = js_value_to_c(host->ctx, global_property(host, "__es"));
        snprintf(errbuf, errlen, "HeytaApp.%s 失败：%s\n%s", fn, message, stack);
        free(message);
        free(stack);
        return NULL;
    }

    JSValueRef result = global_property(host, "__r");
    if (result == NULL || !JSValueIsString(host->ctx, result)) {
        return xstrdup("null");
    }
    return js_value_to_c(host->ctx, result);
}

void heyta_host_destroy(HeytaHost *host) {
    if (host == NULL) return;
    /* 先让门面自己收尾（关库、落盘）—— 直接销毁上下文会跳过 close。 */
    if (host->ctx != NULL && host->driver != NULL) {
        JSStringRef script = JSStringCreateWithUTF8CString(
            "try { if (globalThis.HeytaApp) HeytaApp.close(); } catch (e) {}");
        JSStringRef url = JSStringCreateWithUTF8CString("heyta-close.js");
        JSEvaluateScript(host->ctx, script, NULL, url, 1, NULL);
        JSStringRelease(script);
        JSStringRelease(url);
    }
    if (host->driver != NULL) {
        heyta_driver_close(host->driver);
        free(host->driver);
    }
    if (host->ctx != NULL) JSGlobalContextRelease(host->ctx);
    free(host);
}
