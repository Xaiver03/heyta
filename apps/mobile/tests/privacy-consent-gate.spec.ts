/**
 * 🔴 G-12 在**移动端**这一侧：同意之前，一个字节都不出这台设备
 * =============================================================
 *
 * ## 与 web 那份同名用例的**分工**（不是复制）
 *
 * `apps/web/tests/consent-gate.spec.ts` 钉的是浏览器那一份装配。
 * 这一份钉的是移动端**独有的三件事**：
 *
 *   1. **端口是 op-sqlite 设备偏好**，不是 `localStorage` ——
 *      它可能整台设备都打不开（原生库没起来），此时必须 **fail-closed**：
 *      读不到 = 没同意，而不是"猜一个默认值"。
 *   2. **实时通道那道闸不在 fetch 上**（`WebSocket` 不走 `fetch`），
 *      所以"装了进程级 fetch 闸"这句话对移动端**并不完整** ——
 *      另一半由 `sync/realtime.ts` 判（用例在那边的 spec 里）。
 *   3. **调用点是四组而不是两组**：自动同步的 `ready()`、手点的 `syncNow()`、
 *      `AuthScreen` 的五个出门动作、以及 `openTaskHost()` 里那份显式注入。
 *
 * ## 判据一律是"底层的**次数**"，不是"有没有报错"
 *
 * "报错了"挡不住"先把请求发出去、再报错"那种实现，而合规要的是**没发过**。
 *
 * ## 🔴 为什么每个模块都用 dynamic import
 *
 * `consentFetch` 在**模块求值期**就把当时的 `globalThis.fetch` 绑死了
 * （`globalThis.fetch.bind(globalThis)`，见 consent-gate.ts:69）。静态 import
 * 会被提到本文件最前面执行，那时计数器还没装上 —— 于是数出来**永远是 0**，
 * 一条"看起来完美、实际什么都没测"的判据（§7 第 50 条）。
 * 所以：先装计数器，再 `await import()`，让它绑的就是那个计数器。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 假设备偏好库。
 *
 * ⚠️ 为什么必须 mock 这一层而不是让 `device-prefs.ts` 自己去撞 op-sqlite：
 * 撞上去的结果是"整台设备记不住"，于是 `persisted: true` 那条路径
 * **在这个进程里永远测不到**，而那条路径才是真机上用户看到的那条。
 * 真实那条 fail-closed 行为由下面 `库打不开时` 那组专门覆盖。
 */
const prefs = vi.hoisted(() => ({
  store: new Map<string, string>(),
  /** `true` = 模拟"原生库不在"：读写删全部不生效（不抛，静默失败）。 */
  unavailable: false,
}));

vi.mock('../src/prefs/device-prefs', () => ({
  PREF_KEY_WELCOME_SEEN: 'welcome.hasSeen',
  DEVICE_PREFS_DB_NAME: 'heyta-device-prefs.sqlite',
  readDevicePref: (key: string): string | undefined =>
    prefs.unavailable ? undefined : prefs.store.get(key),
  writeDevicePref: (key: string, value: string): boolean => {
    if (prefs.unavailable) return false;
    prefs.store.set(key, value);
    return true;
  },
  deleteDevicePref: (key: string): boolean => {
    if (prefs.unavailable) return false;
    prefs.store.delete(key);
    return true;
  },
  markWelcomeSeen: () => true,
  hasSeenWelcome: () => false,
  resetDevicePrefsCacheForTests: () => undefined,
}));

const pristine = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    new Response('{"ok":true}', { status: 200 }),
);

/** 底层真实被调的次数 —— 所有"没发出去"的断言都围着它转。 */
const egressCount = (): number => pristine.mock.calls.length;

type GateModule = typeof import('../src/privacy/consent-gate');
type UiModule = typeof import('../src/privacy/consent-ui');
type StartupModule = typeof import('../src/privacy/startup');

