#!/usr/bin/env node
/**
 * 「付款入口」只能在**支付渠道真的接通**的同时落地。
 *
 * 为什么需要这条门禁
 * ------------------
 * 落地页的定价区曾有（现在也没有）一个「立即购买」按钮，`Pricing.tsx` 里留着一句注释说明
 * 为什么不放：**一个点了没反应的购买按钮，比没有按钮更坏**。但那只是**一句注释** ——
 * 没有任何东西阻止下一个人在 web / mobile / landing 里加一个按钮。
 *
 * 而这一次尤其危险：**服务端的结账路由是挂着的**（`/api/billing/checkout` 存在、
 * 未登录返回 401），所以"接口在"很容易被读成"渠道通了"。两者不是一回事：
 * `createBillingAdaptersFromConfig` **永远**返回一个 noop 通道，只有配了 `config.wechatPay`
 * 才会追加真通道；`checkout.routes.ts` 的 ④ 会把 noop 过滤掉，于是没有真通道时
 * 结账返回 **503 BILLING_PROVIDER_NOT_CONFIGURED**。
 * 换句话说：**接口在、但收不了钱。**
 *
 * 这条门禁把两个事实钉在一起
 * --------------------------
 *   · 生产 compose（`server/docker-compose.yml`）有没有把**统一支付中心**那四枚键
 *     （`PAYCENTER_ENABLED` + 三项凭证）转发进容器 —— `environment:` 是白名单，
 *     运维在 `.env` 里填了而 compose 没转发，等于**永远开不了真通道**；
 *   · 客户端有没有付款入口。
 *
 *   两者必须同进同退：转发不全 ⟹ 客户端不许有入口（点了必然 503）；
 *   转发齐了 ⟹ 客户端必须有入口（别让"能收钱但买不了"变成新的半截状态）。
 *
 * ⚠️ **2026-10-20 这一版把判据从微信直连改指向支付中心**（负责人点名授权）：
 *    旧版盯的是 `WECHAT_PAY_ENABLED`，而微信直连已在 `refactor(billing)!` 那笔里退场
 *    （`config.ts` 把它设成 true 会**启动硬错误**）。于是旧判据在一个已经接通中心的
 *    部署上永远回"未配渠道"，在把总闸误设成 true 的 compose 上又永远回"已配渠道" ——
 *    两头都不说真话。旧臂里"微信总闸开 = 有渠道"那条语义随之作废，见下面 ARMS。
 *
 * 于是"入口与渠道一起落地"不再是约定，而是**红的或绿的**。
 */

import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();
const problems = [];

const COMPOSE = join(ROOT, 'server/docker-compose.yml');
const CLIENT_DIRS = ['apps/web/src', 'apps/mobile/src', 'apps/landing/src'];

/**
 * 「付款入口」的判据。**刻意窄**：只认明确的购买动作，
 * 不认「订阅」「定价」这类会出现在说明文案里的词 —— 否则门禁会因为一句介绍而变红，
 * 然后被人用 `// eslint-disable` 式的手法绕过。
 *
 * `立即使用` **不在**表内：那是"打开应用"，不是付款。
 */
