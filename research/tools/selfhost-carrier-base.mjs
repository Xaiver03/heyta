#!/usr/bin/env node
/**
 * `research/tools/selfhost-carrier-base.mjs` —— 载体落笔前回答一个问题：
 * **"这一发的第一父，是不是落地目标那条线的全集？"**
 *
 * 为什么需要它（10-05 16:4x 现量换来的，不是预防性的仪式）：
 * 载体第 11 族写的是"冲突时取 **main** 侧"。当 `main` 指本地那支（落后公开侧 595 笔、
 * 而那 595 笔早已吸收过本批 `e2e/live-site/live-domain.spec.ts` 的新版）时，"取 main 侧"
 * 取到的是**旧版** —— 于是 `6921ac77` 那一发把本批自己的
 * `test('PWA 资产在 /app/ 子路径下拿到真身，且 SW 真的注册成功')` 整条用例连同
 * `?lang=zh-CN` 那句断言一起摘掉了。族的守卫只数两处命中数，"少了一整个 `test(`"不在射程里，
 * 而账面只**打印**了"被丢的独有行 18 条" —— 有名字，没有牙。
 * 反方向同样会错：只用 `origin/main` 当基线时，本地 `main` 上并行会话刚落的 5 笔
 * 会成为新尖的后代之外，推上去就把**别人的 5 笔**从分支上摘掉。
 *
 * 所以这一格不是"选哪支 ref"的偏好，有一条可判的性质：
 *   **落地目标（默认 `origin/main`）必须是载体第一父的祖先。**
 * 不满足 ⇒ 这一发落地必然删掉别人已提交的东西 ⇒ 响亮拒绝，恢复动作是造并基线：
 *   `git merge-tree --write-tree main origin/main`（rc=0 时）→ `git commit-tree -p main -p origin/main`
 *   → 用一支自己的临时 ref 引着，再 `HEYTA_MAIN_REF=<那支> selfhost-merge-carrier.mjs`。
 *
 * 用法：
 *   node research/tools/selfhost-carrier-base.mjs --main=<ref> [--landing=origin/main]
 *   node research/tools/selfhost-carrier-base.mjs --selftest        # 臂数由它自己打印
 * 退出码：0 = 可以当基线；2 = 不可以（打缺多少笔）；3 = 判不了（ref 解析不或计数读不到）。
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const UNJUDGED = Symbol('判不了');

/** 纯判定：只看"落地目标里有多少笔不在候选基线上"。 */
export function baseCheck({ missing }) {
  if (typeof missing !== 'number' || !Number.isInteger(missing) || missing < 0) return UNJUDGED;
  if (missing === 0) return null;
  return `落地目标还差 ${missing} 笔不在这个基线里 ⇒ 这一发落地会把别人已提交的东西从分支上摘掉；`
    + '先把两把线并成一枚基线（merge-tree + commit-tree 两个父），再拿它当 HEYTA_MAIN_REF。';
}

export function baseArms() {
  return [
    { id: 'B0 落地目标是基线祖先（missing=0）⇒ 放行', got: baseCheck({ missing: 0 }), expect: null },
    { id: 'B1 missing=1 ⇒ 必须拒绝（少一笔也是少）', got: typeof baseCheck({ missing: 1 }), expect: 'string' },
    { id: 'B2 missing=595 ⇒ 必须拒绝且把笔数念出来', got: /还差 595 笔/.test(String(baseCheck({ missing: 595 }))), expect: true },
    { id: 'B3 计数不是整数 ⇒ 判不了，不许当放行', got: baseCheck({ missing: '0' }), expect: UNJUDGED },
    { id: 'B4 计数为负 ⇒ 判不了（rev-list 不会给负数，给了就是探针坏）', got: baseCheck({ missing: -1 }), expect: UNJUDGED },
    { id: 'B5 计数缺字段 ⇒ 判不了，不是 0', got: baseCheck({}), expect: UNJUDGED },
  ];
}

const OPT = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

if (process.argv.includes('--selftest')) {
  const arms = baseArms();
  let bad = 0;
  for (const a of arms) {
    const hit = a.got === a.expect;
    if (!hit) bad += 1;
    console.log(`${hit ? 'OK ' : 'BAD'} ${a.id}（期望 ${String(a.expect)} 实得 ${String(a.got)}）`);
  }
  console.log(`臂数 ${arms.length} · 不符 ${bad}`);
  process.exit(bad === 0 ? 0 : 1);
}

const MAIN = OPT('main') ?? 'main';
const LANDING = OPT('landing') ?? 'origin/main';
const git = (a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
let missing;
try {
  git(['rev-parse', '--verify', MAIN]);
  git(['rev-parse', '--verify', LANDING]);
  const out = git(['rev-list', '--count', `${MAIN}..${LANDING}`]);
  missing = /^\d+$/.test(out) ? Number(out) : UNJUDGED;
} catch (e) {
  console.error(`判不了：${String(e.message).split('\n')[0]}`);
  process.exit(3);
}
const verdict = baseCheck({ missing });
const short = (r) => git(['rev-parse', '--short', r]);
console.log(`基线=${MAIN}@${short(MAIN)} · 落地目标=${LANDING}@${short(LANDING)} · 落地目标未被基线包含的笔数=${missing}`
  + ` · 反向（基线独有的笔数）=${git(['rev-list', '--count', `${LANDING}..${MAIN}`])}`);
if (verdict === UNJUDGED) {
  console.error(`判不了：基线=${MAIN} 落地目标=${LANDING} 的计数读不到（缺的是一枚能答的输入，不是放行）`);
  process.exit(3);
}
if (verdict) {
  console.error(verdict);
  process.exit(2);
}
process.exit(0);
