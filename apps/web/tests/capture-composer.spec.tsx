/**
 * 快速捕获（Web 壳）界面判据
 * ============================
 *
 * 出处：`docs/plans/multi-platform-adaptation.md` 的 M3「每轮的固定流程」
 * 第 1–2 步，以及 §判据 A「该特性在 `apps/web` 与 `apps/mobile` 下
 * **不再各有一份实现**」。
 *
 * 迁移前这个文件断言的是 `.ht-capture__chip` 那套 DOM 类名 —— 也就是说它
 * **只能测 web 那一份实现**。现在渲染的是共享 `@heyta/ui` 的
 * `CaptureComposer`（经 web 宿主接线），所以下面一律用 `testID`
 * （RNW → `data-testid`）寻址，**与 mobile 将来能断的是同一批契约**。
 *
 * 纯解析逻辑已经在 `packages/domain/tests/capture.spec.ts` 里测了 42 条，
 * 共享判断在 `packages/ui/tests/capture-model.spec.ts` 里测了 27 条。
 * 这里只测**界面契约** —— 也就是"预览有没有真的起作用"：
 *
 *   1. 识别结果**必须显示**（看得见"我读懂了什么"）
 *   2. 每条**可以单独取消**，取消 = 把那几个字放回输入（**输入框一个字都不少**）
 *   3. 未被采纳的匹配**必须显式标出**，因为它其实还在标题里
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 * 改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`，
 * 否则看到的是**上一次构建**的结果（本 Goal 因此误判过两次）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Priority } from '@heyta/domain';

/** 记录 addTask 收到的参数。写入路径本身由 app-host 的测试覆盖，这里只关心参数对不对。 */
const addTask = vi.fn(() => Promise.resolve());

// 只替换写入动作，UI 其余部分跑真实实现（包括真实的 parseCapture 与共享组件）。
vi.mock('../src/features/tasks/store.js', () => ({
  useTaskStore: (selector: (s: { addTask: typeof addTask }) => unknown) =>
    selector({ addTask }),
}));

const { CaptureComposer } = await import('../src/features/capture/CaptureComposer.js');

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * 判据要读的源码根。
 *
 * ⚠️ 三个环境变量是**只读接缝**，只给故障注入用（把目录复制到 `/tmp`、改一处、
 * 指过去，证明"真实现漂了 → 红"），与 `habits-board.spec.tsx` 的
 * `HEYTA_HABITS_*` 同一约定。不设它们时就是真实路径。
 */
const WEB_SRC = process.env.HEYTA_CAPTURE_WEB_SRC ?? resolve(HERE, '../src');
const UI_SRC = process.env.HEYTA_CAPTURE_UI_SRC ?? resolve(HERE, '../../../packages/ui/src');

/** jsdom 里 RNW 偶尔会问 `ResizeObserver` —— 给个空实现，与别的 spec 一致。 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
});

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CaptureComposer />);
  });
  return container;
}

/** 带**落点**渲染（`destination` 是宿主传进来的，见组件的 props 注释）。 */
function renderWith(destination: { projectId: string; name: string }): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CaptureComposer destination={destination} />);
  });
  return container;
}

/**
 * **不给外壳**那一档（`inlineDuePanel`）：宿主把 `renderDuePanel` 传成 `undefined`，
 * 共享件于是**就地展开**面板，而不是 Portal 成浮层。
 *
 * 🔴 这一档有两个真实消费者：日历里那个已经浮着的捕获层，以及**整个移动端**
 * （`apps/mobile` 从不传 `renderDuePanel`，吃的就是同一支）。
 * 移动端跑不了 Playwright，而 `packages/ui` 刻意不引 DOM 测试栈 ——
 * 所以这一支的**行为**判据只能长在这个文件里，由它替两端量。
 */
function renderInline(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CaptureComposer inlineDuePanel />);
  });
  return container;
}

/**
 * 带**日历锚点**那一档（`anchorDate`）：日历里点某天再新建，落点那一天由宿主给，
 * 不在共享层换算（`CalendarCapturePopover.tsx` 传的就是它）。
 * 这一档与 `inlineDuePanel` 同时在场 —— 日历那一层已经浮着，面板只能就地展开。
 */
function renderAnchored(anchorDate: string): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CaptureComposer anchorDate={anchorDate} inlineDuePanel />);
  });
  return container;
}

/** 往受控 input 里输入。必须走原生 setter，否则 React 收不到变更。 */
function type(el: HTMLDivElement, value: string): void {
  const input = el.querySelector('[data-testid="capture-input"]')! as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 芯片本体（`capture-chip-0`、`capture-chip-1`…），**不含** value/toggle/hint 三个子节点。 */
function chips(el: HTMLDivElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('[data-testid]')].filter((node) =>
    /^capture-chip-\d+$/u.test(node.getAttribute('data-testid') ?? ''),
  );
}

function chipValue(chip: HTMLElement): string {
  return chip.querySelector('[data-testid="capture-chip-value"]')?.textContent ?? '';
}

/**
 * 2026-11-04 收集框对齐滴答清单之后，识别结果有两个家：
 *   · **胶囊**说生效中的那个截止值（`capture-due-capsule-value`）；
 *   · **框下那一行**只说胶囊说不出来的（优先级、未采用、已忽略）。
 * 逐条撤销的出口在**面板里**，而 web 的面板是 Portal 到 `document.body` 的浮层
 * —— 与 `due-date-edit.spec.tsx` 同一条纪律：**面板里的东西一律从 `document` 取**，
 * 不许假定它在哪棵子树里。
 */
