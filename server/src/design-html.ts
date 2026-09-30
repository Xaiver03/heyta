/**
 * 服务端面向用户的 HTML 渲染层（邮件 + 凭据页）。
 * =================================================
 *
 * 唯一事实源：
 *   · 颜色 / 间距 / 字号 —— `./design.generated.js`（搬自设计系统 `tokens.css`）
 *   · 文案 —— `./copy.generated.js`（搬自 `packages/i18n` 的词条表）
 *
 * ## 🔴 三条硬要求（都是产品要求，不是风格偏好）
 *
 * 1. **默认中文。** 语言优先级：显式传入（邮件链接里的 `?lang=`）> `Accept-Language` > `zh-CN`。
 * 2. **用设计系统。** 颜色/间距/字体一律从 token 取 —— 这里**一个裸 hex 都没有**。
 * 3. **严禁任何渐变。** 本文件（以及它引用的生成物）里不允许出现 `gradient(`。
 *    生成脚本还会在设计系统那一侧断言一次（见 `gen-server-design.mjs`）。
 *
 * ## 为什么邮件用 table 布局 + 内联样式
 *
 * 邮件客户端（尤其 Outlook 与各家网页邮箱）对 `<style>`、flex、grid 的支持差异极大，
 * 而 `var(--x)` **完全不支持**。所以：
 *   · 布局用 `<table role="presentation">`（语义上它不是表格，是无障碍里正确的写法）；
 *   · 样式**全部内联**；
 *   · 颜色是**解析后的字面值**（token 的取值在生成期就已经算好了）。
 *
 * ## 为什么凭据页可以直接用 `<style>`
 *
 * 那是真浏览器打开的页面，不是邮件。用一段 `<style>` + 类名比几百个内联样式好维护得多。
 * 但它**只用亮色** —— 与邮件同一个理由：heyta 是蓝白亮色系，暗色必须实测过才交付。
 */

import { EMAIL_COLOR, EMAIL_FONT, EMAIL_SIZE } from './design.generated.js';
import {
  SERVER_COPY,
  SERVER_LOCALES,
  type ServerCopyKey,
  type ServerLocale,
} from './copy.generated.js';

/**
 * 🔴 默认语言是**中文**。
 *
 * 这是产品要求（"默认是中文的"），也与仓库的语言基线一致 ——
 * `packages/i18n` 的 `DEFAULT_LOCALE` 同样是 `zh-CN`。
 */
export const DEFAULT_SERVER_LOCALE: ServerLocale = 'zh-CN';

/** HTML 转义。任何拼进模板的用户数据都必须过它。 */
export const escapeHtml = (unsafe: string): string =>
  unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const isServerLocale = (value: string): value is ServerLocale =>
  (SERVER_LOCALES as readonly string[]).includes(value);

/**
 * 解析语言。
 *
 * 优先级：**显式参数**（`?lang=`，发信时就写进链接里）> `Accept-Language` > 默认 `zh-CN`。
 *
 * 显式参数排第一是刻意的：邮件是**为收件人**渲染的，而收件人点开链接时
 * 用的浏览器语言未必等于他注册时用的语言（比如在英文系统里注册的中文用户）。
 * 把语言写进链接，收件人看到的就是**发信那一刻**他该看到的语言。
 */
export function resolveLocale(
  explicit?: string | null,
  acceptLanguage?: string | null,
): ServerLocale {
  if (explicit !== undefined && explicit !== null && isServerLocale(explicit)) {
    return explicit;
  }

  // `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8` —— 只做一次朴素但正确的匹配：
  // 按顺序取第一个我们支持的语言。不做 q 值排序（那需要完整实现 RFC 9110 的权重比较，
  // 而这里的收益只是极少数多语言用户的首选差异）。
  if (acceptLanguage !== undefined && acceptLanguage !== null) {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]?.trim();
      if (tag === undefined || tag === '') continue;
      if (isServerLocale(tag)) return tag;
      // `zh` / `en-US` 这类前缀匹配。
      const lower = tag.toLowerCase();
      if (lower.startsWith('zh')) return 'zh-CN';
      if (lower.startsWith('en')) return 'en';
    }
  }

  return DEFAULT_SERVER_LOCALE;
}

/**
 * 取词条。
 *
 * 返回类型是 `string` 而不是可空 —— `ServerCopyKey` 是联合类型，
 * **拼错一个 key 是编译期错误**（生成物同时给出了两个语言的完整表）。
 */
