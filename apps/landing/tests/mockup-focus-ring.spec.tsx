/**
 * 展厅那一只进度环与 `packages/ui` 之间的**会红约束**
 * ==================================================
 *
 * 背景：`docs/plans/multi-platform-adaptation.md` 的 M3 **每轮固定流程第 3.5 步**
 * ——「把 landing 上对应那一块也换成真组件」。`tasks` 一刀留下了
 * `mockup-task-row.spec.tsx`，外壳留下了 `mockup-shell-shape.spec.tsx`，
 * 而 **`focus` 那一刀一直没留下任何东西**：`apps/landing/src/mockup/FocusRing.tsx`
 * 手工复刻了一只环，**没有任何判据会因为它抄错而变红**。
 *
 * 这正是本仓库反复吃过的形状：「复刻件抄了一份取值，而没有人问它抄的是不是产品那一组」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么不把展厅换成真 `FocusRing`
 *
 * 与 `mockup-task-row.spec.tsx` 同一条判决（`dida-view-unification.md` §9.1）：
 * 静态引 `@heyta/ui` 会让落地页首屏 **+61.9 kB gzip（+31%）**，懒加载也救不了。
 * **豁免换来的替代约束就是本文件。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这份判据钉的是什么
 *
 * 不是"两者像素一致"（做不到：一个是 SVG，一个是 `react-native-svg`），
 * 而是三条**会真的漂移、且抄错了不会报错**的东西：
 *
 *   1. **几何**：`VIEWBOX` / `STROKE` 必须等于设计系统里的
 *      `--ht-size-focus-ring` / `--ht-size-focus-ring-stroke`；
 *   2. **语义色是同一个 token**：复刻件写的 CSS 变量（`--ht-color-border`）
 *      与共享组件取的 token key（`color.border`）必须**指向同一个 token** ——
 *      改名而不改另一侧，这里会红；
 *   3. **描边端点与起始角**：`strokeLinecap="round"` 与 `-90deg` 起始角，
 *      两端都得有（少了任何一处，环看起来就"不是那一只"，而没有任何东西会报错）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件第一次跑就抓到了一处真漂移（保留记录）
 *
 * 第 1 组里那条"尺寸走 token"的断言，**首跑即红**：
 * 复刻件原本把 SVG 的尺寸写死成 `width="11.25rem" height="11.25rem"` ——
 * 它与 `--ht-size-focus-ring` **当前同值**，所以**看起来完全没错**，
 * 而 token 一旦改（或深色主题覆盖）就不会跟。已改成 `mockup.css` 里的
 * `.mk-focus__ring svg { width: var(--ht-size-focus-ring) }`。
 *
 * 同一轮里还有一处**我自己的**错，也记下来，因为它是"锚点自检"价值的证据：
 * 第一版 `tokenValue()` 只取分号之前的部分（`11.25rem`），而人读的 `180px`
 * 在**行尾注释**里 ⇒ 永远抓不到。因为该 helper 的设计是"抓不到就**抛错**"
 * 而不是"返回 undefined 然后判据静默通过"，错误当场暴露；
 * 若当初写的是后者，这份判据会**从头到尾是一条假绿**。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

const MOCK = readFileSync(join(HERE, '../src/mockup/FocusRing.tsx'), 'utf8');
const MOCKUP_CSS = readFileSync(join(HERE, '../src/mockup/mockup.css'), 'utf8');
const SHARED = readFileSync(join(REPO, 'packages/ui/src/focus/FocusRing.tsx'), 'utf8');
const TOKENS = readFileSync(join(REPO, 'packages/design-system/src/tokens.css'), 'utf8');

/** 浅色主题那一段（深色主题会重复定义同名 token，取错了会得到另一份值）。 */
const LIGHT_TOKENS = TOKENS.split('/* ===== 深色')[0] ?? TOKENS;

/**
 * 取 token 的**整行**（含行尾注释）。
 *
 * 🔴 必须是整行：值本身是 `11.25rem`，而**人读的 `180px` 只在注释里**。
 * 抓不到就**抛错** —— 判据锚点失效必须响，不许静默返回 `undefined` 然后"通过"。
 */
function tokenLine(name: string): string {
  // ⚠️ 行首必须有 `\s*`：token 定义都缩进两个空格（`  --ht-size-focus-ring: …`），
  // 用 `^--ht` 锚定会**一条都匹配不到**。第一版就是这么写的，
  // 于是三条断言全报"锚点失效" —— 又是"抛错而不是静默通过"救了这份判据。
  const re = new RegExp('^\\s*' + name + '\\s*:.*$', 'mu');
  const found = re.exec(LIGHT_TOKENS);
  if (found?.[0] === undefined) {
    throw new Error('判据锚点失效：tokens.css 里找不到 ' + name);
  }
  return found[0];
}

/** token 的**值**（`11.25rem`）。 */
function tokenValue(name: string): string {
  const found = /:\s*([^;]+);/u.exec(tokenLine(name));
  if (found?.[1] === undefined) throw new Error('判据锚点失效：' + name + ' 没有值');
  return found[1].trim();
}

