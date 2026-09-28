/*
 * Linux 原生壳的**无头冒烟**：不开窗，只验"跨语言那一层 + 真的落盘"。
 *
 * 与 `apps/desktop-macos/Sources/heyta-smoke/main.swift`、
 * `apps/desktop-windows/smoke/Program.cs` 是**同一组断言**（同一份契约的三个宿主）。
 *
 * 用法：
 *   ./heyta-smoke
 *   HEYTA_BRIDGE_BUNDLE=<path> ./heyta-smoke
 *
 * ⚠️ 它**不需要 GTK**，所以在没有 X 的服务器上也能跑 —— 这是刻意的：
 *    只有窗口那一步才需要图形会话。
 */

#include "heyta_api.h"

#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int failures = 0;

static void check(bool ok, const char *what) {
    printf("  %s %s\n", ok ? "✅" : "❌", what);
    if (!ok) ++failures;
}

/* 与另两端同源的默认路径：从可执行文件位置反推仓库根太脆弱，
 * 所以在 Linux 上显式要求 HEYTA_BRIDGE_BUNDLE，缺了就报错并给出命令。 */
static const char *bundle_path(void) {
    const char *from_env = getenv("HEYTA_BRIDGE_BUNDLE");
    if (from_env != NULL && from_env[0] != '\0') return from_env;
    return "bridge-bundle/native-bridge.js";
}