export function t(locale: ServerLocale, key: ServerCopyKey): string {
  return SERVER_COPY[locale][key];
}

/** 一处样式里反复出现的"字体 + 颜色 + 字号"组合。 */
const font = (size: string, weight: number, color: string): string =>
  `font-family:${EMAIL_FONT['font.sans']};font-size:${size};font-weight:${String(weight)};color:${color};`;

export interface EmailContent {
  /** `<title>` 与邮件主题分开：主题由 `email.ts` 传（它还要写进 SMTP 的 subject）。 */
  readonly title: string;
  readonly heading: string;
  readonly body: string;
  readonly buttonLabel: string;
  readonly url: string;
  /** 按钮下面的一行提示（有效期 / "不是你发起的就忽略"）。可空。 */
  readonly note?: string;
}

/**
 * 渲染一封邮件。
 *
 * 结构：浅灰底 → 居中白色卡片（品牌 + 标题 + 正文 + 主色按钮 + 提示 + 兜底链接）→ 页脚。
 * **无渐变**，层次全靠 1px 边框与底色差（AGENTS §5：扁平风格用边框表达层次）。
 */
export function renderEmail(locale: ServerLocale, content: EmailContent): string {
  const brand = escapeHtml('heyta');
  const title = escapeHtml(content.title);
  const heading = escapeHtml(content.heading);
  const body = escapeHtml(content.body);
  const buttonLabel = escapeHtml(content.buttonLabel);
  const url = escapeHtml(content.url);
  const note = content.note === undefined ? '' : escapeHtml(content.note);

  const fallbackIntro = escapeHtml(t(locale, 'server.email.common.fallbackIntro'));
  const tagline = escapeHtml(t(locale, 'server.email.common.tagline'));
  const autoNote = escapeHtml(t(locale, 'server.email.common.autoNote'));

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLOR['color.background']};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_COLOR['color.background']};">
<tr>
<td align="center" style="padding:${EMAIL_SIZE['space.8']} ${EMAIL_SIZE['space.4']};">

<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:${EMAIL_COLOR['color.surface']};border:1px solid ${EMAIL_COLOR['color.border']};border-radius:${EMAIL_SIZE['radius.lg']};">

<tr><td style="padding:${EMAIL_SIZE['space.8']} ${EMAIL_SIZE['space.8']} 0 ${EMAIL_SIZE['space.8']};">
<span style="${font(EMAIL_SIZE['font-size.lg'], Number(EMAIL_SIZE['font-weight.semibold']), EMAIL_COLOR['color.primary'])}letter-spacing:-0.01em;">${brand}</span>
</td></tr>

<tr><td style="padding:${EMAIL_SIZE['space.4']} ${EMAIL_SIZE['space.8']} 0 ${EMAIL_SIZE['space.8']};">
<h1 style="margin:0;${font(EMAIL_SIZE['font-size.xl'], Number(EMAIL_SIZE['font-weight.semibold']), EMAIL_COLOR['color.foreground'])}line-height:1.4;">${heading}</h1>
</td></tr>

<tr><td style="padding:${EMAIL_SIZE['space.3']} ${EMAIL_SIZE['space.8']} 0 ${EMAIL_SIZE['space.8']};">
<p style="margin:0;${font(EMAIL_SIZE['font-size.base'], Number(EMAIL_SIZE['font-weight.regular']), EMAIL_COLOR['color.foreground-muted'])}line-height:1.7;">${body}</p>
</td></tr>