/** 行尾注释里的人读 px（`/* 180px …`）—— 也是 SVG 的用户单位。 */
function pxFromComment(raw: string, name: string): number {
  const found = /\/\*\s*(\d+(?:\.\d+)?)px/u.exec(raw);
  if (found?.[1] === undefined) {
    throw new Error('判据锚点失效：' + name + ' 的注释里没有 px 值');
  }
  return Number(found[1]);
}

function mockNumber(name: string): number {
  const found = new RegExp('const ' + name + ' = (\\d+(?:\\.\\d+)?);', 'u').exec(MOCK);
  if (found?.[1] === undefined) {
    throw new Error('判据锚点失效：复刻件里找不到 const ' + name);
  }
  return Number(found[1]);
}

describe('#1 几何：复刻件的 VIEWBOX / STROKE = 设计系统的那两个 size token', () => {
  it('VIEWBOX === --ht-size-focus-ring 的 px', () => {
    expect(mockNumber('VIEWBOX')).toBe(
      pxFromComment(tokenLine('--ht-size-focus-ring'), 'size-focus-ring'),
    );
  });

  it('STROKE === --ht-size-focus-ring-stroke 的 px', () => {
    expect(mockNumber('STROKE')).toBe(
      pxFromComment(tokenLine('--ht-size-focus-ring-stroke'), 'size-focus-ring-stroke'),
    );
  });

  it('🔴 环的实际尺寸走 token（写死 rem 会红 —— 首跑就抓到了这一处）', () => {
    expect(MOCKUP_CSS).toMatch(/width:\s*var\(--ht-size-focus-ring\)/u);
    expect(MOCKUP_CSS).toMatch(/height:\s*var\(--ht-size-focus-ring\)/u);
    // 写死尺寸的形状：SVG 上直接给 width/height 数字。
    expect(MOCK).not.toMatch(/width="\d/u);
    expect(MOCK).not.toMatch(/height="\d/u);
  });
});

describe('#2 语义色：两侧指的是**同一个 token**', () => {
  /**
   * 🔴 这一组是**最有价值**的一条。改名的形状是这样的：
   * 某人把共享组件里的 `tokens['color.border']` 改成 `tokens['color.border-subtle']`，
   * 或把 `--ht-color-focus-work` 改名 —— 两端会**静默**变成两种颜色，
   * 而 build / typecheck / 任何现有门禁都不会报错。
   * 这里把"CSS 变量名"与"token key"钉成同一个 token 的两种写法。
   */
  const PAIRS: readonly (readonly [string, string])[] = [
    ['--ht-color-border', 'color.border'],
    ['--ht-color-focus-work', 'color.focus-work'],
  ];

  for (const [cssVar, tokenKey] of PAIRS) {
    it('复刻件用 var(' + cssVar + ') 与共享组件的对应 token key 指向同一个 token', () => {
      expect(MOCK).toContain('var(' + cssVar + ')');
      expect(SHARED).toContain("tokens['" + tokenKey + "']");
      // 两侧的名字必须是同一个 token 的 CSS 变量化 —— 确认它真的定义在 tokens.css 里。
      expect(tokenValue(cssVar).length).toBeGreaterThan(0);
    });
  }

  it('两条 token 确实不同（否则"工作段与休息段不同色"这句话是假的）', () => {
    expect(tokenValue('--ht-color-focus-work')).not.toBe(tokenValue('--ht-color-focus-break'));
  });
});

describe('#3 描边端点与起始角', () => {
  it('两端都是圆头', () => {
    expect(MOCK).toContain('strokeLinecap="round"');
    expect(SHARED).toContain('strokeLinecap="round"');
  });

  it('两端都从 12 点方向起始（-90deg）', () => {
    expect(MOCK).toContain('rotate(-90deg)');
    expect(SHARED).toContain("rotate: '-90deg'");
  });
});

/**
 * 已知残差（**刻意不断言**，写在这里免得下一个人以为是漏了）：
 *
 *   1. **复刻件只画工作段**（`--ht-color-focus-work`），不画休息段。
 *      展厅是**一帧静态画面**，只能选一个时刻；真组件按 `tone` 在
 *      `color.focus-work` / `color.focus-break` 之间切。
 *      ⇒ 断言"复刻件也要有两种颜色"是错的（它没有那个状态）。
 *      上面那条"两条 token 不同"是这条残差的**最低补偿** ——
 *      它至少保证"两种色"这件事在产品里成立。
 *   2. **计时数字的正字法**：复刻件的 `formatClock` 与领域层的 `focusDisplayText`
 *      是两份实现。展厅要的是 `15:32` 这种**绝对时钟**读数，而领域层给的是
 *      "还剩多少"的语义值，两者不同形。⚠️ 这条**有真实漂移风险**
 *      （改了领域层的格式，展厅不会跟），但目前没有便宜的判据 ——
 *      如实记下，别假装它被覆盖了。
 */
