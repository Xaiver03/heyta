#!/usr/bin/env node
/**
 * 收集框形状门禁（2026-11-04，docs/plans/capture-ticktick-alignment-2026-11.md）
 * ============================================================================
 *
 * 它拦的是**这一格反复退回原形**的那条机制，不是某个像素。
 *
 * 历史：产品负责人为收集框点名过四次。每一轮都改了被点名的那一小块，
 * 而 `apps/web/tests/capture-composer.spec.tsx` 里有一批断言按**旧渲染形状**
 * 认对象（必须有框下方那一行、必须念成「原文 → 解析值」）——
 * 任何一轮改成"胶囊 + 面板"，那批尺当场红，于是下一轮退回原形，
 * 还在提交里写"判据已覆盖"。**能失败的尺把错误的形状变成了合规。**
 *
 * ⇒ 所以这把尺钉的是**新形状**，并且把"旧形状不许回来"写成反向钉子：
 *
 *   1. 输入行恰好三件：输入框 / 日期胶囊 / 添加；
 *   2. 框下那一行的数据源必须是 `captureRowChips`（胶囊已经说过的截止不许说第二遍）；
 *   3. 胶囊必须真能打开面板（不是死按钮 —— 本仓为三枚假按钮翻过案）；
 *   4. `清除` 必须把被消费的那段字送回标题（不变量，缺一就是"删字不交代"）；
 *   5. 空态胶囊不许出现「未设置」这类审计腔；
 *   6. 两端都关掉了「实际标题」那一行（曾经 web 关、mobile 留，还被脚本钉成验收）。
 *   7. 框下那一行不许按平台分叉（web 有交代而移动端没有 = §9.2 的 5c 那种事故）；
 *   8. 外壳那一档的三条腿都在（2026-11-05 改判，见 §9.33）：web 收件箱走锚定浮层、
 *      web 日历落点走就地展开、**移动端走底部面板** —— 少了任何一条，
 *      那一档的面板就静默消失或退回死按钮。
 *   9. 时刻子视图里**不许有"没选日子就什么都不做"的守卫**：第四枚死按钮，
 *      2026-11-05 由移动端设备腿量到（收集箱里空标题点 48 格，全静默）。
 *  10. 面板必须**复用那枚现有的** DatePicker（不是复制一份捕获私货），
 *      且捕获这一族里月历只有一个渲染点 —— S3 那句"组装现有零件"以前只是散文。
 *  11. 面板那一组（`dueChips`）的成员谓词必须是"截止两类、不按 action 过滤"：
 *      §9.10 那个"框下那一行的独占内容只有优先级"的差集现量，面板半边由它定义；
 *      谓词一漂，`capture-model.spec.ts` J 族（抄的是同一个口径）就变成自证。
 *  12. 面板的**出口段只许画一处**：`outlet === 'inline'` 守卫必须恰好两枚（日期视图、
 *      时刻视图各一），且共享件必须有"宿主没外壳就强制回 inline"那道守卫 ——
 *      移动端把出口段放进 sheet 的 `footer` 之后，这两条决定它是画两遍还是凭空消失。
 *  13. 移动端那一层是**模态**：壳起来后输入行既被盖住也不在可及性树上，所以
 *      槽位必须把**此刻那句话**交给宿主（`subject: draft`），宿主必须用它推标题。
 *      ⚠️ 这里只钉接线；"标题画没画得出来"由设备腿 ④b 量 —— Yoga 在自动高度的列容器里
 *      会把 `flex: 1` 的孩子量成 0 高，而 web/jsdom 两侧对这一格完全无感（§9.34）。
 *
 * 每条都有 selftest 臂：先在**违规源码**上红一次，再挂进 `pnpm check` 链。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SHARED = 'packages/ui/src/capture/CaptureComposer.tsx';
const PANEL = 'packages/ui/src/capture/CaptureDuePanel.tsx';
const MODEL = 'packages/ui/src/capture/model.ts';
const WEB_HOST = 'apps/web/src/features/capture/CaptureComposer.tsx';
const MOBILE_HOST = 'apps/mobile/src/lib/capture-labels.ts';
const MOBILE_SCREEN = 'apps/mobile/src/screens/TasksScreen.tsx';
/**
 * 那枚 DatePicker 在**捕获之外**的现役消费者（倒计时看板）。
 * S3 说的"复用现有零件"要靠它来证伪：只剩捕获在用，就不是"现有"。
 */