<tr><td style="padding:${EMAIL_SIZE['space.6']} ${EMAIL_SIZE['space.8']} 0 ${EMAIL_SIZE['space.8']};">
<a href="${url}" style="display:inline-block;background-color:${EMAIL_COLOR['color.primary']};color:${EMAIL_COLOR['color.on-primary']};${font(EMAIL_SIZE['font-size.base'], Number(EMAIL_SIZE['font-weight.semibold']), EMAIL_COLOR['color.on-primary'])}padding:${EMAIL_SIZE['space.3']} ${EMAIL_SIZE['space.6']};border-radius:${EMAIL_SIZE['radius.md']};text-decoration:none;">${buttonLabel}</a>
</td></tr>
${note === '' ? '' : `
<tr><td style="padding:${EMAIL_SIZE['space.4']} ${EMAIL_SIZE['space.8']} 0 ${EMAIL_SIZE['space.8']};">
<p style="margin:0;${font(EMAIL_SIZE['font-size.sm'], Number(EMAIL_SIZE['font-weight.regular']), EMAIL_COLOR['color.foreground-subtle'])}line-height:1.7;">${note}</p>
</td></tr>
`}
<tr><td style="padding:${EMAIL_SIZE['space.6']} ${EMAIL_SIZE['space.8']} ${EMAIL_SIZE['space.8']} ${EMAIL_SIZE['space.8']};">
<div style="border-top:1px solid ${EMAIL_COLOR['color.border-subtle']};padding-top:${EMAIL_SIZE['space.4']};">
<p style="margin:0 0 ${EMAIL_SIZE['space.1']} 0;${font(EMAIL_SIZE['font-size.xs'], Number(EMAIL_SIZE['font-weight.regular']), EMAIL_COLOR['color.foreground-subtle'])}line-height:1.6;">${fallbackIntro}</p>
<p style="margin:0;${font(EMAIL_SIZE['font-size.xs'], Number(EMAIL_SIZE['font-weight.regular']), EMAIL_COLOR['color.primary'])}line-height:1.6;word-break:break-all;">${url}</p>
</div>
</td></tr>

</table>

<p style="margin:${EMAIL_SIZE['space.4']} 0 0 0;${font(EMAIL_SIZE['font-size.xs'], Number(EMAIL_SIZE['font-weight.regular']), EMAIL_COLOR['color.foreground-subtle'])}line-height:1.6;">${tagline}<br>${autoNote}</p>

