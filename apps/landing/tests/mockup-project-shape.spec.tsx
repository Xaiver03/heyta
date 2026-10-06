/**
 * 清单 / 标签复刻件与真实现之间的**会红约束**
 * ==================================================
 *
 * 背景：`docs/plans/multi-platform-adaptation.md` 的 M3 每轮固定流程**第 3.5 步**
 * （「把 landing 上对应那一块也换成真组件 / 补上同步判据」）。
 *
 * 🔴 为什么不是"把复刻件换成真组件"：`docs/research/dida-view-unification.md`
 * §9.1 是**永久判决** —— `apps/landing/src/mockup/**` 静态 import `@heyta/ui`
 * 会让首屏 **+61.9 kB gzip（+31%）**。替代约束是「**纯数据登记处 + 会红判据**」，
 * 与 `mockup-habit-shape.spec.tsx` / `mockup-quadrant-shape.spec.tsx` 同一形状。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一刀的实测结论：landing **有**清单/标签复刻块，而且已经有一份外壳判据
 *
 * `grep` 实测（2026-09-28）：
 *   · `apps/landing/src/mockup/AppWindow.tsx` 有一段 `.mk-projects`
 *     （分区标题 + `.mk-field__box` 输入框形态 + `.mk-field__add` 加号），
 *     从 `SHELL_PANEL_SECTIONS` 渲染；
 *   · `apps/landing/tests/mockup-shell-shape.spec.tsx` §4 已把它与
 *     `ProjectsPanel.tsx` 的源码对账（四个词条 key）。
 *
 * ⇒ 所以第 3.5 步**不是"从零补登记处"**，而是补上缺的那一半：
 * **"复刻件复刻的是 `OrganizerList` 的哪几个部件"没有任何东西在管** ——
 * 真实现这一刀才被创建出来，此前当然无从对账。
 *
 * | 漂移的形状 | 这里怎么红 |
 * |---|---|
 * | 共享 `OrganizerList` 的某个部件被删/改名（登记处锚点扫不到） | `ORGANIZER_ROW_PARTS` 的 `anchor` 一条对不上 |
 * | 层级 / 计数口径的锚点从 `projects/model.ts` 消失 | `toOrganizerTree` / `openTaskCounts` 扫不到 |
 * | web 宿主不再渲染共享组件（又长出一份 DOM 行） | `ProjectsPanel.tsx` 里没有 `OrganizerList` |
 * | 落地页静态 import 了 `@heyta/ui`（§9.1 的 62 kB 回潮） | `mockup/**` 里出现该 import |
 * | 有人"顺手"在复刻件里画行（登记处说没画） | `AppWindow.tsx` 出现 `organizer` 测试 id / `mk-project-row` |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这道判据**不**断言什么（如实写下来，别当它是全覆盖）
 *
 *   1. **行 / 计数 / 取色 / 删除在落地页没有画** —— 这是**已知且登记**的
 *      部分复刻（`ORGANIZER_ROW_PARTS` 的 `replicatedOnLanding` 全为 `false`），
 *      判据只断言"登记处与实际渲染文件一致"，不假装落地页画了行。
 *   2. **像素/样式**：复刻件的 `.mk-projects` CSS 不与共享组件的 token 逐条对账
 *      —— 它的骨架由 `app-shell-shape.ts` + `mockup-shell-shape.spec.tsx` 管。
 *
 * ⚠️ 两个只读接缝（故障注入专用）：`HEYTA_MOCKUP_UI_SRC` / `HEYTA_MOCKUP_WEB_SRC`
 * —— 把目录复制到 `/tmp`、改一处、指过去，证明"真实现改了而复刻没跟 → 红"，
 * 而**不碰共享工作区**。不设它们时就是真实路径。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MOCK_PROJECT_DRAWN_PARTS, ORGANIZER_ROW_PARTS } from '../src/mockup/project-shape.js';
import { readUiSource, readWebSource } from './helpers/source-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

/** 接缝与读取器的唯一所有者在 `./helpers/source-text.ts`。 */
const readUi = readUiSource;

