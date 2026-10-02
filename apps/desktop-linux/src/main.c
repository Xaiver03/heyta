/*
 * Linux 原生壳的**窗口**（GTK4）。
 *
 * ⚠️ 这个文件不负责 UI 的适配与统一 —— 那是另一条线在做。
 *    它只做三件事：把窗口搭起来、把事件转成 AppApi 调用、把错误显示出来。
 *    **一行业务规则都不许写在这里**（排序/完成态/派生视图都在 TS 那一侧）。
 *
 * 无头验证：`HEYTA_EXIT_AFTER_MS=<毫秒>` 时窗口起来后自动退出，
 * 这样在 Xvfb 里可以**确定性地**跑完一轮再截图（见 README §4）。
 */

#include "heyta_api.h"
/* 设计系统 token（P0-7）：GTK CSS 的内嵌形态（packages/design-system 生成，
 * Makefile 用 -I 指到 generated/）。此前这个壳零 token 接入 —— 界面外观
 * 完全跟随 Adwaita 系统主题，与 heyta 的设计语言无关。 */
#include "heyta-tokens.h"

#include <gtk/gtk.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
    HeytaApi *api;
    GtkWidget *window;
    GtkWidget *entry;
    GtkWidget *list;
    GtkWidget *status;
    GtkWidget *footer;
} Shell;

static const char *bundle_path(void) {
    const char *from_env = getenv("HEYTA_BRIDGE_BUNDLE");
    if (from_env != NULL && from_env[0] != '\0') return from_env;
    return "native-bridge.js"; /* 与 exe 同目录（构建时拷过去）；也可用环境变量覆盖 */
}

static char *database_path(void) {
    const char *home = getenv("HOME");
    if (home == NULL) home = "/tmp";
    char dir[512];
    snprintf(dir, sizeof dir, "%s/.local/share/heyta", home);
    char cmd[600];
    snprintf(cmd, sizeof cmd, "mkdir -p '%s'", dir);
    if (system(cmd) != 0) { /* 让后面的 open 去报错 */ }
    char *path = malloc(600);
    snprintf(path, 600, "%s/heyta.sqlite", dir);
    return path;
}

/* 清空 ListBox（GTK4 用 remove 逐个删）。 */
static void clear_list(GtkWidget *list) {
    GtkWidget *child = gtk_widget_get_first_child(list);
    while (child != NULL) {
        GtkWidget *next = gtk_widget_get_next_sibling(child);
        gtk_list_box_remove(GTK_LIST_BOX(list), child);
        child = next;
    }
}

static void refresh(Shell *shell);

static void on_toggle(GtkCheckButton *button, gpointer user_data) {
    (void)user_data;
    Shell *shell = g_object_get_data(G_OBJECT(button), "heyta-shell");
    const char *id = g_object_get_data(G_OBJECT(button), "heyta-id");
    if (shell == NULL || id == NULL) return;

    char err[2048] = {0};
    bool done = gtk_check_button_get_active(button);
    if (!heyta_api_set_task_done(shell->api, id, done, err, sizeof err)) {
        gtk_label_set_text(GTK_LABEL(shell->status), err);
    }
    refresh(shell);
}

static void on_delete(GtkButton *button, gpointer user_data) {
    (void)user_data;
    Shell *shell = g_object_get_data(G_OBJECT(button), "heyta-shell");
    const char *id = g_object_get_data(G_OBJECT(button), "heyta-id");
    if (shell == NULL || id == NULL) return;

    char err[2048] = {0};
    if (!heyta_api_remove_task(shell->api, id, err, sizeof err)) {
        gtk_label_set_text(GTK_LABEL(shell->status), err);
    }
    refresh(shell);
}

