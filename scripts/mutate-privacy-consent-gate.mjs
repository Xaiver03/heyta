/**
 * 链 5（隐私同意闸门）判据的变异验证
 * =================================
 *
 * 这条链上每一处"看起来在保护，其实保护的是另一件事"都在这张表里有一个对应的变异。
 *
 * **链的这一侧（app-host，M1–M8）改的是 `packages/app-host/src/privacy-consent.ts`**，
 * 因为那一层的错法全能在那一层现形。**另一侧（web，W1–W6）改的是外壳的接线**，
 * 抓的判据也各自不同 —— 这一分法本身就是结论：判定只有一份，
 * 而"判定有没有被接到调用点上"是六个**独立**的失效面，每个都要单独钉。
 *
 * 🔴 **第三侧（移动端，R1–R16）不是 web 那一份的复制品。** 浏览器那一组抓不到的
 * 东西在这里全都有对应物：`WebSocket` 不走 `fetch`（R4/R5）、落盘后端可能整台
 * 设备都不可用（R15）、同步的调用点是另一套（R1/R2/R3）、界面形状由 RN 组件
 * 自己决定（R10/R11/R12/R13）。**一层共享判定 + 三个壳各自接线 = 失效面按壳数独立**，
 * 不因为"逻辑抽公共了"就能一次验证覆盖三处。
 *
 *   M1 `privacyNetworkAllowed` 改成"有记录就放行"（明确不同意也出门）
 *   M2 解析时不再核对词表（`'true'` / `'ACCEPTED'` 这类表外值被当成同意）
 *   M3 闸门**先发**再判（判据必须数得出底层调用次数，而不只是"报错了"）
 *   M4 撤回时不压住磁盘值（撤回落盘失败 ⇒ 界面说已撤回、请求照发）
 *   M5 写盘失败时不认本次会话的同意（点了「同意并继续」而同步永不开始）
 *   M6 读的时候磁盘优先（同 M5 的反面：新同意被旧决定盖掉）
 *   M7 决定时间改用 `Intl` —— 移动端 Hermes 上它可能整个不存在，抛在设置页 = 那一页打不开
 *   M8 决定时间只剩日期 —— 同一行收据在四个壳里变成三个答案
 *
 *   W1 `startup-network` 的 arm() 不判闸门 ⇒ 同意前就注册 SW / 连实时 / 采用登录
 *   W2 `installConsentGatedFetch()` 不真的换掉 `globalThis.fetch` ⇒ 进程级那道是空的
 *   W3 铃铛的自动拉取不判闸门 ⇒ 未同意时发请求，界面接着说"稍后重试"（说谎）
 *   W4 同意后不补拉 ⇒ 点了同意，徽标一直是空的（"按了没反应"那一类）
 *   W5 活动 Tab 不判闸门 ⇒ 给没同意的用户**写一行邀请码**（不只是多发一个请求）
 *   W6 `App` 挂载时不弹首启面板 ⇒ G-11 整条不成立（闸门还在，但没人问过用户）
 *
 *   R1  `ready()` 不判闸门          R2  `syncNow()` 的闸挪到 `busy` 之后
 *   R3  订阅只处理放行             R4  实时通道的闸排在 `stopRealtime()` 之前
 *   R5  实时默认 `networkAllowed` 恒真   R6  宿主不注入 `consentFetch`
 *   R7  「撤回」实现成「改成不同意」  R8  注册动作不判闸门
 *   R9  装闸被挪进函数体           R10 「只用本机」染成 danger
 *   R11 两个按钮不等宽             R12 「以后再说」顺手记一次同意
 *   R13 没落盘也收面板             R14 首启判据改成"还没同意"
 *   R15 读不到时兜底成已同意       R16 换全局那一步变成空操作
 *
 * 本脚本会**临时改写工作树**，每个变异跑完立刻还原并核对字节；
 * 还原前先比对磁盘内容，不一致就停手（共享工作树里别人可能正在改同一批文件）。
 *
 * 用法：`node scripts/mutate-privacy-consent-gate.mjs`（退出码非 0 = 有判据抓不到）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const GATE = `${ROOT}/packages/app-host/src/privacy-consent.ts`;
const STARTUP = `${ROOT}/apps/web/src/features/privacy/startup-network.ts`;
const CONSENT_WEB = `${ROOT}/apps/web/src/features/privacy/consent-gate.ts`;
const BELL = `${ROOT}/apps/web/src/features/inbox/InboxBell.tsx`;
const APP = `${ROOT}/apps/web/src/App.tsx`;

const M = `${ROOT}/apps/mobile/src`;
const CONSENT_RN = `${M}/privacy/consent-gate.ts`;
const UI_RN = `${M}/privacy/consent-ui.ts`;
const STARTUP_RN = `${M}/privacy/startup.ts`;
const AUTO_RN = `${M}/sync/auto-sync.ts`;
const STORE_RN = `${M}/sync/store.ts`;
const REALTIME_RN = `${M}/sync/realtime.ts`;
const OPENHOST_RN = `${M}/db/open-host.ts`;
const APP_RN = `${M}/App.tsx`;
const AUTH_RN = `${M}/screens/AuthScreen.tsx`;
const SETTINGS_RN = `${M}/screens/SettingsScreen.tsx`;
const SHEET_RN = `${M}/screens/PrivacyConsentSheet.tsx`;

const pristine = new Map(
  [
    GATE,
    STARTUP,
    CONSENT_WEB,
    BELL,
    APP,
    CONSENT_RN,
    UI_RN,
    STARTUP_RN,
    AUTO_RN,
    STORE_RN,
    REALTIME_RN,
    OPENHOST_RN,
    APP_RN,
    AUTH_RN,
    SETTINGS_RN,
    SHEET_RN,
  ].map((f) => [f, readFileSync(f, 'utf8')]),
);

function replaceIn(file, from, to) {
  const src = pristine.get(file);
  if (!src.includes(from)) throw new Error(`变异锚点没命中：${from.slice(0, 60)}`);
  if (src.split(from).length > 2) {
    throw new Error(`变异锚点命中多处（会改错地方）：${from.slice(0, 60)}`);
  }
  writeFileSync(file, src.replace(from, to));
}

/** 还原并核对字节。 */
function restore(file) {
  const want = pristine.get(file);
  if (readFileSync(file, 'utf8') !== want) writeFileSync(file, want);
  if (readFileSync(file, 'utf8') !== want) throw new Error(`还原失败：${file}`);
}

