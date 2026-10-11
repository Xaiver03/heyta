#!/usr/bin/env node
/**
 * macOS 壳级「小组件环境识别 + 外链交给浏览器」两格的**判据**（读数由壳自己写）。
 *
 * ## 为什么判据与读数分家
 * 壳那侧（`apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` 的 `runWidgetJourneyChain`）
 * 只出**原文读数**。哪些 `data-testid` 算"PWA 安装引导"、哪些算"原生小组件引导"，
 * 唯一事实源是 `apps/web/src/pwa/widget-install.ts` 里那两支函数，而本仓已有
 * `scripts/qa/widget-step-words.mjs` 按**键名集合**去分它（文件头写了为什么不能按形状分：
 * 两套键都带 `.step`、都渲染成带序号的行，所以"行首有 1./2./3."这种形状判据会在
 * **产品该有的样子**上报红）。壳里再抄一份词条 = 第二套判据 = 会漂移的那一套。
 *
 * ## 为什么要有这条链（而不是只留 AX 那枚装置）
 * `scripts/qa/macos-installed-widget-help.sh` 走 Accessibility，而**未激活的实例不向
 * 辅助功能暴露窗口列表**（实测：窗口服务器看得见 1159x754 的那个窗口，System Events 报 0）
 * ⇒ 它必须跑在前台实例上，与 AGENTS §6.2 规定二（验收不得抢走输入焦点）直接冲突。
 * 这条链用壳本来就在用的 `evaluateJavaScript` 通道，后台跑、不激活、不抢键盘。
 *
 * ## 本判据**没有**证到的那一格（不许读成"外链已验证可达"）
 * 诊断链里壳故意**不**叫起浏览器（`WIDGET_EXTERNAL_LAUNCH=suppressed`），因为
 * `NSWorkspace.open` 会把用户的浏览器带到前台。所以这一趟证的是：
 * scheme 判定 + 壳收到哪个 URL + 壳自己没有导航过去（`BEFORE == AFTER`）。
 * "浏览器里真的渲染出那一页"仍归前台 AX 装置 —— 判到会单独印一行 `BOUNDARY=`。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installStepKeys, nativeStepKeys, stepTexts } from './widget-step-words.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const EXPECTED_SITE = process.env.HEYTA_HELP_EXTERNAL_URL || 'https://heyta.waytofuture.cn';

/** 把壳写的 `KEY=VALUE` 证据读成一张表（只认大写键，别的行忽略）。 */
function parseReadings(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/**
 * 核心判据：读数 → 问题清单（空清单 = 这两格闭合）。
 *
 * ⚠️ 每一条都问"**这条读数在不在**"再问内容：缺键与值为空是两种失法，
 *    而把缺键当成"值为空"会让"链根本没跑到那一步"读成"产品不对"。
 */
export function judge(r, { expectedSite = EXPECTED_SITE } = {}) {
  const problems = [];
  const say = (msg) => problems.push(msg);
  const need = (key) => {
    if (r[key] === undefined) {
      say(`读数缺键 ${key} ⇒ 诊断链没跑到那一步（这是**探针未闭合**，不是产品结论）`);
      return false;
    }
    return true;
  };

  // ── 0. 链自身 ────────────────────────────────────────────────────────────
  if (!need('WIDGET_PROBE') || r.WIDGET_PROBE !== 'ran') say('WIDGET_PROBE 不等于 ran');
  if (r.WIDGET_NAV_APPEARANCE !== 'CLICKED') say(`设置页「任务与显示」那一节没点到（${r.WIDGET_NAV_APPEARANCE ?? '缺读数'}）`);
  if (r.WIDGET_NAV_HELP !== 'CLICKED') say(`设置页「关于与帮助」那一节没点到（${r.WIDGET_NAV_HELP ?? '缺读数'}）`);

  // ── 1. 环境识别：壳真的被页侧认成原生壳吗 ────────────────────────────────
  // 页侧判"这是不是我们的壳"读的就是这几个信号（`isNativeShellHost`）；
  // 读数里没有它们，下一个人无法区分"壳没注入"与"页侧没接上"。
  const host = r.WIDGET_HOST_SIGNALS ?? '';
  const hostTrue = ['storagePort', 'webview2', 'heytaStorage', 'heytaWidget'].filter(
    (k) => new RegExp(`${k}=true`).test(host),
  );
  if (hostTrue.length === 0) {
    say(`页侧观察不到任何原生壳信号（${host || '缺读数'}）⇒ 面板走浏览器分支是**正确行为**，这一趟测不到环境识别`);
  }
  const bridgeFn = /widgetBridgeSeal=function/.test(host);

  if (!need('WIDGET_PANEL') || r.WIDGET_PANEL !== '1') say(`小组件面板不在 DOM 里（WIDGET_PANEL=${r.WIDGET_PANEL ?? '缺读数'}）`);
  // 🔴 各节常驻 DOM、用 hidden 切换 ⇒ "在 DOM 里"只证明分支走对了，不证明用户看得见。
  if (!need('WIDGET_PANEL_VISIBLE') || r.WIDGET_PANEL_VISIBLE !== '1') say('小组件那一节当前不可见（hidden）⇒ 读数来自看不见的界面');

  const rows = (r.WIDGET_PANEL_ROWS ?? '').split(',').filter(Boolean);
  const install = installStepKeys();
  const native = nativeStepKeys();
  const installHits = rows.filter((id) => install.includes(id));
  const nativeHits = rows.filter((id) => native.includes(id));
  if (installHits.length > 0) {
    say(`原生壳里渲染了 PWA 安装引导：${installHits.join(' ')}`);
  }

  const nativeAvailableTexts = stepTexts(['web.widgetJourney.note.nativeAvailable']);
  const nativeShellTexts = stepTexts(['web.widgetJourney.note.nativeShell']);
  const capability = r.WIDGET_CAPABILITY_TEXT ?? '';
  const capabilityKind = nativeAvailableTexts.includes(capability)
    ? 'nativeAvailable'
    : nativeShellTexts.includes(capability)
      ? 'nativeShell'
      : 'none';
  // 与 AX 那枚装置同一条口径：能力行必须**等于产品两行原文之一**，读到别的就说明
  // 那段说明不是产品写的（或词条改了没同步），那是探针未闭合，不许静默放过。
  if (capabilityKind === 'none') say(`能力边界说明不等于产品两条原文之一：「${capability || '空'}」`);
  if (capabilityKind === 'nativeAvailable' && !bridgeFn) {
    say('能力行说「原生小组件可用」，但页侧取不到小组件桥的方法 ⇒ 两件事在撒谎');
  }
  if (capabilityKind === 'nativeAvailable' && nativeHits.length === 0) {
    say('能力行说「原生小组件可用」，面板却没渲染任何原生步骤行');
  }
  if (capabilityKind === 'nativeShell' && nativeHits.length > 0) {
    say(`能力行说「原生壳但没有小组件桥」，面板却渲染了原生步骤：${nativeHits.join(' ')}`);
  }

  const statusTexts = stepTexts(['web.widgetJourney.status.native']);
  if (!statusTexts.includes(r.WIDGET_STATUS_TEXT ?? '')) {
    say(`状态行不是「正在原生桌面应用中运行」那一行原文：「${r.WIDGET_STATUS_TEXT ?? '空'}」`);
  }

  // ── 2. 外链交给浏览器 ────────────────────────────────────────────────────
  if (!need('WIDGET_HELP_LINK') || r.WIDGET_HELP_LINK !== '1') say('「关于与帮助」里找不到帮助中心那条外链');
  if (!need('WIDGET_HELP_VISIBLE') || r.WIDGET_HELP_VISIBLE !== '1') say('帮助那一节当前不可见（hidden）');
  const href = r.WIDGET_HELP_HREF ?? '';
  if (!href.startsWith(`${expectedSite}/`)) {
    say(`帮助链接解析后的绝对地址不落在公示站点上：「${href || '空'}」（期望前缀 ${expectedSite}/）`);
  }
  if (href.startsWith('heyta-local:')) {
    say(`帮助链接被解析成**本地地址**（${href}）⇒ 壳里点它会留在应用内，这是那条缺陷的形状本身`);
  }
  if (r.WIDGET_HELP_TARGET !== '_blank') say(`站点类链接必须 target=_blank（实测 ${r.WIDGET_HELP_TARGET || '空'}）`);
  if (!(r.WIDGET_HELP_REL || '').includes('noopener')) say(`外链必须带 rel 的 noopener（实测 ${r.WIDGET_HELP_REL || '空'}）`);

  const before = r.WIDGET_WEBVIEW_URL_BEFORE ?? '';
  const after = r.WIDGET_WEBVIEW_URL_AFTER ?? '';
  if (!before.startsWith('heyta-local://')) say(`点之前的 WebView 地址不是壳里的应用：「${before || '空'}」`);
  if (before !== after) say(`点了外链之后**壳自己导航走了**（before=${before} after=${after}）⇒ 用户工作区被顶掉`);

  const handoffs = (r.WIDGET_EXTERNAL_HANDOFFS || '').trim();
  const [countText, ...urls] = handoffs.split(/\s+/).filter(Boolean);
  const n = Number(countText ?? '0');
  if (!(n > 0)) {
    say('壳**一条外链都没交接** ⇒ "外链交给浏览器"这一格没有读数（点了没反应的那一类）');
  } else if (urls.length === 1 && urls[0] !== href) {
    say(`壳交接的 URL 与链接解析后的地址不一致（handoff=${urls[0]} href=${href}）`);
  }

  return { problems, capabilityKind, summary: { hostTrue, installHits, nativeHits, bridgeFn, handoffs: n } };
}

/** 人读的一行行输出：读数 + 判据 + 那条没证到的边界。 */
function report(r) {
  const { problems, capabilityKind, summary } = judge(r);
  console.log(`PROBE=${r.WIDGET_PROBE ?? '-'}`);
  console.log(`WIDGET_HOST_SIGNALS=${r.WIDGET_HOST_SIGNALS ?? '-'}`);
  console.log(`WIDGET_PLATFORM=${r.WIDGET_PLATFORM ?? '-'}`);
  console.log(`WIDGET_PANEL=${r.WIDGET_PANEL ?? '-'} VISIBLE=${r.WIDGET_PANEL_VISIBLE ?? '-'} ROWS=${(r.WIDGET_PANEL_ROWS ?? '').split(',').filter(Boolean).length}`);
  console.log(`INSTALL_GUIDE_HITS=${summary.installHits.length}${summary.installHits.length ? ` (${summary.installHits.join(' ')})` : ''}`);
  console.log(`NATIVE_STEP_ROWS=${summary.nativeHits.length}`);
  console.log(`WIDGET_CAPABILITY_KIND=${capabilityKind}`);
  console.log(`NATIVE_STATUS_MATCH=${problems.some((p) => p.startsWith('状态行')) ? 'no' : 'yes'}`);
  console.log(`HELP_HREF=${r.WIDGET_HELP_HREF ?? '-'}`);
  console.log(`WEBVIEW_URL_BEFORE=${r.WIDGET_WEBVIEW_URL_BEFORE ?? '-'} AFTER=${r.WIDGET_WEBVIEW_URL_AFTER ?? '-'}`);
  console.log(`EXTERNAL_HANDOFFS=${summary.handoffs} ${r.WIDGET_EXTERNAL_LAUNCH ?? '(无交接读数)'}`);
  if ((r.WIDGET_EXTERNAL_LAUNCH || '').startsWith('suppressed')) {
    console.log('BOUNDARY=浏览器里是否真的渲染出那一页**不在本趟读数里**（诊断链故意不叫起浏览器，§6.2 规定二）；那一格归 scripts/qa/macos-installed-widget-help.sh（需前台实例）');
  }
  for (const p of problems) console.log(`🔴 ${p}`);
  console.log(problems.length === 0 ? 'RESULT=OK' : `RESULT=FAIL problems=${problems.length}`);
  return problems.length;
}

/**
 * `--self-test`：不起壳、不要设备，只问这枚判据**能不能红**。
 * 九臂 = 每条承重承诺各一臂，外加一臂阳性对照（好的读数必须 0 问题）。
 * 臂数由它自己打印，不抄进文档。
 */
function selfTest() {
  const install = installStepKeys();
  const native = nativeStepKeys();
  const good = {
    WIDGET_PROBE: 'ran',
    WIDGET_NAV_APPEARANCE: 'CLICKED',
    WIDGET_NAV_HELP: 'CLICKED',
    WIDGET_HOST_SIGNALS: 'storagePort=true webview2=false heytaStorage=true heytaWidget=true widgetBridgeSeal=function',
    WIDGET_PLATFORM: 'macOS',
    WIDGET_PANEL: '1',
    WIDGET_PANEL_VISIBLE: '1',
    WIDGET_PANEL_ROWS: ['widget-journey-panel', 'widget-journey-status', native[0], native[native.length - 1], 'widget-journey-capability'].join(','),
    WIDGET_STATUS_TEXT: stepTexts(['web.widgetJourney.status.native'])[0],
    WIDGET_CAPABILITY_TEXT: stepTexts(['web.widgetJourney.note.nativeAvailable'])[0],
    WIDGET_HELP_LINK: '1',
    WIDGET_HELP_VISIBLE: '1',
    WIDGET_HELP_HREF: `${EXPECTED_SITE}/docs`,
    WIDGET_HELP_TARGET: '_blank',
    WIDGET_HELP_REL: 'noopener noreferrer',
    WIDGET_WEBVIEW_URL_BEFORE: 'heyta-local://app/index.html',
    WIDGET_WEBVIEW_URL_AFTER: 'heyta-local://app/index.html',
    WIDGET_EXTERNAL_HANDOFFS: `1 ${EXPECTED_SITE}/docs`,
    WIDGET_EXTERNAL_LAUNCH: 'suppressed(HEYTA_WIDGET_HELP_PROBE)',
  };
  const arms = [];
  const arm = (name, mutate, expectProblems) => {
    const r = { ...good };
    mutate(r);
    const { problems } = judge(r);
    const ok = expectProblems ? problems.length > 0 : problems.length === 0;
    arms.push({ name, ok, got: problems.length, first: problems[0] ?? '' });
  };

  arm('阳性对照：正确的读数必须 0 问题', () => {}, false);
  arm('原生壳里出现 PWA 安装引导必须红', (r) => { r.WIDGET_PANEL_ROWS = `${r.WIDGET_PANEL_ROWS},${install[0]}`; }, true);
  arm('能力行不是产品两条原文之一必须红', (r) => { r.WIDGET_CAPABILITY_TEXT = '这段是随手写的'; }, true);
  arm('那一节不可见（hidden）必须红', (r) => { r.WIDGET_PANEL_VISIBLE = '0'; }, true);
  arm('帮助链接解析成本地地址必须红', (r) => { r.WIDGET_HELP_HREF = 'heyta-local://app/docs'; }, true);
  arm('壳自己跟着导航走了必须红', (r) => { r.WIDGET_WEBVIEW_URL_AFTER = `${EXPECTED_SITE}/docs`; }, true);
  arm('一条外链都没交接必须红', (r) => { r.WIDGET_EXTERNAL_HANDOFFS = ''; delete r.WIDGET_EXTERNAL_LAUNCH; }, true);
  arm('交接的 URL 与链接地址不一致必须红', (r) => { r.WIDGET_EXTERNAL_HANDOFFS = `1 ${EXPECTED_SITE}/changelog`; }, true);
  arm('页侧观察不到任何壳信号必须红', (r) => { r.WIDGET_HOST_SIGNALS = 'storagePort=false webview2=false heytaStorage=false heytaWidget=false widgetBridgeSeal=undefined'; }, true);
  arm('说「原生小组件可用」却取不到桥必须红', (r) => { r.WIDGET_HOST_SIGNALS = 'storagePort=true webview2=false heytaStorage=true heytaWidget=true widgetBridgeSeal=undefined'; }, true);
  arm('读数缺键必须报"探针未闭合"而不是产品结论', (r) => { delete r.WIDGET_PANEL; delete r.WIDGET_PANEL_VISIBLE; }, true);

  let failures = 0;
  for (const a of arms) {
    if (!a.ok) failures += 1;
    console.log(`${a.ok ? '✅' : '🔴'} SELFTEST ${a.name} ⇒ 问题数 ${a.got}${a.first ? ` ｜ 首条：${a.first}` : ''}`);
  }
  console.log(`SELFTEST ARMS=${arms.length} FAILED=${failures}`);
  return failures === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) process.exit(selfTest());
const fileIndex = argv.indexOf('--from-file');
if (fileIndex < 0 || !argv[fileIndex + 1]) {
  console.error('用法：--from-file <壳写的证据 .txt> ｜ --self-test');
  process.exit(2);
}
const text = readFileSync(resolve(REPO, argv[fileIndex + 1]), 'utf8');
if (text.trim() === '') {
  console.log('PROBE=-');
  console.log('🔴 证据文件是空的 ⇒ 读空不许当通过');
  console.log('RESULT=UNVERIFIED');
  process.exit(4);
}
process.exit(report(parseReadings(text)) === 0 ? 0 : 1);
