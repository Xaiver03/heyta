/*
 * Linux 侧的 JavaScriptCore 宿主：加载**与 Windows / macOS 同一个** bundle、
 * 注入同步驱动、按名字调门面函数。
 *
 * 与 C#（Jint）/ Swift（JSC）两侧刻意保持一致的三条：
 *   1. 宿主只认识「函数名 + 一个 JSON 参数 + 一个 JSON 结果」这一种调用形状 ——
 *      新增能力 = 在 TS 那边加一个导出函数，宿主这边不改。
 *   2. 参数与结果都过 JSON 文本 ⇒ 跨语言类型映射只有一处。
 *   3. 错误回到宿主并**能被显示出来**，而不是变成一个空白窗口。
 *
 * ## 为什么这里也要"泵"微任务
 *
 * 门面的 `open()` 是 async，返回 Promise。JSC 在**最外层求值结束时**排空微任务队列，
 * 但 C API 下没有 run loop 可以转 —— 所以这里用「再求值一小段脚本」的方式
 * 制造新的入口作用域来推进队列，**有界**地泵（不是死等）。
 * macOS 那边对应的是转 RunLoop；语义相同：**不假设它一定同步完成**。
 */

#ifndef HEYTA_HOST_H
#define HEYTA_HOST_H

#include "heyta_jsengine.h"
#include <stdbool.h>
#include <stddef.h>

typedef struct HeytaHost HeytaHost;

/* 创建宿主：建上下文、装驱动、执行 bundle。
 * 失败返回 NULL 并写 errbuf（错误信息里会带上 JS 的堆栈）。 */
HeytaHost *heyta_host_create(const char *bundle_path, const char *db_path,
                             char *errbuf, size_t errlen);

/* 调 `HeytaApp.<fn>(JSON.parse(arg_json))`。
 * 成功返回结果的 JSON 文本（调用方 free）；失败返回 NULL 并写 errbuf。 */
char *heyta_host_call(HeytaHost *host, const char *fn, const char *arg_json,
                      char *errbuf, size_t errlen);

/* 供 API 层解析结果用（借同一个引擎做 JSON.parse，避免在 C 里手写解析）。 */
JSContextRef heyta_host_context(HeytaHost *host);

/* 把 C 字符串嵌成 JS **字符串字面量**（引号/反斜杠/换行/控制字符都转义，UTF-8 原样透传）。
 * 导出给 UI 层用：壳往 WebView 回推 TS 决定的响应时要走同一份转义，
 * **不许在第二处再手写一遍**（同一形状的第二份就是漂移的开始）。 */
char *heyta_js_string_literal(const char *text);

void heyta_host_destroy(HeytaHost *host);

#endif /* HEYTA_HOST_H */