let gate: GateModule;
let ui: UiModule;
let startup: StartupModule;

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  pristine.mockClear();
  prefs.store.clear();
  prefs.unavailable = false;
  globalThis.fetch = pristine as unknown as typeof fetch;

  gate = await import('../src/privacy/consent-gate');
  ui = await import('../src/privacy/consent-ui');
  startup = await import('../src/privacy/startup');

  // 起点必须是"没问过"，否则上一条用例留下的会话值会把闸门顶开。
  gate.privacyConsent.revoke();
  expect(gate.privacyConsent.networkAllowed(), '前置条件没成立：闸门本来就是开的').toBe(false);
});

describe('consentFetch：闸门关闭时底层一次都不调', () => {
  it('🔴 未同意 ⇒ 底层 0 次，抛的是 PrivacyConsentBlockedError', async () => {
    const error = await gate.consentFetch('https://heyta.example/api/sync/ops').then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(egressCount(), '没同意就发了请求').toBe(0);
    expect((error as Error).name).toBe('PrivacyConsentBlockedError');
    // 上层靠 **instanceof** 归类成 `consent-required`；换成别的名字，
    // 界面就会说"检查网络"—— 那是假话（真正的原因是还没同意）。
    expect((error as Error).message).toContain('privacy-consent-not-granted');
    expect((error as Error).message).toContain('/api/sync/ops');
  });

  it('🔴 「只用本机」与「还没问过」在"能不能出门"上同答，在"要不要再问"上不同答', async () => {
    gate.privacyConsentActions.localOnly();

    await expect(gate.consentFetch('https://heyta.example/api/sync/ops')).rejects.toThrow();
    expect(egressCount(), '明确不同意却仍然发出去了').toBe(0);

    // 这一对断言才是"两档不是一个布尔值"在宿主侧的落点。
    expect(gate.privacyConsent.undecided()).toBe(false);
    expect(ui.shouldAskOnFirstLaunch()).toBe(false);
  });

  it('同意之后照原样放行：入参与返回值都不许被这一层改动', async () => {
    expect(gate.privacyConsentActions.accept().persisted).toBe(true);

    const init = { method: 'POST' as const, headers: { 'x-a': '1' } };
    const response = await gate.consentFetch('https://heyta.example/api/sync/ops', init);

    expect(egressCount()).toBe(1);
    expect(pristine.mock.calls[0]![0]).toBe('https://heyta.example/api/sync/ops');
    expect(pristine.mock.calls[0]![1]).toBe(init);
    expect(response.status).toBe(200);
  });
});

describe('installConsentGatedFetch：把闸装到进程级出口上', () => {
  it('🔴 装上之后，**不知道有闸**的代码调全局 `fetch` 也出不去', async () => {
    // 移动端 `AuthScreen` / `hosted-auth` 走的正是这条路（没传 `fetchImpl`）。
    gate.installConsentGatedFetch();
    expect(globalThis.fetch).not.toBe(pristine);

    const error = await fetch('https://heyta.example/api/login/passkey/options').then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(egressCount(), '裸 fetch 绕过了闸门').toBe(0);
    expect((error as Error).name).toBe('PrivacyConsentBlockedError');
  });

  it('🔴 幂等：装两次不许把闸套两层', async () => {
    gate.installConsentGatedFetch();
    const afterFirst = globalThis.fetch;
    gate.installConsentGatedFetch();
    expect(globalThis.fetch, '第二次安装又包了一层').toBe(afterFirst);

    gate.privacyConsentActions.accept();
    await fetch('https://heyta.example/api/sync/ops');
    expect(egressCount()).toBe(1);
  });

  it('🔴 撤回之后，同一个已经装好的闸立刻重新拦住', async () => {
    gate.installConsentGatedFetch();
    gate.privacyConsentActions.accept();
    await fetch('https://heyta.example/api/sync/ops');
    expect(egressCount()).toBe(1);

    gate.privacyConsentActions.revoke();
    await expect(fetch('https://heyta.example/api/sync/ops')).rejects.toThrow();
    // **次数没有增加**才是判据：撤回之后还发得出去，就是"界面说已撤回、请求照发"。
    expect(egressCount()).toBe(1);
  });
});

