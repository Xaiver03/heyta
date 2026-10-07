/*
 * M2：让 Linux 壳**加载共享 UI 产物**（`apps/web/dist`），而不是自己手写一屏。
 *
 * 依据是既定的那条决策，不是这里的偏好：
 *   `docs/plans/multi-end-unified-strategy.md` §4.3 定案 M2（原生壳 + 壳内 WebView
 *   加载 `react-native-web` 产物），§6.3-T3 第 1 条把三端手写的业务 UI 列为**要删的对象**。
 *   ⇒ 新界面进桌面 = 进 web 产物；在原生壳里再手写一份反而是违反它。
 *
 * 与 macOS（`WKWebView` + `WKURLSchemeHandler`）、Windows（`WebView2` +
 * `SetVirtualHostNameToFolderMapping`）**同一条路线、同一套协议**，只有 API 名字不同：
 *
 *   1. 用自定义 scheme `heyta-local://app/<路径>` 载产物，**不用 `file://`** ——
 *      理由与另两端逐字相同：`file://` 下没有正常 origin，service worker / fetch /
 *      module 的行为都与真浏览器不同，那样测出来的"能渲染"不代表真实形态。
 *   2. 在文档创建**之前**注入端口 shim（`window.__heytaHostStoragePort`）。
 *      晚一步就来不及：页侧在启动那刻就定了用哪份存储。
 *   3. 页侧消息 → TS（`HeytaApp.handleHostMessage`）→ 把 TS 决定的**每一串**回推。
 *      🔴 壳不解析任何协议字段（不认 `hello`/`ready`、不建模请求形状）——
 *      在 C 这边认字段就等于在第三种语言里再实现一遍协议。
 *
 * 🔴 **"能兑现"是注入的前提**：shim 是一句承诺（"这个宿主能提供 SQLite"），
 *    页侧一见端口就必然走 `shell` 后端；承诺了却兑现不了 ⇒ 应用**永久卡在启动**，
 *    而且那不是报错、是"什么都不发生"。所以 `heyta_web_new()` 只有在
 *    bundle 与产物**都在**的时候才建 WebView，否则返回 NULL 并说明原因，
 *    由调用方退回手写的 GTK 那一屏（ macOS 侧 `ShellStorageHost.decide()` 同一判据）。
 */

#ifndef HEYTA_WEB_H
#define HEYTA_WEB_H

#include "heyta_api.h"

#include <gtk/gtk.h>
#include <stdbool.h>
#include <stddef.h>

typedef struct HeytaWeb HeytaWeb;

/**
 * 找共享 UI 产物目录（按 `HEYTA_WEB_ROOT` → exe 旁 `web-dist` →
 * `../../share/heyta/web-dist`（FHS：exe 在 `/usr/lib/heyta`，产物在 `/usr/share/heyta`）→ 开发树 `../../apps/web/dist` 依次试，判据是里面真的有
 * `index.html`）。找到返回一个**进程内静态缓冲**里的绝对路径（不 free），
 * 找不到返回 NULL 并把"为什么没找到"写进 why —— 这一句必须能说出口，
 * 否则下一个人只看到"没生效"。
 */
const char *heyta_web_resolve_root(char *why, size_t whylen);

/**
 * 建 WebView（注册自定义 scheme、注入 shim、接好信号）。失败返回 NULL 并写 errbuf
 * （原因必须具体到"缺哪一枚"）。`widget` _out 参数给出可直接 `gtk_window_set_child`
 * 的那个控件。
 *
 * 🔴 **这一枚不发起加载，也不创建门面。** 顺序是实测承重的，不是风格：
 *    在那台 Ubuntu 载体上，只要 JSC 上下文**先于** WebView 存在，
 *    WebKitGTK 6.0 从此发不出任何加载信号（helper 进程照样起来、`get_uri()`
 *    照样返回目标 URI，但 `load-changed`/`load-failed`/scheme 请求一次都不发），
 *    而把门面的创建挪到 WebView **之后**就一切正常。
 *    最小复现与全部读数见 `docs/runbooks/linux-dev-box.md` 的 M2 那一节
 *    （装置：`src/webview-load-probe.c`）。
 */
HeytaWeb *heyta_web_new(const char *root, GtkWidget **widget, char *errbuf, size_t errlen);

/** 门面建好之后接上它。页侧第一条存储消息到来之前接上都算来得及。 */
void heyta_web_set_api(HeytaWeb *web, HeytaApi *api);

/** 发起加载并开始轮询取证 —— 必须在 `heyta_web_new` 与门面创建**之后**。 */
void heyta_web_load(HeytaWeb *web);

GtkWidget *heyta_web_widget(HeytaWeb *web);

/* 页面加载完之后再取一次证据（窗口刚 present 时 DOM 还没挂）。 */
void heyta_web_probe(HeytaWeb *web);

void heyta_web_free(HeytaWeb *web);

#endif /* HEYTA_WEB_H */
