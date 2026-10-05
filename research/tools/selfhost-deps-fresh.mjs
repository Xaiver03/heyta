#!/usr/bin/env node
/**
 * `selfhost-deps-fresh.mjs` —— "载体这棵树上的 `node_modules` 是不是**当前那把锁**装出来的"
 * 这条判据的单一所有者。消费方是 `selfhost-land-main.mjs`（跑完整 `pnpm check` 之前那一道）。
 *
 * ## 为什么需要它
 * 落地那一刻做的事是：重算载体（`reset --hard` 到新的 main）→ 在载体上跑**完整链**。
 * 而重算只同步**提交**，不重装依赖：`node_modules` 是被 git 忽略的目录，它留在原地。
 * main 只要动过 `pnpm-lock.yaml`（或 `e2e/pnpm-lock.yaml`），那一趟链就跑在**上一把锁的依赖**上 ——
 * 症状可能是"模块找不到"（响亮，便宜），也可能是**装着旧版本跑过去**（安静，贵）：
 * 与 §7 第 27 条"APK 里是旧 JS bundle"、§8.111 ①"跑在旧载体上等于没跑"是同一个失效形态，
 * 只是这一枚落在依赖层。
 *
 * ## 判据从哪读
 * pnpm 在每次安装时把当次那把锁**逐字**复制成 `node_modules/.pnpm/lock.yaml`，
 * 所以"装的时候用的是哪把锁"有物证，不用猜时间戳。两棵树各判一次：根与 `e2e/`
 * （`e2e` **刻意不在**根工作区内，它自带一份 lockfile —— 见 `e2e/pnpm-workspace.yaml`）。
 *
 * 🔴 **空测量不许算通过**（这条是被今天的实测逼出来的）：我第一版用 shell 量同一件事，
 * `set -- $pair` 没把两个路径拆开 ⇒ 两边 sha 都是空串 ⇒ `same=YES`。
 * 于是"什么都没读到"读起来与"两边一致"完全一样。所以下面每一条都要求
 * sha 是 **64 位十六进制**，且两把锁**成对**存在 —— 缺任何一枚就是"判不了"，不是"新鲜"。
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import process from 'node:process';

/** 要成对判的树。少判一棵 = 那一棵可以带着旧依赖跑完整链而没人报红。 */
export const PAIRS = [
  { name: '根工作区', lock: 'pnpm-lock.yaml', installed: 'node_modules/.pnpm/lock.yaml' },
  { name: 'e2e 套件', lock: 'e2e/pnpm-lock.yaml', installed: 'e2e/node_modules/.pnpm/lock.yaml' },
];

const sha256OrNull = (path) => {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    return { error: e?.code === 'ENOENT' ? '不存在' : `读不到（${e?.code ?? e?.message}）` };
  }
  if (buf.length === 0) return { error: '是 0 字节文件（空内容也会"两边相等"）' };
  return { sha: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
};

/**
 * @returns {{error: string} | {rows: Array<{name: string, lockSha: string, installedSha: string, same: boolean, lockBytes: number, installedBytes: number}>, stale: string[]}}
 */
export function depsFresh(dir, pairs = PAIRS) {
  if (!dir) return { error: '没给目录 ⇒ 不知道判的是哪棵树（不是"都新鲜"）' };
  if (!pairs.length) return { error: '要判的锁清单是空的 ⇒ 这不是"没有旧依赖"，是没东西被判' };
  const rows = [];
  const stale = [];
  for (const p of pairs) {
    const l = sha256OrNull(join(dir, p.lock));
    if (l.error) return { error: `${p.name} 的锁 ${p.lock} ${l.error}（${dir}）` };
    const i = sha256OrNull(join(dir, p.installed));
    // 🔴 没有 `.pnpm/lock.yaml` 只说明**这棵树从没装过依赖**，不说明装得对。
    //    把它当成"新鲜"就会让完整链跑在一个连 node_modules 都没有的树上。
    if (i.error) return { error: `${p.name} 读不到安装指纹 ${p.installed}（${dir}）：${i.error} ⇒ 依赖没装或形状变了，判不了 ≠ 新鲜` };
    const same = l.sha === i.sha;
    if (!same) stale.push(p.name);
    rows.push({ name: p.name, lockSha: l.sha, installedSha: i.sha, same, lockBytes: l.bytes, installedBytes: i.bytes });
  }
  return { rows, stale };
}

export const freshReading = (r) => r.rows
  .map((x) => `${x.name} ${x.same ? '✅同源' : '❌不同源'} lock=${x.lockSha.slice(0, 12)}(${x.lockBytes}B) installed=${x.installedSha.slice(0, 12)}(${x.installedBytes}B)`)
  .join(' · ');