describe('设备偏好库打不开时（移动端口门独有的一整类）', () => {
  beforeEach(() => {
    prefs.unavailable = true;
  });

  it('🔴 读不到 = **没同意**（fail-closed），不是猜一个默认值', () => {
    expect(gate.privacyConsent.undecided()).toBe(true);
    expect(gate.privacyConsent.networkAllowed()).toBe(false);
  });

  it('🔴 刚装好的设备 + 偏好库打不开 ⇒ 磁盘**真的被读过**，而且答案是"没问过"', async () => {
    /**
     * ⚠️ 为什么上面那条不够、这一条要**重新 import 一个闸门**：
     * 外层 `beforeEach` 调过一次 `revoke()`，而撤回会在会话里立一个"压住磁盘"的标记
     * （那是 M4/R16 要的另一个方向的行为）。拿着那个闸门判 fail-closed，
     * 实际判的是"撤回压住了磁盘" —— 磁盘那条读路径**根本没走**。
     * R15（读不通时兜底成"已同意"）第一轮就是这么溜过去的：判据全绿，
     * 因为它验证的那台设备从来不需要读磁盘。
     */
    vi.resetModules();
    prefs.unavailable = true;
    const fresh = await import('../src/privacy/consent-gate');

    expect(fresh.privacyConsent.undecided(), '偏好库读不通，却"已经有决定了"').toBe(true);
    expect(fresh.privacyConsent.networkAllowed(), '读不通 ⇒ 默认放行 = fail-open').toBe(false);
    await expect(fresh.consentFetch('https://heyta.example/api/sync/ops')).rejects.toThrow();
    expect(egressCount(), '读不通的那一刻就已经把包发出去了').toBe(0);
  });

  it('🔴 写不进去时这一轮仍然算同意，但界面**必须**知道没落地', async () => {
    const readout = gate.privacyConsentActions.accept();

    expect(readout.persisted).toBe(false);
    // 用户确实作出了明确同意；这台设备的存储没记住是**另一件事**。
    // 把它当成"没同意"会让"点了同意、同步永远不开始"—— 本仓库反复记过的静默失效。
    expect(gate.privacyConsent.networkAllowed()).toBe(true);
    await expect(gate.consentFetch('https://heyta.example/api/sync/ops')).resolves.toBeInstanceOf(
      Response,
    );
    expect(egressCount()).toBe(1);
  });

  it('🔴 面板不许静默收起：没落盘时 `notPersisted` 为 true 且 `open` 仍为 true', () => {
    ui.openPrivacySheet('first-launch');
    expect(ui.privacySheetState().open, '前置条件没成立：面板本来就没开').toBe(true);

    ui.acceptNetworkConsent();

    const sheet = ui.privacySheetState();
    expect(gate.privacyConsent.networkAllowed(), '这一轮的同意本身没生效').toBe(true);
    expect(sheet.notPersisted).toBe(true);
    // 🔴 收起的话，那句"这台设备没记住你的决定"就只剩设置页里能看到了 ——
    // 而没有人会为了这件事去翻设置。（与"警告必须出现在用户正看着的那一块上"同一条。）
    expect(sheet.open, '没落盘却把面板收起了：那句警告当场没人能看见').toBe(true);
  });

  it('撤回落盘失败时，本次会话也必须关门（否则"已撤回"与"照发"同时成立）', async () => {
    prefs.unavailable = false;
    gate.privacyConsentActions.accept();
    expect(gate.privacyConsent.networkAllowed()).toBe(true);

    prefs.unavailable = true; // 撤回这一刻磁盘坏了
    const { persisted } = gate.privacyConsentActions.revoke();

    expect(persisted).toBe(false);
    expect(gate.privacyConsent.networkAllowed()).toBe(false);
    await expect(gate.consentFetch('https://heyta.example/api/sync/ops')).rejects.toThrow();
    expect(egressCount()).toBe(0);
  });
});

