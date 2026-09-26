/**
 * 移动端纯函数用的取词函数类型
 * ==============================
 *
 * `lib/` 与 `sync/` 里那批**纯函数**（截止文案、同步状态、冲突视图…）
 * 都会被单测直接调用，所以它们**不能**依赖 React context 拿 `t` ——
 * 只能由调用方把它作为参数传进来。
 *
 * 🔴 类型刻意取自 `@heyta/i18n` 的 `I18nValue['t']`，而不是自己写一遍
 * `(key: string) => string`：后者会让拼错的 key 在**运行时**才炸，
 * 而词条表存在的全部意义就是"拼错是编译错误"。
 */
import type { I18nValue } from '@heyta/i18n';

export type Translate = I18nValue['t'];
