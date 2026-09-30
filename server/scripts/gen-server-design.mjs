#!/usr/bin/env node
/**
 * 从设计系统生成**服务端**要用的 token 快照。
 * ============================================
 *
 * ```sh
 * node server/scripts/gen-server-design.mjs          # 写盘
 * node server/scripts/gen-server-design.mjs --check  # 只校验（门禁用）
 * ```
 *
 * ## 🔴 为什么是"生成 + 提交生成物"，而不是在运行时读设计系统
 *
 * 服务端的邮件与凭据页也需要设计 token（颜色、间距、字号）。
 * 但 `server/Dockerfile` 只打包 `packages/{sync-core,shared-schema,domain}`
 * —— **运行时的镜像里没有 `@heyta/design-system`**，读不到。
 *
 * 有两条路：
 *   ① 把 `@heyta/design-system` 接进 server 的构建链（改 Dockerfile + 加依赖）；
 *   ② 生成一个快照文件，提交进仓库，并用门禁钉住它与真源一致。
 *
 * 选 ②。理由是这条模式**仓库里已经有两次先例**，而且都工作得很好：
 *   · `apps/landing/scripts/gen-og-card.mjs` —— 分享卡片的域名与主色从
 *     `tokens.css` 注入，不写死；
 *   · `apps/web/scripts/gen-pwa.mjs` —— PWA 资产从 token 与词条生成，
 *     由 `tests/pwa.spec.ts` 钉住"磁盘产物 === 重新生成的结果"。
 *
 * **真源仍然只有一份**（`packages/design-system/src/tokens.css`）：
 * 这个脚本读的是设计系统**自己生成的** `generated/tokens.json`，
 * 而不是重新解析 CSS —— 也就是说 var() 展开、暗色合并这些事
 * **一行都没有在这里重做**（那会变成第二份解析器，必然漂移）。
 *
 * ## 为什么只用 light
 *
 * `generated/tokens.json` 的 `dark` 段是**稀疏覆盖**（73 条 vs light 的 198 条），
 * 设计系统自己的文件头就写着"只适合数据流水线，不适合直接消费"。
 * 而 heyta 是蓝白亮色系，**邮件与凭据页都只用亮色** —— 邮件客户端的暗色模式
 * 由收件方决定，我们控制不了，硬做暗色只会两边都不对。
 * 所以这里明确只搬 `light`，并在标题里写清楚。
 *
 * ## 严禁渐变
 *
 * 设计系统里**本来就没有任何渐变**（`grep -rn gradient packages/design-system/src/` 为空），
 * 所以从这里取的值天然满足"无渐变"。这里再加一条**断言**把它钉死：
 * 万一以后有人往 tokens.css 里加了渐变，本脚本会**拒绝生成**，
 * 而不是把渐变悄悄带进邮件。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..');
const REPO = join(SERVER, '..');
const SOURCE = join(REPO, 'packages/design-system/generated/tokens.json');
const TARGET = join(SERVER, 'src/design.generated.ts');

/**
 * 要搬的 token —— **白名单**，不是全表。
 *
 * 白名单的理由是"邮件与凭据页真正用到什么"，抄全表会让生成物里
 * 躺着一大堆没人用的键，而它们会随着设计系统演进不断产生无意义的 diff。
 */
const COLOR_TOKENS = [
  'color.background',
  'color.surface',
  'color.surface-raised',
  'color.foreground',
  'color.foreground-muted',
  'color.foreground-subtle',
  'color.primary',
  'color.primary-hover',
  'color.on-primary',
  'color.primary-subtle',
  'color.border',
  'color.border-subtle',
  'color.success',
  'color.success-subtle',
  'color.danger',
  'color.danger-subtle',
];

/** 尺寸类：真源里是**数字**（RN 的点值），HTML 里要带 `px` —— 见下面的 `toPx`。 */
const SIZE_TOKENS = [
  'space.1',
  'space.2',
  'space.3',
  'space.4',
  'space.5',
  'space.6',
  'space.8',
  'space.10',
  'space.12',
  'space.16',
  'font-size.xs',
  'font-size.sm',
  'font-size.base',
  'font-size.lg',
  'font-size.xl',
  'font-size.2xl',
  'radius.sm',
  'radius.md',
  'radius.lg',
  'radius.full',
  'font-weight.regular',
  'font-weight.medium',
  'font-weight.semibold',
];

/** 字体栈是**字符串**（原样），单独一类。 */
const FONT_TOKENS = ['font.sans', 'font.mono'];

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
const light = raw.light;

if (light === undefined) {
  throw new Error(`${relative(REPO, SOURCE)} 里没有 light 段 —— 设计系统的生成物结构变了？`);
}

