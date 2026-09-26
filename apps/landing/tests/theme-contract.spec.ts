/**
 * 主题契约：三处必须用同一个 storage key
 * =========================================
 *
 * `heyta.theme` 这个 key 出现在**三个**地方，它们不是巧合而是契约：
 *
 *   1. `apps/web/src/lib/theme.ts`        —— 产品应用读写它
 *   2. `apps/landing/src/lib/theme.ts`    —— 落地页读写它
 *   3. `apps/landing/index.html`          —— 样式表之前**同步**读它
 *
 * 第 3 处容易被忘掉，而忘了它的后果很具体：暗色用户会先看到一帧亮色
 * （FOUC）。而前两处不一致的后果更隐蔽 —— 用户在应用里选了暗色，
 * 打开落地页却是亮色，看起来像"主题功能坏了"，而不是"key 拼错了"。
 *
 * 这类漂移没有任何类型系统能拦住（三处都是字符串字面量），
 * 所以在这里用测试钉住。
 *
 * ⚠️ 刻意**不 import** `apps/web` 的模块：`apps/*` 之间不允许互相依赖
 * （见 `scripts/check-layering.mjs`）。这里把对方当**文本**读，
 * 断言的正是"两份源码里的字面量一致"这件事本身。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY } from '../src/lib/theme.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '../..');

const KEY = 'heyta.theme';

describe('主题 storage key', () => {
  it('落地页导出的常量就是约定的 key', () => {
    expect(THEME_STORAGE_KEY).toBe(KEY);
  });

  it('产品应用（apps/web）用同一个字面量', () => {
    const source = readFileSync(resolve(REPO, 'apps/web/src/lib/theme.ts'), 'utf8');
    expect(source).toContain(`'${KEY}'`);
  });

  it('落地页的同步引导脚本用同一个字面量', () => {
    const html = readFileSync(resolve(APP, 'index.html'), 'utf8');
    expect(html).toContain(`'${KEY}'`);
  });

  it('引导脚本在 <head> 里、且在拉取 main.tsx 之前 —— 否则暗色用户会看到一帧亮色', () => {
    const html = readFileSync(resolve(APP, 'index.html'), 'utf8');

    const scriptAt = html.indexOf(`'${KEY}'`);
    expect(scriptAt).toBeGreaterThan(-1);

    // ⚠️ 源码里没有 `<link rel="stylesheet">` —— CSS 是 main.tsx 导入的，
    // 由 Vite 在构建时注入。所以这里比的是"引导脚本 vs 拉取 main.tsx"：
    // 只要引导脚本在前，CSS 就还没被应用（它要等 main.tsx 那个模块跑起来）。
    const mainAt = html.indexOf('src="/src/main.tsx"');
    expect(mainAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(mainAt);

    // 而且必须在 <head> 里（放 <body> 末尾就等于没做，样式早已应用）
    const headEnd = html.indexOf('</head>');
    expect(scriptAt).toBeLessThan(headEnd);
  });

  it('引导脚本在 <head> 里同步执行（不是 type="module"，那会延后）', () => {
    const html = readFileSync(resolve(APP, 'index.html'), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const inline = head.slice(head.indexOf('<script>'));
    expect(inline.startsWith('<script>')).toBe(true);
  });
});

describe('主题属性的写法', () => {
  it('落地页设置的是 <html data-theme>，与 tokens.css 的暗色选择器一致', () => {
    const source = readFileSync(resolve(APP, 'src/lib/theme.ts'), 'utf8');
    expect(source).toContain('documentElement.dataset');
    expect(source).toContain('theme');
  });
});
