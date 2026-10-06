/**
 * AI 面板的"这条提案作用在哪条任务上" = **表单草稿**，不许长成第二个选中所有者。
 * ==============================================================================
 *
 * 起因是 `pnpm check:selection-single-source` 的断言 B 把 `AssistantScreen.tsx` 里两处
 * `const [selectedId] = useState<…>` 报成"宿主重新长出本地选中态"。逐处读过之后结论是
 * **两边都不许**：
 *
 * · 把它接进共享的 `'task'` 槽 ⇒ 现量后果在 `screens/TasksScreen.tsx`：
 *   `const detailTaskId = useSelected('task')` 直接喂给一枚
 *   `visible={detailTaskId !== null}` 的详情 Modal —— 在 AI 面板里点一条任务，
 *   任务详情就弹出来。那不是"跨视图保持选中"，那是**面板劫持了导航**。
 * · 把它改名绕开 B 的名字形状 ⇒ 正是门禁文件头 H1/H2 两条臂 built 要拦的那种写法。
 *
 * 所以这一族的本分是：状态留在面板里，**档位登记成 `form-draft`**（门禁的封闭词表第五档），
 * 而"不许接进共享选中态"这件事由本文件钉住 —— 否则第五档只是第四个借口。
 *
 * 🔴 本仓库的移动端测试通道是**源码级**的（node 环境，无 RTL / 无 jsdom，理由原文见
 * `profile-avatar-entry.spec.ts` 文件头）。每条负向断言都配**正向对照**：
 * "没命中"必须能区分"确实没有"与"探针根本没读到文件"。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const here = new URL('.', import.meta.url);
const read = (rel: string): string =>
  // 🔴 先剥注释再判形状（§8.130 为此撞过两处）：本文件头的注释里逐字写着被禁的那个写法。
  readFileSync(new URL(rel, here), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const PANELS = '../src/ai/AssistantScreen.tsx';
const TASKS_SCREEN = '../src/screens/TasksScreen.tsx';
const GATE = '../../../scripts/check-selection-single-source.mjs';

describe('AI 面板不碰共享选中态', () => {
  const source = read(PANELS);

  it('两个面板各自持有本地草稿（两处声明，名字就是门禁登记的那个）', () => {
    expect(source.match(/const \[targetTaskId, setTargetTaskId\] = useState/g) ?? []).toHaveLength(2);
  });

  it('🔴 全文件没有 import 选中态、没有 useSelected、没有 selection.select', () => {
    expect(source).not.toMatch(/from '\.\.\/lib\/selection'/);
    expect(source).not.toMatch(/\buseSelected\w*\s*\(/);
    expect(source).not.toMatch(/\bselection\.select\w*\s*\(/);
  });

  it('草稿在提交那一刻冻进 `frozen.taskId`（所有权交接只发生一次）', () => {
    expect(source.match(/setFrozen\(\{ taskId: task\.id/g) ?? []).toHaveLength(2);
  });

  it('正向对照：共享槽确实连着任务详情的可见性（否则上面那条负向判据的理由已经失效）', () => {
    const tasks = read(TASKS_SCREEN);
    expect(tasks).toMatch(/from '\.\.\/lib\/selection'/);
    expect(tasks).toMatch(/const detailTaskId = useSelected\('task'\)/);
    expect(tasks).toMatch(/visible=\{detailTaskId !== null\}/);
  });
});

describe('第五档 `form-draft` 的存在与被登记（门禁侧对账）', () => {
  const gate = read(GATE);

  it('封闭词表里确实有这一档', () => {
    expect(gate).toMatch(/const ROW_ID_CLASSES = \[[^\]]*'form-draft'/);
  });

  it('住户就是 AssistantScreen 那一处，且没有别的文件混进这一档', () => {
    const rows = [...gate.matchAll(/\['([^']+)', '([^']+)', 'form-draft'\]/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(rows).toEqual(["apps/mobile/src/ai/AssistantScreen.tsx targetTaskId"]);
  });
});