/* ── 自检：夹具都是临时目录，只写自己造的那几个文件 ─────────────────── */
export function depsFreshSelftest() {
  const problems = [];
  const errs = [];
  const root = mkdtempSync(join(tmpdir(), 'heyta-deps-fresh-'));
  const put = (rel, text) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  try {
    const LOCK = 'lockfileVersion: 9.0\nimporters: {}\n';
    const OTHER = 'lockfileVersion: 9.0\nimporters:\n  .:\n    dependencies: { left: { version: 1 } }\n';

    for (const p of PAIRS) put(p.lock, LOCK);
    for (const p of PAIRS) put(p.installed, LOCK);
    let r = depsFresh(root);
    if (r.error) problems.push(`control 应当出数却报错：${r.error}`);
    else if (r.stale.length) problems.push(`control 判成不同源：${freshReading(r)}`);
    else if (r.rows.length !== PAIRS.length) problems.push(`control 只判了 ${r.rows.length} 枚，应当 ${PAIRS.length}`);
    errs.push(`臂 control 问题 ${(r.error ? 1 : 0) + (r.stale?.length ?? 0)} 条（应当 0）`);

    /* 臂 1：只装了根、e2e 从没装过 ⇒ 必须"判不了"，不许"根锁绿了就放行" */
    rmSync(join(root, PAIRS[1].installed), { force: true });
    r = depsFresh(root);
    if (!r.error) problems.push('臂1 e2e 没装依赖却出了读数 ⇒ 半棵树可以带旧依赖跑完整链');
    else if (!r.error.includes(PAIRS[1].installed)) problems.push(`臂1 没点名是没装的那一枚：${r.error}`);
    errs.push(`臂1 问题 ${r.error ? 0 : 1} 条（应当 0）`);

    /* 臂 2：两边都有但内容不同 ⇒ 必须不同源，且两个 sha 都要打出来 */
    put(PAIRS[1].installed, OTHER);
    r = depsFresh(root);
    if (r.error) problems.push(`臂2 应当出数却报错：${r.error}`);
    else if (!r.stale.includes(PAIRS[1].name)) problems.push('臂2 换了 e2e 的安装指纹却仍判同源 ⇒ 这条判据没牙');
    else if (r.rows.some((x) => !x.lockSha || !x.installedSha)) problems.push('臂2 的 sha 有空的');
    errs.push(`臂2 问题 ${(r.error ? 1 : 0) + (r.stale?.includes(PAIRS[1].name) ? 0 : 1)} 条（应当 0）`);

    /* 臂 3：锁自己没了 ⇒ 判不了（这不是"没装"，是"不知道该怎么算新"） */
    put(PAIRS[0].lock, '');
    r = depsFresh(root);
    if (!r.error) problems.push('臂3 根锁是空文件却出了读数 ⇒ 0 字节也会"两边相等"');
    errs.push(`臂3 问题 ${r.error ? 0 : 1} 条（应当 0）`);

    /* 臂 4：清单被清空 ⇒ 必须报错，不许读成"没有旧依赖" */
    put(PAIRS[0].lock, LOCK);
    r = depsFresh(root, []);
    if (!r.error) problems.push('臂4 清单为空却返回了"新鲜" ⇒ 空集不是安全');
    r = depsFresh('');
    if (!r.error) problems.push('臂4 没给目录却返回了"新鲜"');
    errs.push(`臂4 问题 ${(depsFresh(root, []).error ? 0 : 1) + (depsFresh('').error ? 0 : 1)} 条（应当 0）`);

    /* 臂 5：真实腿 —— 对**分支检出**（只读）跑一次，证明这台机器上这枚判据读得到真东西。
     *        刻意不判载体：那是与并行那条线共用的树，读它不该由自检顺手做。 */
    const branch = '/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-selfhost';
    const live = depsFresh(branch);
    let liveReading = '';
    if (live.error) {
      problems.push(`真实腿判不了（分支检出）：${live.error}`);
      liveReading = `真实腿：判不了（${live.error}）`;
    } else {
      liveReading = `真实腿（分支检出）：${freshReading(live)}${live.stale.length ? ` ⇒ ${live.stale.length} 枚不同源` : ''}`;
    }
    errs.push(`臂5 问题 ${live.error ? 1 : 0} 条（应当 0）`);

    /* 收尾复绿：把夹具复原成 control，再判一次 ⇒ 证明变异没留在对象里 */
    for (const p of PAIRS) put(p.installed, LOCK);
    r = depsFresh(root);
    errs.push(`收尾复绿 问题 ${(r.error ? 1 : 0) + (r.stale?.length ?? 0)} 条（应当 0）`);
    if (r.error || r.stale.length) problems.push(`收尾复绿失败：${r.error ?? freshReading(r)}`);

    return { problems, errs, liveReading };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('selfhost-deps-fresh.mjs')) {
  const args = process.argv.slice(2);
  const dirFlag = args.find((a) => a.startsWith('--dir='));
  if (args.includes('--selftest')) {
    const s = depsFreshSelftest();
    s.errs.forEach((e) => console.log(`  ${e}`));
    console.log(`  ${s.liveReading}`);
    if (s.problems.length) {
      console.log(`🔴 自检 ${s.problems.length} 条问题：\n - ${s.problems.join('\n - ')}`);
      process.exit(2);
    }
    console.log('✅ 依赖新鲜判据自检：control 同源 + 五臂各按预期（没装≠新鲜 / 换锁必红 / 空文件必红 / 空清单必红 / 真实腿可读）+ 收尾复绿');
    process.exit(0);
  } else if (dirFlag) {
    const r = depsFresh(dirFlag.slice(6));
    if (r.error) {
      console.log(`🔴 ${r.error}`);
      process.exit(2);
    }
    console.log(freshReading(r));
    process.exit(r.stale.length ? 3 : 0);
  }
  console.log('用法：node research/tools/selfhost-deps-fresh.mjs --selftest | --dir=<树根>');
  process.exit(0);
}