function capsuleText(el: HTMLDivElement): string {
  return el.querySelector('[data-testid="capture-due-capsule-value"]')?.textContent ?? '';
}

function capsuleAria(el: HTMLDivElement): string {
  return el.querySelector('[data-testid="capture-due-capsule"]')?.getAttribute('aria-label') ?? '';
}

/** 点胶囊打开面板，返回 Portal 出去的那块面板。已经开着就**不重复点**（再点会把它关掉）。 */
function openPanel(el: HTMLDivElement): HTMLElement {
  const existing = document.querySelector<HTMLElement>('[data-testid="capture-due-popover"]');
  if (existing !== null) return existing;
  const capsule = el.querySelector<HTMLElement>('[data-testid="capture-due-capsule"]');
  if (capsule === null) throw new Error('输入行里没有日期胶囊');
  act(() => {
    capsule.click();
  });
  const panel = document.querySelector<HTMLElement>('[data-testid="capture-due-popover"]');
  if (panel === null) throw new Error('胶囊点不开面板（外壳没挂上或 testid 漂了）');
  return panel;
}

/** 面板里那枚`清除`。 */
function clearButton(panel: HTMLElement): HTMLElement {
  const node = [...panel.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (n) => n.textContent?.trim() === '清除',
  );
  if (node === undefined) throw new Error('面板里没有清除出口（DatePicker 的 clear 措辞漂了？）');
  return node;
}

/** 面板里「文字里读到的日期」那几条的撤销/恢复按钮，顺序 = 识别顺序。 */
function dueItemToggles(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[data-testid^="capture-due-item-toggle-"]')];
}

/** 面板里那几条的可见文本（原文 + 解析值）。 */
function dueItemTexts(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll<HTMLElement>('[data-testid^="capture-due-item-"]')]
    .filter((node) => !node.getAttribute('data-testid')!.startsWith('capture-due-item-toggle-'))
    .map((node) => node.textContent ?? '');
}

function inputValue(el: HTMLDivElement): string {
  return (el.querySelector('[data-testid="capture-input"]') as HTMLInputElement).value;
}

function submit(el: HTMLDivElement): HTMLElement {
  return el.querySelector<HTMLElement>('[data-testid="capture-submit"]')!;
}

/**
 * 🔴 **「实际标题：…」那一行已经整条退役**（2026-11-03 否掉 → 2026-11-04 删干净）。
 *
 * 产品负责人原话：「不要写什么实际标题是什么东西，没有必要」—— 对照滴答清单，
 * 输入行里只留**原文 + 一枚日期胶囊**，不另起一行复述"将会创建成什么"。
 * 11-03 那一轮只做到"关掉"（`showPreview` 开关，两端都关），胶囊没建、mobile 那一行
 * 还被 `verify-mobile-capture.sh` 钉成验收项 ⇒ 两端形状分叉、旧形状被尺子钉死。
 * 本轮补上胶囊与面板，并把那个**零消费者的开关连同渲染与两条词条一起删掉** ——
 * 留着"配置了但没人读"的路是本仓最忌讳的形状。
 *
 * ⚠️ 所以这一族**不再有任何 DOM 断言去问"预览行在不在"**：那个 testid 已经从实现里
 * 消失，一条恒为真的断言等于没有断言（AGENTS.md §6 第 2 条）。它换成两处**能红**的钉子：
 *   · 本文件末尾「源码级判据」里那两条反向钉子；
 *   · `apps/landing/tests/mockup-capture-shape.spec.tsx` 里同一对 + `check:capture-shape`。
 * ⇒ 原来断言"预览文字"的用例改钉**胶囊**：解析结果是同一份事实，载体换了，
 * 判据的意图（用户看得到自己的字被怎么处理）一个字没变。
 */

