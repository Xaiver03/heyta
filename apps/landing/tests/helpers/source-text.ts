import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 读**产品源码文本**当判据输入时共用的几件小事。
 *
 * 🔴 为什么单独一枚文件：`mockup-shell-shape` 与 `mockup-fidelity` 都要"从 web 源码里
 * 数某个名字出现在**代码**里几次"。这类判据最容易的坏法是**扫到自己的说明注释**——
 * `App.tsx` 里那句"共享的 `TodayProgressCard` 没有删"是一段历史说明，它字面上含那个名字，
 * 却不是一次引用。两处各写一遍剥注释的正则，就是从"同一个判断写两次"开始漂的
 * （AGENTS §3.5 同形状的第二次）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LANDING = resolve(HERE, '../..');

/**
 * 产品源码根。⚠️ 这枚 env 旋钮是**变异台架**用的（把判据指向一棵临时树，
 * 不它就只能改真源码）；不设它时就是真实路径。
 */
export const WEB_SRC = process.env.HEYTA_MOCKUP_WEB_SRC ?? join(LANDING, '../web/src');

/** 共享层源码根。⚠️ 与上面同一族：变异台架专用，含义与用法逐字相同。 */
export const UI_SRC = process.env.HEYTA_MOCKUP_UI_SRC ?? join(LANDING, '../../packages/ui/src');

/** 读 web 侧某个源文件（相对 `apps/web/src`）。 */
export function readWebSource(relativePath: string): string {
  return readFileSync(join(WEB_SRC, relativePath), 'utf8');
}

/** 读共享层某个源文件（相对 `packages/ui/src`）。 */
export function readUiSource(relativePath: string): string {
  return readFileSync(join(UI_SRC, relativePath), 'utf8');
}

/** `apps/web/src/App.tsx` —— 外壳与"做事"视图的接线处。 */
export function readWebAppSource(): string {
  return readWebSource('App.tsx');
}

/** 剥掉块注释与行注释。⚠️ 行注释那条要求前面是 `{` 或行首，否则会咬到 URL。 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{?\/\/[^\n]*/g, '');
}

/** 某个标识符在**代码**（已剥注释）里出现的次数。`name` 只许传标识符。 */
export function codeOccurrences(source: string, name: string): number {
  return [...stripComments(source).matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
}
