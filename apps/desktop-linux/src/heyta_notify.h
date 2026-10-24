/*
 * Linux 壳的**通知中心**与**掐表**（§3.5 意义上的平台差异，零业务判定）。
 *
 * ## 为什么不需要任何新依赖
 *
 * freedesktop 通知就是一条 D-Bus 方法调用（`org.freedesktop.Notifications.Notify`），
 * 而 GLib **自带** GDBus —— 本壳本来就链着 gio（gtk4 的 Requires）。
 * 🔴 不引 libnotify：那是"系统库已经给你的东西再包一层第三方依赖"，
 *    过了 §3.2 许可门也过不了 §3.1 可维护性门的"为什么不能直接用 GLib"这一问。
 *
 * ## 边界：哪一行的判定住在哪
 *
 * 该弹哪条、弹过没有、回执（`firedAt`）全在 TS 的 `reminder-foreground.ts`；
 * 这里只回答两个平台问题 —— **怎么弹**（四个端口方法）与**什么时候醒**
 * （`nextReminderWakeDelay()` 的毫秒数拿去喂 `g_timeout_add`）。
 * 一行截止计算都不在 C（那会是第二份领域逻辑）。
 *
 * ## 四值映射（`ReminderAuthorization` 在 freedesktop 上的诚实读法）
 *
 * · `granted`     —— 本次运行里会话总线**真的连上了**，且
 *                    `org.freedesktop.Notifications.GetCapabilities` 应了话。
 *                    ⚠️ 语义是"通知服务器能收到"，**不是**"系统弹窗批准过" ——
 *                    freedesktop 根本没有 per-app 的批准开关，这是本平台的形状，不是偷懒。
 * · `unsupported` —— 没有会话总线 / 总线地址解析失败 / 服务不应话。
 * · `default`     —— "本次运行还没试过"。⚠️ 它只作为**内部初值**存在：
 *                    `authorizationStatus()` 被问到的那一刻就完成探测并缓存。
 *                    不能把 default 交给 JS —— bundle 里 `deliverReminders` 的端口包装
 *                    （native-bridge.ts 的 `InjectedReminderPort` 路径）**不转发**
 *                    `requestAuthorization`，`default` 会永远停在
 *                    `reason:'permission'`，到点的提醒一次都不会响 ——
 *                    那正是"会收钱不交付"的形状（ADR-0054 那条线）。
 * · `denied`      —— 本平台**不可达**（没有 per-app 通知开关可被拒），永不返回。
 *
 * "不在启动时弹权限框"这条约束在本平台上是天然成立的：探测只是一次 D-Bus 查询，
 * 不显示任何 UI；而且 JS 只在**真有待投递提醒**时才查状态（空集在查状态之前就短路）。
 *
 * ## show() 返回 false 的纪律
 *
 * 投递失败（总线错误、服务返回 id 0）必须返回 **false** —— 返回 true 会让 JS 把这条
 * 提醒记成已投（写 `firedAt`），用户的提醒就**静默丢了**。失败时顺带把通道状态打回
 * "没试过"，下一次询问会重新探测（服务器半路死掉也是能自愈的读数）。
 */

#ifndef HEYTA_NOTIFY_H
#define HEYTA_NOTIFY_H

#include "heyta_host.h"
#include "heyta_jsengine.h"

#include <stdbool.h>

/* 注入 `globalThis.__heytaReminderPort` —— 与 `__heytaDriverFactory` 同一个约定：
 * 宿主把平台能力挂在 global 上，bundle 反向不认识任何平台 API。
 * 形状 = { authorizationStatus(): string, requestAuthorization(): string,
 *          show(requestJson): bool, openSettings(): bool }。 */
void heyta_notify_install_port(JSContextRef ctx);

/* 页侧（WebView 里那一份应用）**也能使的三条 C 入口** —— 供 `heyta_web.c` 的
 * `heytaReminder` 消息处理器调。为什么要有第二组：桌面端跑的是**存储宿主**模式，
 * 业务判断在页侧而不在壳的 JS 引擎里（见 `apps/web/src/features/reminders/`），
 * 而 WebKit 的页面**碰不到** `globalThis.__heytaReminderPort`（那是宿主引擎的全局）。
 * 所以页面只能用 `window.webkit.messageHandlers` 那一根管道，壳在这头接住再转给
 * 上面同一族函数 —— **判定与投递只有一份**，两条入口只是两种到达方式。
 * 返回值与端口那四个方法逐字同形（`granted`/`unsupported`、bool）。 */
const char *heyta_notify_permission(void);
bool heyta_notify_show(const char *title, const char *body);
bool heyta_notify_open_settings(void);

/* 掐表的**唯一**入口：幂等（全进程只有一枚这一族的定时器），
 * 挂上后先跑一轮投递（"bridge 开开后各跑一次"就是这一发），
 * 每轮结束用 `nextReminderWakeDelay()` 重排；null ⇒ 不排（与 JS 循环同一语义，不空转）。
 * ⚠️ 必须在 GLib 主循环里调用（窗口壳）；无头冒烟不挂表，只验端口跨边界。 */
void heyta_notify_arm(HeytaHost *host);

/* 宿主销毁时拆表（host 没了而定时器还挂着 = 悬垂指针，这是唯一允许在 C 里做的"业务"：生命周期）。 */
void heyta_notify_disarm(void);

/* ── 页侧那条腿（`heytaReminder` 消息通道，见 heyta_web.c）──────────────────
 *
 * 🔴 为什么产品态要这三个而不是只有上面那四个端口方法：桌面应用模式下**引擎归页侧**，
 *    壳这份 QuickJS/JSC 里没有 host ⇒ `deliverReminders()` 这条路走不通
 *    （`heyta_api.c` 那层会拿到"宿主没有打开"）。而"什么时候醒、弹哪条、记不记账"
 *    既然都在页侧，弹出去这一米就只能由页侧**问壳要一次**。
 *    三个函数与上面那四个端口方法是**同一份实现**，只是入参从 JS 值换成普通 C 字符串
 *    —— 消息已经被 WebKit 的 JSC 取出来了，不再重复解析一遍。
 *
 * ⚠️ 返回值必须是可 JSON 化的标量（词表串 / `true`|`false` 的字面量文本），
 *    调用方原样塞进 ack 脚本。不许在这里替页侧猜"大概是投出去了"。 */
const char *heyta_notify_page_permission(void);
bool heyta_notify_page_open_settings(void);
bool heyta_notify_page_show(const char *occurrence_id, const char *title, const char *body);

#endif /* HEYTA_NOTIFY_H */
