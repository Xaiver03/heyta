/**
 * 真实用户旅程：从零开始把 AI 记忆用一遍（**真端点**）
 * ======================================================
 *
 * ## 这条测试补的是哪个洞
 *
 * 在此之前，这一块的验证是**两半、从来没接上过**：
 *
 * | 层 | 怎么验的 | 缺什么 |
 * |---|---|---|
 * | 函数层 | `verify-ai-preferences-live.mjs` 直接调 `requestBreakdown`，**真端点** | 不经过界面、不经过 op-log |
 * | 界面层 | `ai-breakdown.spec.tsx` 挂真组件点按钮，**假 fetch** | 真模型从没被界面调过 |
 *
 * 于是"用户在界面上点拆解 → 真模型回话 → 勾选 → 写入备注 → 反馈落库 →
 * 偏好可见 → 忘掉一条 → 刷新后还记着"这条**完整旅程一次都没跑过**。
 *
 * 而本仓库最高发的失效形状恰恰是**每一段都绿、接起来断**：
 * `memory.ts` 零调用方（7 轮）、`healthSeed` 从没接线、`describeEndpointHealth`
 * 零调用点。单看任何一段的证据都很好，缺的正是这条线。
 *
 * ## 这里**没有一处 mock**
 *
 * - 真 `App`（不是单独挂某个组件）
 * - 真 `OpLogEngine` + 真 IndexedDB（`fake-indexeddb`）
 * - 真 `localStorage` 设置存储
 * - 真密钥内存存储
 * - 🔴 **真 `fetch`** —— `AiBreakdown` 的 `fetchImpl` 只在测试注入，
 *   这里**故意不传**，于是走 `globalThis.fetch`，请求真的发到配置的端点
 *
 * ## 配置与跳过
 *
 * 用 `/tmp/heyta-ai-live/provider.json`（与两个 live 脚本同一个文件）。
 * 没配就**跳过** —— 没配端点不是失败，是"还没配"。
 */

import { readFileSync } from 'node:fs';

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OpType } from '@heyta/sync-core';

import {
  __resetOpLogForTests,
  currentState,
  dispatchIntent,
  initOpLog,
} from '../src/lib/oplog.js';

// ── 真端点配置 ───────────────────────────────────────────────────────────
const CONFIG_PATH = process.env['HEYTA_AI_LIVE_CONFIG'] ?? '/tmp/heyta-ai-live/provider.json';

interface LiveConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

function loadConfig(): LiveConfig | undefined {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<LiveConfig>;
    if (typeof raw.endpoint !== 'string' || typeof raw.apiKey !== 'string') return undefined;
    return { endpoint: raw.endpoint, apiKey: raw.apiKey, model: raw.model ?? 'gpt-4o-mini' };
  } catch {
    return undefined;
  }
}

const CONFIG = loadConfig();