const DATE_PICKER_OTHER_CONSUMER = 'packages/ui/src/countdown/EventBoard.tsx';
const ZH = 'packages/i18n/src/locales/zh-CN.ts';
const EN = 'packages/i18n/src/locales/en.ts';

const read = (file) => readFileSync(resolve(ROOT, file), 'utf8');

/** 去掉块注释与行注释：注释里写着"不许出现 X"不该被当成 X 出现了。 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function checkRowSource(shared, model) {
  const problems = [];
  const s = code(shared);
  if (!s.includes('captureRowChips(parsed)')) {
    problems.push(`${SHARED}: 框下那一行的数据源不是 captureRowChips —— 旧形状（所有识别项一律进那一行）回来了`);
  }
  // ⚠️ 必须带**左边界**：`rowChips.map(` 里就含 `chips.map(` 这个子串，
  // 少了这个 lookbehind，当前源码会被自己的新名字判成违规（实测撞过一次）。
  if (/(?<![A-Za-z])chips\.map\(/.test(s)) {
    problems.push(`${SHARED}: 仍在遍历全量 chips —— 截止项会同时出现在胶囊与那一行（同一件事说两遍）`);
  }
  const m = code(model);
  const body = m.slice(m.indexOf('export function captureRowChips'));
  if (!/chip\.action === 'ignore'/.test(body.slice(0, 600))) {
    problems.push(`${MODEL}: captureRowChips 不再过滤"生效中的截止"，胶囊与那一行会各说一遍同一天`);
  }
  return problems;
}

/**
 * 面板那一组（`dueChips`）的成员谓词 —— S2 差集前提的**面板半边**。
 *
 * 🔴 为什么要由源码尺子钉住：`packages/ui/tests/capture-model.spec.ts` 的 J 族比的是
 * 「那一行 − 面板那一组」，它把面板的口径**抄**成自己的 filter。有人把这一行改成只收
 * `dueDate`，或给面板那一组加了按 action 的过滤，J 族**照样绿** —— 而 §9.10 那条
 * 「那一行的独占内容只有优先级」已经漂了，§9.13「那一行改成条件挂载」的决策会继续吃
 * 一个没人再量过的旧读数。这正是本单一直在防的形状：断言钉住的是抄件，不是谓词本身。
 */
function checkPanelDueGroup(shared) {
  const s = code(shared);
  const start = s.indexOf('const dueChips');
  if (start === -1) {
    return [`${SHARED}: 没有 dueChips —— 面板那一组整块没了，§9.10 的差集前提不再成立`];
  }
  const block = s.slice(start).split('\n  const ')[0];
  const problems = [];
  for (const field of ['dueDate', 'dueTime']) {
    if (!block.includes(`chip.field === '${field}'`)) {
      problems.push(`${SHARED}: dueChips 不再收 ${field} ⇒ 那一类变成那一行的独占内容，§9.10 的差集要重量（§9.13 那个决策跟着重看）`);
    }
  }
  if (block.includes('chip.action')) {
    problems.push(`${SHARED}: dueChips 开始按 action 过滤 ⇒ 面板少了一档（未采用/已忽略），§9.10 的差集要重量`);
  }
  return problems;
}

/**
 * 移动端那一档的**底部面板**接线（目标原话点名的 `mobile BottomSheet`）。
 *
 * 🔴 为什么必须由源码尺钉：这一格的三处退化各有各的成因（§9.6），而每一处修好之后
 * 都只在一个地方成立 —— 出口在 `footer`、档位是 `medium`、语义是 `'popover'`。
 * 少任何一条，界面仍然"合法"：出口掉回折叠线以下 = 非整半点填不进去；
 * 档位铺满 = 用户看不见自己正在改哪一句；用 `'bottom-sheet'` = 多画一枚 ×、
 * 且 Esc 被判成 deny。而移动端跑不了 Playwright，行为只能等真机 ——
 * 所以先由这把尺保证**接线形状**不许悄悄退回去。
 */