static void refresh(Shell *shell) {
    clear_list(shell->list);

    char err[2048] = {0};
    HeytaTaskList tasks = {0};
    if (!heyta_api_list_tasks(shell->api, &tasks, err, sizeof err)) {
        gtk_label_set_text(GTK_LABEL(shell->status), err);
        return;
    }

    for (size_t i = 0; i < tasks.count; ++i) {
        GtkWidget *row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
        gtk_widget_set_margin_top(row, 4);
        gtk_widget_set_margin_bottom(row, 4);

        GtkWidget *toggle = gtk_check_button_new();
        gtk_check_button_set_active(GTK_CHECK_BUTTON(toggle), tasks.items[i].done);
        g_object_set_data(G_OBJECT(toggle), "heyta-shell", shell);
        g_object_set_data_full(G_OBJECT(toggle), "heyta-id", g_strdup(tasks.items[i].id), g_free);
        g_signal_connect(toggle, "toggled", G_CALLBACK(on_toggle), NULL);
        gtk_box_append(GTK_BOX(row), toggle);

        GtkWidget *label = gtk_label_new(tasks.items[i].title != NULL ? tasks.items[i].title : "");
        gtk_label_set_xalign(GTK_LABEL(label), 0.0f);
        gtk_widget_set_hexpand(label, TRUE);
        gtk_box_append(GTK_BOX(row), label);

        GtkWidget *remove = gtk_button_new_with_label("删除");
        g_object_set_data(G_OBJECT(remove), "heyta-shell", shell);
        g_object_set_data_full(G_OBJECT(remove), "heyta-id", g_strdup(tasks.items[i].id), g_free);
        g_signal_connect(remove, "clicked", G_CALLBACK(on_delete), NULL);
        gtk_box_append(GTK_BOX(row), remove);

        gtk_list_box_append(GTK_LIST_BOX(shell->list), row);
    }

    gtk_label_set_text(GTK_LABEL(shell->status),
                       tasks.count == 0 ? "还没有任务。上面写一条试试。" : "");
    heyta_task_list_free(&tasks);
}

static void on_add(GtkButton *button, gpointer user_data) {
    (void)button;
    Shell *shell = user_data;
    const char *text = gtk_editable_get_text(GTK_EDITABLE(shell->entry));
    if (text == NULL || text[0] == '\0') return;

    char err[2048] = {0};
    char id[128] = {0};
    if (!heyta_api_add_task(shell->api, text, id, sizeof id, err, sizeof err)) {
        gtk_label_set_text(GTK_LABEL(shell->status), err);
        return;
    }
    gtk_editable_set_text(GTK_EDITABLE(shell->entry), "");
    refresh(shell);
}

static void on_entry_activate(GtkEntry *entry, gpointer user_data) {
    (void)entry;
    on_add(NULL, user_data);
}

static gboolean report_window_evidence(gpointer user_data) {
    Shell *shell = user_data;
    printf("WINDOW_TITLE=%s\n", gtk_window_get_title(GTK_WINDOW(shell->window)));
    printf("WINDOW_SIZE=%dx%d\n", gtk_widget_get_width(shell->window),
           gtk_widget_get_height(shell->window));
    fflush(stdout);
    return G_SOURCE_REMOVE;
}

static gboolean quit_cb(gpointer user_data) {
    gtk_window_close(GTK_WINDOW(user_data));
    return G_SOURCE_REMOVE;
}

/* 设计系统 token（P0-7）：把生成的 CSS 挂到默认 display。
 * 版本分流：4.12 起 load_from_data 进了废弃序列（本壳 -Werror，废弃警告
 * 即失败），load_from_string 从 4.12 起可用；更老的 GTK 走 data + 长度。
 * 失败不静默：GTK 解析不了的规则只会打日志，样式类挂不上时窗口仍是
 * 可用的 —— 但 @define-color 全量色板在这里一次性挂好。 */
