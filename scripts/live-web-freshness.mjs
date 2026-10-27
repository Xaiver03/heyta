#!/usr/bin/env node
/**
 * 线上那盘网页应用**新不新**（**诊断，不是门禁**）
 *
 * ## 它补的是哪一格
 *
 * 服务端与网页应用是**两件产物、两条发布路径**：`scripts/deploy-ssh.mjs` 只换
 * `supersync-server` 容器，而公网 `/app/` 打的是宿主机 `/var/www/heyta-app`
 * （由 `docs/runbooks/deployment.md` 里那条 rsync 单独同步）。于是有一种红是整条
 * `pnpm check` 与 `/health=200` 都看不见的：**代码改对了、那一盘还是旧的**。
 * 本域名这一族已经踩过多次（B232 那次是落地页的导航，2026-10-27 那次是验证码登录
 * 那一档 —— 服务端修好了，线上那盘 SPA 里连"最新两句文案"都搜不到）。
 *
 * `scripts/dist-freshness.mjs` 判的是**本机** `packages/<pkg>/dist` 落后于 `src`；
 * 这一枚判的是**公网那台机器上**的字节落后于仓库多远。两个对象，不重叠。
 *
 * ## 判据的形状（以及它**不是**什么）
 *
 * 针脚（needle）= 最近 `--depth` 枚动过 `packages/i18n/src/locales/zh-CN.ts` 的提交里
 * **新增的词条值**，且那个 key 在 `apps/web/src` 里被引用过（没引用就不在这盘里）。
 * 逐枚问"这串字在不在公网送回来的那堆 `/app/assets/*` 字节里"。
 *
 * ⚠️ 它是**新鲜度**判据，不是**逐字节**判据：Vite 产物里的 hash 只有真构建才预测得了，
 * 所以"线上那份 == 仓库输入"这句话要逐字节成立，仍然得走一次构建 + 对账。这一枚能确定的是
 * 反方向：**新东西不在场 ⇒ 那一盘必然旧于引入它的那枚提交**。
 *
 * ## 为什么默认 exit 0（承 dist-freshness 同一条纪律）
 *
 * 并行会话随时可能刚落一笔 i18n 而还没发布 —— 那一刻"落后"是**正常态**，不是谁的错。
 * 一条天生红的门禁等于没有门禁（AGENTS §8 第 3 条）。要为一个具体读数负责，显式传 `--strict`。
 *
 * ## 三种假绿，各自怎么挡
 *
 *  1. **分母为空**（一枚针脚都没抽到）⇒ 单独判红并点名，绝不回"0 个不在场 ⇒ 齐"。
 *     这是最容易发生的一种：词条表格式一改（比如换双引号），抽取就静默空掉。
 *  2. **抓不到线上**（断网 / 5xx / 域名换掉）⇒ 记成 `fetch-error`，**不许**折算成"针脚不在场"。
 *     否则一次网络抖动会读成"线上落后了 N 笔"。
 *  3. **未知旗标**⇒ 直接拒（同一晚 `check-schema-migration-drift.mjs` 刚为这个吃过一次：
 *     不认的旗标被静默忽略时，它照样打出一整份"看起来关于你问的那个对象"的绿。见环境陷阱 #605）。
 *
 * ## 用法
 *
 *   node scripts/live-web-freshness.mjs                 # 体检：逐枚针脚在/不在 + 落后到哪一笔
 *   node scripts/live-web-freshness.mjs --strict        # 有针脚不在场 ⇒ exit 1
 *   node scripts/live-web-freshness.mjs --depth 12      # 多看几笔提交
 *   node scripts/live-web-freshness.mjs --origin https://staging.example
 *   node scripts/live-web-freshness.mjs --self-test     # 六臂自检（每臂都要能失败）
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOCALE_FILE = 'packages/i18n/src/locales/zh-CN.ts';
const WEB_SRC_DIR = 'apps/web/src';
const DEFAULT_ORIGIN = 'https://heyta.waytofuture.cn';
const ALLOWED_FLAGS = ['--strict', '--self-test'];

function parseArgs(argv) {
  const out = { strict: false, selfTest: false, depth: 6, origin: DEFAULT_ORIGIN };
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--strict') out.strict = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--depth') out.depth = Number.parseInt(argv[++i], 10);
    else if (a === '--origin') out.origin = argv[++i];
    else if (a.startsWith('-')) unknown.push(a);
    else unknown.push(`多余的位置参数 ${a}`);
  }
  return { ...out, unknown };
}

/** 从 git 里抽针脚：最近 depth 枚动过词条表的提交里**新增**的、且被 apps/web 引用的值。 */
function collectNeedles({ depth, localeFile = LOCALE_FILE, srcDir = WEB_SRC_DIR } = {}) {
  const log = execFileSync('git', ['log', `-n${depth}`, '--format=%H\x1f%s', '--', localeFile], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const referenced = new Set(
    execFileSync('grep', ['-rhoE', "'[a-zA-Z0-9_.-]+'", '--', srcDir], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((l) => l.replace(/'/g, '')),
  );
  const needles = [];
  const skipped = { notReferencedByWeb: 0, tooShort: 0, notALiteral: 0 };
  for (const line of log.split('\n')) {
    if (line.trim() === '') continue;
    const [sha, subject] = line.split('\x1f');
    const diff = execFileSync('git', ['show', '--format=', '--unified=0', sha, '--', localeFile], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    for (const raw of diff.split('\n')) {
      if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
      if (!/^\+\s*'/.test(raw)) continue;
      const m = /^\+\s*'([a-zA-Z0-9_.-]+)':\s*'(.+)',?\s*$/.exec(raw);
      if (m === null) {
        skipped.notALiteral += 1;
        continue;
      }
      const [, key, value] = m;
      if (!referenced.has(key)) {
        skipped.notReferencedByWeb += 1;
        continue;
      }
      // 太短的值（"是"/"否"）在任何字节流里都会巧合命中，判不了新鲜度。
      if (value.replace(/\\./g, 'xx').length < 8) {
        skipped.tooShort += 1;
        continue;
      }
      needles.push({ key, value, sha: sha.slice(0, 9), subject });
    }
  }
  return { needles, skipped };
}

/**
 * 从一枚 JS 的正文里找出它动态加载的 chunk 文件名。
 * 单独成函数是为了**能在自检里判红**：这一层爬不到，住在懒加载 chunk 里的新文案
 * 就会被读成"不在场 ⇒ 线上旧了"（假红）。
 */
function discoverChunkNames(body) {
  const out = new Set();
  for (const m of body.matchAll(/["'`(/](?:assets\/)?([A-Za-z0-9._-]+-[A-Za-z0-9_-]{6,}\.js)["'`]/g)) {
    out.add(m[1]);
  }
  return [...out];
}

/**
 * 把公网那盘的字节取回来。失败**不**折算成"针脚不在场"。
 *
 * 🔴 只抓入口那一枚会**假红**：一枚住在懒加载 chunk 里的新文案，会因为那枚 chunk
 *    根本没被抓回来而读成"不在场 ⇒ 线上旧了"。所以顺着入口 JS 里的 chunk 名再爬一层
 *    （有界，最多 `maxChunks` 枚），并如实报告抓了几枚。
 */
async function fetchBundle(origin, { maxChunks = 60 } = {}) {
  const base = origin.replace(/\/$/, '');
  const res = await fetch(`${base}/app/`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${base}/app/ 答 ${res.status}`);
  const html = await res.text();
  const refs = new Set([...html.matchAll(/\/app\/assets\/[A-Za-z0-9._-]+\.js/g)].map((x) => x[0]));
  if (refs.size === 0) throw new Error(`${base}/app/ 回来了，但正文里不引任何 /app/assets/*.js`);
  const parts = [html];
  const queue = [...refs];
  for (let i = 0; i < queue.length && i < maxChunks; i += 1) {
    const ref = queue[i];
    const r = await fetch(`${base}${ref}`, { redirect: 'follow' });
    if (!r.ok) throw new Error(`GET ${base}${ref} 答 ${r.status}`);
    const body = await r.text();
    parts.push(body);
    for (const name of discoverChunkNames(body)) {
      const next = `/app/assets/${name}`;
      if (!refs.has(next) && refs.size < maxChunks) {
        refs.add(next);
        queue.push(next);
      }
    }
  }
  return { text: parts.join('\n'), refs: [...refs] };
}


/** 纯函数：给定针脚与线上字节，算出判决。分母为空单独成一档。 */
function decide(needles, bundleText) {
  if (needles.length === 0) {
    return { kind: 'empty-denominator', missing: [], checked: 0 };
  }
  const missing = needles.filter((n) => !bundleText.includes(n.value));
  return { kind: 'ok', missing, checked: needles.length };
}

function report(needles, verdict, bundleInfo) {
  const skip = bundleInfo.skipped;
  console.log(
    `线上盘新鲜度体检 ｜ origin=${bundleInfo.origin} ｜ 抓回 ${bundleInfo.refs.length} 枚产物 / ${bundleInfo.bytes} 字节`,
  );
  if (verdict.kind === 'empty-denominator') {
    console.log('🔴 分母为空：一枚针脚都没抽到。这**不是**"线上是新的"，是体检根本没跑。');
    console.log('   先查抽取：词条表的行形状（两空格缩进 + 单引号 key + 单引号 value）或 apps/web 的引用写法是不是改了。');
    console.log(`   剔除明细：不像字面量 ${skip.notALiteral} ｜ key 没被 apps/web 引用 ${skip.notReferencedByWeb} ｜ 值太短 ${skip.tooShort}`);
    return;
  }
  const bySha = new Map();
  for (const n of needles) if (!bySha.has(n.sha)) bySha.set(n.sha, n.subject);
  console.log(
    `   针脚 ${verdict.checked} 枚，来自 ${bySha.size} 笔提交（逐枚动过 ${LOCALE_FILE}）` +
      `｜ 剔除：没被 web 引用 ${skip.notReferencedByWeb} ｜ 值太短 ${skip.tooShort} ｜ 不像字面量 ${skip.notALiteral}`,
  );
  for (const n of verdict.missing) {
    console.log(`   🔴 不在场  ${n.sha}  ${n.key}  「${n.value.slice(0, 28)}…」`);
  }
  if (verdict.missing.length === 0) {
    console.log(`   ✅ 全部在场 ⇒ 线上那盘不早于 ${needles[needles.length - 1].sha}`);
  } else {
    const oldest = needles.find((n) => verdict.missing.includes(n));
    console.log(`   ⇒ 线上那盘**旧于** ${oldest.sha}（${oldest.subject.slice(0, 40)}…）`);
    console.log('     对齐它是对外动作：先按 docs/runbooks/deployment.md 那条 rsync，别在这里改代码。');
  }
}

const SELF_TEST_ARMS = () => {
  const arms = [];
  const N = [
    { key: 'a.one', value: '第一句足够长的中文文案', sha: 'aaaa11111', subject: 'feat A' },
    { key: 'a.two', value: '第二句也足够长的中文文案', sha: 'bbbb22222', subject: 'feat B' },
  ];
  const push = (name, got, want) =>
    arms.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  push('① 全在场 ⇒ 零缺失', decide(N, 'x 第一句足够长的中文文案 y 第二句也足够长的中文文案 z'), {
    kind: 'ok',
    missing: [],
    checked: 2,
  });
  push('② 缺一枚 ⇒ 只点名那一枚', decide(N, 'x 第一句足够长的中文文案'), {
    kind: 'ok',
    missing: [N[1]],
    checked: 2,
  });
  push('③ 分母为空 ⇒ 不许判成齐', decide([], '什么都有'), { kind: 'empty-denominator', missing: [], checked: 0 });
  push('④ 线上字节为空 ⇒ 两枚都不在场（不是"齐"）', decide(N, ''), { kind: 'ok', missing: N, checked: 2 });
  push('⑤ 未知旗标必须被拒', parseArgs(['--strict', '--bogus']).unknown, ['--bogus']);
  push('⑥ 认的旗标不许被当成未知', parseArgs(['--strict', '--self-test', '--depth', '9']).unknown, []);
  push(
    '⑦ 懒加载 chunk 名要爬得到（否则新文案会假红）',
    discoverChunkNames('import("./index-AbC12345.js");e("./chunk-Zz9_8675x.js"),"/app/assets/three-QwErTy12.js"'),
    ['index-AbC12345.js', 'chunk-Zz9_8675x.js', 'three-QwErTy12.js'],
  );
  push('⑧ 正文里没有 chunk 名 ⇒ 空清单（不是崩）', discoverChunkNames('var a=1;'), []);
  return arms;
};

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.unknown.length > 0) {
    console.error(`🔴 未知旗标：${opts.unknown.join(' ')} ｜ 这枚尺只认 ${ALLOWED_FLAGS.join(' / ')} 与 --depth/--origin`);
    process.exit(1);
  }
  if (opts.selfTest) {
    const arms = SELF_TEST_ARMS();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) {
      console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`);
    }
    console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  const needles = collectNeedles({ depth: opts.depth });
  let bundle;
  try {
    bundle = await fetchBundle(opts.origin);
  } catch (err) {
    console.log(`⚠️ 抓不到线上那盘：${String(err.message ?? err).split('\n')[0]}`);
    console.log('   记成 fetch-error —— 它**不是**"针脚不在场"，一次抖动不许读成"线上落后 N 笔"。');
    process.exit(opts.strict ? 1 : 0);
  }
  const verdict = decide(needles.needles, bundle.text);
  report(needles.needles, verdict, {
    origin: opts.origin,
    refs: bundle.refs,
    bytes: bundle.text.length,
    skipped: needles.skipped,
  });
  if (verdict.kind === 'empty-denominator') process.exit(1);
  if (opts.strict && verdict.missing.length > 0) process.exit(1);
  process.exit(0);
};

await main();