beforeEach(() => {
  /*
    🔴 **把系统时间钉死**（2026-09-28 12:00）。

    这一族断言里有**推算出来的日期**（`明天` → `09-29`）。不钉时钟的话，
    它写下的那一天是绿的，而**跨过一次午夜就变红** —— 实测 2026-09-29 00:14：
    `AssertionError: expected '2026-09-30（明天）' to contain '09-29'`。

    ⇒ 这不是产品缺陷，是测试自己带了一颗**定时炸弹**（与 flake 同族：
    失败与代码无关，只与"什么时候跑"有关）。`shouldAdvanceTime` 让真实计时器
    继续走，所以 `act` 里的异步链路照常推进。
  */
  vi.useFakeTimers({ now: new Date(2026, 8, 28, 12, 0, 0), shouldAdvanceTime: true });
  addTask.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('CaptureComposer —— 识别结果必须可见（2026-11-04 起有两个家）', () => {
  it('无输入时不渲染任何识别项，胶囊也只有图标', () => {
    const el = render();
    expect(chips(el)).toHaveLength(0);
    expect(capsuleText(el)).toBe('');
  });

  it('🔴 截止进**胶囊**、优先级进**那一行**：同一件事不许说两遍', () => {
    const el = render();
    type(el, '明天交周报 !1');
    expect(capsuleText(el), '日期由胶囊说').toContain('明天');
    const cs = chips(el);
    expect(cs, '框下那一行只剩优先级').toHaveLength(1);
    expect(cs[0]!.textContent).toContain('!1');
    expect(chipValue(cs[0]!)).toContain('高优先级');
  });

  it('🔴 输入行只有三件：输入框 / 日期胶囊 / 添加', () => {
    const el = render();
    for (const id of ['capture-input', 'capture-due-capsule', 'capture-submit']) {
      expect(el.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
    // 第四件就是"铺开式控件"复发 —— 产品负责人为这句话删过整个行内动作排。
    const compose = el.querySelector('[data-testid="capture-input"]')!.parentElement!;
    expect(compose.children).toHaveLength(3);
  });

  it('🔴 「今天下午八点给张教授发PPT」这一句：框下**一行都不挂**', () => {
    const el = render();
    type(el, '今天下午八点给张教授发PPT');
    expect(capsuleText(el)).toContain('20:00');
    expect(chips(el)).toHaveLength(0);
  });

  it('解析不出任何东西时既不显示识别项、胶囊也只有图标（界面不该无中生有）', () => {
    const el = render();
    type(el, '写完那段不好解析的说明');
    expect(chips(el)).toHaveLength(0);
    expect(capsuleText(el)).toBe('');
  });

  it('那一组仍带无障碍名，胶囊也**把当前值念出来**', () => {
    const el = render();
    type(el, '明天交周报 !1');
    expect(
      el.querySelector('[data-testid="capture-matches"]')?.getAttribute('aria-label'),
    ).toBe('识别出的字段');
    expect(capsuleAria(el)).toContain('明天');
  });

  it('没选日期时胶囊只画图标：aria 是一整句，界面上不许出现「未设置」', () => {
    const el = render();
    type(el, '交周报');
    expect(capsuleText(el)).toBe('');
    expect(capsuleAria(el)).toBe('选择截止日期');
    expect(el.textContent).not.toContain('未设置');
  });
});

describe('CaptureComposer —— 每一条截止识别都能单独取消（出口在面板里）', () => {
  it('🔴 取消 = 那段文字**回到标题**，而输入框一个字都不少', () => {
    const el = render();
    type(el, '明天交周报 !1');
    expect(inputValue(el)).toBe('明天交周报 !1');

    const panel = openPanel(el);
    expect(dueItemToggles(panel)).toHaveLength(1);
    act(() => {
      dueItemToggles(panel)[0]!.click();
    });

    // 🔴 输入框**一个字都不能少** —— 界面不许替用户删掉他写的东西
    expect(inputValue(el)).toBe('明天交周报 !1');
    expect(capsuleText(el), '取消之后胶囊不再念着那一天').toBe('');
    // 被取消的那条**回到框下那一行**（它不在胶囊里了，得有个地方说"这条我没算"），
    // 优先级那条不受影响。顺序 = 识别顺序，日期在前。
    const cs = chips(el);
    expect(cs).toHaveLength(2);
    expect(chipValue(cs[0]!)).toContain('已忽略');
    expect(chipValue(cs[1]!)).toContain('高优先级');
  });

  it('取消后可以恢复（两击可逆，出口是同一个节点）', () => {
    const el = render();
    type(el, '明天交周报');
    const toggle = dueItemToggles(openPanel(el))[0]!;
    act(() => {
      toggle.click();
    });
    expect(capsuleText(el)).toBe('');

    act(() => {
      toggle.click();
    });
    expect(capsuleText(el)).toContain('明天');
  });

  it('取消日期后提交，标题包含那段文字且**不带 dueDate**', () => {
    const el = render();
    type(el, '明天交周报');
    // ⚠️ `openPanel` 必须在 `act` **外面**调：它自己会点胶囊并立刻从 `document`
    // 取那块 Portal 出去的面板，套在 act 里时这一帧还没提交，取到的是 null。
    const panel = openPanel(el);
    act(() => {
      dueItemToggles(panel)[0]!.click();
    });
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith('明天交周报', {});
  });

  it('每个撤销出口都有 aria-label，且带上对应的原文', () => {
    const el = render();
    type(el, '明天交周报');
    const label = dueItemToggles(openPanel(el))[0]!.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).toContain('明天');
  });

  it('🔴 面板里`清除`之后：原文回标题、胶囊空、提交不带截止', () => {
    const el = render();
    type(el, '今天下午八点交周报');
    const panel = openPanel(el);
    act(() => {
      clearButton(panel).click();
    });
    expect(inputValue(el)).toBe('今天下午八点交周报');
    expect(capsuleText(el)).toBe('');
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith('今天下午八点交周报', {});
  });
});

describe('CaptureComposer —— 不给外壳那一档：就地展开（移动端的唯一面板路径）', () => {
  /*
    🔴 这一族量的是共享件里 `renderDuePanel === undefined` 那**一支**。
    移动端从头到尾没传过外壳 ⇒ 它的胶囊点开之后有没有面板，**完全**靠这一支；
    而在此之前全仓没有任何一条判据渲染过它（`grep -rn renderDuePanel packages/ui/tests
    apps/web/tests apps/mobile/tests` 现量 0 命中）—— 也就是说把那一支改成 `null`，
    web 收件箱照样绿（它走浮层），只有日历落点与**整个移动端**静默变成死按钮。
    这正是本计划 §0 那条根因的形状：判据钉住了"看得到"，没钉住"点得动"。
  */
  it('🔴 点胶囊 ⇒ 面板画在同一棵子树里，而不是 Portal 成浮层', () => {
    const el = renderInline();
    type(el, '今天下午八点交周报');
    const capsule = el.querySelector<HTMLElement>('[data-testid="capture-due-capsule"]')!;
    act(() => {
      capsule.click();
    });
    // 就地 ⇒ 从挂载点里就取得到（浮层那一档必须从 document 取，这里是反的）
    expect(el.querySelector('[data-testid="capture-due-panel"]')).not.toBeNull();
    // 反向钉子：这一档**不许**存在 web 的浮层外壳
    expect(document.querySelector('[data-testid="capture-due-popover"]')).toBeNull();
  });

  it('🔴 就地面板里的撤销出口真的接得上：取消 ⇒ 那段字回到标题、输入框一个字不少', () => {
    const el = renderInline();
    type(el, '今天下午八点交周报');
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="capture-due-capsule"]')!.click();
    });
    const panel = el.querySelector<HTMLElement>('[data-testid="capture-due-panel"]')!;
    const toggles = dueItemToggles(panel);
    expect(toggles.length, '就地展开的面板里没有逐条撤销出口').toBeGreaterThan(0);
    act(() => {
      toggles[0]!.click();
    });
    expect(inputValue(el)).toBe('今天下午八点交周报');
  });

  it('胶囊自己就是开关：再点一次收起，且收起后不留残影', () => {
    const el = renderInline();
    type(el, '明天交周报');
    const capsule = el.querySelector<HTMLElement>('[data-testid="capture-due-capsule"]')!;
    act(() => {
      capsule.click();
    });
    expect(el.querySelector('[data-testid="capture-due-panel"]')).not.toBeNull();
    act(() => {
      capsule.click();
    });
    expect(el.querySelector('[data-testid="capture-due-panel"]')).toBeNull();
  });
});