/**
 * 🔴 **拒绝一切渐变。**
 *
 * 产品要求"严禁任何渐变"，而设计系统当前也确实是零渐变。
 * 这条断言保证：**将来**有人往 tokens.css 里加了渐变时，
 * 生成会当场失败，而不是让渐变悄悄进到邮件与凭据页里。
 */
const gradientish = Object.entries(light).filter(([, value]) =>
  typeof value === 'string' ? /gradient\(/i.test(value) : false,
);
if (gradientish.length > 0) {
  throw new Error(
    `设计系统里出现了渐变 token：${gradientish.map(([k]) => k).join(', ')}\n` +
      '   🔴 邮件与凭据页**严禁渐变**。要么把它从 tokens.css 去掉，' +
      '要么把它排除在白名单之外（并在本脚本里写明理由）。',
  );
}

/** 缺任何一个白名单键都当场失败 —— 静默少一个键会让模板渲染出空样式。 */
const pick = (key) => {
  const value = light[key];
  if (value === undefined) {
    throw new Error(
      `设计系统里找不到 token \`${key}\`。\n` +
        '   🔴 要么它被改名了（请更新本脚本的白名单，并同步模板），' +
        '要么它被删了（那模板的取值需要换一个语义 token）。',
    );
  }
  return value;
};

/** 数字 → CSS 长度。`0` 不加单位（CSS 里 `0` 带单位虽合法但没意义）。 */
const toPx = (value) => {
  if (typeof value === 'number') return value === 0 ? '0' : `${String(value)}px`;
  if (typeof value === 'string') {
    // 已经是 CSS 长度（如 `9999` 被写成字符串、或 `1rem`）—— 原样，但仍校验一下
    return value;
  }
  throw new Error(`token 值既不是数字也不是字符串：${JSON.stringify(value)}`);
};

const lines = [];
lines.push('/**');
lines.push(' * 服务端（邮件 / 凭据页）用的设计 token 快照 —— **自动生成，请勿手改**。');
lines.push(' *');
lines.push(' * 唯一事实源：`packages/design-system/src/tokens.css`');
lines.push(' * 搬运路径：tokens.css →（design-system 的 generate）→ `generated/tokens.json` → 本文件');
lines.push(' * 重新生成：`node server/scripts/gen-server-design.mjs`');
lines.push(' * 校验漂移：`node server/scripts/gen-server-design.mjs --check`（已接进 `pnpm check`）');
lines.push(' *');
lines.push(' * 🔴 **只含 light**：`tokens.json` 的 dark 段是稀疏覆盖（73 条 vs light 的 198 条），');
lines.push(' *    设计系统自己标注了"不适合直接消费"。邮件客户端的暗色模式由收件方决定，');
lines.push(' *    我们控制不了 —— 所以邮件与凭据页**只用亮色**。');
lines.push(' *');
lines.push(' * 🔴 **零渐变**：生成时断言过（见 `gen-server-design.mjs` 的 gradient 检查）。');
lines.push(' */');
lines.push('');
lines.push('/** 颜色 token —— 语义名，值取自设计系统。 */');
lines.push('export const EMAIL_COLOR = {');
for (const key of COLOR_TOKENS) {
  lines.push(`  '${key}': '${String(pick(key))}',`);
}
lines.push('} as const;');
lines.push('');
lines.push('/** 尺寸 / 字重 token —— 已转成带 `px` 的 CSS 长度（字重是纯数字）。 */');
lines.push('export const EMAIL_SIZE = {');
for (const key of SIZE_TOKENS) {
  const value = pick(key);
  const rendered = key.startsWith('font-weight.') ? String(value) : `'${toPx(value)}'`;
  lines.push(`  '${key}': ${rendered},`);
}
lines.push('} as const;');
lines.push('');
lines.push('/** 字体栈（含中文字体回退）。 */');
lines.push('export const EMAIL_FONT = {');
for (const key of FONT_TOKENS) {
  lines.push(`  '${key}': ${JSON.stringify(String(pick(key)))},`);
}
lines.push('} as const;');
lines.push('');

const output = lines.join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(TARGET, 'utf8');
  } catch {
    current = '';
  }
  if (current !== output) {
    console.error(
      `🔴 ${relative(REPO, TARGET)} 与设计系统不一致。\n` +
        '   跑 `node server/scripts/gen-server-design.mjs` 重新生成，并把它一起提交。',
    );
    process.exit(1);
  }
  console.log(`✅ 服务端设计 token 与设计系统一致（${String(COLOR_TOKENS.length + SIZE_TOKENS.length + FONT_TOKENS.length)} 个）。`);
  process.exit(0);
}

writeFileSync(TARGET, output, 'utf8');
console.log(
  `✅ 已写入 ${relative(REPO, TARGET)}（颜色 ${String(COLOR_TOKENS.length)} / 尺寸 ${String(SIZE_TOKENS.length)} / 字体 ${String(FONT_TOKENS.length)}）`,
);