describe('面板的三条界面行为（正常落盘的那台设备）', () => {
  it('🔴 决定**记住了**之后面板收起（否则每次同意都要多点一下「知道了」）', () => {
    ui.openPrivacySheet('first-launch');
    ui.acceptNetworkConsent();

    const sheet = ui.privacySheetState();
    expect(sheet.notPersisted).toBe(false);
    expect(sheet.open, '决定已经记住了还不收面板 = 把确认变成阻挡').toBe(false);
  });

  it('🔴 「以后再说」（面板的关闭动作）**不产生任何决定**', () => {
    ui.openPrivacySheet('first-launch');
    ui.closePrivacySheet();

    // 关闭一次就把同意作出了，那是把一次误触发明成一个法律决定。
    expect(gate.privacyConsent.current()).toBeNull();
    expect(gate.privacyConsent.undecided()).toBe(true);
    expect(gate.privacyConsent.networkAllowed()).toBe(false);
  });

  it('🔴 「点了要出门的按钮」这条路：返回 false 的同时**必须**把面板打开', () => {
    // 只 `return` 不弹面板，症状就是「点同步没反应」—— 本仓库反复记过的静默失效。
    expect(ui.requireNetworkConsent()).toBe(false);
    expect(ui.privacySheetState().open).toBe(true);
    expect(ui.privacySheetState().reason).toBe('required-for-action');
    expect(egressCount()).toBe(0);

    gate.privacyConsentActions.accept();
    expect(ui.requireNetworkConsent()).toBe(true);
  });

  it('🔴 重新打开面板要清掉**上一次**决定的"没记住"警告', () => {
    prefs.unavailable = true;
    ui.acceptNetworkConsent();
    expect(ui.privacySheetState().notPersisted).toBe(true);

    prefs.unavailable = false;
    ui.openPrivacySheet('revoked');
    // 不清的话，"上次没记住"这句话会跟着每一次重新打开的面板。
    expect(ui.privacySheetState().notPersisted).toBe(false);
  });
});

describe('决定变更要通知订阅者（自动同步与实时通道靠它）', () => {
  it('🔴 accept / localOnly / revoke 三个来源都通知 —— 一个都不许漏', () => {
    const seen: string[] = [];
    gate.subscribePrivacyConsent(() => seen.push('x'));

    gate.privacyConsentActions.accept();
    gate.privacyConsentActions.localOnly();
    gate.privacyConsentActions.revoke();

    expect(seen, '决定变了却没人被通知：自动同步会停在旧状态上').toHaveLength(3);
  });

  it('🔴 一个订阅者抛错，不许把其余的饿死', () => {
    const later = vi.fn();
    gate.subscribePrivacyConsent(() => {
      throw new Error('重建实时通道时炸了');
    });
    gate.subscribePrivacyConsent(later);

    expect(() => gate.privacyConsentActions.accept()).not.toThrow();
    expect(later, '前一个订阅者抛错，把后一个挡掉了').toHaveBeenCalledTimes(1);
    // 同意本身必须仍然成立 —— 通知失败不该把一个有效的法律决定变成一个故障。
    expect(gate.privacyConsent.networkAllowed()).toBe(true);
  });
});