function checkMobileSheet(panel, composer, mobileScreen) {
  const s = code(mobileScreen);
  const p = code(panel);
  const c = code(composer);
  const problems = [];
  for (const [needle, why] of [
    ['duePanelOutlet="footer"', '共享件不知道要把出口段交给宿主 ⇒ 出口只能画在滚动内容里，折叠线以下'],
    ['footer={slot.footerContent}', 'slot 的出口段没进 sheet 的 footer（footer 是 ScrollView 之外的兄弟节点，这是它唯一永远可见的位置）'],
    ['overlay="popover"', '语义档位退回 bottom-sheet ⇒ 多画一枚 ×，且 Esc 被表判成 deny'],
    ["detents={['medium']}", '档位退回铺满 ⇒ 面板自己那几行被折掉，非整半点那一档要滚很久才够得着'],
    // 🔴 这一格是 §9.6 撤壳那条不变量的现形：模态起来后输入行既被盖住也不在可及性树上，
    //    **标题是唯一还能说话的地方**。它只钉"接线"（标题取自 slot.subject），
    //    "标题画没画得出来"不在这儿钉 —— 那一格由设备腿 ④b 量（Yoga 在自动高度的列容器里
    //    会把 `flex: 1` 的孩子量成 0 高，而 web/jsdom 两侧看不见）。
    ['title={dueSheetTitle(slot.subject)}', '壳的标题退回静态那句 ⇒ 用户看不见自己正在给哪句话设截止'],
  ]) {
    if (!s.includes(needle)) problems.push(`apps/mobile/src/screens/TasksScreen.tsx: ${needle} 不在了 —— ${why}`);
  }
  if (!c.includes('subject: draft,')) {
    problems.push(`${SHARED}: 槽位不再把草稿交给宿主 ⇒ 上面那格标题只能写死，壳里没人说得出在改哪句话`);
  }
  const guarded = (p.match(/outlet === 'inline' \?/g) ?? []).length;
  if (guarded !== 2) {
    problems.push(`${PANEL}: 出口段的 \`outlet === 'inline'\` 守卫是 ${String(guarded)} 处（应为 2：日期视图与时刻视图各一处）—— 分置模式下可能两处都画（同一目的地两个控件）或都不画（填不进非整半点）`);
  }
  if (!c.includes("renderDuePanel === undefined ? 'inline' : duePanelOutlet")) {
    problems.push('共享件少了"没有外壳就强制回 inline"那道守卫 ⇒ footer 模式下没人接出口段，出口会凭空消失');
  }
  return problems;
}

function checkComposeRow(shared) {
  const s = code(shared);
  const problems = [];
  const order = ['capture-input', 'capture-due-capsule', 'capture-submit'];
  const at = order.map((id) => s.indexOf(`testID="${id}"`));
  for (let i = 0; i < order.length; i += 1) {
    if (at[i] === -1) problems.push(`${SHARED}: 输入行里没有 ${order[i]} —— 三件套缺了一枚`);
  }
  if (at.every((n) => n !== -1) && !(at[0] < at[1] && at[1] < at[2])) {
    problems.push(`${SHARED}: 输入行三件的顺序不是 输入框 → 胶囊 → 添加`);
  }
  if (!/setPanelOpen\(\(open\) => !open\)/.test(s)) {
    problems.push(`${SHARED}: 胶囊的 onPress 不切面板 —— 那是一枚死按钮（本仓为"三枚假按钮"翻过案）`);
  }
  if (!s.includes('renderDuePanel')) {
    problems.push(`${SHARED}: 面板不再交给宿主装外壳 —— 锚定浮层那一档被写死了`);
  }
  return problems;
}

/**
 * 外壳那一档的三条腿（2026-11-05 改判，见计划 §3.3 与 §9.33）：
 * web 收件箱 = 锚定浮层；web 日历落点 = 就地展开；**移动端 = 底部面板**。
 *
 * 🔴 这一支为什么仍必须由源码尺钉住：`renderDuePanel === undefined ? panelContent` 那一支
 * 现在只剩**日历落点**一个消费者。把它写成 `null`，web 收件箱与移动端都照样绿
 * （它们各有外壳），只有日历落点**静默**变成死按钮 —— 而 `packages/ui` 刻意不引 DOM 测试栈，
 * 行为判据只能长在 `apps/web/tests/capture-composer.spec.tsx` 的「不给外壳那一档」那族里，
 * 本函数钉的是**这一支不许消失**。
 * ⚠️ 旧版这里还钉着"移动端不许自带外壳"（§3.3 的原话），目标原话点的是 `mobile BottomSheet`，
 *    所以那条已按改判撤掉，移动端的形状改由 `checkMobileSheet` 钉。
 */
