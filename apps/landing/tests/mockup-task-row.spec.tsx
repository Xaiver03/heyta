/**
 * 展厅那一行与 `packages/ui` 之间的**会红约束**
 * ==============================================
 *
 * 背景：`docs/research/dida-view-unification.md` §4.5 / §8.3。
 *
 * `apps/landing/src/mockup/` 手工复刻了应用外壳与任务行，是"五处漂移"的来源，
 * 而且**每迁一个视图，landing 就多漂一处**。更糟的是当时**没有任何东西会因此报错**：
 * `check:design` 管取值来源、`check:ui-language` 管硬编码文案、
 * `check:claims` 管页面上的验证链接 —— 没有一条在问"复刻件抄的是不是产品那一组取值"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么不是"把展厅换成真组件"（试过，有数字）
 *
 * `@heyta/ui` 是 RN 组件，Web 端要靠 `react-native-web`。2026-09-28 实测：
 *
 * | 方案 | 首屏 `main-*.js` | 另取 |
 * |---|---|---|
 * | 静态 import 真组件 | 199,000 → **260,897 B gzip**（+31%） | — |
 * | 懒加载孤岛 | 198,975 B gzip（不变） | `TaskListLive` **83,578 B gzip** |
 *
 * 孤岛救不了：`Hero.tsx` 也渲染这个展厅，实测 1280×800 下展厅的 `top` 是 **529px**，
 * **就在首屏**，chunk 在 `load` 后约 90ms 就被取回 —— 总字节反而更多
 *（199+84=283 kB gzip > 262 kB），只换来"不阻塞首屏渲染"。
 *
 * 所以结论是**真组件不进落地页**（理由与仓库把 131 kB gzip 的 `three`
 * 拆成按需 chunk 是同一条）。漂移改用**契约**解决。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 会红的约束落在哪儿
 *
 * `packages/design-system/src/task-row-shape.ts` 的 `TASK_ROW_SHAPE` /
 * `TASK_ROW_TEXT` 是**一行用哪些 token** 的唯一登记处，`packages/ui` 的 RN 行
 * **从它取值**。本文件把 `mockup.css` 里那一节的每一个 token 名与它**逐项比对**：
 *
 * | 漂移的形状 | 这里怎么红 |
 * |---|---|
 * | 共享行换了 token，落地页没跟 | 缺 `var(--ht-<新 token>)` |
 * | 落地页自己挑了一组别的 token | 同上（契约里的那个找不到） |
 * | 有人把 20px 的圆勾选框抄回来（**真实发生过**） | 「不许出现 `--ht-icon-md`」 |
 * | 有人把标题抄成 `font-size-sm`（**真实发生过**） | `.mk-task__title` 规则逐项对账 |
 * | 有人在别处 import `@heyta/ui` / `react-native-web` | 源码扫描 |
 * | 有人又手抄一个新的界面块 | `mk-*` 族数超预算 |
 *
 * ⚠️ 与 `tests/theme-contract.spec.ts` 同一个做法：**不 import 对面那个包**找你
 *（`apps/*` 之间不许互相依赖，而 `@heyta/ui` 在 Node 里根本加载不了 ——
 * 它是 Flow 源码写的 RN 包，`SyntaxError: Unexpected token 'typeof'`）。
 * 这里比的是"两份源码里的 token 名一致"这件事本身。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cssVarName, TASK_ROW_SHAPE, TASK_ROW_TEXT, TEXT_STYLES } from '@heyta/design-system';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

/**
 * `mockup.css` 里 `mk-*` 前缀族的**预算**（§5「CSS 前缀族只减不增」）。
 *
 * 34 → **32**：与真应用对齐时，`.mk-project`（旧的手写静态清单名，一行一个名字）
 * 成了**死规则** —— 真应用 `ProjectsPanel` 是「输入框 + `+`」，复刻已改用它，
 * 那个选择器全仓再无引用。删掉它属于"删手工复刻与样式"这一步的收尾。
 * 这一条现在只防**新增**界面块；行本身的取值由下面的契约比对钉住。
 */
const MOCKUP_CSS_FAMILY_BUDGET = 32;