describe('startPrivacyGate()：装配顺序与首启弹面板（G-11）', () => {
  it('🔴 没决定过 ⇒ 装上 fetch 闸**并**弹出面板，原因写的是「首次启动」', () => {
    startup.startPrivacyGate();

    expect(globalThis.fetch, '闸没装到进程级出口上：裸 fetch 能绕过去').toBe(gate.consentFetch);
    const sheet = ui.privacySheetState();
    expect(sheet.open, '从没问过的设备没被问 —— G-11 那条缺口原样留着').toBe(true);
    expect(sheet.reason).toBe('first-launch');
  });

  it('🔴 明确选过「只用本机」⇒ 不再弹，但闸照样要装', () => {
    gate.privacyConsentActions.localOnly();
    expect(ui.privacySheetState().open).toBe(false);

    startup.startPrivacyGate();

    // 已经答过的人被反复问，会把"我们尊重你的决定"变成空话（判据是 undecided()，
    // 不是 networkAllowed() —— 两者在"只用本机"这一档上给出的是**不同**答案）。
    expect(ui.privacySheetState().open, '每次冷启动重问一遍已经作过的决定').toBe(false);
    expect(globalThis.fetch).toBe(gate.consentFetch);
    expect(egressCount()).toBe(0);
  });

  it('🔴 已经同意过 ⇒ 不弹（"别打扰做过决定的人"对两档都要成立）', () => {
    gate.privacyConsentActions.accept();
    startup.startPrivacyGate();
    expect(ui.privacySheetState().open).toBe(false);
  });

  it('撤回之后下一次冷启动会重新问（撤回的定义就是"回到没问过"）', () => {
    gate.privacyConsentActions.accept();
    gate.privacyConsentActions.revoke();

    startup.startPrivacyGate();

    expect(ui.privacySheetState().open).toBe(true);
    expect(egressCount(), '撤回之后这一轮还发得出请求').toBe(0);
  });

  it('装好之后，同意之前任何请求都出不去（这一条把上面两段串成一句话）', async () => {
    startup.startPrivacyGate();
    await expect(fetch('https://heyta.example/api/sync/ops')).rejects.toThrow();
    expect(egressCount()).toBe(0);

    gate.privacyConsentActions.accept();
    await expect(fetch('https://heyta.example/api/sync/ops')).resolves.toBeInstanceOf(Response);
    expect(egressCount()).toBe(1);
  });
});

/*
  ──────────────────────────────────────────────────────────────────────────
  🔴 下面是**源码级**判据：调用点在不在、顺序对不对。
  ──────────────────────────────────────────────────────────────────────────

  为什么这一组不写成行为用例：`auto-sync.ts` 在模块顶层就 `AppState.addEventListener`、
  `sync/store.ts` 会去开真 SQLite、`AuthScreen` 是 RN 组件（本壳没有 RN 渲染测试栈）。
  那些地方**没有**能在纯 node 里跑起来的注入缝，而"有人把那道检查删了 / 挪晚了"
  恰恰是最需要失败的两种改动。这是本仓既有的做法，理由写在
  `realtime-wiring.spec.ts` 那段"调用点存在"的注释里（同一个坑）。

  ⚠️ 判据必须**先去掉注释**再匹配：第一版这类判据曾把
  `// void startRealtime();` 这种注释掉的调用算成调用，**注释掉照样绿**。
*/
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/**
 * 只留下**会被执行**的东西：块注释（含 JSX 的 `{/* … *\/}`）与行注释一律去掉。
 *
 * ⚠️ 这一层不是整洁癖：第一版这类判据曾把
 * `// void startRealtime();` 这种**注释掉**的调用算成调用，注释掉照样绿。
 * 现在连"注释里写了一句 `flex: 1`"都不会再被数进等宽判据里。
 * 行注释要求 `//` 前面是行首或空白，否则会把 `'https://…'` 这样的字符串截断。
 */