/** 每个变异自带的归属：改哪些文件、在哪个包里跑哪份判据。 */
const HOST = {
  files: [GATE],
  dir: 'packages/app-host',
  filter: '@heyta/app-host',
  testFile: 'tests/privacy-consent.spec.ts',
};
const WEB = {
  files: [STARTUP],
  dir: 'apps/web',
  filter: '@heyta/web',
  testFile: 'tests/startup-network.spec.ts',
};

const hostCases = [
  {
    name: 'M1 有记录就放行（明确不同意也照样出门）',
    apply: () =>
      replaceIn(
        GATE,
        'return record !== null && record.decision === \'accepted\';',
        'return record !== null;',
      ),
  },
  {
    name: 'M2 解析不再核对词表（表外值被当成有效同意）',
    apply: () =>
      replaceIn(
        GATE,
        'if (typeof decision !== \'string\' || !DECISIONS.has(decision)) return null;',
        'if (typeof decision !== \'string\') return null;',
      ),
  },
  {
    name: 'M3 闸门先发请求再判（合规前提变成事后诸葛）',
    apply: () =>
      replaceIn(
        GATE,
        '    if (isAllowed()) return fetchImpl(input as RequestInfo, init);',
        '    const sent = fetchImpl(input as RequestInfo, init);\n    if (isAllowed()) return sent;',
      ),
  },
  {
    name: 'M4 撤回时不压住磁盘值（"已撤回"与"请求照发"同时成立）',
    apply: () =>
      replaceIn(
        GATE,
        '      session = null;\n      revoked = true;\n      return { persisted };',
        '      session = null;\n      return { persisted };',
      ),
  },
  {
    name: 'M5 写盘失败就不认这次同意（点了同意而同步永远不开始）',
    apply: () =>
      replaceIn(
        GATE,
        '      session = record;\n      revoked = false;',
        '      if (persisted) session = record;\n      revoked = false;',
      ),
  },
  {
    name: 'M6 读的时候磁盘优先（新的同意被磁盘上的旧决定盖掉）',
    apply: () =>
      replaceIn(
        GATE,
        '    if (session !== null) return session;\n    return parsePrivacyConsent(port.read(PRIVACY_CONSENT_KEY));',
        '    return parsePrivacyConsent(port.read(PRIVACY_CONSENT_KEY)) ?? session;',
      ),
  },
  {
    // 这条不是"格式不好看"：`Intl` 在 Hermes 上是可选编译的，拿不到时
    // `new Intl.DateTimeFormat()` **直接抛** —— 抛在设置页就是那一页打不开。
    // 而且它的输出随运行环境漂，写进测试会让判据挂在开发机配置上。
    name: 'M7 决定时间改用 `Intl`（移动端那一页当场抛，web 的判据跟着系统 ICU 漂）',
    apply: () =>
      replaceIn(
        GATE,
        '  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;',
        '  return new Intl.DateTimeFormat().format(new Date(iso));',
      ),
  },
  {
    name: 'M8 决定时间只剩日期（四个壳里"什么时候点的"变成三个答案）',
    apply: () =>
      replaceIn(
        GATE,
        '  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;',
        '  return iso.slice(0, 10);',
      ),
  },
].map((c) => ({ ...HOST, ...c }));

