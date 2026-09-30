/**
 * 服务端（邮件 / 凭据页）用的设计 token 快照 —— **自动生成，请勿手改**。
 *
 * 唯一事实源：`packages/design-system/src/tokens.css`
 * 搬运路径：tokens.css →（design-system 的 generate）→ `generated/tokens.json` → 本文件
 * 重新生成：`node server/scripts/gen-server-design.mjs`
 * 校验漂移：`node server/scripts/gen-server-design.mjs --check`（已接进 `pnpm check`）
 *
 * 🔴 **只含 light**：`tokens.json` 的 dark 段是稀疏覆盖（73 条 vs light 的 198 条），
 *    设计系统自己标注了"不适合直接消费"。邮件客户端的暗色模式由收件方决定，
 *    我们控制不了 —— 所以邮件与凭据页**只用亮色**。
 *
 * 🔴 **零渐变**：生成时断言过（见 `gen-server-design.mjs` 的 gradient 检查）。
 */

/** 颜色 token —— 语义名，值取自设计系统。 */
export const EMAIL_COLOR = {
  'color.background': '#f8fafc',
  'color.surface': '#ffffff',
  'color.surface-raised': '#ffffff',
  'color.foreground': '#0f172a',
  'color.foreground-muted': '#64748b',
  'color.foreground-subtle': '#94a3b8',
  'color.primary': '#2563eb',
  'color.primary-hover': '#1d4ed8',
  'color.on-primary': '#ffffff',
  'color.primary-subtle': '#eff6ff',
  'color.border': '#e2e8f0',
  'color.border-subtle': '#f1f5f9',
  'color.success': '#059669',
  'color.success-subtle': '#ecfdf5',
  'color.danger': '#dc2626',
  'color.danger-subtle': '#fef2f2',
} as const;

/** 尺寸 / 字重 token —— 已转成带 `px` 的 CSS 长度（字重是纯数字）。 */
export const EMAIL_SIZE = {
  'space.1': '4px',
  'space.2': '8px',
  'space.3': '12px',
  'space.4': '16px',
  'space.5': '20px',
  'space.6': '24px',
  'space.8': '32px',
  'space.10': '40px',
  'space.12': '48px',
  'space.16': '64px',
  'font-size.xs': '12px',
  'font-size.sm': '14px',
  'font-size.base': '16px',
  'font-size.lg': '18px',
  'font-size.xl': '20px',
  'font-size.2xl': '24px',
  'radius.sm': '4px',
  'radius.md': '8px',
  'radius.lg': '12px',
  'radius.full': '9999px',
  'font-weight.regular': 400,
  'font-weight.medium': 500,
  'font-weight.semibold': 600,
} as const;

/** 字体栈（含中文字体回退）。 */
export const EMAIL_FONT = {
  'font.sans': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  'font.mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;