describe('CaptureComposer —— 未被采纳的匹配必须显式标出', () => {
  it('🔴 两个日期：第二条标成"未采用"，并说明它仍在标题中', () => {
    const el = render();
    type(el, '今天 明天 交周报');

    // 生效中的那条由胶囊说；**未采用的那条必须还看得见**，否则用户以为两条都算。
    const cs = chips(el);
    expect(cs).toHaveLength(1);
    const hint = cs[0]!.querySelector('[data-testid="capture-chip-hint"]');
    expect(hint?.textContent).toContain('未采用');
    // 而且它没有取消按钮（因为没被采纳，没什么可取消的）
    expect(cs[0]!.querySelector('[data-testid="capture-chip-toggle"]')).toBeNull();
    expect(capsuleText(el), '胶囊说的是第一条').toContain('今天');

    // 关键：它确实还在标题里 —— 预览行已被产品负责人否掉，而"这段文字没被吞掉"
    // 这件事必须继续可验，所以判据落在提交出去的标题上。
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith(expect.stringContaining('明天'), expect.anything());
  });

  it('面板里两条都列出来，生效中的那条才有撤销出口', () => {
    const el = render();
    type(el, '今天 明天 交周报');
    const panel = openPanel(el);
    const texts = dueItemTexts(panel).join(' ');
    expect(texts).toContain('今天');
    expect(texts).toContain('明天');
    expect(dueItemToggles(panel)).toHaveLength(1);
  });
});