const webCases = [
  {
    name: 'W1 arm() 不判闸门（同意前就注册 SW / 连实时 / 采用登录）',
    apply: () => replaceIn(STARTUP, '      if (!ports.networkAllowed()) return;\n', ''),
    files: [STARTUP],
    testFile: 'tests/startup-network.spec.ts',
  },
  {
    name: 'W2 installConsentGatedFetch 不真的换掉 globalThis.fetch（进程级那道是空的）',
    apply: () => replaceIn(CONSENT_WEB, '  globalThis.fetch = consentFetch;', '  // 变异：不换全局'),
    files: [CONSENT_WEB],
    testFile: 'tests/consent-gate.spec.ts',
  },
  {
    name: 'W3 铃铛的自动拉取不判闸门（未同意就发请求，界面接着说「稍后重试」）',
    apply: () =>
      replaceIn(
        BELL,
        '  const pollNotifications = useCallback((): void => {\n    if (!privacyConsent.networkAllowed()) return;\n    void refreshNotifications();',
        '  const pollNotifications = useCallback((): void => {\n    void refreshNotifications();',
      ),
    files: [BELL],
    testFile: 'tests/inbox.spec.tsx',
  },
  {
    name: 'W4 同意之后不补拉（点了同意，徽标一直是空的）',
    apply: () =>
      replaceIn(
        BELL,
        '  useEffect(\n    () =>\n      subscribePrivacyConsent(() => {\n        pollNotifications();\n      }),\n    [pollNotifications],\n  );',
        '  // 变异：去掉同意后补拉',
      ),
    files: [BELL],
    testFile: 'tests/inbox.spec.tsx',
  },
  {
    name: 'W5 活动 Tab 不判闸门（给没同意的用户写一行邀请码）',
    apply: () =>
      replaceIn(
        BELL,
        "    if (!open || tab !== 'activity') return;\n    if (!privacyConsent.networkAllowed()) return;",
        "    if (!open || tab !== 'activity') return;",
      ),
    files: [BELL],
    testFile: 'tests/inbox.spec.tsx',
  },
  {
    name: 'W6 挂载时不弹首启面板（闸门还在，但从来没人问过用户）',
    apply: () =>
      replaceIn(
        APP,
        "    if (shouldAskOnFirstLaunch()) usePrivacyStore.getState().openSheet('first-launch');",
        '    // 变异：首启不弹',
      ),
    files: [APP],
    testFile: 'tests/privacy-consent-sheet.spec.tsx',
  },
].map((c) => ({ ...WEB, ...c }));

/*
  ──────────────────────────────────────────────────────────────────────────
  🔴 第三侧：移动端（R1–R15）
  ──────────────────────────────────────────────────────────────────────────

  为什么 web 那一组**不算数**：移动端的出口形状与浏览器不同 ——
  `WebSocket` 不走 `fetch`，所以那里那道进程级闸在这里只覆盖一半；
  落盘后端是 op-sqlite 设备偏好而不是 `localStorage`，所以"整台设备记不住"
  这一整类在浏览器里根本没有对应物；而自动同步/实时通道是**另一套**调用点。
  一层共享判定，三个壳各自接线 —— 失效面按壳数独立，不因为"逻辑抽公共了"就合并。
*/
const RN = {
  files: [],
  dir: 'apps/mobile',
  filter: '@heyta/mobile',
  testFile: 'tests/privacy-consent-gate.spec.ts',
};
const REALTIME_SPEC = 'tests/realtime-wiring.spec.ts';