const ENTRY_PATTERNS = [
  /立即购买/,
  /去购买/,
  /马上去买/,
  /立即订阅/,
  /去支付/,
  /立即支付/,
  /开通会员/,
  /\/api\/billing\/checkout/,
  /createCheckout\s*\(/,
  /startCheckout\s*\(/,
];

/**
 * 把一行源码里的**注释**去掉，返回剩下的代码部分。
 *
 * 🔴 为什么不是"看这一行是不是以 `//` 或 `*` 开头"就完事。
 *
 * 这条门禁**曾经那样写**，于是它对**块注释的续行**完全失效：
 * 一句写在块注释中间、以中文括号开头的说明
 * （`（同一条判据见 Pricing.tsx 里为什么不放…）。`）
 * 既不 startsWith('//') 也不 startsWith('*')，于是被当成**真的付款入口**。
 *
 * 后果不是"误报一次"那么轻：一条会对着**注释**变红的门禁，
 * 迟早会被人用改文案、加白名单、甚至关掉它的方式绕过 ——
 * 而它守的是一条真实的产品承诺（渠道没接通就不许有购买按钮）。
 *
 * 所以改成跨行跟踪 `inBlock` 状态。
 *
 * ⚠️ `//` 只有在**不是** `://` 的一部分时才当注释 —— 否则
 * `'https://example.com'` 会被从中间截断，而**截断之后的文本里
 * 藏的付款入口就再也查不到了**（假阴性比假阳性危险得多）。
 */
function stripCommentsOnLine(line, inBlock) {
  let code = line;
  let block = inBlock;

  for (;;) {
    if (block) {
      const close = code.indexOf('*/');
      if (close === -1) return { code: '', inBlock: true };
      code = code.slice(close + 2);
      block = false;
      continue;
    }
    const open = code.indexOf('/*');
    if (open === -1) break;
    const before = code.slice(0, open);
    const after = code.slice(open + 2);
    const close = after.indexOf('*/');
    if (close === -1) return { code: before, inBlock: true };
    code = before + after.slice(close + 2);
  }

  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '/' && code[i + 1] === '/' && code[i - 1] !== ':') {
      code = code.slice(0, i);
      break;
    }
  }
  return { code, inBlock: false };
}

/** 扫一个目录，返回 [{ file, line, text }]。**跳过注释**（含块注释续行）。 */
const scanDir = (dir) => {
  const hits = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return hits;

  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|vue|svelte|html)$/.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      // 🔴 `inBlock` **按文件**重置，不是按行 —— 块注释跨行，
      //    逐行重置等于又退回"只看行首"的老写法。
      let inBlock = false;
      text.split('\n').forEach((line, i) => {
        const stripped = stripCommentsOnLine(line, inBlock);
        inBlock = stripped.inBlock;
        // 注释不是入口。否则写一句"这里以后放购买按钮"就会让门禁变红。
        const code = stripped.code.trim();
        if (code === '') return;
        if (ENTRY_PATTERNS.some((re) => re.test(code))) {
          hits.push({ file: relative(ROOT, p), line: i + 1, text: code.slice(0, 120) });
        }
      });
    }
  };
  walk(abs);
  return hits;
};

/**
 * 取出 compose 里 `environment:` 段的正文（按缩进判断范围）。
 *
 * 原本写成 `split(/^ {2}environment:/)` —— **假设了 2 空格缩进**，而 compose 里是 4 空格，
 * 于是永远切不出这一段、`channelConfigured` 恒为 false。那会让这条门禁**只会单向生效**：
 * 任何"渠道配了"的情况都被误判成"没配"。按缩进取才是对的。
 */
const environmentSection = (compose) => {
  const lines = compose.split('\n');
  const start = lines.findIndex((l) => /^\s*environment:\s*$/.test(l));
  if (start === -1) return '';
  const indent = lines[start].match(/^\s*/)[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.match(/^\s*/)[0].length <= indent) break;
    out.push(line);
  }
  return out.join('\n');
};

// ── 生产渠道是否配置 ────────────────────────────────────────────────

/**
 * 把 compose 里 `- VAR=值` 右边那一段解析成**它实际传进去的值**。
 *
 * 🔴 这个函数是为一次实测事故写的（2026-10-16）。原判据是
 * `/^\s*-\s*WECHAT_[A-Z_]+=\S/m` —— 只看"等号右边非空白"。而 compose 里那行是
 *
 *     - WECHAT_PAY_ENABLED=${WECHAT_PAY_ENABLED:-false}
 *
 * `${…:-false}` 非空白 ⇒ `channelConfigured` 变成 **true**。可那一行的语义**恰恰相反**：
 * 没人设这个环境变量时它是 `false` ⇒ 线上**只有 noop**。于是这半条门禁
 * （"没渠道就不许有付款入口"）**恒不生效** —— 而它守的正是"点了没反应的按钮"。
 *
 * ⚠️ 同一个文件上面还记着一次**同族**事故：`split(/^ {2}environment:/)` 假设了缩进，
 * 让 `channelConfigured` **恒为 false**。两次都出在同一件事上：
 * **这条判据到底在断言什么**（"有这一行" ≠ "线上真的有渠道"）。
 */