function checkShellTier(shared, webHost) {
  const s = code(shared);
  const problems = [];
  // needle 必须**带着 panelContent 一起匹配**：共享件里现在有第二处
  // `renderDuePanel === undefined`（那道"没外壳就强制 inline"的守卫），
  // 只取第一枚匹配会把守卫那行当成三元左支 ⇒ 假红（本次实测撞到过一次）。
  if (!/renderDuePanel === undefined\s*\?[\s\S]{0,24}?panelContent/.test(s)) {
    problems.push(`${SHARED}: 没给外壳时不再画 panelContent —— 日历落点的面板会静默消失`);
  }
  if (!/inlineDuePanel === true \? undefined : renderDuePanel/.test(code(webHost))) {
    problems.push(`${WEB_HOST}: 收件箱/日历两档不再由这一句选外壳 —— 锚定浮层与就地展开的分档漂了`);
  }
  return problems;
}

/**
 * 框下那一行**不许按平台分叉**。
 *
 * 🔴 为什么单独一枚：`checkPreviewGone` 那组只管"实际标题那一行两端都不许回来"，
 * 而**没有任何一臂**钉住"这一行的挂载条件在两端是同一份共享实现"。
 * 于是"web 上了就地高亮、于是把 web 那一行删掉，移动端没有高亮、留着那一行"
 * 这种写法**当前不会红** —— 而 §9.2 的 5c 把"两端形状就此分叉"记成上一轮最坏的结果
 * （它当时还被 `verify-mobile-capture.sh` 钉成验收项，于是分叉被合法化了）。
 *
 * 判据形状：那一行的渲染条件里**不许出现 `Platform.OS`**。
 * 分端渲染本身是本仓允许的（判断共享、渲染分端），但允许的是
 * "外壳长什么样"（浮层 vs 就地），不允许的是
 * "同一类识别结果在一端有交代、在另一端没有" —— 那是不变量层面的分叉，不是外观差异。
 */
function checkRowNotPlatformSplit(shared) {
  const s = code(shared);
  const problems = [];
  const at = s.indexOf('rowChips.length > 0');
  if (at === -1) {
    // 那一行整个没了 ⇒ 这一臂不适用，但**必须留下别的交代**：
    // 由 `capturePanelChips`/面板次级列表承担，本臂只在行还在时生效。
    return problems;
  }
  const around = s.slice(Math.max(0, at - 400), at + 60);
  if (/Platform\.OS/.test(around)) {
    problems.push(`${SHARED}: 框下那一行的挂载条件里出现了 Platform.OS —— 同一类识别结果会在两端一有一无（§9.2 的 5c 那种分叉），要做 T1 就两端一起做，或先改计划`);
  }
  return problems;
}

function checkClearReturnsText(shared, model) {
  const problems = [];
  if (!code(shared).includes('clearCaptureDue(parsed, ignored)')) {
    problems.push(`${SHARED}: 清除不再登记忽略清单 —— "字被吞了而界面没说"那条不变量失去出口`);
  }
  const m = code(model);
  const body = m.slice(m.indexOf('export function clearCaptureDue'));
  if (!/next\.push\(\{ field: match\.field, raw: match\.raw \}\)/.test(body.slice(0, 900))) {
    problems.push(`${MODEL}: clearCaptureDue 不再把被消费的日期/时刻登记进忽略清单`);
  }
  return problems;
}

function checkHostWording(webHost, mobileHost) {
  const problems = [];
  for (const [file, source] of [[WEB_HOST, webHost], [MOBILE_HOST, mobileHost]]) {
    const s = code(source);
    if (!/kind === 'empty'[\s\S]{0,60}return '';/.test(s)) {
      problems.push(`${file}: 胶囊空态没有返回空串 —— 只画图标这一档丢了`);
    }
    if (/capsule[\s\S]{0,200}detail\.unset/.test(s)) {
      problems.push(`${file}: 胶囊引用了「未设置」那一条（审计腔不许流进输入行）`);
    }
  }
  return problems;
}