/** 只取 `.mk-task*` 那一节：别的展厅块里出现同名 token 不算数。 */
function taskSection(): string {
  const css = readFileSync(join(APP, 'src/mockup/mockup.css'), 'utf8');
  const start = css.indexOf('/* ── 任务列表');
  const end = css.indexOf('/* ── 四象限');
  if (start < 0 || end < start) throw new Error('mockup.css 里找不到任务列表那一节');
  // 剥掉注释：说明文字里**故意**写着那几个"已经删掉的 token 名"。
  return css.slice(start, end).replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

/** 取出某条规则的规则体（第一条匹配）。 */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`mockup.css 里找不到规则：${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function sourceFiles(directory: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('任务行的形状 = 共享契约', () => {
  it('`TASK_ROW_SHAPE` 里的每一个 token 都出现在展厅那一行的 CSS 里', () => {
    const css = taskSection();
    /**
     * 契约里**允许**不出现在复刻件上的槽位。每一项都要写明理由 ——
     * 这是一个显式白名单，不是"算了吧"。
     *
     * `touchTarget`：勾选框的**触控区**下限（44）。共享行靠一圈负外边距把
     * 触控区拉回来与屏幕留白对齐；而展厅整块是 `pointer-events: none` 的
     * 展示品（见 `mockup.css` 的 `.mk-frame`），**没有命中区要去补偿**。
     */
    const NOT_IN_REPRODUCTION = new Set(['touchTarget']);

    const checked = Object.entries(TASK_ROW_SHAPE).filter(
      ([slot]) => !NOT_IN_REPRODUCTION.has(slot),
    );
    // 白名单不许悄悄长大。
    expect(checked.length).toBe(Object.keys(TASK_ROW_SHAPE).length - NOT_IN_REPRODUCTION.size);

    for (const [slot, token] of checked) {
      // 🔴 `cssVarName()` 来自 design-system 自己 —— 不用手拼 `--ht-...`：
      // 拼错的话（比如把 `.` 写成 `_`）这条断言会"通过"，而页面上那个变量
      // 解析不到值、静默塌成 0。那正是设计系统存在的理由。
      expect(
        css,
        `契约里的 ${slot} = ${token}（${cssVarName(token)}）没出现在 mockup.css 的任务列表一节`,
      ).toContain(`var(${cssVarName(token)})`);
    }
  });

  it('标题与元信息的排版逐项等于 `TASK_ROW_TEXT` 的语义样式', () => {
    const css = taskSection();

    const title = ruleBody(css, '.mk-task__title');
    const titleSpec = TEXT_STYLES[TASK_ROW_TEXT.title];
    for (const [part, token] of [
      ['font-size', titleSpec.size],
      ['font-weight', titleSpec.weight],
      ['line-height', titleSpec.leading],
      ['letter-spacing', titleSpec.tracking],
    ] as const) {
      expect(
        title,
        `.mk-task__title 的 ${part} 必须等于 row-title 的 ${token}`,
      ).toContain(`var(${cssVarName(token)})`);
    }

    const meta = ruleBody(css, '.mk-task__meta');
    const metaSpec = TEXT_STYLES[TASK_ROW_TEXT.meta];
    for (const [part, token] of [
      ['font-size', metaSpec.size],
      ['font-weight', metaSpec.weight],
      ['line-height', metaSpec.leading],
      ['letter-spacing', metaSpec.tracking],
    ] as const) {
      expect(meta, `.mk-task__meta 的 ${part} 必须等于 row-meta 的 ${token}`).toContain(
        `var(${cssVarName(token)})`,
      );
    }
  });

  it('那两处**真实发生过的**漂移不许回来', () => {
    const css = taskSection();

    // 勾选框曾经抄的是 `--ht-icon-md`（20px）+ 圆形；共享行是
    // `size.checkbox`（22px）+ `radius.sm`。
    expect(css, '勾选框又抄成 --ht-icon-md 了（共享行用的是 size.checkbox）').not.toContain(
      'var(--ht-icon-md)',
    );
    expect(css, '勾选框又抄成圆形了（共享行用的是 radius.sm）').not.toContain(
      'var(--ht-radius-full)',
    );

    // 标题曾经抄成 `--ht-font-size-sm`；`row-title` 是 `font-size.base`。
    //（`--ht-font-size-sm` 仍然合法 —— 它是 `row-meta` 的字号，用在元信息那一行。）
    const title = ruleBody(css, '.mk-task__title');
    expect(title, '标题又抄成 --ht-font-size-sm 了（row-title 用的是 font-size.base）').not.toContain(
      'var(--ht-font-size-sm)',
    );
  });
});

describe('首屏包不许变大', () => {
  it('落地页源码里不出现 `@heyta/ui` / `react-native` / `react-native-web`', () => {
    const offenders = sourceFiles(join(APP, 'src'))
      .filter((file) => /from '(?:@heyta\/ui|react-native|react-native-web)'/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(APP, file).split('\\').join('/'));

    expect(
      offenders,
      '静态引进 RN 组件会让首屏 main-*.js 从 199 kB 涨到 261 kB gzip（+31%）；\n' +
        '展厅走的是"形状契约"这条路，见 src/mockup/TaskList.tsx 文件头。',
    ).toEqual([]);
  });

  it('`vite.config.ts` 里没有 `react-native` → `react-native-web` 的别名', () => {
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
    // 别名一旦回来，就说明有人又在往展厅里塞真组件 —— 那 62 kB 会静默回到首屏。
    expect(config).not.toContain('reactNativeWebDir');
    expect(config).not.toMatch(/resolve:\s*\{[\s\S]*alias/);
  });
});

describe('复刻件的 CSS 只减不增', () => {
  it(`mk-* 前缀族数量 ≤ ${String(MOCKUP_CSS_FAMILY_BUDGET)}`, () => {
    const css = readFileSync(join(APP, 'src/mockup/mockup.css'), 'utf8');
    const families = [
      ...new Set([...css.matchAll(/^\.(mk-[a-z0-9]+)/gm)].map((match) => match[1] ?? '')),
    ].sort();

    expect(
      families.length,
      `mockup.css 的 mk-* 族变多了：${families.join(', ')}\n` +
        '新增一个界面块之前先问：它能不能做成 packages/ui 的组件？',
    ).toBeLessThanOrEqual(MOCKUP_CSS_FAMILY_BUDGET);
  });
});