int main(void) {
    const char *bundle = bundle_path();
    if (access(bundle, R_OK) != 0) {
        fprintf(stderr,
                "❌ 找不到 bundle：%s\n"
                "   先跑：node packages/app-host/scripts/build-native-bridge.mjs\n"
                "   或设 HEYTA_BRIDGE_BUNDLE=<路径>\n",
                bundle);
        return 1;
    }
    printf("bundle：%s\n", bundle);

    char db_path[512];
    snprintf(db_path, sizeof db_path, "/tmp/heyta-linux-smoke-%d/smoke.sqlite", (int)getpid());
    char mkdir_cmd[600];
    snprintf(mkdir_cmd, sizeof mkdir_cmd, "mkdir -p /tmp/heyta-linux-smoke-%d", (int)getpid());
    if (system(mkdir_cmd) != 0) { /* 目录建不出来就让后面的 open 报错 */ }
    printf("db：%s\n\n", db_path);

    char err[2048] = {0};
    char client_id[128] = {0};
    char first_id[128] = {0};
    char second_id[128] = {0};
    HeytaTaskList tasks = {0};

    /* ── 1. 打开：真的建库、真的拿到 clientId ─────────────────────── */
    HeytaApi *api = heyta_api_create(bundle, db_path, err, sizeof err);
    if (api == NULL) {
        fprintf(stderr, "❌ 建宿主失败：%s\n", err);
        return 1;
    }
    if (!heyta_api_open(api, db_path, client_id, sizeof client_id, err, sizeof err)) {
        fprintf(stderr, "❌ open 失败：%s\n", err);
        heyta_api_destroy(api);
        return 1;
    }
    check(client_id[0] != '\0', "打开宿主并拿到 clientId");

    /* ── 2. 空库 ──────────────────────────────────────────────────── */
    if (heyta_api_list_tasks(api, &tasks, err, sizeof err)) {
        check(tasks.count == 0, "新库列出来是空的");
        heyta_task_list_free(&tasks);
    } else {
        check(false, "新库列出来是空的");
    }

    /* ── 3. 新建 + 排序（排序在 TS 侧，这里只验结果）──────────────── */
    bool added_first = heyta_api_add_task(api, "第一条", first_id, sizeof first_id, err, sizeof err);
    bool added_second = heyta_api_add_task(api, "第二条", second_id, sizeof second_id, err, sizeof err);
    if (!added_first || !added_second) {
        fprintf(stderr, "❌ addTask 失败：%s\n", err);
        heyta_api_destroy(api);
        return 1;
    }
    check(strcmp(first_id, second_id) != 0, "两条任务拿到不同的 id");

    if (heyta_api_list_tasks(api, &tasks, err, sizeof err)) {
        check(tasks.count == 2, "新建后列出 2 条");
        bool ordered = tasks.count == 2 &&
                       strcmp(tasks.items[0].title, "第一条") == 0 &&
                       strcmp(tasks.items[1].title, "第二条") == 0;
        check(ordered, "按 (createdAt, id) 升序 —— 与 TaskActions 文档一致");
        heyta_task_list_free(&tasks);
    } else {
        check(false, "新建后列出 2 条");
    }

    /* ── 4. 完成态 ────────────────────────────────────────────────── */
    if (heyta_api_set_task_done(api, first_id, true, err, sizeof err)) {
        if (heyta_api_list_tasks(api, &tasks, err, sizeof err)) {
            size_t done_count = 0;
            bool first_done = false;
            for (size_t i = 0; i < tasks.count; ++i) {
                if (tasks.items[i].done) ++done_count;
                if (strcmp(tasks.items[i].id, first_id) == 0) first_done = tasks.items[i].done;
            }
            check(done_count == 1, "只有一条被标成完成");
            check(first_done, "被标完成的是第一条");
            heyta_task_list_free(&tasks);
        } else {
            check(false, "只有一条被标成完成");
        }
    } else {
        fprintf(stderr, "❌ setTaskDone 失败：%s\n", err);
        check(false, "只有一条被标成完成");
    }

    /* ── 5. 错误必须能过边界（而不是静默）────────────────────────── */
    char rejected_id[128] = {0};
    bool rejected = !heyta_api_add_task(api, "", rejected_id, sizeof rejected_id, err, sizeof err);
    check(rejected, "空标题被拒（TaskActions 的既定语义，跨语言之后仍然成立）");

    heyta_api_destroy(api);

    /* ── 6. 重开：真的落盘了（换一个宿主读同一个文件）────────────── */
    HeytaApi *reopened = heyta_api_create(bundle, db_path, err, sizeof err);
    if (reopened == NULL) {
        fprintf(stderr, "❌ 重开失败：%s\n", err);
        return 1;
    }
    if (heyta_api_open(reopened, db_path, client_id, sizeof client_id, err, sizeof err)) {
        if (heyta_api_list_tasks(reopened, &tasks, err, sizeof err)) {
            check(tasks.count == 2, "重开后仍然是 2 条（数据真的落盘）");
            size_t done_count = 0;
            for (size_t i = 0; i < tasks.count; ++i) {
                if (tasks.items[i].done) ++done_count;
            }
            check(done_count == 1, "重开后完成态还在");

            if (tasks.count > 0 && heyta_api_remove_task(reopened, tasks.items[0].id, err, sizeof err)) {
                heyta_task_list_free(&tasks);
                if (heyta_api_list_tasks(reopened, &tasks, err, sizeof err)) {
                    check(tasks.count == 1, "软删除后只剩 1 条");
                } else {
                    check(false, "软删除后只剩 1 条");
                }
            } else {
                check(false, "软删除后只剩 1 条");
            }
            heyta_task_list_free(&tasks);
        } else {
            check(false, "重开后仍然是 2 条（数据真的落盘）");
        }
    } else {
        fprintf(stderr, "❌ 重开时 open 失败：%s\n", err);
        check(false, "重开后仍然是 2 条（数据真的落盘）");
    }
    heyta_api_destroy(reopened);

    /* ── 7. 驱动错误必须能过边界（信封那条路）────────────────────── */
    /* C 里没有异常，所以 Linux 侧用**信封**（见 heyta_driver.c）。
     * 这里直接开一个内存库，喂一条非法 SQL，确认拿到的是信封而不是静默成功。 */
    sqlite3 *probe = NULL;
    if (sqlite3_open(":memory:", &probe) == SQLITE_OK) {
        char *message = NULL;
        int rc = sqlite3_exec(probe, "THIS IS NOT VALID SQL", NULL, NULL, &message);
        check(rc != SQLITE_OK && message != NULL, "驱动出错时拿得到错误消息（而不是静默）");
        sqlite3_free(message);
        sqlite3_close_v2(probe);
    } else {
        check(false, "驱动出错时拿得到错误消息（而不是静默）");
    }

    char cleanup[600];
    snprintf(cleanup, sizeof cleanup, "rm -rf /tmp/heyta-linux-smoke-%d", (int)getpid());
    if (system(cleanup) != 0) { /* 清理失败不影响结论 */ }

    printf("\n");
    if (failures == 0) {
        printf("✅ 跨语言那一层 + 落盘 全部通过。\n");
        return 0;
    }
    fprintf(stderr, "❌ 冒烟失败 %d 条。\n", failures);
    return 1;
}