/**
 * 「实际标题」那一行与那个开关是否**真的从实现里消失**。
 *
 * 🔴 为什么不是"检查两端有没有关掉它"：`showPreview={false}` 这种写法在 prop 还存在时
 * 也能满足"没人打开"，于是留下一条**配置了但没人读**的路 —— 本仓最忌讳的形状
 * （`apps/web/src/features/capture/CaptureComposer.tsx` 文件头为 AI 面板写过同一条）。
 * 能失败的说法只有一句：实现里不再有这两个词。
 */
function checkPreviewGone(shared, webHost, mobileScreen) {
  const problems = [];
  const s = code(shared);
  for (const word of ['showPreview', 'capture-preview', 'previewLead', 'previewEmpty']) {
    if (s.includes(word)) {
      problems.push(`${SHARED}: 仍含 ${word} —— 那一行复述只是被"关掉"，没被删掉`);
    }
  }
  if (!s.includes('rowChips.length > 0')) {
    problems.push(`${SHARED}: 识别行不再由 rowChips 的空态守卫守着（复刻件的空态等价性建立在这句上）`);
  }
  for (const [file, source] of [[WEB_HOST, webHost], [MOBILE_SCREEN, mobileScreen]]) {
    if (code(source).includes('showPreview')) {
      problems.push(`${file}: 还在传 showPreview —— 那个 prop 已经不存在`);
    }
  }
  return problems;
}

const NEW_KEYS = [
  'capture.capsule.aria.unset',
  'capture.capsule.aria.value',
  'capture.panel.title',
  'capture.panel.dueItems',
  'capture.panel.timeAria',
  'capture.panel.time.otherTime',
  'capture.panel.time.backToList',
  'capture.panel.time.backToDay',
  'capture.panel.time.rowAria',
];

/**
 * 时刻那一格（S3 点名的 30 分步进列表）。
 *
 * 🔴 三条各拦一种退步：
 *   · 没有列表 ⇒ S3 那格没做；
 *   · 又给 `DatePicker` 传 `time` ⇒ 列表与自由输入同时在场 = 同一目的地两个控件；
 *   · 没有「其它时间」出口 ⇒ 20:15 这一档在捕获路径上填不进去，那是能力倒退。
 */
