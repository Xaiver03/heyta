/**
 * 判据：**一行任务永远不许在没有标题的情况下渲染出来**
 * ======================================================
 *
 * 实测出处：`docs/plans/ui-review-fill-zh-timeline.md` 的 G9 条目。
 * 桌面载荷（Web 形态，macOS/Windows 壳里跑的就是这一份）真浏览器测量：
 * 视口 1440→900 时标题可用宽 519→359→199→103→39→**0**，
 * 到 900 那一档**整行只剩行尾控件，标题一个字都不显示**。
 * 截图在台账里登记（人已看）。
 *
 * 机制不是"挤到第二行"：共享行 `body` 是 `flex: 1`，在 RNW 上算出
 * `flex-basis: 0%` —— 它只拿"行尾要完之后剩下的"。宿主行尾那一坨常驻控件
 * `flex-basis: auto`，于是窄窗口下剩余宽恰好是 0。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据分两组，各挡一种回归
 *
 *   A. **共享层有下限**：`TaskRow.tsx` 的 `body` 样式块里必须有一条
 *      **百分比** `minWidth`，且 `flex: 1` 仍在。把那一行删掉 ⇒ 红。
 *      百分比而非固定 px：px 下限不随视口缩放，换窗口就回到 0 宽。
 *   B. **宿主层允许折行**：下限单独加会把行尾推出可视区（实测 a 档
 *      「尾出界」），必须配合 `flexWrap: 'wrap'`；折行后还要
 *      `justifyContent: 'flex-end'`，否则第二行从左边缘起、压进标题列。
 *      把 `flexWrap` 删掉 ⇒ 红（实测 b 档：标题回到 0）。
 *
 * 阈值为什么是 20%–50%（不是随手挑的）：
 *   · 820 视口下行的可用宽 ≈ 468，**20% 只给标题 ~93px**（约一个半汉字）——
 *     那与"没有标题"只差一点点，所以下限必须 ≥ 20%；
 *   · 1440 视口下行尾实测要 517px ≈ 整行的 48%，**下限一旦超过一半，
 *     宽窗口上每一行都会折成两行**（连标题很短的也是），所以必须 ≤ 50%。
 *   当前取值 30% 落在这两个数之间；820 视口下实测标题拿到 140px。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 这道判据**抓不到**什么
 *
 * 1. **它不测像素**：判据断的是"下限与折行都还在、位置对"，
 *    "窄窗口下真的看得见标题"只能靠真浏览器截图（§6.2 规定一），
 *    那条已经做过并登记在台账，不在这个文件里复现。
 * 2. 它不约束**行尾有多少个控件** —— 那是产品取向（hover 才显形？收进 ⋯ 菜单？），
 *    归产品负责人拍板；这里钉的是"无论宿主塞多少，标题不能被挤没"。
 * 3. 它读的是**各自一份源码**：将来若有第二个宿主也喂常驻行尾，
 *    要像 B 组那样各自补一条，而不是指望这里自动覆盖。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 用 `process.cwd()`（= `apps/web`）：本套件跑在 jsdom，`import.meta.url`
 * 不是 `file:`，配 `readFileSync` 会报 `The URL must be of scheme file`。
 */
const repoRoot = resolve(process.cwd(), '..', '..');

/**
 * 剥掉注释再断言。
 * 这两个文件都**故意**在注释里写出被禁止的形态来讲解判据（`minWidth: 0`、
 * `density ===` 都是这个形状）—— 不剥注释，判据会被自己的说明文字弄红。
 */
function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

const codeOf = (pathFromRepoRoot: string): string =>
  stripComments(readFileSync(resolve(repoRoot, pathFromRepoRoot), 'utf8'));

/**
 * 取出 `body: { … } as const` 这一整块样式（含大括号）。
 *
 * 🔴 必须**按块**取而不是整文件匹配：`minWidth` 这类属性出现在好几个样式块里，
 * 整文件断言会"在下拉框上也有一条下限"时假绿。括号自己配对数，
 * 这样嵌套对象（`body` 里没有，但同类样式表里有）不会把结束点提前。
 */
