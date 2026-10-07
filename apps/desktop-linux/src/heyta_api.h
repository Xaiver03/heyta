/*
 * Linux 壳看到的**唯一** C 侧 API。
 *
 * 与 `AppApi.cs`（C#）/ `AppApi.swift`（Swift）是同一形状：一层薄薄的类型化包装，
 * 把 JSON 结果解析成 struct。**这里不许出现任何业务规则** ——
 * 排序、完成态、派生视图都在 TS 的 `packages/app-host/src/native-bridge.ts` 里。
 *
 * ⚠️ UI 的适配与统一**不是这个壳的职责**（那是另一条线在做）。
 */

#ifndef HEYTA_API_H
#define HEYTA_API_H

#include <stdbool.h>
#include <stddef.h>

typedef struct {
    char *id;
    char *title;
    bool done;
} HeytaTask;

typedef struct {
    HeytaTask *items;
    size_t count;
} HeytaTaskList;

typedef struct HeytaApi HeytaApi;

HeytaApi *heyta_api_create(const char *bundle_path, const char *db_path,
                           char *errbuf, size_t errlen);

/* 返回设备 clientId（写进 out，调用方给足缓冲）。 */
bool heyta_api_open(HeytaApi *api, const char *db_path, char *out, size_t out_len,
                    char *errbuf, size_t errlen);

bool heyta_api_list_tasks(HeytaApi *api, HeytaTaskList *out, char *errbuf, size_t errlen);

/* 返回新建任务的 id。 */
bool heyta_api_add_task(HeytaApi *api, const char *title, char *out, size_t out_len,
                        char *errbuf, size_t errlen);

bool heyta_api_set_task_done(HeytaApi *api, const char *id, bool done,
                             char *errbuf, size_t errlen);

bool heyta_api_remove_task(HeytaApi *api, const char *id, char *errbuf, size_t errlen);

/* M2 存储宿主（与 macOS `ShellStorageHost` / Windows 那份同一形状）：
 * 只开 store、不建引擎 —— 引擎归页侧的真应用，两个引擎同库会各自为政。
 * out 拿回来的是**库里那个** clientId（LWW 的决胜依据，不许壳自己算一个）。 */
bool heyta_api_open_store(HeytaApi *api, char *out, size_t out_len,
                          char *errbuf, size_t errlen);

/* 页侧经宿主边界发来一条消息 ⇒ 交给 TS ⇒ 把 TS 决定要回推的那些串**原样**取回。
 * out 是 `{"outboundJson":[...]}` 这段文本：壳不拆它、不认 `hello`/`ready`，
 * 因为"协议只在 TS 一份实现"是本仓的既定边界（apps/desktop-windows/README §1）。 */
bool heyta_api_handle_host_message(HeytaApi *api, const char *message_json,
                                   char *out, size_t out_len,
                                   char *errbuf, size_t errlen);

void heyta_task_list_free(HeytaTaskList *list);
void heyta_api_destroy(HeytaApi *api);

#endif /* HEYTA_API_H */