function checkTimeView(panel) {
  const s = code(panel);
  const problems = [];
  if (!s.includes('timeStepSlots(')) {
    problems.push(`${PANEL}: 面板里没有 30 分钟步进列表 —— 计划 S3 点名的这一格没做`);
  }
  if (/time=\{\{/.test(s)) {
    problems.push(`${PANEL}: 又给 DatePicker 传了 time —— 步进列表与自由输入会同时在场`);
  }
  // ⚠️ 必须带**引号**匹配整个 testid：`includes('capture-time-mode')` 会被
  // `capture-time-mode-x` 这种改名照样命中 —— selftest 就是这么抓到这两臂原本是假臂。
  if (!s.includes('testID="capture-time-mode"')) {
    problems.push(`${PANEL}: 「其它时间」出口没了 —— 非整半点的时刻填不进去`);
  }
  if (!s.includes('testID="capture-time-back"')) {
    problems.push(`${PANEL}: 时刻子视图没有回日期视图的出口 —— 用户进得去出不来`);
  }
  // 🔴 时刻这一档**不许**有"还没选日子就什么都不做"的守卫（2026-11-05 移动端设备腿实测）：
  //    收集箱里空着标题点进时刻列表，48 格 + 全天 + 自由输入全部静默无效，
  //    而界面上它们长得和能用一模一样。无日期的时刻落在今天（`capture.ts` 文件头那条），
  //    所以这里没有"还不能做"的状态。反向钉子：判的是 `!== undefined` 这个守卫形状，
  //    `due.date === undefined` 的显示分支不算（那是文案分档）。
  if (/due\.date !== undefined/.test(s)) {
    problems.push(`${PANEL}: 时刻这一档里还有 "due.date !== undefined" 守卫 —— 没选日子时那些控件是死按钮（设备腿实测的形状）`);
  }
  return problems;
}

/**
 * S3 那句"组装**现有** DatePicker"以前只是散文。
 *
 * 🔴 三问缺一都算没钉住：
 *   · 面板 import 的是全仓那枚 `../date-picker/DatePicker.js` 吗（而不是复制一份
 *     `capture/DatePicker.tsx` —— 复制那一刻所有现有判据照样绿，这正是本单 §0 的根因形状）；
 *   · 月历那一格真的是**渲染**它画出来的吗（不是又手写一套格子）；
 *   · 捕获这一族里月历只有一个渲染点吗（宿主/组合器再画一张 = 同一目的地两个控件）。
 * 第四问把"现有"这两个字钉死：这枚 picker 本来就服务别的界面（倒计时看板），
 * 若哪天它只剩捕获一个消费者，那"复用现有零件"这句话就已经名存实亡。
 */
function checkDatePickerIsTheSharedOne(panel, composer, otherConsumer) {
  const problems = [];
  const p = code(panel);
  if (!p.includes("from '../date-picker/DatePicker.js'")) {
    problems.push(`${PANEL}: 面板没有 import 那枚**现有**的 DatePicker（../date-picker/DatePicker.js）—— S3 要的是组装现有零件，不是再造一份`);
  }
  if (!p.includes('<DatePicker')) {
    problems.push(`${PANEL}: 面板里没有渲染 <DatePicker —— 月历那一格不知道是用什么画出来的`);
  }
  if (code(composer).includes('<DatePicker')) {
    problems.push(`${SHARED}: 组合器里也渲染了 <DatePicker —— 同一块月历出现两个渲染点`);
  }
  if (!code(otherConsumer).includes('date-picker/DatePicker')) {
    problems.push(`${DATE_PICKER_OTHER_CONSUMER}: 那枚 DatePicker 没有别的消费者了 —— "复用现有"这句话名存实亡`);
  }
  return problems;
}

function checkLocaleParity(zh, en) {
  const problems = [];
  for (const [file, source] of [[ZH, zh], [EN, en]]) {
    for (const suffix of NEW_KEYS) {
      for (const prefix of ['web.', 'mobile.']) {
        const key = `'${prefix}${suffix}'`;
        if (!source.includes(key)) problems.push(`${file}: 缺词条 ${key}`);
      }
    }
  }
  return problems;
}

function selfTest() {
  const shared = read(SHARED);
  const model = read(MODEL);
  const arms = [
    {
      name: '旧形状回来：那一行改回遍历全量 chips',
      problems: checkRowSource(shared.replace('captureRowChips(parsed)', 'chips'), model),
      expectRed: true,
    },
    {
      name: '胶囊变死按钮：onPress 不再切面板',
      problems: checkComposeRow(shared.replace('setPanelOpen((open) => !open)', 'void 0')),
      expectRed: true,
    },
    {
      name: '没给外壳那一档被写成 null（日历落点的面板静默消失）',
      problems: checkShellTier(shared.replace('? panelContent', '? null'), read(WEB_HOST)),
      expectRed: true,
    },
    {
      name: 'web 宿主不再按 inlineDuePanel 分档（两档外壳的分工漂了）',
      problems: checkShellTier(
        shared,
        read(WEB_HOST).replace('props.inlineDuePanel === true ? undefined : renderDuePanel', 'renderDuePanel'),
      ),
      expectRed: true,
    },
    {
      // 2026-11-05 改判：移动端**应当**自带外壳（目标原话 `mobile BottomSheet`），
      // 所以这一臂从"移动端不许传外壳"换成"外壳必须按 §9.33 那三样接"。
      name: '移动端的底部面板没接出口段（非整半点又回到填不进去）',
      problems: checkMobileSheet(
        read(PANEL),
        read(SHARED),
        read(MOBILE_SCREEN).replace('footer={slot.footerContent}', 'footer={undefined}'),
      ),
      expectRed: true,
    },
    {
      name: '出口段的 inline 守卫被拆掉（分置模式下会被画两遍）',
      problems: checkMobileSheet(
        read(PANEL).replace("outlet === 'inline' ? (\n        <CaptureDuePanelOutlet", '(true ? (\n        <CaptureDuePanelOutlet'),
        read(SHARED),
        read(MOBILE_SCREEN),
      ),
      expectRed: true,
    },
    {
      name: '共享件少了"没有外壳就强制 inline"那道守卫',
      problems: checkMobileSheet(
        read(PANEL),
        read(SHARED).replace("renderDuePanel === undefined ? 'inline' : duePanelOutlet", 'duePanelOutlet'),
        read(MOBILE_SCREEN),
      ),
      expectRed: true,
    },
    {
      // 模态起来后输入行既被盖住也不在树上：标题退回静态那句 = 壳里没人说得出在改哪句话。
      name: '壳的标题退回静态那句（用户看不见自己在改哪句话）',
      problems: checkMobileSheet(
        read(PANEL),
        read(SHARED),
        read(MOBILE_SCREEN).replace('title={dueSheetTitle(slot.subject)}', 'title={labels.panel.title}'),
      ),
      expectRed: true,
    },
    {
      // 上面那格的**另一半**：宿主接了标题，但共享件不再把草稿交出来 ⇒ 标题只能写死。
      name: '槽位不再带草稿（宿主拿不到那句话）',
      problems: checkMobileSheet(
        read(PANEL),
        read(SHARED).replace('subject: draft,', ''),
        read(MOBILE_SCREEN),
      ),
      expectRed: true,
    },
    {
      name: '那一行按平台分叉：web 上了高亮就删行、移动端留着',
      problems: checkRowNotPlatformSplit(
        shared.replace('rowChips.length > 0', "Platform.OS === 'web' ? false : rowChips.length > 0"),
      ),
      expectRed: true,
    },
    {
      name: '清除不登记忽略：删字不交代',
      problems: checkClearReturnsText(shared.replace('clearCaptureDue(parsed, ignored)', 'ignored'), model),
      expectRed: true,
    },
    {
      name: '宿主空态说了「未设置」',
      problems: checkHostWording(
        read(WEB_HOST).replace(/if \(kind === 'empty' \|\| due\.date === undefined\) return '';/, "return '未设置';"),
        read(MOBILE_HOST),
      ),
      expectRed: true,
    },
    {
      name: '「实际标题」那一行只是被关掉、没被删掉（prop 又回来了）',
      problems: checkPreviewGone(
        read(SHARED).replace('const canSubmit = captureCanSubmit(parsed);', 'const canSubmit = captureCanSubmit(parsed); // showPreview\n        if (showPreview) void 0;'),
        read(WEB_HOST),
        read(MOBILE_SCREEN),
      ),
      expectRed: true,
    },
    { name: '当前源码', problems: allProblems(), expectRed: false },
    {
      name: '时刻步进列表被删掉',
      problems: checkTimeView(read(PANEL).replace('timeStepSlots(TIME_STEP_MINUTES)', '[] as never[]')),
      expectRed: true,
    },
    {
      name: '列表与自由输入同时在场（又给 DatePicker 传了 time）',
      problems: checkTimeView(read(PANEL).replace('        onChange={(date) => {', '        time={{ value: undefined }}\n        onChange={(date) => {')),
      expectRed: true,
    },
    {
      name: '「其它时间」出口没了（非整半点填不进去）',
      problems: checkTimeView(read(PANEL).replace('capture-time-mode', 'capture-time-mode-x')),
      expectRed: true,
    },
    {
      name: '时刻子视图没有回日期视图的出口',
      problems: checkTimeView(read(PANEL).replace('capture-time-back', 'capture-time-back-x')),
      expectRed: true,
    },
    {
      // 🔴 这一臂翻回的就是 2026-11-05 设备腿量到的那个形状（当时它没有任何判据能红）。
      name: '没选日子时时刻控件静默无效（守卫回来 ⇒ 收集箱里 48 格全是死按钮）',
      problems: checkTimeView(
        read(PANEL).replace('onPick(due.date ?? today, slot)', 'if (due.date !== undefined) onPick(due.date, slot)'),
      ),
      expectRed: true,
    },
    {
      // S3 那句"组装**现有** DatePicker"以前没有尺：把月历复制成捕获私货，全都绿。
      name: '面板改用复制出来的私货月历（"复用现有零件"这句话被悄悄换掉）',
      problems: checkDatePickerIsTheSharedOne(
        read(PANEL).replace("from '../date-picker/DatePicker.js'", "from './CaptureDatePicker.js'"),
        read(SHARED),
        read(DATE_PICKER_OTHER_CONSUMER),
      ),
      expectRed: true,
    },
    {
      name: '组合器里又渲染一张月历（同一目的地两个控件）',
      problems: checkDatePickerIsTheSharedOne(
        read(PANEL),
        read(SHARED).replace('const due = useMemo(', 'const fork = <DatePicker />;\n  const due = useMemo('),
        read(DATE_PICKER_OTHER_CONSUMER),
      ),
      expectRed: true,
    },
    {
      // J 族（capture-model.spec.ts）把面板的口径抄成自己的 filter；这臂钉的是**被抄的那个谓词**不许漂。
      name: '面板那一组不收 dueTime（J 族的差集前提悄悄变了）',
      problems: checkPanelDueGroup(
        read(SHARED).replace(
          "chip.field === 'dueDate' || chip.field === 'dueTime'",
          "chip.field === 'dueDate'",
        ),
      ),
      expectRed: true,
    },
    {
      name: '面板那一组加了 action 过滤（未采用/已忽略从面板消失）',
      problems: checkPanelDueGroup(
        read(SHARED).replace(
          "chip.field === 'dueDate' || chip.field === 'dueTime'",
          "chip.field === 'dueDate' || (chip.field === 'dueTime' && chip.action === 'ignore')",
        ),
      ),
      expectRed: true,
    },
  ];

  let failed = 0;
  for (const arm of arms) {
    const red = arm.problems.length > 0;
    if (red !== arm.expectRed) {
      failed += 1;
      console.error(`🔴 selftest「${arm.name}」预期 ${arm.expectRed ? '红' : '绿'}，实际 ${red ? '红' : '绿'}`);
      for (const line of arm.problems.slice(0, 3)) console.error(`     ${line}`);
    }
  }
  console.log(failed === 0 ? `✅ 收集框形状门禁自检：${arms.length} 臂结果符合预期。` : `🔴 自检失败 ${failed} 臂。`);
  process.exit(failed === 0 ? 0 : 1);
}

function allProblems() {
  return [
    ...checkRowSource(read(SHARED), read(MODEL)),
    ...checkComposeRow(read(SHARED)),
    ...checkShellTier(read(SHARED), read(WEB_HOST)),
    ...checkRowNotPlatformSplit(read(SHARED)),
    ...checkPanelDueGroup(read(SHARED)),
    ...checkMobileSheet(read(PANEL), read(SHARED), read(MOBILE_SCREEN)),
    ...checkDatePickerIsTheSharedOne(read(PANEL), read(SHARED), read(DATE_PICKER_OTHER_CONSUMER)),
    ...checkTimeView(read(PANEL)),
    ...checkClearReturnsText(read(SHARED), read(MODEL)),
    ...checkHostWording(read(WEB_HOST), read(MOBILE_HOST)),
    ...checkPreviewGone(read(SHARED), read(WEB_HOST), read(MOBILE_SCREEN)),
    ...checkLocaleParity(read(ZH), read(EN)),
  ];
}

// 🔴 两种拼法都认。本仓带自检臂的尺有 62 枚，而债表 `audit-gate-selftest-consumers.mjs`
//    是按**引号包住的 `--self-test` 字面量**数"有没有人跑臂"的；
//    第一版我只写了自己惯用的 `--selftest` ⇒ 这 15 枚臂在那张账上**根本不存在**
//    （现量：该工具输出里 `grep -c capture-shape` ⇒ 0）。臂照跑，但没人知道它在跑。
if (process.argv.includes('--self-test') || process.argv.includes('--selftest')) selfTest();

const problems = allProblems();
if (problems.length > 0) {
  console.error(`🔴 收集框形状退回原形（${problems.length} 处）：`);
  for (const line of problems) console.error(`   ${line}`);
  console.error('   细则见 docs/plans/capture-ticktick-alignment-2026-11.md §3、§5。');
  process.exit(1);
}
console.log('✅ 收集框：输入行三件、截止只由胶囊说、胶囊能开面板、清除把字送回标题、两端同一档。');