function resolvedValue(raw) {
  const m = /^\$\{[A-Z_][A-Z0-9_]*(?::-([^}]*))?\}$/.exec(raw);
  if (m === null) return raw; // 字面量：原样
  return m[1] ?? ''; // `${VAR}` / `${VAR:-默认}` ⇒ 取默认；没有默认就是空串
}

/** 布尔型开关：只有真值才算"开"。`false`/空/`0` 都不算。 */
const isEnabled = (value) => /^(1|true|yes|on)$/i.test(value.trim());

const COMPOSE_ENV_LINE = /^\s*-\s*((?:PAYCENTER|WECHAT|WX)_[A-Z0-9_]+)=(.*)$/;

/** 支付中心：一枚总闸 + 三项凭证。"能不能接通"看这四枚是否**都被转发进容器**。 */
const PAYCENTER_MASTER = 'PAYCENTER_ENABLED';
const PAYCENTER_CREDS = ['PAYCENTER_BASE_URL', 'PAYCENTER_CLIENT_ID', 'PAYCENTER_CLIENT_SECRET'];

/** 真通道能不能被这个部署开起来（不是"现在开着没"）。 */
let channelForwarded = false;
if (!existsSync(COMPOSE)) {
  problems.push(`找不到 ${relative(ROOT, COMPOSE)} —— 无法判断支付渠道是否接通`);
} else {
  const envSection = environmentSection(readFileSync(COMPOSE, 'utf8'));
  // 注释行不算（`environmentSection` 取的已经是 environment 段，但 `#` 开头的说明仍可能在里面）。
  const assignments = envSection
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => COMPOSE_ENV_LINE.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({ key: m[1], value: resolvedValue(m[2].trim()) }));

  const byKey = new Map(assignments.map((a) => [a.key, a]));

  /**
   * 🔴 **总闸管辖其余字段**，不是"任一字段有值就算通"。
   *
   * 第一版写成 `assignments.some(key === 'WECHAT_PAY_ENABLED' ? isEnabled : isPresent)` ——
   * 于是 `WECHAT_PAY_ENABLED=${…:-false}` 配上 `WECHAT_MCH_ID=123` 又被判成"已配渠道"。
   * **是自检的臂 D 在同一轮里当场把这条抓出来的**，不是靠人再看一遍。
   * 服务端也是这个语义：`createBillingAdaptersFromConfig` 只在总闸开时才追加真通道。
   */
  const master = byKey.get(PAYCENTER_MASTER);
  const missingCreds = PAYCENTER_CREDS.filter((k) => !byKey.has(k));
  channelForwarded = master !== undefined && missingCreds.length === 0;

  if (master !== undefined && missingCreds.length > 0) {
    problems.push(
      '🔴 compose 转发了 `PAYCENTER_ENABLED`，但没转发这三项凭证里的 `' +
        `${missingCreds.join('`, `')}` +
        '`。\n' +
        '     `environment:` 是白名单：运维在 `.env` 里填了这些值也**进不了容器** ⇒\n' +
        '     真通道永远注册不上，结账返回 503。要么四枚一起转，要么就别放总闸。',
    );
  }

  // 总闸的**默认值**不许写成真：`config.ts` 是全有或全无，凭证留空 + 总闸真 = 每次部署启动即崩。
  if (master !== undefined && isEnabled(master.value)) {
    const emptyCreds = PAYCENTER_CREDS.filter((k) => !byKey.has(k) || byKey.get(k).value === '');
    if (emptyCreds.length > 0) {
      problems.push(
        '🔴 `PAYCENTER_ENABLED` 的默认值是假之外的真值，而这些凭证解析出来是空的：' +
          `${emptyCreds.join(', ')}。\n` +
          '     服务端把它们当**启动期硬错误**（有意，防止"看起来配了但注册不上"），\n' +
          '     所以这样写等于让所有没填 `.env` 的部署起不来。默认写 `false`，由运维显式打开。',
      );
    }
  }

  /**
   * 微信直连那条路已在 `refactor(billing)!` 里退场：`config.ts` 见
   * `WECHAT_PAY_ENABLED=true` 直接抛错，`registry.ts` 不再注册它。
   * 这里仍然认它，是为了**响亮**而不是静默 —— 它现在是一种"配了也收不到钱"的写法。
   */
  const wechatMaster = byKey.get('WECHAT_PAY_ENABLED');
  if (wechatMaster !== undefined && isEnabled(wechatMaster.value)) {
    problems.push(
      '🔴 compose 把 `WECHAT_PAY_ENABLED` 设成了真，而微信直连**不再被注册**。\n' +
        '     服务端现在对这一句回启动硬错误（`is no longer supported`）；\n' +
        '     收单与退款统一走支付中心：改设 `PAYCENTER_ENABLED` 与那三项凭证。',
    );
  }
  const wechatCreds = assignments.filter(
    ({ key, value }) => /^(?:WX|WECHAT)_/i.test(key) && key !== 'WECHAT_PAY_ENABLED' && value !== '',
  );
  if (wechatCreds.length > 0) {
    problems.push(
      '🔴 compose 里给微信直连的凭证填了字面值（' +
        `${wechatCreds.map((a) => a.key).join(', ')}` +
        '），而那条路已经退场 ⇒ 填了也不会多出任何通道。\n' +
        '     要接通就写支付中心那四枚键。',
    );
  }
}

