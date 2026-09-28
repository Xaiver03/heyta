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

void heyta_task_list_free(HeytaTaskList *list);
void heyta_api_destroy(HeytaApi *api);

#endif /* HEYTA_API_H */
