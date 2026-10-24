/**
 * 「当前这个地址是不是独立后台页」的唯一判定。
 *
 * ## 为什么是一枚纯函数，而不是写在入口里
 *
 * 它是**一条会决定整棵树渲染成什么**的判断，而这种判断只要抄第二份，
 * 两份就会在某个没人注意的挂载路径上分家。抽成函数才能被直接测到
 * （`apps/web/tests/admin-console-route.spec.tsx` 逐形状喂地址），
 * 而不必为了验证它起一次真浏览器。
 *
 * ## 认得的形状
 *
 * | 地址 | 来源 |
 * |---|---|
 * | `/admin` | 生产入口：nginx `location = /admin` 把应用那份 `index.html` 别名到这里 |
 * | `/admin/` | 有人手敲时爱补一个尾斜杠 |
 * | `/app/admin`、`/app/admin/` | 挂在 `/app/` 下时，`location /app/` 的 `try_files` 兜底本来就会给出应用 HTML，所以这条**不改 nginx 也通** |
 *
 * ⚠️ 它**不**匹配任何以 `/admin` 结尾的其它路径（比如自托管用户把某个页面起名
 * `…/admin`）：判定用的是**整段相等**，不是 `endsWith`。`endsWith` 那一版会让
 * 「用户自己的某个路径」把 heyta 切进后台壳 —— 那是同一族里最难归因的错。
 *
 * ## 它不是安全措施
 *
 * 地址对不对只决定**界面壳长什么样**。权限一律由服务端 `requireAdmin` 裁决
 * （ADR-0038 §4.3）：手工把地址敲成 `/admin` 的人看到的是一个"没有权限"的页面，
 * 而不是一条数据。
 */
const ADMIN_CONSOLE_PATHS = new Set(['/admin', '/app/admin']);

/** 去掉尾部多余的斜杠（`/admin//` 与 `/admin` 是同一个页面）。 */
function trimTrailingSlashes(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  // 全斜杠的路径（`/`、`//`）剪完会变成空串，而空串不是"某个页面"。
  return trimmed === '' ? '/' : trimmed;
}

export function isAdminConsolePath(pathname: string): boolean {
  return ADMIN_CONSOLE_PATHS.has(trimTrailingSlashes(pathname));
}

/** 读当前浏览器地址。单独一格是为了让入口那行读起来是"路由"，不是"取环境变量"。 */
export function isAdminConsoleLocation(): boolean {
  return isAdminConsolePath(window.location.pathname);
}

/**
 * 「返回应用」的目标地址。
 *
 * 🔴 必须由 `import.meta.env.BASE_URL` 派生，**不许写死 `/app/`**：
 * 同一个 bundle 会挂在三种位置下 —— dev server 的 `/`、生产的 `/app/`、
 * 自托管者爱挂哪儿挂哪儿。与 `pwa/register.ts` 的 sw URL、
 * `ShareFeature` 的 `appBaseUrl` 是同一条纪律。
 */
export function appEntryHref(): string {
  return import.meta.env.BASE_URL;
}
