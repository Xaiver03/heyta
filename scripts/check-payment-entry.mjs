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
 *   · 生产 compose（`server/docker-compose.yml`）**没有**转发任何 `WECHAT_*`
 *     ⇒ 线上只有 noop ⇒ 客户端**必须没有**付款入口；
 *   · 一旦有人在 compose 里配上渠道 ⇒ 这条门禁**立刻要求客户端有入口**
 *     （反过来也会红，防止"点了没反应的按钮"重新出现）。
 *
 * 于是"入口与渠道一起落地"不再是约定，而是**红的或绿的**。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
let channelConfigured = false;
if (!existsSync(COMPOSE)) {
  problems.push(`找不到 ${relative(ROOT, COMPOSE)} —— 无法判断支付渠道是否接通`);
} else {
  const envSection = environmentSection(readFileSync(COMPOSE, 'utf8'));
  // 只认"确实传了值"的行，避免把注释里提到 WECHAT 也算成"配了"。
  channelConfigured = /^\s*-\s*WECHAT_[A-Z_]+=\S/m.test(envSection);
}

// ── 客户端里有哪些付款入口 ──────────────────────────────────────────
const hits = CLIENT_DIRS.flatMap(scanDir);

if (!channelConfigured) {
  for (const h of hits) {
    problems.push(
      `🔴 生产 compose 没配支付渠道，但客户端出现了付款入口：${h.file}:${h.line}\n` +
        `     ${h.text}\n` +
        `     渠道未接通时，结账接口的 ④ 会返回 503 BILLING_PROVIDER_NOT_CONFIGURED ——\n` +
        `     也就是**点下去不会有任何结果**。不放按钮比放一个没反应的按钮好。`,
    );
  }
} else if (hits.length === 0) {
  problems.push(
    '🔴 生产 compose 已经配了支付渠道，但客户端里没有任何付款入口。\n' +
      '     渠道通了就该让用户买得到 —— 请在同一轮里把入口加上（web + mobile），\n' +
      '     不要让"能收钱但买不了"成为新的半截状态。',
  );
}

if (problems.length > 0) {
  console.error('❌ 付款入口与支付渠道不一致：\n');
  for (const p of problems) console.error(`   ${p}\n`);
  console.error(
    `   现状：生产 compose ${channelConfigured ? '已配' : '未配'}支付渠道；` +
      `客户端里找到 ${hits.length} 处付款入口。`,
  );
  process.exit(1);
}

console.log(
  `✅ 付款入口与支付渠道一致：生产 compose ${channelConfigured ? '已配' : '未配'}渠道，` +
    `客户端有 ${hits.length} 处付款入口。`,
);