// ── IndexedDB：真实现（内存版），不是 mock ───────────────────────────────
(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 把 React 的更新与微任务都冲干净。 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 轮询等到条件成立（真网络调用要等）。 */
async function waitFor(
  label: string,
  cond: () => boolean,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await flush();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
  // 🔴 超时必须抛，而且要带上当时的界面文本 ——
  // 否则失败信息只有"等超时了"，等于把现场丢掉了。
  throw new Error(
    `等待「${label}」超时（${String(timeoutMs)}ms）\n当前界面文本：\n${(container?.textContent ?? '').slice(0, 900)}`,
  );
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

/** 受控 input：必须走原生 setter + input 事件，否则 React 收不到。 */
function type(el: Element | null | undefined, value: string): void {
  const input = el as HTMLInputElement | null;
  if (input === null) throw new Error('要输入的元素不存在');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressEnter(el: Element | null | undefined): void {
  act(() => {
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

const byTestId = (id: string): Element | null =>
  container?.querySelector(`[data-testid="${id}"]`) ?? null;
const bySelector = (s: string): Element | null => container?.querySelector(s) ?? null;
const byText = (tag: string, text: string): Element | null =>
  [...(container?.querySelectorAll(tag) ?? [])].find((e) => e.textContent?.trim() === text) ??
  null;

/** 切到某个视图（顶部 tab）。 */
function switchView(label: string): void {
  click(byText('button[role="tab"]', label));
}

/**
 * 铺垫"这个用户已经用了一阵子"的历史数据。
 *
 * 🔴 为什么必须铺：`inferPreferences` 有 `MIN_SAMPLE_SIZE = 8` 的冷启动门槛。
 * 不铺的话偏好一条都算不出来，后续「看到偏好 → 忘掉一条」就无从验证 ——
 * 而那正是 M6 的验收判据。**不许为了让测试好过而降低门槛。**
 *
 * 铺的是**真 op**（走 `dispatchIntent`），不是往 state 里塞对象。
 */
async function seedHistory(): Promise<void> {
  const day = 86_400_000;
  const base = Date.now() - 30 * day;

  for (let i = 0; i < 14; i += 1) {
    // 每个任务带 6 项左右的清单 → 让 P4（拆解粒度）有信号
    const note = ['- [ ] 一', '- [ ] 二', '- [ ] 三', '- [ ] 四', '- [ ] 五', '- [ ] 六'].join('\n');
    await dispatchIntent({
      entityType: 'TASK',
      entityId: `seed-task-${String(i)}`,
      opType: OpType.Create,
      payload: {
        title: `整理第 ${String(i)} 份周报的要点并发出`,
        note,
        completedAt: base + i * day,
      },
    });
  }

  // 专注记录：实际用时约为估计的 1.8 倍 → 让 P1（估算偏差）有信号
  for (let i = 0; i < 16; i += 1) {
    const planned = 25 * 60_000;
    await dispatchIntent({
      entityType: 'FOCUS_SESSION',
      entityId: `seed-focus-${String(i)}`,
      opType: OpType.Create,
      payload: {
        kind: 'work',
        plannedMs: planned,
        actualMs: Math.round(planned * 1.8),
        completed: true,
        startedAt: base + i * 3_600_000,
        endedAt: base + i * 3_600_000 + planned,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────

describe.skipIf(CONFIG === undefined)('真实用户旅程：AI 记忆从头到尾', () => {
  beforeEach(async () => {
    localStorage.clear();
    __resetOpLogForTests();
    await initOpLog();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function mountApp(): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<App />);
    });
    await flush();
  }

  /**
   * 在设置界面里把 AI 配起来：开三闸 → 加端点 → 填地址模型 → 存密钥 → 授权。
   * **全部点真界面**，没有一处写 localStorage 抄近路。
   */
  async function configureAiThroughUi(): Promise<void> {
    switchView('设置');
    await flush();

    click(bySelector('#ai-enabled'));
    click(bySelector('#ai-allow-remote'));
    await flush();

    click(byTestId('add-custom-endpoint'));
    await flush();

    const item = byTestId('endpoint-custom-1');
    expect(item, '加自定义端点后应该出现一行端点').not.toBeNull();
    type(item?.querySelector('[aria-label$="的地址"]'), CONFIG?.endpoint ?? '');
    type(item?.querySelector('[aria-label$="的模型"]'), CONFIG?.model ?? '');
    await flush();

    // 密钥只进内存（本会话），点"记住"
    const keyInput = item?.querySelector('[aria-label$="的密钥"]');
    expect(keyInput, '端点行应该有密钥输入框').not.toBeNull();
    type(keyInput, CONFIG?.apiKey ?? '');
    click(byText('button', '记住（本次会话）'));
    await flush();

    // 声明能力：`breakdown` 要求 `structured_output` **和** `long_context`
    // 两项（`DEFAULT_FEATURE_CAPABILITIES`，ADR-0010 §3.4）。
    //
    // ⚠️ 这里有个真实的坑，值得记下来：端点 `capabilities` 未声明时**隐式默认**
    // 是 `['structured_output']`，而勾选框按"未声明 = 全不勾"渲染 ——
    // 于是一勾 `long_context`，那份隐式默认就被挤掉了，
    // 端点反而**不再满足 breakdown**。
    // 设置界面会用「能力缺口」提示这件事（所以用户是被告知的），
    // 真实用户照着提示补勾即可 —— 这里就照做。
    click(item?.querySelector('[aria-label$="的能力 structured_output"]'));
    click(item?.querySelector('[aria-label$="的能力 long_context"]'));
    await flush();

    // 把端点路由到「拆解」功能（出厂不预置任何路由）
    const featureRow = byTestId('feature-breakdown');
    expect(featureRow, '应该出现「拆解」功能行').not.toBeNull();
    const chip = [...(featureRow?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.includes('自定义端点'),
    );
    expect(chip, '功能行里应该有刚加的端点可选项').not.toBeUndefined();
    click(chip);
    await flush();

    // 授权数据出境（按功能绑定）
    const consent = byTestId('consent-breakdown');
    expect(consent, '有远端端点时 breakdown 应该要求授权').not.toBeNull();
    click(consent?.querySelector('button'));
    await flush();
  }

  it(
    '🔴 真端点：配好 → 建任务 → 拆解 → 取舍 → 写备注 → 反馈落库 → 偏好可见 → 忘掉 → 刷新后仍在',
    async () => {
      // ══ 0. 历史数据（真 op）══════════════════════════════════════════
      await seedHistory();
      await flush();

      // ══ 1. 挂真 App ═════════════════════════════════════════════════
      await mountApp();
      expect(byText('button[role="tab"]', '任务'), 'App 应该渲染出视图 tab').not.toBeNull();

      // ══ 2. 在界面上配置 AI（含密钥）═════════════════════════════════
      await configureAiThroughUi();

      // 打开记忆总开关 —— 这一条是 M6 的前提
      click(bySelector('#ai-memory-enabled'));
      await flush();


      // ══ 3. 回任务，建一条任务 ═══════════════════════════════════════
      switchView('任务');
      await flush();

      const composer = bySelector('input[placeholder^="添加任务"]');
      expect(composer, '找不到捕获输入框').not.toBeNull();
      type(composer, '把新版本发到生产环境');
      pressEnter(composer);

      // 🔴 不能只 flush() 一次就断言：任务落库要过 op-log 引擎，是异步的。
      // 一次微任务冲刷在负载下不够 —— 症状是「单独跑必过、成套并行跑偶发失败」，
      // 这种形态最容易被误判成"环境问题"而放过去。
      await waitFor('回车后任务落进 op-log', () =>
        Object.values(currentState().tasks).some((t) => t.title === '把新版本发到生产环境'),
      );

      const task = Object.values(currentState().tasks).find(
        (t) => t.title === '把新版本发到生产环境',
      );
      expect(task, '回车后任务应该落进 op-log').toBeDefined();
      const taskId = task?.id ?? '';

      // ══ 4. 点拆解 —— 真网络调用，零注入 ═════════════════════════════
      click(byTestId(`ai-breakdown-${taskId}`));
      await flush();
      click(byTestId('ai-send'));

      await waitFor(
        '真模型返回拆解结果',
        () => byTestId('ai-proposal') !== null || byTestId('ai-failed') !== null,
      );
      if (byTestId('ai-failed') !== null) {
        throw new Error(
          `真实拆解失败：${byTestId('ai-failure-message')?.textContent ?? '(无原因)'}`,
        );
      }

      const itemCount = container?.querySelectorAll('[data-testid^="ai-item-"]').length ?? 0;
      expect(itemCount, '真模型应该拆出 2 项以上').toBeGreaterThanOrEqual(2);

      // ══ 5. 逐条取舍：去掉第一项 ═════════════════════════════════════
      click(byTestId('ai-item-0'));
      await waitFor(
        '取舍后保留数更新',
        () => byTestId('ai-kept-count')?.textContent === String(itemCount - 1),
      );
      expect(byTestId('ai-kept-count')?.textContent).toBe(String(itemCount - 1));

      // ══ 6. 写入备注 ═════════════════════════════════════════════════
      click(byTestId('ai-apply'));
      await waitFor('备注写进 op-log', () => {
        const n = currentState().tasks[taskId]?.note ?? '';
        return n.includes('- [ ]');
      });

      const note = currentState().tasks[taskId]?.note ?? '';
      expect(note, '写入的清单应该是勾选框格式').toContain('- [ ]');

      // ══ 7. 反馈必须落库（M4 的核心）═════════════════════════════════
      const feedback = Object.values(currentState().aiFeedback);
      expect(feedback, '🔴 写入备注必须产生一条 AI_FEEDBACK —— 否则 P6/P7 永远学不到').toHaveLength(1);
      expect(feedback[0]).toMatchObject({
        feature: 'breakdown',
        outcome: 'modified',
        proposedCount: itemCount,
        appliedCount: itemCount - 1,
      });

      // ══ 8. 偏好必须可见（M6 的验收判据）═════════════════════════════
      switchView('设置');
      await waitFor('记忆面板出现', () => byTestId('memory-panel') !== null);
      await waitFor('推断出偏好', () => byTestId('memory-known') !== null);
      expect(byTestId('memory-panel'), '记忆面板应该出现').not.toBeNull();
      expect(byTestId('memory-known'), '有历史数据就应该推断出偏好').not.toBeNull();

      const shownIds = [...(container?.querySelectorAll('[data-testid^="memory-pref-"]') ?? [])].map(
        (e) => e.getAttribute('data-testid')?.replace('memory-pref-', '') ?? '',
      );
      expect(shownIds.length, '应该至少显示一条偏好').toBeGreaterThan(0);

      // ══ 9. 忘掉一条 ═════════════════════════════════════════════════
      const target = shownIds[0] ?? '';
      click(byTestId(`memory-forget-${target}`));
      await waitFor('忘掉写进 op-log', () =>
        Object.values(currentState().preferenceCorrections).some(
          (c) => c.preferenceId === target,
        ),
      );
      await flush();

      expect(byTestId(`memory-pref-${target}`), '忘掉之后不该还在「我了解到的你」里').toBeNull();
      expect(byTestId(`memory-restore-${target}`), '应该出现恢复入口').not.toBeNull();

      // ══ 10. 模拟刷新：真 op-log 重建，纠正必须还在 ══════════════════
      act(() => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;

      __resetOpLogForTests();
      await initOpLog(); // 从 IndexedDB 真重建
      await mountApp();
      switchView('设置');
      await flush();

      expect(
        currentState().preferenceCorrections !== undefined,
        '纠正记录应该从存储里重建出来',
      ).toBe(true);
      expect(
        Object.values(currentState().preferenceCorrections).some((c) => c.preferenceId === target),
        '🔴 刷新后纠正必须还在 —— 不然"删了又回来"，用户就再也不信这一层了',
      ).toBe(true);
      expect(
        byTestId(`memory-restore-${target}`),
        '刷新后「你已忘记」应该仍在，且可恢复',
      ).not.toBeNull();

      // ══ 11. 恢复回去 ════════════════════════════════════════════════
      click(byTestId(`memory-restore-${target}`));
      await flush();
      await waitFor('恢复写进 op-log', () =>
        Object.values(currentState().preferenceCorrections).every(
          (c) => c.preferenceId !== target || c.deletedAt !== undefined,
        ),
      );
      // 🔴 等 **DOM** 变化，而不是只看 op-log。
      // 只断言状态的话，界面没跟着更新也会过 —— 而"点了恢复但界面不动"
      // 正是用户看得见的那个 bug。
      await waitFor(
        '恢复后「你已忘记」里不再有它',
        () => byTestId(`memory-restore-${target}`) === null,
        15_000,
      );
      expect(
        byTestId(`memory-pref-${target}`),
        '恢复之后应该回到「我了解到的你」',
      ).not.toBeNull();
    },
    180_000,
  );
});