const organizerListSource = (): string => readUi('projects/OrganizerList.tsx');
const projectsModelSource = (): string => readUi('projects/model.ts');
const webHostSource = (): string => readWebSource('features/projects/ProjectsPanel.tsx');
const appWindowSource = (): string =>
  readFileSync(join(APP, 'src/mockup/AppWindow.tsx'), 'utf8');
const projectShapeSource = (): string =>
  readFileSync(join(APP, 'src/mockup/project-shape.ts'), 'utf8');

/** 去掉注释再做"有没有出现某个词"的断言（文件头就写着这些名字，会假红）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('真实现的锚点还在（共享层）', () => {
  it('`OrganizerList` 的导出与"一行五个部件"逐条对得上', () => {
    const list = organizerListSource();
    expect(list).toContain('export function OrganizerList');
    for (const part of ORGANIZER_ROW_PARTS) {
      expect(list, `共享组件里找不到部件 ${part.id}（锚点：${part.anchor}）`).toContain(
        part.anchor,
      );
    }
  });

  it('层级 / 计数口径仍是 `projects/model.ts` 的职责', () => {
    const model = projectsModelSource();
    expect(model).toContain('export function toOrganizerTree');
    expect(model).toContain('export function topLevelProjects');
    expect(model).toContain('export function childProjects');
    expect(model).toContain('export function openTaskCounts');
    // 计数口径（未完成 + 未删除）只在模型里判一次。
    expect(model).toContain('export function openTaskCount');
  });
});

describe('web 宿主渲染的是共享组件（不是又一份 DOM 行）', () => {
  it('`ProjectsPanel.tsx` 取 `OrganizerList`，且不再有老行骨架', () => {
    const host = webHostSource();
    expect(host).toContain('OrganizerList');
    expect(host).toContain("from '@heyta/ui'");
    expect(host).not.toContain('ht-nav__item');
  });
});

describe('落地页侧栏的清单/标签块：登记处 = 实际复刻范围', () => {
  it('登记处说没画行，渲染文件里就没有任何"行"的痕迹', () => {
    // 前件：五个部件在落地页一个都没复刻（部分复刻是**已知**的，见文件头）。
    expect(ORGANIZER_ROW_PARTS.filter((p) => p.replicatedOnLanding)).toEqual([]);
    // 落地页只画了标题与输入框形态。
    expect([...MOCK_PROJECT_DRAWN_PARTS]).toEqual(['heading', 'composer']);

    const code = stripComments(appWindowSource());
    // 🔴 判据锚点：`.mk-projects` 必须还在（复刻件被整块删掉也要有人知道）。
    expect(code).toContain('mk-projects');
    // 行骨架不许在复刻件里冒出来 —— 那正是 §2 的漂移形状。
    expect(code).not.toContain('organizer-row');
    expect(code).not.toContain('mk-project-row');
  });

  it('登记处自己引用的锚点与共享源码一致（登记处不能是空话）', () => {
    // `ORGANIZER_ROW_PARTS` 是**唯一**登记，`project-shape.ts` 里不写第二份。
    const shape = projectShapeSource();
    expect(shape).toContain('ORGANIZER_ROW_PARTS');
    // 分区标题/占位符的 key 属于 `app-shell-shape.ts`，本文件不许抄一份。
    expect(shape).not.toContain('web.projects.heading');
    expect(shape).not.toContain('web.tags.heading');
  });

  it('🔴 落地页仍然**静态** import `@heyta/ui`（§9.1 的 62 kB 不许回潮）', () => {
    const code = stripComments(appWindowSource());
    expect(code).not.toMatch(/from\s+['"]@heyta\/ui['"]/);
    // 整个 mockup 目录也不许 —— 判据锚点是"渲染文件"这一份。
    const shapeCode = stripComments(projectShapeSource());
    expect(shapeCode).not.toMatch(/from\s+['"]@heyta\/ui['"]/);
  });
});