function codeOf(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** 从 `open` 处的 `{` 起做括号配平，返回**不含**外层花括号的内部文本。 */
function braceBalanced(code: string, open: number): string {
  expect(open, '找不到 `{` —— 被匹配的东西不存在').toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  throw new Error('花括号没有闭合');
}

/**
 * 取 `const <name> = (...) => { ... }` / `function <name>(...) { ... }` 的**函数体**。
 *
 * 两处都不是仪式：
 *
 * · 用括号配平而不是正则截断 —— 正则 `/const X[\s\S]*?\n  \};/` 会被函数体里
 *   任何一处 `};` 提前截断，于是"检查在后半段"也能被判过。
 * · 函数体的 `{` 必须从**参数列表之后**开始找 —— `startRealtime(over: Partial<X> = {})`
 *   这种带默认值的参数里就有 `{}`，直接找第一个 `{` 会截到签名里，
 *   于是整个函数体"看不见"，判据当场变成一条永远不成立的空断言。
 */
function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`const ${name} =`);
  const from = at >= 0 ? at : code.indexOf(`function ${name}(`);
  expect(from, `找不到 ${name} —— 调用点不存在`).toBeGreaterThanOrEqual(0);
  const afterParams = code.indexOf(')', from);
  expect(afterParams, `${name} 没有参数列表的右括号`).toBeGreaterThan(from);
  return braceBalanced(code, code.indexOf('{', afterParams));
}

/**
 * 断言 `before` 与 `after` 都在 `text` 里，且 `before` **先**出现。
 *
 * 顺序在这一点上不是洁癖：`syncNow()` 里闸门排在 `set({ busy: true })` 之后，
 * 界面会显示一次"正在同步"然后立刻失败；`AuthScreen` 里闸门排在请求之后，
 * 就是"同意之前已经把包发出去了"。**都在**但**顺序错**，这两种实现都得红。
 */
function assertOrdered(text: string, before: RegExp, after: RegExp, why: string): void {
  const first = text.search(before);
  const second = text.search(after);
  expect(first, `缺少 ${String(before)}：${why}`).toBeGreaterThanOrEqual(0);
  expect(second, `缺少 ${String(after)}：${why}`).toBeGreaterThanOrEqual(0);
  expect(first < second, `顺序反了：${why}（先出现的位置 ${String(first)} vs ${String(second)}）`).toBe(
    true,
  );
}