// ── 客户端里有哪些付款入口 ──────────────────────────────────────────
const hits = CLIENT_DIRS.flatMap(scanDir);

if (!channelForwarded) {
  for (const h of hits) {
    problems.push(
      `🔴 生产 compose 没把支付中心的凭证转发进容器，但客户端出现了付款入口：${h.file}:${h.line}\n` +
        `     ${h.text}\n` +
        `     真通道开不起来时，结账接口的 ④ 会返回 503 BILLING_PROVIDER_NOT_CONFIGURED ——\n` +
        `     也就是**点下去不会有任何结果**。不放按钮比放一个没反应的按钮好。`,
    );
  }
} else if (hits.length === 0) {
  problems.push(
    '🔴 生产 compose 已经能把支付中心接通，但客户端里没有任何付款入口。\n' +
      '     渠道通了就该让用户买得到 —— 请在同一轮里把入口加上（web + mobile），\n' +
      '     不要让"能收钱但买不了"成为新的半截状态。',
  );
}

/* ── 自检：每臂都必须能红，另有一条阳性对照 ─────────────────────────────
 *
 * 🔴 **这条门禁此前一条自检都没有** —— 而它已经以**同一种方式**坏过两次
 * （缩进假设 ⇒ `channelConfigured` 恒 false；`${VAR:-false}` 被当成"传了值" ⇒ 恒 true）。
 * 两次都不是"判据想法错了"，是"这条判据到底在断言什么"没被钉住。
 * ⇒ 下面这些臂钉的是那一刻：**compose 里怎么写，才算"线上真的能接通支付中心"**。
 *
 * ⚠️ 旧臂 B/C（"微信总闸为真 = 有渠道"）随 2026-10-20 那次改判据**作废**：
 *    微信直连已退场，把它的总闸设成真是启动硬错误而不是"渠道通了"。
 *    作废的方式是把臂换成 E/F 两条会红的判据，不是删掉不管 —— 旧形状今天仍会出现在
 *    别人的 `.env` 与旧文档里，得有一条会红的尺替我们记住它已经死了。
 */
const PAYCENTER_FALSE = [
  '      - PAYCENTER_ENABLED=${PAYCENTER_ENABLED:-false}\n',
  '      - PAYCENTER_BASE_URL=${PAYCENTER_BASE_URL:-}\n',
  '      - PAYCENTER_CLIENT_ID=${PAYCENTER_CLIENT_ID:-}\n',
  '      - PAYCENTER_CLIENT_SECRET=${PAYCENTER_CLIENT_SECRET:-}\n',
].join('');