describe('CaptureComposer —— 提交', () => {
  it('标题为空时禁用提交（只输入"明天"不算一个任务）', () => {
    const el = render();
    type(el, '明天');
    // RNW 的 `Pressable` 渲染成 div，`disabled` 体现在 `aria-disabled`。
    expect(submit(el).getAttribute('aria-disabled')).toBe('true');
  });

  it('提交时把解析出的字段一并交给写入动作', () => {
    const el = render();
    type(el, '明天交周报 !1');
    act(() => {
      submit(el).click();
    });

    expect(addTask).toHaveBeenCalledTimes(1);
    const [title, over] = addTask.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(title).toBe('交周报');
    expect(over['priority']).toBe(Priority.High);
    // dueDate 是 epoch ms（Task 的约定），且落在本地零点
    const due = new Date(over['dueDate'] as number);
    expect(due.getHours()).toBe(0);
    expect(due.getMinutes()).toBe(0);
  });

  it('提交后清空输入', () => {
    const el = render();
    type(el, '交周报');
    act(() => {
      submit(el).click();
    });
    expect(inputValue(el)).toBe('');
  });

  it('只有优先级没有日期时也要能提交', () => {
    const el = render();
    type(el, '交周报 p2');
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith('交周报', { priority: Priority.Medium });
  });

  /**
   * 🔴 `destination` 是**组件的契约**，不是 App 的巧合。
   *
   * 端到端那条（`app-mount.spec.tsx`）钉的是"调用点真的传了"；这里钉的是
   * "传了就一定写进去" —— 两层各管一段，缺任何一层都能被下面这一族的漂移绕过：
   * 只改共享层的提交签名，App 那条会红；只改 App 的调用点，这一条仍然绿而
   * 端到端那条红。
   *
   * 两个字段**同时**给是这条用例的重点：`dueDate` 与 `projectId` 走的是同一个
   * 展开对象，谁把 `over` 重写成逐字段赋值，就可能只漏掉后加的那一个。
   */
  it('🔴 有落点时：projectId 与解析出的字段一起交给写入动作', () => {
    const el = renderWith({ projectId: 'p-home', name: '家庭装修' });
    type(el, '明天买漆 !1');
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith('买漆', {
      dueDate: expect.any(Number),
      priority: Priority.High,
      projectId: 'p-home',
    });
  });

  it('🔴 有落点时：占位符点名它（用户按回车前就该知道这条会去哪儿）', () => {
    const el = renderWith({ projectId: 'p-home', name: '家庭装修' });
    const input = el.querySelector('[data-testid="capture-input"]') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toContain('家庭装修');
  });

  it('没有落点时：一个字段都不多塞（收集箱不是某条清单的别名）', () => {
    const el = render();
    type(el, '买牛奶');
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith('买牛奶', {});
  });

  it('🔴 回车也走同一条提交路（共享 `TextInput` 的 `onSubmitEditing`）', () => {
    // 迁移前这是 `<input onKeyDown={Enter}>`；共享层换成 RN 的 `onSubmitEditing`，
    // 在 react-native-web 上它由 Enter 键触发（实测：走同一条 `submit()`）。
    const el = render();
    type(el, '交周报');
    act(() => {
      el.querySelector('[data-testid="capture-input"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(addTask).toHaveBeenCalledWith('交周报', {});
  });
});

describe('CaptureComposer —— web 不再有第二份实现（源码级判据）', () => {
  const hostSource = (): string =>
    readFileSync(resolve(WEB_SRC, 'features/capture/CaptureComposer.tsx'), 'utf8');
  const boardSource = (): string =>
    readFileSync(resolve(UI_SRC, 'capture/CaptureComposer.tsx'), 'utf8');
  const modelSource = (): string => readFileSync(resolve(UI_SRC, 'capture/model.ts'), 'utf8');

  it('web 宿主从 `@heyta/ui` 取共享组件，且不再有手写的芯片 DOM 骨架', () => {
    const host = hostSource();
    expect(host).toContain('@heyta/ui');
    expect(host).toContain('SharedCaptureComposer');
    // 🔴 DOM 类名不许回潮：它们正是"web 自己又画了一份"的痕迹。
    //    ⚠️ 只盯**字符串字面量里的**类名，不盯"文件里出现过这个词" ——
    //    文件头的说明文字里就写着这几个类名（实测第一版因此假红，
    //    与 `habits-board.spec.tsx` 踩的是同一个坑）。
    expect(host).not.toMatch(/['"`]ht-capture/);
    expect(host).not.toMatch(/['"`]ht-compose/);
    // 解析也不许回到宿主：它必须在共享层 / 领域层。
    expect(host).not.toContain('parseCapture(');
  });

  /**
   * 🔴 「实际标题」那一行与那个零消费者的开关都不许回来。
   *
   * 为什么钉在源码而不是 DOM：`capture-preview` 这个 testid 已经从实现里消失，
   * "它不在 DOM 里"这条断言从此**恒真** —— 而一条不能失败的判据等于没有判据
   * （AGENTS.md §6 第 2 条）。能失败的说法只有一句：实现里不再有这两个词。
   *
   * ⚠️ 先剥注释：本文件与共享组件的说明文字里就写着这些词，
   * 不剥的话第一版就是假红（与 `:496-498` 记的 `ht-capture` 同一个坑）。
   */
  it('「实际标题」那一行与 `showPreview` 开关都已退役，不许回潮', () => {
    const bare = boardSource().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(bare).not.toContain('capture-preview');
    expect(bare).not.toContain('showPreview');
    expect(bare).not.toContain('previewLead');
    // 反向另一半：识别行为空时**什么都不画**，这件事仍由一处守卫守着（复刻件的空态等价性靠它）。
    expect(bare).toContain('rowChips.length > 0');
  });

  it('芯片骨架在共享层（`toCaptureChips`），不在 web 的 JSX 里', () => {
    expect(boardSource()).toContain('toCaptureChips');
    expect(modelSource()).toContain('export function toCaptureChips');
    expect(hostSource()).not.toContain('toCaptureChips');
  });

  it('文案一律由宿主注入：共享层不 import `@heyta/i18n`', () => {
    // 盯 import 语句，不盯"文件里出现过这个词"（文件头正是这么写的）。
    expect(boardSource()).not.toMatch(/from\s+['"]@heyta\/i18n/);
    expect(modelSource()).not.toMatch(/from\s+['"]@heyta\/i18n/);
  });

  it('共享 model 不 import `react-native`（node 单测解析不了它 —— 这是免费的分层护栏）', () => {
    expect(modelSource()).not.toMatch(/from\s+['"]react-native['"]/);
  });
});

/**
 * 中文时刻的芯片措辞（2026-11）。
 *
 * 🔴 钉的是**可见措辞**，不是解析结果 —— 领域层已经断言 `dueTime === '15:00'`，
 * 但那还不够：芯片如果只念「15:00」，用户看不出认的是今天还是明天，
 * 而"猜错哪一天"正是这个字段唯一致命的错法。滴答清单的做法是一条芯片
 * 说清「今天 15:00」，这里与它对齐。
 */
describe('🔴 胶囊要说清「哪一天几点」（2026-11-04 起这件事由胶囊说，不再由芯片说）', () => {
  it('无日期词的时刻 → 胶囊念「今天 15:00」', () => {
    const el = render();
    type(el, '下午3点开会');
    expect(capsuleText(el), '没有念出是哪一天').toContain('今天');
    expect(capsuleText(el)).toContain('15:00');
    // 生效中的截止不在框下重复一遍 —— 那一行此刻应该是空的。
    expect(chips(el)).toHaveLength(0);
  });

  it('写了日期 → 胶囊一次说清「明天 16:00」（不拆成两枚）', () => {
    const el = render();
    type(el, '明天16:00 交周报');
    expect(capsuleText(el)).toContain('明天');
    expect(capsuleText(el)).toContain('16:00');
  });

  it('只有日期没有时刻 → 胶囊只念那一天，不补一个 00:00', () => {
    const el = render();
    type(el, '明天交周报');
    expect(capsuleText(el)).toBe('明天');
  });

  it('🔴 三天以外的日子必须念**日期**，不能只说「还剩 N 天」', () => {
    const el = render();
    type(el, '下周三交周报');
    // 「还剩 9 天」回答了还有几天，却省掉了**哪一天** —— 而那是这个字段唯一致命的错法。
    // 分档在共享层 `captureCapsuleShowsWord`，不在两端各写一次（否则同一句"下周三"
    // 在两台设备上可以一个说天数、一个说日期，而且两边都不报错）。
    expect(capsuleText(el)).toMatch(/10月7日/u);
    expect(capsuleText(el)).not.toContain('还剩');
  });
});

/**
 * 🔴 时刻那一格（计划 S3 点名的 30 分步进列表）。
 *
 * 这一族钉三件事，每件都对应一种会退回去的形状：
 *   · 列表与自由输入**互斥**地出现 —— 同时在场就是"同一目的地两个控件"；
 *   · 点一格真的改到胶囊，而且**不许把用户写的字吞掉**；
 *   · 「其它时间」真的能填进 20:15 —— 砍掉自由输入是能力倒退，不是对齐。
 */
describe('CaptureComposer —— 面板里的时刻子视图', () => {
  it('默认是日期视图：有「时刻」那一行，但**既没有步进列表也没有文本框**', () => {
    const el = render();
    type(el, '今天下午八点给张教授发PPT');
    const panel = openPanel(el);
    expect(panel.querySelector('[data-testid="capture-time-row"]'), '日期视图里没有时刻那一行').not.toBeNull();
    expect(panel.querySelector('[data-testid="capture-time-value"]')?.textContent).toBe('20:00');
    expect(panel.querySelector('[data-testid="date-picker"]'), '日期视图里没有月历').not.toBeNull();
    expect(panel.querySelector('[data-testid="capture-time-slots"]')).toBeNull();
    expect(panel.querySelector('[data-testid="capture-time-input"]')).toBeNull();
  });

  it('点「时刻」⇒ 进子视图：48 格 + 全天，且**月历不再在场**（视图切换，不是叠在下面）', () => {
    const el = render();
    type(el, '今天下午八点给张教授发PPT');
    const panel = openPanel(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    const slots = [...panel.querySelectorAll<HTMLElement>('[data-testid^="capture-time-slot-"]')];
    // 48 格 + 那一枚 `capture-time-slot-all-day`
    expect(slots).toHaveLength(49);
    expect(slots.some((n) => n.getAttribute('data-testid') === 'capture-time-slot-20:00')).toBe(true);
    expect(slots.some((n) => n.getAttribute('data-testid') === 'capture-time-slot-23:30')).toBe(true);
    expect(panel.querySelector('[data-testid="date-picker"]'), '列表叠在月历下面 = 面板高到要滚着找日历').toBeNull();
  });

  it('🔴 点一格 21:00 ⇒ 胶囊改成 今天 21:00，输入框一个字都不少', () => {
    const el = render();
    type(el, '今天下午八点给张教授发PPT');
    const panel = openPanel(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-slot-21:00"]')!.click();
    });
    expect(capsuleText(el)).toContain('21:00');
    expect(capsuleText(el), '换时刻不许把日期那一段丢掉').toContain('今天');
    expect(inputValue(el)).toBe('今天下午八点给张教授发PPT');
  });

  it('点「全天」⇒ 胶囊只剩日子，不再念 00:00', () => {
    const el = render();
    type(el, '今天下午八点给张教授发PPT');
    const panel = openPanel(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-slot-all-day"]')!.click();
    });
    expect(capsuleText(el)).toBe('今天');
  });

  it('🔴 「其它时间」⇒ 列表换成自由输入，20:15 这一档填得进去（能力没倒退）', () => {
    const el = render();
    type(el, '今天下午八点给张教授发PPT');
    const panel = openPanel(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-mode"]')!.click();
    });
    // 互斥：进了文本档，列表必须不在场
    expect(panel.querySelector('[data-testid="capture-time-slots"]'), '列表与文本框同时在场 = 同一目的地两个控件').toBeNull();
    const input = panel.querySelector<HTMLInputElement>('[data-testid="capture-time-input"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '20:15');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(capsuleText(el)).toContain('20:15');
  });

  it('🔴 半截草稿不提交：框里是「20:」而胶囊仍是上一个值', () => {
    const el = render();
    type(el, '今天下午八点给张教授发PPT');
    const panel = openPanel(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-mode"]')!.click();
    });
    const input = panel.querySelector<HTMLInputElement>('[data-testid="capture-time-input"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '20:');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(capsuleText(el), '半截时刻写进 op 就是替用户猜时间').toContain('20:00');
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value, '失焦后输入框不许撒谎说"20:"是个时刻').toBe('20:00');
  });

  it('「返回」回日期视图：月历在、列表不在', () => {
    const el = render();
    type(el, '今天下午八点交周报');
    const panel = openPanel(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-back"]')!.click();
    });
    expect(panel.querySelector('[data-testid="date-picker"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="capture-time-slots"]')).toBeNull();
  });
});

/**
 * 🔴 **没选日子时，时刻这一档的每一枚控件都必须真的做事**（2026-11-05 移动端设备腿实测）。
 *
 * 上面那一族每一例都先打了「今天下午八点…」，所以 `due.date` 一直有值 ——
 * 于是实现里那三处 `if (due.date !== undefined) onPick(...)` **从来没有被测到过**。
 * 设备上量到的形状是：收集箱里空着标题点胶囊、进时刻子视图，48 格 + 全天 + 自由输入
 * **全部静默无效**（胶囊仍是「选择截止日期」）。用户看到一排能按的按钮，按了什么都没有。
 *
 * 落成今天不是新发明：`packages/domain/src/capture.ts` 文件头那条
 * 「无日期的时刻落在**今天**（与滴答清单同款）」早就定了这件事。
 * 文本解析对裸 `16:00` 保守（`dueTimeNeedsDate`）的理由是那句还可能指视频比例；
 * **一次点击不是歧义**，所以这一档不许保守到什么都不做。
 */
describe('CaptureComposer —— 没有日期时点时刻：落在今天，不许静默无效', () => {
  /** 标题里一个日期词都没有 ⇒ `due.date` 确实为空，这一族才有意义。 */
  function openTimeViewNoDate(el: HTMLDivElement): HTMLElement {
    const panel = openPanel(el);
    expect(capsuleText(el), '前置：胶囊此刻必须是空的（真没有日期）').toBe('');
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    expect(panel.querySelector('[data-testid="capture-time-slots"]'), '没进时刻子视图').not.toBeNull();
    return panel;
  }

  it('🔴 点一格 21:00 ⇒ 胶囊落在「今天 21:00」，而不是按了没反应', () => {
    const el = render();
    type(el, '给张教授发PPT');
    const panel = openTimeViewNoDate(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-slot-21:00"]')!.click();
    });
    expect(capsuleText(el), '点时刻点了个空 —— 这一格就是设备上量到的那个死按钮').toContain('21:00');
    expect(capsuleText(el), '无日期的时刻落在今天（capture.ts 文件头那条）').toContain('今天');
    expect(inputValue(el), '补日期不许动用户写的字').toBe('给张教授发PPT');
  });

  it('🔴 点「全天」⇒ 胶囊落在今天（这一枚同样不许是死的）', () => {
    const el = render();
    type(el, '给张教授发PPT');
    const panel = openTimeViewNoDate(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-slot-all-day"]')!.click();
    });
    expect(capsuleText(el)).toBe('今天');
  });

  it('🔴 「其它时间」填 20:15 ⇒ 同样落在今天（自由输入那一档是第三条腿）', () => {
    const el = render();
    type(el, '给张教授发PPT');
    const panel = openTimeViewNoDate(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-mode"]')!.click();
    });
    const input = panel.querySelector<HTMLInputElement>('[data-testid="capture-time-input"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '20:15');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(capsuleText(el)).toContain('20:15');
    expect(capsuleText(el), '时刻落进去了而日子没有 ⇒ 胶囊会只念时刻，等于没设截止').toContain('今天');
  });

  it('🔴 反面对手：半截草稿没有日期时**不许**生出今天（无中生有比死按钮更糟）', () => {
    const el = render();
    type(el, '给张教授发PPT');
    const panel = openTimeViewNoDate(el);
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-mode"]')!.click();
    });
    const input = panel.querySelector<HTMLInputElement>('[data-testid="capture-time-input"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '20:');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(capsuleText(el), '「20:」不是一个时刻，替用户猜出"今天"就是篡改意图').toBe('');
  });

  it('🔴 移动端那一支（就地展开，没有外壳）同样是落在今天 —— 这条缺陷就是从那里量到的', () => {
    const el = renderInline();
    type(el, '给张教授发PPT');
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="capture-due-capsule"]')!.click();
    });
    const panel = el.querySelector<HTMLElement>('[data-testid="capture-due-panel"]')!;
    expect(document.querySelector('[data-testid="capture-due-popover"]'), '就地那一支不许长出浮层').toBeNull();
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-slot-09:30"]')!.click();
    });
    expect(capsuleText(el)).toContain('09:30');
    expect(capsuleText(el)).toContain('今天');
  });

  it('🔴 标题里有个**没被采纳**的裸时刻（`16:00`）时手工点一格 ⇒ 值进胶囊，那段字原样留在标题里', () => {
    /*
      这一格是 S3c 那趟**自己造出来的新状态**：以前没日期时点了没反应，
      所以"打字里有一句被解析器故意拒绝的时刻 + 用户又手工点了另一格"从没能同时出现。
      现在它会出现，于是必须回答：界面上同时有 `16:00`（标题里 + 一枚"未采用"芯片）
      与 `今天 21:00`（胶囊里），算不算"字被消费而界面没说"？
      按 `capture.ts` 文件头第 3 条：不算 —— `dueTimeNeedsDate` 只是**不采纳**那条匹配，
      匹配仍在 `matches` 里，所以它照旧作为"未采用"那一档可见；而这次手工选择
      **取代的是"没有值"，不是那句字** ⇒ 芯片在点完之后必须还在（下面钉的就是这一条）。
    */
    const el = render();
    type(el, '16:00 交周报');
    const panel = openPanel(el);
    expect(capsuleText(el), '前置：裸时刻不该被采纳，胶囊该是空的').toBe('');
    // 🔴 实测纠正了我在这里的原判断：`dueTimeNeedsDate` 只是**不采纳**那条匹配，
    //    匹配本身仍在 `matches` 里 ⇒ 它按不变量 3 必须作为"未采用"那一档可见，
    //    而不是消失。（写成"不许有芯片"会红，红的是我的期望，不是实现。）
    const cs = chips(el);
    expect(cs, '未采纳的裸时刻必须还看得见，否则用户以为它算进去了').toHaveLength(1);
    expect(cs[0]!.querySelector('[data-testid="capture-chip-hint"]')?.textContent).toContain('未采用');
    expect(cs[0]!.querySelector('[data-testid="capture-chip-toggle"]'), '没被采纳的东西没有"取消"可言').toBeNull();

    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-slot-21:00"]')!.click();
    });
    expect(capsuleText(el)).toContain('21:00');
    expect(capsuleText(el)).toContain('今天');
    expect(inputValue(el), '手工选日子时刻都不许改动用户写的字').toBe('16:00 交周报');
    // 手工点完之后，那句未采纳的时刻**不许从那一行消失** —— 它既没被消费，
    // 也没被这次手工选择取代（取代的是"没有值"，不是那句字）。
    expect(chips(el), '手工选了 21:00 之后，那句未采纳的 16:00 不许悄悄不见').toHaveLength(1);

    act(() => {
      submit(el).click();
    });

    expect(addTask, '「16:00 交周报」去掉那个没被采纳的时刻后仍有标题，该能提交').toHaveBeenCalledTimes(1);
    const [title, over] = addTask.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(title, '那句没被采纳的时刻必须原样留在标题里（不变量 1/3）').toContain('16:00');
    const due = new Date(over['dueDate'] as number);
    expect([due.getHours(), due.getMinutes()], '手工点的 21:00 要真的进那条任务').toEqual([21, 0]);
  });

  it('🔴 日历落点（有 `anchorDate`）里点时刻 ⇒ 落在那一天，不许跳回今天', () => {
    /*
      `due.date ?? today` 里那个 `??` 就是这条的全部意义。
      日历里点的是 09-30 那一格，用户要的是「09-30 晚上九点」；谁把它"简化"成 `today`，
      这一格当场红，而"没日期时落在今天"那几条照绿 ⇒ 两族钉子各管一件事，不是重复。
    */
    const el = renderAnchored('2026-09-30');
    type(el, '给张教授发PPT');
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="capture-due-capsule"]')!.click();
    });
    const panel = el.querySelector<HTMLElement>('[data-testid="capture-due-panel"]')!;
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-row"]')!.click();
    });
    act(() => {
      panel.querySelector<HTMLElement>('[data-testid="capture-time-slot-21:00"]')!.click();
    });
    expect(capsuleText(el)).toContain('21:00');
    expect(capsuleText(el), '锚点那一天被 `today` 顶掉了 ⇒ 日历里点的日子不算数').not.toContain('今天');
    expect(inputValue(el)).toBe('给张教授发PPT');
  });
});