describe('调用点与顺序（源码级：删掉或挪晚都会红）', () => {
  it('🔴 `App.tsx` 在**模块顶层**装闸，不在 effect 里', () => {
    const code = codeOf('App.tsx');
    expect(
      /^startPrivacyGate\(\);$/m.test(code),
      '`startPrivacyGate()` 不在模块顶层（缩进为 0）—— 放进 effect 里意味着首帧之后才装闸',
    ).toBe(true);
  });

  it('🔴 移动端宿主**显式**注入闸门 fetch，不靠构造顺序', () => {
    // `SyncClient` 在构造函数里就把 fetch 取走了（client.ts:670），
    // 只换全局等于"依赖 openTaskHost() 一定发生在装闸之后"这种没人守的假设。
    expect(codeOf('db/open-host.ts')).toMatch(/fetchImpl:\s*consentFetch/);
  });

  it('🔴 自动同步的 `ready()`：闸门是**第一道**，排在凭据检查之前', () => {
    const body = bodyOf(codeOf('sync/auto-sync.ts'), 'ready');
    assertOrdered(
      body,
      /privacyConsent\.networkAllowed\(\)/,
      /readSyncConfig\(\)/,
      '没同意时自动同步照跑 —— 而"还没配置服务器"那句话会盖住真正的原因',
    );
  });

  it('🔴 `syncNow()`：闸门排在 `set({ busy: true })` 之前，拦下时**不进** busy', () => {
    const body = bodyOf(codeOf('sync/store.ts'), 'syncNow');
    assertOrdered(
      body,
      /consentGate\(\)/,
      /set\(\{\s*busy:\s*true/,
      '界面会闪一次"正在同步"然后立刻失败，而真正的原因（还没同意）没地方说',
    );
  });

  it('🔴 同意变更的订阅者：放行要补跑、撤回要关通道（两个方向都不许只做一个）', () => {
    const code = codeOf('sync/auto-sync.ts');
    const body = bodyOf(code, 'startAutoSync');
    const at = body.indexOf('subscribePrivacyConsent(');
    expect(at, '没有订阅同意变更 —— 首启面板点了同意，自动同步要等到下次切前台').toBeGreaterThanOrEqual(
      0,
    );
    /**
     * 🔴 判据的范围必须**只到那个回调自己的 `{}`**为止。
     *
     * 第一版取的是 `body.slice(at)`（订阅之后的全部文本），于是 R3 那个变异
     * —— 删掉回调里的 `else stopRealtime();` —— **照样绿**：紧跟在后面的
     * `stopAutoSync()` 里也有一句 `stopRealtime()`，替它把这一格补上了。
     * 范围宽一寸，判据就假一寸。
     */
    const callback = braceBalanced(body, body.indexOf('{', at));
    // 只判"订阅了"不够：漏掉 `else stopRealtime()` 的那一份实现，症状是
    // 「界面说已撤回，服务端的推送照样进来」—— 而那正是撤回这个功能存在的理由。
    expect(
      /notifyConfigured\(\)/.test(callback),
      '放行时没补跑：点了同意，调度器与实时通道都停在旧状态',
    ).toBe(true);
    expect(
      /stopRealtime\(\)/.test(callback),
      '回调里没有关通道那一支：撤回之后 WebSocket 照推，而界面写着「已撤回」',
    ).toBe(true);
    assertOrdered(
      callback,
      /networkAllowed\(\)/,
      /stopRealtime\(\)/,
      '撤回分支没先读闸门就关通道 —— 那是把"同意"也当成撤回',
    );
  });

  it('🔴 撤回时先停通道、后判闸门（`startRealtime` 侧的顺序）', () => {
    // 顺序反了会留下一条带着旧令牌的 WebSocket，而界面上写着「已撤回」。
    const body = bodyOf(codeOf('sync/realtime.ts'), 'startRealtime');
    assertOrdered(
      body,
      /stopRealtime\(\)/,
      /deps\.networkAllowed\(\)/,
      '闸门排在 stopRealtime 之前 = 撤回时旧连接原地留着',
    );
  });

  it('🔴 `AuthScreen` 五个出门动作**每一个**都先过闸门', () => {
    const code = codeOf('screens/AuthScreen.tsx');
    const handlers: Array<[name: string, egress: RegExp]> = [
      ['sendLoginLink', /requestMagicLink\(/],
      ['register', /registerWithMagicLink\(/],
      ['passkeyLogin', /beginPasskeyLogin\(/],
      ['passkeyRegister', /beginPasskeyRegistration\(/],
      ['redeemPasted', /redeemPastedAuthToken\(/],
    ];
    for (const [name, egress] of handlers) {
      const body = bodyOf(code, name);
      assertOrdered(
        body,
        /requireNetworkConsent\(\)/,
        egress,
        `${name} 会在没同意时发请求（fetch 那层会拦住，但界面要说清为什么，而不是转圈）`,
      );
    }
  });

  it('🔴 设置页那个**撤回入口**存在，并且开的是同一张面板', () => {
    const code = codeOf('screens/SettingsScreen.tsx');
    expect(code).toMatch(/privacyConsentActions\.revoke\(\)/);
    // 🔴 「重新作出选择」必须复用**同一张**面板；另写一个"同意界面"就是第二个裁决者。
    expect(code).toMatch(/openPrivacySheet\(/);
    expect(code).toMatch(/subscribePrivacyConsent\(/);
  });
});

/**
 * 🔴 **界面形状的判据**（PIPL 第 16 条 + 《认定方法》"诱导同意"那一类）。
 *
 * 这几条为什么用源码级而不是渲染快照：本壳没有 RN 组件测试栈（没有
 * `@testing-library/react-native`，而为一个判据引新依赖要过 AGENTS §3.1–3.2 两道门）。
 * 形状是**写在 JSX 里的事实**，读源码就能钉住它被删掉/改掉，而这正是最可能发生的事。
 */
describe('首启面板的界面纪律（不同意必须是同等可达的一条路）', () => {
  const code = codeOf('screens/PrivacyConsentSheet.tsx');

  it('🔴 「同意并联网」与「只用本机」**并排且等宽**（同一行、两个槽位共用同一个等宽样式）', () => {
    const acceptAt = code.indexOf("t('common.privacy.consent.accept')");
    const localAt = code.indexOf("t('common.privacy.consent.localOnly')");
    expect(acceptAt, '没有「同意」按钮').toBeGreaterThanOrEqual(0);
    expect(localAt, '没有「只用本机」按钮').toBeGreaterThanOrEqual(0);
    expect(acceptAt < localAt, '「只用本机」排在「同意」之前（读屏顺序会决定第一下命中谁）').toBe(true);
    // 2026-10-02 样式迁移（L4）：内联对象改为模块级 StyleSheet（makeStyles 惯用法），
    // 判据跟着换形态、**意图不变**：两个槽位必须引用**同一个** `styles.action`
    // （共享一个等宽定义比两份内联各写一遍更不会漂），且该样式确实是 flex:1、
    // 所在行确实是横向 row —— 把"不同意"做窄一点就是《认定方法》里的诱导同意。
    expect(
      (code.match(/style=\{styles\.action\}/g) ?? []).length,
      '两个选项没有共用同一个等宽槽位样式',
    ).toBe(2);
    const actionStyleAt = code.indexOf('action: {');
    expect(
      code.slice(actionStyleAt, actionStyleAt + 60),
      '等宽槽位样式丢了 flex:1',
    ).toMatch(/flex:\s*1/);
    expect(
      code,
      '两个决定按钮不在同一个横向 row 里 —— 上下堆叠会把"二选一"读成"先主后次"',
    ).toMatch(/actionsRow: \{\s*flexDirection: 'row'/);
  });

  it('🔴 「只用本机」是**中性**的（danger 色 = 把拒绝画成惩罚）', () => {
    const localAt = code.indexOf("t('common.privacy.consent.localOnly')");
    const own = code.slice(localAt, localAt + 300);
    expect(/tone="secondary"/.test(own), '「只用本机」没有显式的 secondary 语气').toBe(true);
    expect(/tone="danger"/.test(own), '「只用本机」用了 danger 色').toBe(false);
  });

  it('🔴 系统返回手势（`onRequestClose`）接的是**关闭**，不是同意', () => {
    // 行为那半边在上面的「以后再说」用例里已经钉死了（关闭之后仍然是"没问过"）；
    // 这一条只补它够不着的那一段：**面板真的接的是那个函数**。
    expect(code).toMatch(/onRequestClose=\{closePrivacySheet\}/);
    expect(/onRequestClose=\{acceptNetworkConsent\}/.test(code), '返回键被接成"同意"').toBe(false);
    // 关闭这条动作本身也不许偷偷记账 —— 否则换个变量名就能绕过上面那条。
    const closeBody = bodyOf(codeOf('privacy/consent-ui.ts'), 'closePrivacySheet');
    expect(/decide\(/.test(closeBody), 'closePrivacySheet 里在作决定').toBe(false);
  });

  it('🔴 两个保证都摆出来（本地优先不是"降级"，这句要说给用户）', () => {
    expect(code).toMatch(/localOnlyGuarantee/);
    expect(code).toMatch(/acceptedGuarantee/);
  });

  it('⚠️ 条款链接不做 `canOpenURL()` 预检（iOS 未登记 scheme 时它恒 false，会把真链接判死）', () => {
    expect(code).toMatch(/Linking\.openURL\(/);
    expect(code, '出现了 canOpenURL 预检 —— 见文件头那条理由').not.toMatch(/canOpenURL/);
  });
});