function styleBlock(source: string, key: string): string {
  const start = source.indexOf(`${key}: {`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start + key.length + 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

const ROW = codeOf('packages/ui/src/task-list/TaskRow.tsx');
const APP = codeOf('apps/web/src/App.tsx');
const BODY = styleBlock(ROW, 'body');

/**
 * 从 `from` 往后取**第一处** `style={{ … }}`（大括号自己配对）。
 *
 * 🔴 为什么不是"取到下一个 `const render` 为止"：实测 App.tsx 里
 * `renderTaskTrailing` 之后**没有**别的 `const render` 了（右边界 = -1），
 * 那样切的区间是"到文件尾"—— 于是"页面里别处有一句 `flexWrap`"就能骗过判据。
 * 按块取才钉得住"是**行尾那一层容器**在折行"。
 */
function firstStyle(source: string, from: number): string {
  const start = source.indexOf('style={{', from);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start + 'style='.length; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

const TAIL_DEF = APP.indexOf('const renderTaskTrailing = useCallback(');
// 🔴 锚点找不到时必须是空串，不能让 `indexOf(…, -1)` 退化成"从文件头找第一个 style"
//    —— 那会让下面两条改成"给页面里随便一个容器打分"。
const TAIL_STYLE = TAIL_DEF < 0 ? '' : firstStyle(APP, TAIL_DEF);

describe('一行任务必须始终渲染出它的标题', () => {
  it('前提：两个被测锚点都还在（找不到块 = 判据在测空气）', () => {
    expect(ROW.length, 'TaskRow.tsx 读到了吗').toBeGreaterThan(0);
    expect(APP.length, 'App.tsx 读到了吗').toBeGreaterThan(0);
    // 🔴 块取不到时是空串，而空串上 `/minWidth/.test('')` 只是"没匹配"——
    //    那会让下面每一条都变成"永远不红"。先断言它真的存在。
    expect(BODY.length, '没在 TaskRow.tsx 里找到 body 样式块').toBeGreaterThan(0);
    expect(BODY).toContain('flex');
  });

  it('A1. body 有一条百分比宽度下限（删掉那一行 ⇒ 红）', () => {
    const raw = BODY.match(/minWidth:\s*'([^']*)'/)?.[1];
    expect(raw, 'body 没有 minWidth 下限 ⇒ 窄窗口下标题会被行尾控件挤到 0 宽').toBeDefined();
    expect(raw, '下限必须是百分比：固定 px 不随视口缩放').toMatch(/^[\d.]+%$/);
  });

  it('A2. 下限落在 20%–50% 之间（阈值来源见文件头，两边都有实测依据）', () => {
    const percent = Number(BODY.match(/minWidth:\s*'([\d.]+)%'/)?.[1]);
    expect(Number.isFinite(percent), '解析不出下限数值').toBe(true);
    expect(percent, '低于 20% 时 820 视口只剩 ~93px，等于没有标题').toBeGreaterThanOrEqual(20);
    expect(percent, '高于 50% 时宽窗口也会每行折两行').toBeLessThanOrEqual(50);
  });

  it('A3. 下限不许写成裸数字或 px（那条路会让标题重新可变 0）', () => {
    // 未加引号的数字（`minWidth: 240`）—— RNW 会当 px 用，不随视口缩放。
    expect(BODY, 'minWidth 不许是裸数字').not.toMatch(/minWidth:\s*[\d.]+\s*[,}]/);
    // 带引号但单位是 px。
    const raw = BODY.match(/minWidth:\s*'([^']*)'/)?.[1] ?? '';
    expect(raw, 'minWidth 不许是 px').not.toMatch(/px$/);
  });

  it('A4. body 仍是 flex: 1（"下限是剩余宽的下限"这个前提）', () => {
    expect(BODY).toMatch(/flex:\s*1\b/);
    // `minWidth: 0` 与百分比下限互斥：0 就是"没有下限"。
    expect(BODY).not.toMatch(/minWidth:\s*'0/);
  });

  it('B1. 宿主行尾那层容器允许折行（只加下限会把控件推出可视区，实测 a 档 FAIL）', () => {
    expect(TAIL_DEF, '找不到 `const renderTaskTrailing = useCallback(` ⇒ 这两条在测空气').toBeGreaterThanOrEqual(0);
    expect(TAIL_STYLE.length, '没取到行尾容器的 style 块 ⇒ 判据没在测任何东西').toBeGreaterThan(0);
    expect(TAIL_STYLE, '行尾不换行 ⇒ 窄窗口下控件出界').toMatch(/flexWrap:\s*'wrap'/);
  });

  it('B2. 折行后仍右对齐（否则第二行从左边缘起、压进标题列）', () => {
    expect(TAIL_STYLE).toMatch(/justifyContent:\s*'flex-end'/);
    expect(TAIL_STYLE).toMatch(/alignContent:\s*'center'/);
  });

  it('B3. 下限与折行必须同时在（缺一档实测就是红的）', () => {
    // 这条只把"两者是一组"写死，防止有人"修一半就提交"：
    // 实测 a 档（只有下限）尾出界、b 档（只有折行）标题 0 宽。
    const hasFloor = /minWidth:\s*'[\d.]+%'/.test(BODY);
    const hasWrap = /flexWrap:\s*'wrap'/.test(TAIL_STYLE);
    expect(hasFloor && hasWrap, `下限=${hasFloor} 折行=${hasWrap}：必须同时成立`).toBe(true);
  });
});
