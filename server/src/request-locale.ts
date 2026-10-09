import { resolveLocale } from './design-html.js';
import type { ServerLocale } from './copy.generated.js';

/**
 * 从请求里解析收件人语言。
 *
 * 顺序与 `design-html.ts` 的 `resolveLocale` 一致：
 *   ① `body.locale`（客户端当前界面语言，**可选**——客户端不传也完全正常工作）
 *   ② 默认 `zh-CN`
 *
 * 🔴 **刻意不改任何 zod schema**：`body.locale` 是可选字段，zod 的 `z.object()`
 * 默认会剥掉未声明的键 —— 也就是说这个字段**不会**进 `parseResult.data`，
 * 但也**不会**让请求失败。加它不需要动 schema，于是也不会与正在改这些
 * schema 的人撞车。（要让它进 `data` 就得改 schema，代价远大于收益。）
 *
 * 🔴 为什么这是一枚单独的文件：这条判断原来长在 `api.ts` 里，而新增的账号安全路由
 * 也需要它。让一枚路由模块为了一个四行的解析函数去 import 全仓最大的那个文件，
 * 症状不是"慢一点"，是**它的单元测试必须把整个 API 面拖进来 mock**
 * （AGENTS §3.5：同形状的第二次就是漂移的开始；这里是把它挪到唯一的真源那一侧）。
 *
 * ⚠️ `Accept-Language` 这一档已于 2026-10-03 **删掉**（判据在
 * `server/tests/account-locale.spec.ts` 与 `email-locale-wire.spec.ts`：
 * 变异 = 把读 `accept-language` 的那几行加回来 ⇒ 那两条红）。理由写在原处：
 * 浏览器语言不是选择，是环境噪声，而它当时正把中文界面注册的人的第一封邮件渲染成英文。
 */
export const localeFromRequest = (req: { body?: unknown }): ServerLocale => {
  const body = req.body as { locale?: unknown } | undefined;
  return resolveLocale(typeof body?.locale === 'string' ? body.locale : null);
};
