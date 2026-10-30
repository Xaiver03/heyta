#!/usr/bin/env node
/**
 * 错误形状有没有**机读**的一面——④ 那一维里"错误形状机器可读性"这一格的可复跑装置。
 * =================================================================
 *
 * ## 为什么要有它
 *
 * ④ 的四格里，吞异常 / 只 console.log / 失败支静默成功本线已有 `audit-silent-failure-branch.mjs`，
 * 唯独**"错误形状机器可读性"只有散文**（此前只逐枚登记过两三个具体案例：`reasonCode` 落 null、
 * 402 的 `code` 在界面层丢成同一句话）。"机读"这件事其实有明确的判据：
 * **消费方是拿什么区分失败的**——拿类型/`name`/`code` 就是机读的，拿 `message` 里的**文案**就是
 * 把人读的那一份当成契约：文案一改（本仓还有 i18n 门禁与四端词条），分支静默失效且没有任何东西会红。
 * 本尺判的就是这条落差。
 *
 * ## 判什么（三族）
 *
 * **F1 消费侧：拿 `.message` 当分支依据**（比较、`includes|startsWith|endsWith|match|search`、`/re/.test(x.message)`）
 * 按**被比的那一项是什么**分档——这一档决定它是缺陷还是无奈：
 *   🔴 `copy-contract`   生产代码里比**自家中文文案**字面量 ⇒ 词条一改分支就哑，正是本仓 i18n 门禁管的那批文件
 *   🟡 `test-copy`       同样的写法但落在测试面（`tests/`、`*.spec.*`）⇒ 契约脆化，但不是线上缺陷
 *   🟠 `vendor-prose`    比的是**上游原文**（纯 ASCII 整句，像浏览器/Node 抛的）⇒ 上游没有码位可读，多半无奈，要人看
 *   🔵 `marker-in-text`  比的是**常量**（`X_MARKER` 一类）⇒ 能跑，但它证明"码位被塞进 message 里"，
 *                          也就是错误形状里缺一个正经的 code 字段；这一档不判红，是**给 F2 用的证据**
 *   ⚪ 比变量/模板串 ⇒ 记「判不了」，不猜
 *
 * **F2 生产侧：具名错误类有没有机读承载**——`class X extends Error {…}` 的类体里既没有
 * `name`（覆写或 `this.name =`）、也没有 `code|reasonCode|errorCode|kind|status` 之一 ⇒ 🟠 `no-machine-field`。
 * （本仓的正经写法是 `this.name = <常量>`；`packages/ai/src/egress.ts` 那枚就是模板样本。）
 *
 * **F3 抛出侧：裸 `new Error(...)` 与具名 `new XError(...)` 的规模比**——只报比例，**不出候选**：
 * 工具函数里裸抛是合法写法，把 1600 枚塞进"待办"就是噪声。比例的作用是让人看见
 * "这个库靠类型区分失败的面有多大"。
 *
 * ## **不**判什么
 *
 * **F4 对外响应体（服务端）**：真形状是 Fastify 的 `reply.status(4xx|5xx).send({ … })`
 *   （`res.status().json()` 那一族在本仓读 0，所以谓词是按真实形状重下的，不是猜的）。
 *   对象字面量里有没有 `code|reasonCode|errorCode` 任一码位 ⇒ 没有就落档：
 *     🔴 `reply-5xx-no-code`  服务端故障对外还不给码位（客户端只能猜，正是 B238 那格"503 兜底"的形状）
 *     🟠 `reply-4xx-no-code`  业务拒绝不给码位（能跑，但界面层要分档回执就分不了）
 *   `send(变量)` 那种取不到字面量 ⇒ 记「判不了」，不猜对象里有什么。
 *   🔴 对账：独立正则数 `reply.status(…)` 的 4xx/5xx 枚数，必须等于「带码位 + 无码位两档 + 判不了」之和。
 * ② `message` 的展示用途（渲染进界面、写进日志）⇒ 不参与比较就不算契约；
 * ③ 跨 realm/序列化后类型丢失导致的"只能读文案"（如 webview、worker 边界）⇒ 尺看不出来，逐枚由人判。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-error-shape-machine-readable.mjs              # 诊断，恒退 0
 *   node research/tools/audit-error-shape-machine-readable.mjs --strict     # 有 🔴 ⇒ 退 1
 *   node research/tools/audit-error-shape-machine-readable.mjs --self-test  # 臂数由它自己打印
 *   node research/tools/audit-error-shape-machine-readable.mjs --mutate     # 内存注入再摘掉，不碰工作树
 *   node research/tools/audit-error-shape-machine-readable.mjs --scope packages/ai/src
 *
 * 0 诊断 ｜ 1 `--strict` 且有 🔴 ｜ 2 分母为空 / **两把尺对不上账**（抽取瞎了，读数不可信）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { maskText, lineOf } from './lib/text-mask.mjs';

const DEFAULT_SCOPES = ['apps/', 'packages/', 'server/src/'];
const MAX_LIST = 25;
const CJK = /[㐀-鿿぀-ヿ]/;
const CODE_KEYS = ['code', 'reasonCode', 'errorCode', 'kind', 'status'];
const FIELD_KEYS = ['name', ...CODE_KEYS];
// 🔴 字段声明前面能带修饰符（`override name = 'X'` 是本仓 sync-core 的正规写法）；
//    第一版只认 `^\s*name` 与 `this.name =`，三枚**明明有 `override name`** 的类被读成"无机读承载"
//    ——假红三枚，逐枚开码才发现（记进台账 §6.135）。
//    正则**不许**拼进模板字面量再交给 RegExp：模板会把 `\s` 变成字母 s，谓词当场失效而一切照绿。
//    用 String.raw 片段拼数组、键名单独插，绕开双重转义。
const FIELD_RES = Object.fromEntries(FIELD_KEYS.map((k) => [k, new RegExp(
  [String.raw`(?:this\.`, k, String.raw`\s*=)`, String.raw`|(?:^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|override\s+|declare\s+)*`, k, String.raw`\s*[:=])`].join(''),
  'm')]));
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** F1 的比较算子（在遮蔽文本上找 ⇒ 注释与字符串里的不算代码；**被比的那一项回原文读**，
 *  因为 `maskText` 会把引号里挖成空格——这一条是上一把尺用臂抓出来的教训，不是猜想）。 */