const mobileCases = [
  {
    name: 'R1 自动同步的 `ready()` 不判闸门（冷启动前台同步悄悄出去）',
    apply: () =>
      replaceIn(
        AUTO_RN,
        '  if (!privacyConsent.networkAllowed()) return false;\n  if (!foreground) return false;',
        '  if (!foreground) return false;',
      ),
    files: [AUTO_RN],
  },
  {
    name: 'R2 手点的 `syncNow()` 把闸门挪到 `busy` 之后（先转圈再失败，真话没地方说）',
    apply: () =>
      replaceIn(
        STORE_RN,
        '  const blocked = consentGate();\n  if (blocked !== null) {\n    set({ status: blocked });\n    return blocked;\n  }\n\n  set({ busy: true, status: { kind: \'syncing\', phase: \'upload\' } });',
        '  set({ busy: true, status: { kind: \'syncing\', phase: \'upload\' } });\n\n  const blocked = consentGate();\n  if (blocked !== null) {\n    set({ status: blocked });\n    return blocked;\n  }\n',
      ),
    files: [STORE_RN],
  },
  {
    name: 'R3 同意订阅只处理"放行"、不处理"撤回"（界面说已撤回，WebSocket 照推）',
    apply: () =>
      replaceIn(
        AUTO_RN,
        '    if (privacyConsent.networkAllowed()) notifyConfigured();\n    else stopRealtime();',
        '    if (privacyConsent.networkAllowed()) notifyConfigured();',
      ),
    files: [AUTO_RN],
  },
  {
    name: 'R4 `startRealtime` 的闸门排在 `stopRealtime()` 之前（撤回时留下一条带旧令牌的连接）',
    apply: () =>
      replaceIn(
        REALTIME_RN,
        '  const deps = resolveDeps(over);\n  stopRealtime();',
        '  const deps = resolveDeps(over);\n  if (!deps.networkAllowed()) return;\n  stopRealtime();',
      ),
    files: [REALTIME_RN],
    testFile: REALTIME_SPEC,
  },
  {
    name: 'R5 实时通道的默认 `networkAllowed` 变成恒真（注入缝还在，生产却绕开了闸）',
    apply: () =>
      replaceIn(
        REALTIME_RN,
        'networkAllowed: over.networkAllowed ?? (() => privacyConsent.networkAllowed()),',
        'networkAllowed: over.networkAllowed ?? (() => true),',
      ),
    files: [REALTIME_RN],
    testFile: REALTIME_SPEC,
  },
  {
    name: 'R6 移动宿主不注入 `consentFetch`（只靠"全局 fetch 已被换掉"+ 构造顺序）',
    apply: () => replaceIn(OPENHOST_RN, '      fetchImpl: consentFetch,\n', ''),
    files: [OPENHOST_RN],
  },
  {
    name: 'R7 设置页的「撤回」实现成「改成不同意」（回到"没问过"这件事没了）',
    apply: () =>
      replaceIn(
        SETTINGS_RN,
        '= privacyConsentActions.revoke();',
        '= privacyConsentActions.localOnly();',
      ),
    files: [SETTINGS_RN],
  },
  {
    name: 'R8 注册动作不判闸门（没同意时点「注册」直接发请求）',
    apply: () =>
      replaceIn(
        AUTH_RN,
        '  const sendLoginLink = async (): Promise<void> => {\n    if (!requireNetworkConsent()) return;',
        '  const sendLoginLink = async (): Promise<void> => {',
      ),
    files: [AUTH_RN],
  },
  {
    name: 'R9 `startPrivacyGate()` 被挪进函数体（首帧之后才装闸）',
    apply: () => replaceIn(APP_RN, '\nstartPrivacyGate();\n', '\n  startPrivacyGate();\n'),
    files: [APP_RN],
  },
  {
    name: 'R10 「只用本机」染成 danger（把拒绝画成惩罚 = 诱导同意）',
    apply: () =>
      replaceIn(
        SHEET_RN,
        'onPress={chooseLocalOnly}\n                  tone="secondary"',
        'onPress={chooseLocalOnly}\n                  tone="danger"',
      ),
    files: [SHEET_RN],
  },
  {
    name: 'R11 两个决定按钮不等宽（"不同意"那一侧变窄）',
    apply: () =>
      replaceIn(
        SHEET_RN,
        '              <View style={{ flex: 1 }}>\n                <Button\n                  label={t(\'common.privacy.consent.localOnly\')}',
        '              <View style={{ flex: 2 }}>\n                <Button\n                  label={t(\'common.privacy.consent.localOnly\')}',
      ),
    files: [SHEET_RN],
  },
  {
    name: 'R12 「以后再说」（关闭）顺手记了一次同意',
    apply: () =>
      replaceIn(
        UI_RN,
        'export function closePrivacySheet(): void {\n  set({ open: false });\n}',
        'export function closePrivacySheet(): void {\n  set({ open: false });\n  privacyConsent.decide(\'accepted\');\n}',
      ),
    files: [UI_RN],
  },
  {
    name: 'R13 决定没落盘时也把面板收起（那句警告当场没人能看见）',
    apply: () =>
      replaceIn(
        UI_RN,
        '  const { persisted } = privacyConsentActions.accept();\n  set(persisted ? { open: false, notPersisted: false } : { open: true, notPersisted: true });',
        '  const { persisted } = privacyConsentActions.accept();\n  void persisted;\n  set({ open: false, notPersisted: false });',
      ),
    files: [UI_RN],
  },
  {
    name: 'R14 首启判据从 `undecided()` 改成"还没同意"（答过「只用本机」的人每次冷启动被重问）',
    apply: () =>
      replaceIn(
        STARTUP_RN,
        "  if (privacyConsent.undecided()) openPrivacySheet('first-launch');",
        "  if (!privacyConsent.networkAllowed()) openPrivacySheet('first-launch');",
      ),
    files: [STARTUP_RN],
  },
  {
    name: 'R15 设备偏好读不到时兜底成"已同意"（fail-open：整台设备记不住 = 默认放行）',
    apply: () =>
      replaceIn(
        CONSENT_RN,
        '  read: (key) => readDevicePref(key),',
        '  read: (key) =>\n    readDevicePref(key) ?? \'{"decision":"accepted","decidedAt":"2020-01-01T00:00:00.000Z"}\',',
      ),
    files: [CONSENT_RN],
  },
  {
    name: 'R16 `installConsentGatedFetch()` 不真的换掉全局 fetch（进程级那道是空的）',
    apply: () => replaceIn(CONSENT_RN, '  globalThis.fetch = consentFetch;', '  // 变异：不换全局'),
    files: [CONSENT_RN],
  },
].map((c) => ({ ...RN, ...c }));

