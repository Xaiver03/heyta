/*
 * Linux 侧的**同步 SQLite 驱动**，与 `packages/storage/src/sqlite/sqlite-driver.ts` 同形。
 *
 * 这是**同一个契约的第三份实现**（前两份：C# / Swift），所以前两份踩过的坑这里全部适用：
 *
 *   1. 契约用 `?` **位置**占位符 —— 要自己数 `?`，并且**跳过字符串字面量**里的 `?`，
 *      否则 `WHERE title = 'a?b'` 会被静默改坏（坏法是"多绑一个参数"，报错离现场很远）。
 *   2. 整数按 int64 绑，不能一律 double —— 否则 SQLite 的比较与索引会退化。
 *   3. 错误走**信封**（`{"__heytaDriverError":"…"}`），不抛异常 ——
 *      理由见下面「为什么不用异常」。
 *
 * ## 🔴 为什么不用异常
 *
 * macOS 那边的结论在这里同样成立、而且更硬：**C 里根本没有异常**。
 * 所以信封不是一个取舍，是唯一可行的做法。三端因此**共用同一个 TS 侧驱动包装**
 * （`native-bridge.ts` 的 `throwIfDriverError`）：有信封就拆开并 `throw`，没有就走普通返回值。
 *
 * ## 为什么没有引 JSON 库
 *
 * 驱动的边界是「参数 JSON 文本进 / 行 JSON 文本出」。在 C 里手写 JSON 解析与转义
 * 是最容易出内存与转义 bug 的地方 —— 而我们**手里就有一个 JS 引擎**。
 * 于是：参数用引擎的 `JSON.parse` 变成 JS 值，行用 JSC 的数组 API 直接建出来，
 * 再用引擎的 `JSON.stringify` 变回文本。
 *
 * ⇒ **零 JSON 代码、零额外依赖**，而且转义规则与另两端逐字一致（都是引擎的规则）。
 */

#ifndef HEYTA_DRIVER_H
#define HEYTA_DRIVER_H

#include "heyta_jsengine.h"
#include <sqlite3.h>
#include <stdbool.h>
#include <stddef.h>

typedef struct HeytaDriver HeytaDriver;

/* 打开数据库。失败返回 NULL 并写 errbuf。`path` 为 ":memory:" 时是内存库。 */
HeytaDriver *heyta_driver_open(const char *path, JSContextRef ctx, char *errbuf, size_t errlen);

/* 把驱动挂成 JS 全局对象 `__heytaDriver`，并定义 `__heytaDriverFactory`。
 * 门面要的是一个**函数**，而 JSC 这边暴露的是对象 —— 所以补一行 JS 造工厂。 */
bool heyta_driver_install(HeytaDriver *driver, JSContextRef ctx, char *errbuf, size_t errlen);

void heyta_driver_close(HeytaDriver *driver);

#endif /* HEYTA_DRIVER_H */