static void load_design_tokens(void) {
    GtkCssProvider *provider = gtk_css_provider_new();
#if GTK_CHECK_VERSION(4, 12, 0)
    gtk_css_provider_load_from_string(provider, HEYTA_TOKENS_CSS);
#else
    gtk_css_provider_load_from_data(provider, (const guint8 *)HEYTA_TOKENS_CSS, -1);
#endif
    gtk_style_context_add_provider_for_display(
        gdk_display_get_default(), GTK_STYLE_PROVIDER(provider),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(provider);
}

static void activate(GtkApplication *app, gpointer user_data) {
    Shell *shell = user_data;

    load_design_tokens();

    shell->window = gtk_application_window_new(app);
    gtk_widget_add_css_class(shell->window, "heyta-window");
    gtk_window_set_title(GTK_WINDOW(shell->window), "heyta");
    gtk_window_set_default_size(GTK_WINDOW(shell->window), 900, 560);

    GtkWidget *root = gtk_box_new(GTK_ORIENTATION_VERTICAL, 12);
    gtk_widget_set_margin_top(root, 24);
    gtk_widget_set_margin_bottom(root, 24);
    gtk_widget_set_margin_start(root, 24);
    gtk_widget_set_margin_end(root, 24);
    gtk_window_set_child(GTK_WINDOW(shell->window), root);

    GtkWidget *title = gtk_label_new("heyta");
    gtk_label_set_xalign(GTK_LABEL(title), 0.0f);
    gtk_widget_add_css_class(title, "title-1");
    gtk_widget_add_css_class(title, "heyta-title");
    gtk_box_append(GTK_BOX(root), title);

    GtkWidget *subtitle = gtk_label_new("Linux 原生壳 · 界面是 GTK4，逻辑与存储是与 web / mobile 同一份 TS");
    gtk_label_set_xalign(GTK_LABEL(subtitle), 0.0f);
    gtk_widget_add_css_class(subtitle, "dim-label");
    gtk_widget_add_css_class(subtitle, "heyta-dim");
    gtk_box_append(GTK_BOX(root), subtitle);

    GtkWidget *input_row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    shell->entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(shell->entry), "写点什么，回车添加");
    gtk_widget_set_hexpand(shell->entry, TRUE);
    g_signal_connect(shell->entry, "activate", G_CALLBACK(on_entry_activate), shell);
    gtk_box_append(GTK_BOX(input_row), shell->entry);

    GtkWidget *add = gtk_button_new_with_label("添加");
    gtk_widget_add_css_class(add, "suggested-action");
    g_signal_connect(add, "clicked", G_CALLBACK(on_add), shell);
    gtk_box_append(GTK_BOX(input_row), add);
    gtk_box_append(GTK_BOX(root), input_row);

    shell->status = gtk_label_new("");
    gtk_label_set_xalign(GTK_LABEL(shell->status), 0.0f);
    gtk_box_append(GTK_BOX(root), shell->status);

    GtkWidget *scroller = gtk_scrolled_window_new();
    gtk_widget_set_vexpand(scroller, TRUE);
    shell->list = gtk_list_box_new();
    gtk_list_box_set_selection_mode(GTK_LIST_BOX(shell->list), GTK_SELECTION_NONE);
    gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(scroller), shell->list);
    gtk_box_append(GTK_BOX(root), scroller);

    shell->footer = gtk_label_new("");
    gtk_label_set_xalign(GTK_LABEL(shell->footer), 0.0f);
    gtk_widget_add_css_class(shell->footer, "dim-label");
    gtk_widget_add_css_class(shell->footer, "heyta-dim");
    gtk_box_append(GTK_BOX(root), shell->footer);

    /* ── 初始化：失败必须显示出来（空白窗口是最难排查的失败形态）── */
    char err[2048] = {0};
    char client_id[128] = {0};
    const char *bundle = bundle_path();
    char *db = database_path();

    shell->api = heyta_api_create(bundle, db, err, sizeof err);
    if (shell->api == NULL) {
        char message[2400];
        snprintf(message, sizeof message, "初始化失败：%s", err);
        gtk_label_set_text(GTK_LABEL(shell->status), message);
        gtk_widget_set_sensitive(shell->entry, FALSE);
        gtk_widget_set_sensitive(add, FALSE);
    } else if (!heyta_api_open(shell->api, db, client_id, sizeof client_id, err, sizeof err)) {
        char message[2400];
        snprintf(message, sizeof message, "初始化失败：%s", err);
        gtk_label_set_text(GTK_LABEL(shell->status), message);
    } else {
        char footer[900];
        snprintf(footer, sizeof footer, "库：%s　设备：%s", db, client_id);
        gtk_label_set_text(GTK_LABEL(shell->footer), footer);
        refresh(shell);
    }
    free(db);

    gtk_window_present(GTK_WINDOW(shell->window));

    /* 证据：窗口尺寸要**等它真的被分配之后**再取 —— 刚 `present` 完拿到的是 0x0。
     * （第一版就是立刻打印，结果证据行写着 `WINDOW_SIZE=0x0`；
     *   截图明明是好的，但那行"证据"是假的 —— 宁可不打印，也不打印一个假值。） */
    g_timeout_add(600, report_window_evidence, shell);

    const char *exit_after = getenv("HEYTA_EXIT_AFTER_MS");
    if (exit_after != NULL && exit_after[0] != '\0') {
        g_timeout_add((guint)atoi(exit_after), quit_cb, shell->window);
    }
}

int main(int argc, char **argv) {
    if (access(bundle_path(), R_OK) != 0) {
        fprintf(stderr,
                "❌ 找不到 bundle：%s\n"
                "   先跑：node packages/app-host/scripts/build-native-bridge.mjs\n"
                "   并设 HEYTA_BRIDGE_BUNDLE=<路径>\n",
                bundle_path());
        return 1;
    }

    Shell shell;
    memset(&shell, 0, sizeof shell);

    GtkApplication *app = gtk_application_new("cloud.finlaw.heyta", G_APPLICATION_DEFAULT_FLAGS);
    g_signal_connect(app, "activate", G_CALLBACK(activate), &shell);
    int status = g_application_run(G_APPLICATION(app), argc, argv);

    if (shell.api != NULL) heyta_api_destroy(shell.api);
    g_object_unref(app);
    return status;
}