const ARMS = [
  ['A 四枚键齐转（总闸默认 false）+ 客户端有入口 ⇒ 绿', PAYCENTER_FALSE, 'entry', 'ok'],
  ['B 只转总闸、三项凭证没转 ⇒ 红并点名缺哪几枚',
    '      - PAYCENTER_ENABLED=${PAYCENTER_ENABLED:-false}\n', 'entry', 'missing-creds'],
  ['C 四枚齐转但客户端没有入口 ⇒ 红（能收钱却买不了）', PAYCENTER_FALSE, 'noentry', 'no-entry'],
  ['D 总闸默认写成真而凭证为空 ⇒ 红（每次部署启动即崩）',
    '      - PAYCENTER_ENABLED=${PAYCENTER_ENABLED:-true}\n' + PAYCENTER_FALSE.slice(PAYCENTER_FALSE.indexOf('\n') + 1),
    'entry', 'master-default-on'],
  ['E 把已退场的微信总闸开成 true ⇒ 红',
    '      - WECHAT_PAY_ENABLED=true\n' + PAYCENTER_FALSE, 'entry', 'wechat-retired'],
  ['F 给微信直连的凭证填字面值 ⇒ 红（填了也不多一条通道）',
    '      - WECHAT_MCH_ID=123\n' + PAYCENTER_FALSE, 'entry', 'wechat-creds'],
];

function fixtureRoot(envLines, withEntry) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-pay-'));
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(join(dir, 'server/docker-compose.yml'),
    `services:\n  app:\n    environment:\n${envLines}`);
  for (const d of CLIENT_DIRS) mkdirSync(join(dir, d), { recursive: true });
  if (withEntry) {
    writeFileSync(join(dir, CLIENT_DIRS[0], 'x.ts'), 'await startCheckout({});\n');
  }
  return dir;
}

function runGate(root) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, HEYTA_CHECK_ROOT: root },
    encoding: 'utf8',
  });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

/** 每臂"必须命中哪句话"—— 判据换了句子，这里的表就是唯一要对账的地方。 */
const EXPECT_TEXT = {
  'missing-creds': '没转发这三项凭证',
  'no-entry': '没有任何付款入口',
  'master-default-on': '启动期硬错误',
  'wechat-retired': '不再被注册',
  'wechat-creds': '已经退场',
};

function selfTest() {
  let failures = 0;
  for (const [label, envLines, mode, expect] of ARMS) {
    const dir = fixtureRoot(envLines, mode === 'entry');
    let out;
    try {
      out = runGate(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const red = out.includes('❌');
    const hit =
      expect === 'ok' ? !red
      : red && out.includes(EXPECT_TEXT[expect]);
    console.log(`${hit ? '✅' : '❌'} 臂 ${label}${hit ? '' : ` —— 实际输出：${out.trim().slice(0, 160)}`}`);
    if (!hit) failures += 1;
  }
  // 阳性对照：四枚键齐转 + 客户端有入口 ⇒ 一个字都不报（这就是"渠道与入口一起落地"那一格）
  const clean = fixtureRoot(PAYCENTER_FALSE, true);
  let cleanOut;
  try {
    cleanOut = runGate(clean);
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
  if (cleanOut.includes('❌')) {
    console.log(`❌ 阳性对照失败：合法组合被报红\n${cleanOut.slice(0, 200)}`);
    failures += 1;
  } else {
    console.log('✅ 阳性对照：四枚键齐转且有入口 ⇒ 零报红');
  }
  console.log(`\n臂数 ${ARMS.length}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

if (problems.length > 0) {
  console.error('❌ 付款入口与支付渠道不一致：\n');
  for (const p of problems) console.error(`   ${p}\n`);
  console.error(
    `   现状：生产 compose ${channelForwarded ? '能接通' : '接通不了'}支付中心；` +
      `客户端里找到 ${hits.length} 处付款入口。`,
  );
  process.exit(1);
}

console.log(
  `✅ 付款入口与支付渠道一致：生产 compose ${channelForwarded ? '能接通' : '接通不了'}支付中心，` +
    `客户端有 ${hits.length} 处付款入口。`,
);