</td>
</tr>
</table>
</body>
</html>`;
}

/**
 * 渲染邮件对应的**纯文本**版本。
 *
 * 不是可选项：只有 HTML 的邮件在部分客户端与"纯文本模式"下会显示成一片乱码，
 * 而纯文本版也是垃圾邮件过滤的一个正向信号。
 */
export function renderEmailText(
  locale: ServerLocale,
  content: Pick<EmailContent, 'heading' | 'body' | 'buttonLabel' | 'url' | 'note'>,
): string {
  const lines = [
    content.heading,
    '',
    content.body,
    '',
    `${content.buttonLabel}: ${content.url}`,
  ];
  if (content.note !== undefined) lines.push('', content.note);
  lines.push('', t(locale, 'server.email.common.fallbackIntro'), content.url);
  lines.push('', t(locale, 'server.email.common.autoNote'));
  return lines.join('\n');
}

export interface PageAction {
  readonly label: string;
  /** `href` 为空时渲染成 `<button>`（由页内脚本接管点击）。 */
  readonly href?: string;
  readonly id?: string;
  readonly primary?: boolean;
}

export interface PageContent {
  readonly title: string;
  readonly heading: string;
  readonly body: string;
  /** 主体里的额外 HTML（已经转义过或由我们生成）。 */
  readonly extraHtml?: string;
  readonly actions?: readonly PageAction[];
  /** 额外脚本（如 `/recover-passkey.js`）。 */
  readonly scripts?: readonly string[];
}

/**
 * 渲染一张凭据页。
 *
 * 与邮件的差别：这是真浏览器里的页面，所以用一段 `<style>` + 类名，
 * 并且**颜色仍然来自同一份 token**（取值在生成期解析好，这里不写裸 hex）。
 */
export function renderPage(locale: ServerLocale, content: PageContent): string {
  const actions = (content.actions ?? [])
    .map((action) => {
      const cls = action.primary === true ? 'btn btn--primary' : 'btn';
      const id = action.id === undefined ? '' : ` id="${escapeHtml(action.id)}"`;
      const label = escapeHtml(action.label);
      return action.href === undefined
        ? `<button type="button" class="${cls}"${id}>${label}</button>`
        : `<a class="${cls}" href="${escapeHtml(action.href)}"${id}>${label}</a>`;
    })
    .join('\n        ');

  /**
   * 🔴 脚本必须放在 **`</body>` 之前**，不能放 `<head>`。
   *
   * 踩过的坑（2026-09-30 用户实测报障）：放 `<head>` 且**不加 `defer`** 时，
   * 脚本会在 `<head>` 里**同步执行** —— 那一刻 `<body>` 还没被解析出来，
   * `document.body` 是 `null`，于是页内脚本第一行的
   * `document.body.dataset.token` 直接抛 `TypeError`，
   * **按钮点了完全没反应**（用户看到的正是"点一下没反应"）。
   */
  const scripts = (content.scripts ?? [])
    .map((src) => `<script src="${escapeHtml(src)}"></script>`)
    .join('\n    ');

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(content.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: ${EMAIL_SIZE['space.6']} ${EMAIL_SIZE['space.4']};
    background: ${EMAIL_COLOR['color.background']};
    color: ${EMAIL_COLOR['color.foreground']};
    font-family: ${EMAIL_FONT['font.sans']};
    font-size: ${EMAIL_SIZE['font-size.base']};
    line-height: 1.7;
  }
  .card {
    width: 100%;
    max-width: 26rem;
    padding: ${EMAIL_SIZE['space.8']};
    background: ${EMAIL_COLOR['color.surface']};
    border: 1px solid ${EMAIL_COLOR['color.border']};
    border-radius: ${EMAIL_SIZE['radius.lg']};
  }
  .brand {
    display: block;
    margin-bottom: ${EMAIL_SIZE['space.4']};
    color: ${EMAIL_COLOR['color.primary']};
    font-size: ${EMAIL_SIZE['font-size.lg']};
    font-weight: ${EMAIL_SIZE['font-weight.semibold']};
  }
  h1 {
    margin: 0 0 ${EMAIL_SIZE['space.3']} 0;
    font-size: ${EMAIL_SIZE['font-size.xl']};
    font-weight: ${EMAIL_SIZE['font-weight.semibold']};
    line-height: 1.4;
  }
  p { margin: 0 0 ${EMAIL_SIZE['space.4']} 0; color: ${EMAIL_COLOR['color.foreground-muted']}; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: ${EMAIL_SIZE['space.2']};
    width: 100%;
    padding: ${EMAIL_SIZE['space.3']} ${EMAIL_SIZE['space.6']};
    border: 1px solid ${EMAIL_COLOR['color.border']};
    border-radius: ${EMAIL_SIZE['radius.md']};
    background: ${EMAIL_COLOR['color.surface']};
    color: ${EMAIL_COLOR['color.foreground']};
    font-family: inherit;
    font-size: ${EMAIL_SIZE['font-size.base']};
    font-weight: ${EMAIL_SIZE['font-weight.semibold']};
    text-decoration: none;
    cursor: pointer;
  }
  .btn--primary {
    border-color: ${EMAIL_COLOR['color.primary']};
    background: ${EMAIL_COLOR['color.primary']};
    color: ${EMAIL_COLOR['color.on-primary']};
  }
  .btn--primary:hover { background: ${EMAIL_COLOR['color.primary-hover']}; }
  .btn:disabled { background: ${EMAIL_COLOR['color.border']}; border-color: ${EMAIL_COLOR['color.border']}; color: ${EMAIL_COLOR['color.foreground-subtle']}; cursor: default; }
  /* 🔴 焦点环不许抹掉（AGENTS §5）。 */
  .btn:focus-visible, a:focus-visible { outline: 2px solid ${EMAIL_COLOR['color.primary']}; outline-offset: 2px; }
  .status { margin: ${EMAIL_SIZE['space.4']} 0 0 0; font-size: ${EMAIL_SIZE['font-size.sm']}; }
  .status--ok { color: ${EMAIL_COLOR['color.success']}; }
  .status--err { color: ${EMAIL_COLOR['color.danger']}; }
  .hint { margin: ${EMAIL_SIZE['space.3']} 0 0 0; font-size: ${EMAIL_SIZE['font-size.xs']}; color: ${EMAIL_COLOR['color.foreground-subtle']}; }
  a { color: ${EMAIL_COLOR['color.primary']}; }
  .ok-icon { color: ${EMAIL_COLOR['color.success']}; font-size: ${EMAIL_SIZE['font-size.2xl']}; line-height: 1; margin-bottom: ${EMAIL_SIZE['space.2']}; }
</style>
</head>
<body>
  <main class="card">
    <span class="brand">heyta</span>
    ${content.extraHtml ?? ''}
    <h1>${escapeHtml(content.heading)}</h1>
    <p>${escapeHtml(content.body)}</p>
    ${actions}
  </main>
${scripts}
</body>
</html>`;
}