const CMP_RE = /\.message\s*(?:===|!==|==|\.\s*(?:includes|startsWith|endsWith|match|search|localeCompare)\s*\()/g;
const REPLY_RE = /\breply\.status\(\s*(\d{3})\s*\)\s*\.send\s*\(\s*/g;
// 🔴 三档，不是一档：统一码位（`code` 类键）／**另一种码位**（`status: 'approved'` 这类枚举字段，
//    健康检查与退款通道那两处就是这个形状——机读，只是不统一）／两者都没有才算候选。
//    只认第一档会把第二档读成缺陷（本尺第一发假红三枚，逐枚开码才发现）；
//    而对象里带 `...展开` 时字面量看不全 ⇒ 必须记「判不了」，不许当"没有码位"。
const CODE_IN_BODY = /\b(?:code|reasonCode|errorCode)\s*:/;
const OTHER_CODE_IN_BODY = /\b(?:status|reason|channel|state|db)\s*:\s*['"`]/;
const SPREAD_IN_BODY = /\.\.\./;
const TESTISH = /(^|\/)(tests?|__tests__)\/|\.spec\.[tm]sx?$/;

function operandOf(raw, at, len) {
  const tail = raw.slice(at + len, at + len + 160);
  const eq = /^(?:\s*)(['"`])([\s\S]{0,120}?)\1/.exec(tail) ?? /^\s*([A-Za-z_$][\w$.]{0,60})/.exec(tail);
  if (!eq) return { text: '', shape: 'unknown' };
  if (eq[2] !== undefined) return { text: eq[2], shape: eq[1] === '`' ? 'template' : 'literal' };
  return { text: eq[1], shape: 'identifier' };
}

export function scanText(file, text) {
  const masked = maskText(text);
  const rows = [];
  let tokens = 0;
  let compared = 0;
  let unreadable = 0;
  const tokRe = /\.message\b/g;
  let t;
  while ((t = tokRe.exec(masked)) !== null) tokens += 1;
  CMP_RE.lastIndex = 0;
  let m;
  while ((m = CMP_RE.exec(masked)) !== null) {
    compared += 1;
    const op = operandOf(text, m.index, m[0].length);
    const line = lineOf(masked, m.index);
    const inTest = TESTISH.test(file);
    let tier = 'unreadable';
    if (op.shape === 'literal') {
      if (CJK.test(op.text)) tier = inTest ? 'test-copy' : 'copy-contract';
      // 🔴 纯 ASCII 还要再分一刀：**自家往文案里塞的码位 slug**（`privacy-consent-not-granted` 这种
      //    无空格的连字符串）与**上游浏览器的整句原文**（`Access Handles cannot be created…`）
      //    是两种东西——前者是"码位写在 message 里"的证据（和比常量同一档），后者是"上游没有码位可读"的无奈。
      //    第一版把它们并成一档，把 `apps/mobile/src/ai/AssistantScreen.tsx:204` 那枚读成了"比上游原文"。
      else if (!/\s/.test(op.text) && /-/.test(op.text)) tier = 'marker-in-text';
      else tier = 'vendor-prose';
    }
    else if (op.shape === 'identifier') tier = /(?:MARKER|_TEXT|MESSAGE|REASON)$|^Message|^ERROR/.test(op.text) ? 'marker-in-text' : 'unreadable';
    if (tier === 'unreadable') unreadable += 1;
    rows.push({ file, line, tier, operand: op.text.slice(0, 48) || '(取不到)', shape: op.shape });
  }
  // F2：具名错误类有没有机读承载
  const classes = [];
  // 🔴 类名**不**要求以 Error 结尾：class Opaque extends Error 一样是错误类，
//    只认 *Error 会让这类分母整体消失（臂 G15 第一发就是这么把自己的夹具读成「没数到类」）。
const clsRe = /\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+Error\s*\{/g;
  let c;
  while ((c = clsRe.exec(masked)) !== null) {
    const brace = c.index + c[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = brace; i < masked.length; i += 1) {
      if (masked[i] === '{') depth += 1;
      else if (masked[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) { classes.push({ file, name: c[1], line: lineOf(masked, c.index), fields: ['配不上'] , ok: true }); continue; }
    const body = masked.slice(brace, end + 1);
    const found = FIELD_KEYS.filter((k) => FIELD_RES[k].test(body));
    classes.push({ file, name: c[1], line: lineOf(masked, c.index), fields: found, ok: found.length > 0 });
  }
  // F3：抛出侧规模（只数，不出候选）
  const bareThrow = (masked.match(/\bthrow\s+new\s+Error\s*\(/g) ?? []).length;
  const typedThrow = (masked.match(/\bthrow\s+new\s+[A-Za-z_$][\w$]*Error\s*\(/g) ?? []).length;
  // F4：服务端对外响应体（只吃 server/src，别的面没有 reply）
  const replies = [];
  let replyUnreadable = 0;
  let replyTotal = 0;
  if (file.startsWith('server/src/')) {
    const re = new RegExp(REPLY_RE.source, 'g');
    let r;
    while ((r = re.exec(masked)) !== null) {
      if (r[1][0] !== '4' && r[1][0] !== '5') continue;   // 2xx/3xx 不是错误响应，不进分母
      replyTotal += 1;
      // 🔴 开括号要按 `(` 在**这一段匹配里的位置**取，不能拿 `r[0].length - 1`：
      //    那个正则结尾带 `\s*`，减一常常落在被吃掉的那个空白上 ⇒ 每一处都被读成"取不到字面量"
      //    （臂 G18 第一发就是这么把 4 处全读成判不了、假绿一片）。
      const open = r.index + r[0].lastIndexOf('(') + 1;
      if (masked[open] === '{') {
        let depth = 0;
        let end = -1;
        for (let i = open; i < masked.length; i += 1) {
          if (masked[i] === '{') depth += 1;
          else if (masked[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
        }
        // 🔴 这三项判据必须吃**原文**：`maskText` 把引号也一起挖成空格（等长遮蔽连定界符都不留），
        //    所以"值是不是字符串字面量"这类判断在遮蔽文本上永远读不到 ⇒ 只认 `code:` 那种键名的那档还能work，
        //    认 `status: 'approved'` 这一档就会整档消失（假红一枚，臂 G18 第一次就是这么红的）。
        const body = end < 0 ? '' : text.slice(open, end + 1);
        let tier;
        if (end < 0) tier = 'unreadable-body';
        else if (SPREAD_IN_BODY.test(body)) tier = 'spread-body';
        else if (CODE_IN_BODY.test(body)) tier = 'has-code';
        else if (OTHER_CODE_IN_BODY.test(body)) tier = 'other-code-field';
        else tier = r[1][0] === '5' ? 'reply-5xx-no-code' : 'reply-4xx-no-code';
        if (tier === 'unreadable-body' || tier === 'spread-body') replyUnreadable += 1;
        replies.push({ file, line: lineOf(masked, r.index), tier, status: r[1] });
      } else {
        replyUnreadable += 1;
        replies.push({ file, line: lineOf(masked, r.index), tier: 'unreadable-send', status: r[1] });
      }
    }
  }
  return { rows, classes, tokens, compared, unreadable, bareThrow, typedThrow, replies, replyUnreadable, replyTotal };
}

/** 第二趟用：某具名错误类在**整个作用域**里被 `instanceof 那枚类` 分过没有、被 `throw new 那枚类` 抛过没有。
 *  🔴 的成立要三个条件同时满足：既没有机读字段、也没有 `instanceof` 消费者、**而且确实被抛出过**——
 *    第一版少了第三条，把 `packages/sync-core`（vendored）里几枚"定义了但根本没人抛"的类
 *    也算成缺陷，那是把 ② 那一族（死代码）的形状记到 ④ 的账上。 */
export function useCounts(files, read) {
  const refs = new Map();
  const thrown = new Map();
  for (const f of files) {
    let text = '';
    try { text = read(f); } catch { continue; }
    const masked = maskText(text);
    let m;
    const reI = /\binstanceof\s+([A-Za-z_$][\w$]*)/g;
    while ((m = reI.exec(masked)) !== null) refs.set(m[1], (refs.get(m[1]) ?? 0) + 1);
    const reT = /\bthrow\s+new\s+([A-Za-z_$][\w$]*)\s*\(/g;
    while ((m = reT.exec(masked)) !== null) thrown.set(m[1], (thrown.get(m[1]) ?? 0) + 1);
  }
  return { refs, thrown };
}

export function scanFiles(files, read = (f) => readFileSync(f, 'utf8'), uses = { refs: null, thrown: null }) {
  const acc = { rows: [], classes: [], tokens: 0, compared: 0, unreadable: 0, bareThrow: 0, typedThrow: 0, replies: [], replyUnreadable: 0, replyTotal: 0 };
  for (const f of files) {
    let text = '';
    try { text = read(f); } catch { continue; }
    const r = scanText(f, text);
    acc.rows.push(...r.rows);
    for (const c of r.classes) {
      acc.classes.push({ ...c, refs: uses.refs?.get(c.name) ?? 0, throws: uses.thrown?.get(c.name) ?? 0 });
    }
    acc.tokens += r.tokens;
    acc.compared += r.compared;
    acc.unreadable += r.unreadable;
    acc.bareThrow += r.bareThrow;
    acc.typedThrow += r.typedThrow;
    acc.replies.push(...r.replies);
    acc.replyUnreadable += r.replyUnreadable;
    acc.replyTotal += r.replyTotal;
  }
  return acc;
}

export function candidates(rows) {
  return rows.filter((r) => r.tier === 'copy-contract').sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
export function applyScope(files, scope) {
  if (!scope) return files.filter((f) => DEFAULT_SCOPES.some((s) => f.startsWith(s)));
  const s = scope.endsWith('/') ? scope : `${scope}/`;
  return files.filter((f) => f.startsWith(s));
}
const listTracked = () => git(['ls-files', '--', '*.ts', '*.tsx']).split('\n').filter((l) => l.trim() !== '' && !l.endsWith('.d.ts'));
const safeRead = (f, read) => { try { return read(f); } catch { return ''; } };
function lineStartOf(text, line) {
  const lines = text.split('\n');
  return lines.slice(0, Math.max(0, line - 1)).reduce((a, l) => a + l.length + 1, 0);
}

/** 变异：M1 注入一枚"拿自家中文文案当分支"⇒ 🔴 必须 +1；M2 把同一枚换成比 `name` ⇒ 必须回到基线。
 *  全程只在内存，不落盘（本仓纪律：变异还原只从 .mut-bak，不从 git）。 */
function mutate(files, read, uses) {
  const base = scanFiles(files, read, uses);
  const n0 = candidates(base.rows).length;
  const src = base.rows.find((r) => r.tier === 'marker-in-text') ?? base.rows.find((r) => r.tier === 'vendor-prose') ?? base.rows.find((r) => r.tier === 'test-copy');
  if (!src) { console.log('🔴 分母里没有可借形的比较写法 ⇒ 变异臂打空，不判绿（这读数不可信）。'); return 1; }
  const file = src.file;
  const text = safeRead(file, read);
  const at = lineStartOf(text, src.line);
  if (!text.slice(at, at + 300).includes('.message')) { console.log(`🔴 ${file}:${src.line} 那一行没有 .message ⇒ 变异臂定位失败，不判绿。`); return 1; }
  const injected = `${text.slice(0, at)}  if (caught.message.includes('这一句是本线自家文案')) { /* 变异夹具 */ }\n${text.slice(at)}`;
  const m1 = candidates(scanFiles(files, (f) => (f === file ? injected : safeRead(f, read)), uses).rows).length - n0;
  // M2：把注入那一行换成比 name（机读写法），必须回到基线
  const named = `${text.slice(0, at)}  if (caught.name.includes('SomeError')) { /* 机读写法 */ }\n${text.slice(at)}`;
  const m2 = candidates(scanFiles(files, (f) => (f === file ? named : safeRead(f, read)), uses).rows).length - n0;
  console.log(`基线 🔴 ${n0} 枚（借形于 ${src.file}:${src.line} 那一族的 ${src.tier}）`);
  console.log(`M1 注入一枚比自家中文文案的分支 ⇒ 🔴 变化 ${m1}（期望 +1）｜M2 同一位置换成比 name ⇒ 🔴 变化 ${m2}（期望 0）`);
  if (m1 !== 1 || m2 !== 0) { console.log('🔴 本尺对"分支依据的是文案还是类型"不敏感 ⇒ 拿它当门是假绿。'); return 1; }
  console.log('✅ 变异臂：注入红、换成机读写法不红（只动被点名的那一行）。');
  return 0;
}

function selfTest() {
  const bad = [];
  const labels = [];
  const push = (label, got, want) => {
    labels.push(label);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad.push(`${label} ｜ 期望 ${JSON.stringify(want)} ｜ 实读 ${JSON.stringify(got)}`);
    console.log(`${ok ? '✅' : '🔴'} ${label}`);
  };
  const A = 'packages/ai/src/a.ts';
  const T = (body) => `export function f(caught: unknown) {\n  const e = caught as Error;\n${body}\n}\n`;
  const tiers = (pairs) => {
    const rows = [];
    let tokens = 0;
    let compared = 0;
    for (const [f, t] of pairs) { const r = scanText(f, t); rows.push(...r.rows); tokens += r.tokens; compared += r.compared; }
    return { tiers: rows.map((x) => x.tier).sort(), tokens, compared };
  };
  push('G1 生产代码比自家中文文案 ⇒ 🔴 copy-contract', tiers([[A, T('  return e.message.includes("用户尚未同意隐私规则");')]]).tiers, ['copy-contract']);
  push('G2 同样写法落在测试面 ⇒ 🟡 不是线上缺陷（分档看路径，不看内容）',
    tiers([['packages/ai/tests/a.spec.ts', T('  return e.message.includes("用户尚未同意隐私规则");')]]).tiers, ['test-copy']);
  push('G3 比上游浏览器原文（纯 ASCII 整句）⇒ 🟠 要人看，不判红',
    tiers([[A, T('  return e.message.includes("Access Handles cannot be created if there is another open Access Handle");')]]).tiers, ['vendor-prose']);
  push('G4 比常量（码位塞在文案里）⇒ 🔵 marker-in-text，这一档不判红',
    tiers([[A, T('  return e.message.includes(PRIVACY_CONSENT_BLOCKED_MARKER);')]]).tiers, ['marker-in-text']);
  push('G5 比变量/模板 ⇒ ⚪ 判不了（计数进"判不了"那一栏，不许静默）',
    (() => { const r = scanText(A, T('  const key = "x";\n  return e.message.includes(key) || e.message.includes(`前缀${key}`);')); return [r.rows.filter((x) => x.tier === 'unreadable').length, r.unreadable]; })(),
    [2, 2]);
  push('G6 注释里那枚比较不算（结构判断必须吃遮蔽后的文本）',
    tiers([[A, 'export function f(e: Error) {\n  // if (e.message.includes("自家文案")) return true;\n  return false;\n}\n']]).tiers, []);
  push('G7 对账成立：.message 出现次数 ≥ 参与比较的次数，且差额逐枚可数',
    (() => { const r = tiers([[A, T('  log(e.message);\n  return e.message === "登录已失效";')]]); return [r.tokens >= r.compared, r.tokens, r.compared]; })(),
    [true, 2, 1]);
  push('G8 错误类有机读承载（this.name= 或 code 字段）⇒ 不算候选',
    scanText(A, 'export class OkError extends Error {\n  constructor(m: string) { super(m); this.name = "Ok"; }\n}\n').classes[0].ok, true);
  push('G9 错误类什么都没带 ⇒ 🟠 no-machine-field 候选（F2 那一族）',
    scanText(A, 'export class BadError extends Error {\n  constructor(m: string) { super(m); }\n}\n').classes[0].ok, false);
  push('G10 抛出侧只数规模：裸 throw 与具名 throw 各归各的计数',
    (() => { const r = scanText(A, 'function a() { throw new Error("裸"); }\nfunction b() { throw new BadError("具名"); }\n'); return [r.bareThrow, r.typedThrow]; })(),
    [1, 1]);
  push('G11 一枚都没有 ⇒ 聚合给全 0（主读数据此退 2）',
    [scanText(A, 'export const x = 1;\n').rows.length, scanText(A, 'export const x = 1;\n').tokens], [0, 0]);
  push('G12 `--scope` 只吃目录前缀：ai 不许把 aish/ 算进来',
    applyScope(['packages/ai/src/a.ts', 'packages/aish/src/a.ts'], 'packages/ai/src').length, 1);
  push('G13 被比的那一项要回**原文**读：遮蔽后引号里是空格，读回来必须是文案本体',
    scanText(A, T('  return e.message.includes("这一句必须读得回来");')).rows[0].operand, '这一句必须读得回来');
  push('G14 纯 ASCII 也要分家：无空格连字符串 = 自家往文案塞的码位（🔵），带空格的整句才是上游原文（🟠）',
    (() => { const r = tiers([[A, T('  return e.message.includes("privacy-consent-not-granted") || e.message.includes("Access Handles cannot be created");')]]); return r.tiers; })(),
    ['marker-in-text', 'vendor-prose']);
  push('G15 无机读承载但有 instanceof 消费者 ⇒ 🟠（分得开就不算缺陷）；两者全无 ⇒ 🔴 抛出去谁也区分不了',
    (() => {
      const src = 'export class Opaque extends Error {\n  constructor(m: string) { super(m); }\n}\n';
      const files = [A, 'packages/ai/src/b.ts'];
      const quiet = (f) => (f === A ? src : 'export function f() {}\n');
      const loud = (f) => (f === A ? src : 'export function g(e: unknown) { return e instanceof Opaque; }\n');
      const noRef = scanFiles(files, quiet, useCounts(files, quiet));
      const withRef = scanFiles(files, loud, useCounts(files, loud));
      return [noRef.classes.length, noRef.classes[0].ok, noRef.classes[0].refs ?? 0, withRef.classes[0].refs];
    })(), [1, false, 0, 1]);
  push('G16 第三道闸：定义了但**从来没抛出**的类不算 🔴（那是 ② 死代码那一族的账，不能记到 ④ 头上）',
    (() => {
      const cls = 'export class NeverThrown extends Error {\n  constructor(m: string) { super(m); }\n}\nexport class IsThrown extends Error {\n  constructor(m: string) { super(m); }\n}\nexport function boom() { throw new IsThrown("x"); }\n';
      const files = [A, 'packages/ai/src/b.ts'];
      const rd = (f) => (f === A ? cls : 'export function noop() {}\n');
      const base = scanFiles(files, rd, useCounts(files, rd));
      const noField = base.classes.filter((c) => !c.ok);
      const opaque = noField.filter((c) => !c.refs && c.throws > 0);
      const never = noField.filter((c) => !c.refs && !c.throws);
      return [noField.length, opaque.map((c) => c.name), never.map((c) => c.name)];
    })(), [2, ['IsThrown'], ['NeverThrown']]);
  push('G17 带修饰符的字段声明要认得：override name = 一枚机读承载（第一发假红三枚就是漏了这一形）',
    scanText(A, 'export class SyncFilePrefixVersionError extends Error {\n  constructor(v: number) { super(String(v)); }\n  override name = \'SyncFilePrefixVersionError\';\n}\n').classes[0].ok, true);
  push('G19 F4 的谓词是按真实形状下的：res.status().json() 那一族在本仓读 0（写错形状的尺会一路读绿）',
    [git(['grep', '-h', '-c', 'reply\\.status(', '--', 'server/src/api.ts']) !== '', /\.json\(/.test('')], [true, false]);
  push('G18 F4 四档分得开：统一码位 / 另一种码位（status: approved 这种）/ 什么都没有才落档 / 带 ...展开 记判不了',
    (() => {
      const srv = 'server/src/api.ts';
      const r = scanText(srv, 'app.get("/x", (req, reply) => {\n  reply.status(503).send({ message: "nope" });\n  reply.status(400).send({ code: "bad", message: "x" });\n  reply.status(409).send({ status: "approved", channel: "unavailable" });\n  reply.status(402).send({ ...body(reason), used: 3 });\n  reply.status(200).send({ ok: true });\n});\n');
      return [r.replies.map((x) => x.tier), r.replyTotal, r.replyUnreadable];
    })(), [['reply-5xx-no-code', 'has-code', 'other-code-field', 'spread-body'], 4, 1]);
  const nums = labels.map((l) => Number(/^G(\d+)/.exec(l)?.[1] ?? 0));
  const uniq = new Set(nums);
  const seqOk = Math.max(...nums) === uniq.size;
  console.log(`${seqOk ? '✅' : '🔴'} G${Math.max(...nums) + 1} 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重号数 ${uniq.size}）`);
  if (!seqOk) bad.push(`编号臂跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 去重 ${uniq.size}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  return bad.length === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const strict = argv.includes('--strict');
  const si = argv.indexOf('--scope');
  const scope = si >= 0 ? argv[si + 1] ?? '' : '';
  const ti = argv.indexOf('--top');
  const top = ti >= 0 ? Number(argv[ti + 1] ?? MAX_LIST) : MAX_LIST;
  const files = applyScope(listTracked(), scope);
  if (files.length === 0) { console.log(`🔴 分母为空（作用域"${scope || '默认三片'}"里一枚 .ts/.tsx 都没数到）⇒ 尺瞎。`); process.exit(2); }
  const base = scanFiles(files, (f) => readFileSync(f, 'utf8'), useCounts(files, (f) => readFileSync(f, 'utf8')));
  if (base.tokens === 0) { console.log(`🔴 扫了 ${files.length} 枚，一处 \`.message\` 都没数到 ⇒ 抽取瞎了，读 0 不等于"没有拿文案当分支"。`); process.exit(2); }
  // 🔴 两把尺对账：`.message` 出现次数 = 参与比较的次数 + 只读不比的次数
  const nonCmp = base.tokens - base.compared;
  console.log(`作用域 ${scope || '默认三片'} ｜ .ts/.tsx ${files.length} 枚 ｜ \`.message\` 出现 ${base.tokens} 处（参与比较 ${base.compared} ｜ 只读/赋值 ${nonCmp}）`);
  if (base.compared > base.tokens || base.tokens < 0) { console.log('🔴 对账不成立 ⇒ 计数重复或抽取错位，本趟读数不可信。'); process.exit(2); }
  const cand = candidates(base.rows);
  const by = (k) => base.rows.filter((r) => r.tier === k).length;
  console.log(`F1 消费侧：🔴 比自家文案 ${by('copy-contract')} ｜ 🟡 测试面同样写法 ${by('test-copy')} ｜ 🟠 比上游原文 ${by('vendor-prose')} ｜ 🔵 码位塞在文案里 ${by('marker-in-text')} ｜ ⚪ 判不了 ${base.unreadable}`);
  const noField = base.classes.filter((c) => !c.ok);
  const opaque = noField.filter((c) => !c.refs && c.throws > 0);
  const neverThrown = noField.filter((c) => !c.refs && !c.throws);
  console.log(`F2 生产侧：具名错误类 ${base.classes.length} 枚 ｜ 无机读承载（既无 name 也无 code 类字段）${noField.length} 枚 ｜ 其中确实被抛出过又没人用 instanceof 分的 🔴 ${opaque.length} 枚 ｜ 定义了但从来没抛出的 ${neverThrown.length} 枚（那是 ② 那一族的形状，不在本尺记账）`);
  console.log(`F3 抛出侧：裸 throw ${base.bareThrow} 枚 ｜ 具名 throw ${base.typedThrow} 枚（只报规模，不出候选：工具函数里裸抛合法）`);
  const r5 = base.replies.filter((x) => x.tier === 'reply-5xx-no-code');
  const r4 = base.replies.filter((x) => x.tier === 'reply-4xx-no-code');
  const rOk = base.replies.filter((x) => x.tier === 'has-code').length;
  console.log(`F4 对外响应体（server/src）：reply.status(4xx/5xx).send 共 ${base.replyTotal} 处 ｜ 统一码位 ${rOk} ｜ 另一种码位（status/reason/channel 类枚举字段）${base.replies.filter((x) => x.tier === 'other-code-field').length} ｜ 🔴 5xx 什么都没有 ${r5.length} ｜ 🟠 4xx 什么都没有 ${r4.length} ｜ 判不了 ${base.replyUnreadable} 处（send(变量)、带 ...展开、括号配不上）`);
  if (base.replyTotal !== base.replies.length) { console.log('🔴 F4 对账不成立 ⇒ 响应体归属漏了，本趟读数不可信。'); process.exit(2); }
  if (cand.length) {
    console.log('\n🔴 候选（生产代码里把自家文案当契约；逐枚开码才成判词）：');
    for (const c of cand.slice(0, top)) console.log(`   ${c.file}:${c.line}  .message … "${c.operand}"`);
    if (cand.length > top) console.log(`   …另有 ${cand.length - top} 枚（加 --top 500 全列）`);
  }
  if (noField.length) {
    console.log('\n🟠 无机读承载但有 instanceof 消费者的具名错误类（按包聚合；分得开就不算缺陷，逐枚要人看）：');
    const g = new Map();
    for (const c of noField.filter((x) => x.refs)) { const k = c.file.split('/').slice(0, 2).join('/'); g.set(k, (g.get(k) ?? 0) + 1); }
    for (const [k, n] of [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`   ${String(n).padStart(3)} 枚  ${k}`);
  }
  if (opaque.length) {
    console.log('\n🔴 无机读承载、没有 instanceof 消费者、又确实被抛出过的错误类（抛出去谁也区分不了；逐枚开码才成判词）：');
    for (const c of opaque.slice(0, top)) console.log(`   ${c.file}:${c.line}  class ${c.name}（抛出 ${c.throws} 处）`);
  }
  if (r5.length) { console.log('\n🔴 5xx 对外没给码位（客户端只能猜；逐枚开码才成判词）：'); for (const c of r5.slice(0, top)) console.log(`   ${c.file}:${c.line}  status ${c.status}`); }
  if (r4.length) { console.log('\n🟠 4xx 对外没给码位（界面层要分档回执就分不了）：'); for (const c of r4.slice(0, top)) console.log(`   ${c.file}:${c.line}  status ${c.status}`); }
  console.log(`\n候选 F1 ${cand.length} 枚 ＋ F2 ${opaque.length} 枚 ＋ F4 ${r5.length + r4.length} 枚${strict ? '' : '｜诊断尺默认退 0，加 --strict 才判红（两族任一枚即红）'}`);
  if (argv.includes('--mutate')) process.exit(mutate(files, (f) => readFileSync(f, 'utf8'), useCounts(files, (f) => readFileSync(f, 'utf8'))));
  process.exit(strict && (base.rows.some((r) => r.tier === 'copy-contract') || opaque.length > 0 || r5.length > 0 || r4.length > 0) ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