const cases = [...hostCases, ...webCases, ...mobileCases].map((c) => ({
  ...c,
  cmd: ['--filter', c.filter, 'exec', 'vitest', 'run', c.testFile],
}));

let missed = 0;
for (const c of cases) {
  c.apply();
  let red = false;
  let out = '';
  try {
    execFileSync('pnpm', c.cmd, {
      cwd: `${ROOT}/${c.dir}`,
      stdio: 'pipe',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (e) {
    red = true;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  // 打印**具体哪几条**转红：只报"退出码非 0"证明不了是这条判据抓到的
  // —— 加载期崩溃与判据红在退出码上长得一模一样。
  const failedTests = out
    .split('\n')
    .map((line) => line.replace(/\s{2,}$/, ''))
    .filter((line) => /(^\s*[×✕✗✘]\s)|(^\s*FAIL)/.test(line))
    .slice(0, 4)
    .map((line) => line.trim());
  console.log(`${red ? '✅ 被抓到' : '🔴 没抓到'} | ${c.name}`);
  if (red && failedTests.length > 0) console.log(`        ${failedTests.join('\n        ')}`);
  if (!red) missed += 1;
  for (const f of c.files) restore(f);
}

console.log(
  missed === 0
    ? `结论：${cases.length} 个变异全部被抓到，工作树已还原`
    : `结论：${missed}/${cases.length} 个变异没被抓到 —— 那条判据是装饰`,
);
process.exit(missed === 0 ? 0 : 1);