/**
 * 🔴 **捕获框里不许再出现任何 AI 入口**（2026-11 产品裁决）。
 *
 * 「一句话解析」整体搬进了右侧助手（`AssistantPanel` 的 `captureTarget` 那段
 * 写了理由与判据）。这一组是**反向**钉子：防止它被"顺手"搬回来 ——
 * 用户的判断是那枚按钮挂在主输入框下面很突兀，而这个仓库里
 * 一次合并就足以让搬回来这件事悄悄发生。
 */
describe('🔴 捕获框里没有任何 AI 入口', () => {
  it('渲染出来的 DOM 里没有 `capture-ai`', () => {
    const el = render();
    type(el, '把那份材料整理一下');
    expect(el.querySelector('[data-testid="capture-ai"]')).toBeNull();
  });

  it('宿主源码里不再 import AI 面板（也不再把 AI 配置透传进来）', () => {
    const host = readFileSync(resolve(WEB_SRC, 'features/capture/CaptureComposer.tsx'), 'utf8');
    expect(host).not.toMatch(/from\s+['"]\.\.\/ai\/AiCapture/);
    // 这三个 prop 只在"输入框自己跑 AI"时才有意义，搬走之后留着就是死配置。
    expect(host).not.toMatch(/\brouting\?/u);
    expect(host).not.toMatch(/\bconsents\?/u);
  });
});
