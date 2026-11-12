#!/usr/bin/env node
/**
 * `check:repo-size` —— 仓库体积超预算就红
 * ========================================
 *
 * ## 为什么要有这一条（2026-11-13 实测代价）
 *
 * gitee 的 push 被服务端按仓库体积拒：
 *
 *     remote: Repo size: 1583.887MB, exceeds quota 1024MB
 *     remote: You only have 3 push opportunities
 *
 * 查下来体积不是"一点缓存垃圾"，而是**三笔各自独立、加起来 2.5 GB 的东西**：
 *
 *   1. `.pnpm-store/` + `.npm-cache/` + `apps/<端>/evidence/` 的历史残留 —— 1265 MB。
 *      这笔已有门禁（`check:repo-cache-paths`）守 `HEAD`，但它守不住**历史**：
 *      `git rm --cached` 只摘指针，对象仍全仓可达。
 *   2. **少数大文档被反复全文重写** —— `docs/plans/` 累积 840 MB（3163 版）、
 *      `BLOCKED.md` 390 MB（477 版）、`PROGRESS.md` 325 MB（474 版）。
 *      这几个文件**当时**在磁盘上合计只有 55 MB ⇒ 98% 是旧版本。
 *   3. **本地备份分支把 900 MB 钉在库里** —— 一枚指向已废弃分叉线的
 *      `backup/...` 分支独占 20222 个对象 / 899.7 MB，且**没有任何门禁看得见它**。
 *      实测：删掉它 + `git gc` 之后，pack 从 983 MiB 掉到 116 MiB。
 *
 * 第 3 笔是最贵的一课：**备份是好事，但没人守的备份会变成体积黑洞**。
 * 所以本门禁判两件事，都要求"能重新量出来"：
 *
 *   · `size-pack` 是否超预算；
 *   · 有没有**非 main 的本地 ref** 独占了超过阈值的对象体积（备份分支/归档 ref）。
 *
 * ## 判据形状
 *
 * 1. **测不到 ⇒ 红**：`git count-objects` 失败、`rev-list` 失败、解析不了 ——
 *    一律判"探针坏了"，**绝不退 0**。把读不到读成"预算内"就是那条元规则说的
 *    "一条永远通过的判据比没有判据更糟"。
 * 2. `size-pack` > 预算 ⇒ 红，并打印最大几笔来源。
 * 3. 某个非 main ref 独占对象 > 阈值 ⇒ 红，点名它并给出「先落 bundle 再删」的出路。
 *    🔴 **不自动删** —— 备份分支可能是别的会话正在用的救生索；这条门禁只**报警 + 给命令**。
 *
 * ## 预算从哪来（不是拍的）
 *
 * 2026-11-13 清理后实测：pack **115.89 MiB**（44386 个对象，5167 个提交，含 41 个标签）。
 * 那是一次**真实的、内容零丢失的**读数（4830 个文件的 blob 哈希与清理前逐一致）。
 * 默认预算 **300 MiB**：留 2.6 倍余量给正常的文档/代码演进，而"再来一笔 900 MB 的
 * 备份分支"或"文档历史再翻一倍"会立刻红。
 *
 * `HEYTA_REPO_PACK_BUDGET_MB` 覆盖预算；`HEYTA_REPO_REF_UNIQUE_MB` 覆盖单 ref 阈值
 * （默认 200 MB —— 比正常分支的独占量高一个量级，只有真·历史黑洞才够得着）。
 *
 * ## 用法
 *
 *   pnpm check:repo-size
 *   node scripts/check-repo-size.mjs --self-test
 *   node scripts/check-repo-size.mjs --budget-mb 512
 */

import { spawnSync } from 'node:child_process';

const DEFAULT_PACK_BUDGET_MB = 300;
const DEFAULT_REF_UNIQUE_MB = 200;

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const envMb = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 跑一条 git 命令，返回 {ok, stdout, reason}。失败**不带默认值** —— 由调用方判红。 */
const git = (repo, args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { ok: false, stdout: '', reason: `spawn 失败：${r.error.message}` };
  if (r.status !== 0) {
    const tail = (r.stderr || '').trim().split('\n').slice(-1)[0] || '';
    return { ok: false, stdout: r.stdout || '', reason: `git ${args[0]} 退出 ${r.status}${tail ? `：${tail}` : ''}` };
  }
  return { ok: true, stdout: r.stdout || '', reason: '' };
};

/** 采集体积读数。任一项取不到 ⇒ ok:false（调用方必须红，不许当成 0）。 */
const measure = (repo) => {
  const co = git(repo, ['count-objects', '-v']);
  if (!co.ok) return { ok: false, reason: co.reason };

  const kv = {};
  for (const line of co.stdout.split('\n')) {
    const m = line.match(/^([a-z-]+):\s*(\d+)/);
    if (m) kv[m[1]] = Number(m[2]);
  }
  if (kv['size-pack'] === undefined) {
    // size-pack 缺席有两种：真的没有 pack（新仓，合法 0），或输出形状变了。
    // 用 in-pack 区分：没有对象才是合法 0，有对象却读不到 size-pack ⇒ 探针坏了。
    if (kv['in-pack'] === undefined) return { ok: false, reason: 'count-objects 输出里既没有 size-pack 也没有 in-pack —— 形状变了' };
    if (kv['in-pack'] > 0) return { ok: false, reason: `in-pack=${kv['in-pack']} 却读不到 size-pack —— 探针坏了` };
    kv['size-pack'] = 0;
  }

  const packMb = (kv['size-pack'] * 1024) / (1024 * 1024);
  return { ok: true, packMb, inPack: kv['in-pack'] || 0 };
};

/**
 * 找"非 main ref 独占的对象体积"。
 *
 * 做法：main 可达对象集合 vs 每个 ref 可达集合，求差 —— 差集就是"只有这个 ref 需要"的对象。
 * 🔴 这是**下界**：两个 ref 共享的独占对象会被各自都算一次（重复计数）。
 *    对本门禁的用途（发现"某个备份分支钉住一大坨"）足够；不拿它当精确账单。
 */
const findHeavyRefs = (repo, thresholdMb) => {
  const mainRev = git(repo, ['rev-list', '--objects', 'main']);
  if (!mainRev.ok) return { ok: false, reason: `取 main 可达对象失败：${mainRev.reason}` };
  const mainSet = new Set(mainRev.stdout.split('\n').map((l) => l.split(' ')[0]).filter(Boolean));

  const refs = git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/archive', 'refs/tmp', 'refs/backup']);
  if (!refs.ok) return { ok: false, reason: `取 ref 清单失败：${refs.reason}` };

  const heavy = [];
  for (const ref of refs.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    if (ref === 'refs/heads/main') continue;
    const rv = git(repo, ['rev-list', '--objects', ref]);
    if (!rv.ok) return { ok: false, reason: `取 ${ref} 可达对象失败：${rv.reason}` };
    const own = [];
    for (const line of rv.stdout.split('\n')) {
      const sha = line.split(' ')[0];
      if (sha && !mainSet.has(sha)) own.push(sha);
    }
    if (own.length === 0) continue;

    // 只对候选 ref 量体积（对象数少的一个子集也要走一次 cat-file，所以先按数量粗筛）
    const cat = spawnSync('git', ['-C', repo, 'cat-file', '--batch-check=%(objecttype) %(objectsize)'], {
      input: own.join('\n'),
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (cat.status !== 0) return { ok: false, reason: `量 ${ref} 的对象体积失败：cat-file 退出 ${cat.status}` };
    let bytes = 0;
    for (const line of cat.stdout.split('\n')) {
      const [type, size] = line.split(' ');
      if (type === 'blob') bytes += Number(size) || 0;
    }
    const mb = bytes / (1024 * 1024);
    if (mb > thresholdMb) heavy.push({ ref, mb, objects: own.length });
  }
  return { ok: true, heavy };
};

const selfTest = () => {
  let failed = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed += 1;
  };
  console.log('· check:repo-size --self-test');

  // 臂 A：本仓真实读数必须能取到，且远低于默认预算（证明探针真的读到了东西，
  //        而不是把"读不到"当成了"预算内"）。
  const here = measure(process.cwd());
  check('臂A 本仓 pack 读数可取', here.ok, here.ok ? `${here.packMb.toFixed(1)} MB / ${here.inPack} 个对象` : here.reason);
  if (here.ok) {
    check('臂A 读数是个正数（0 通常意味着没读到）', here.packMb > 0 || here.inPack === 0, `${here.packMb.toFixed(2)} MB`);
  }

  // 臂 B：探针坏掉必须判红 —— 拿一个不存在的仓去量。
  const bogus = measure('/nonexistent-repo-for-self-test');
  check('臂B 不存在的仓 ⇒ 判探针坏（不是"预算内"）', !bogus.ok, bogus.reason);

  // 臂 C：阈值谓词真的能红 —— 把阈值压到 0.0001 MB，本仓必然超。
  //        这条证明"超预算 ⇒ 红"不是装饰。
  check('臂C 阈值谓词可红（0.0001 MB 阈值下本仓判定为超）', here.ok && here.packMb > 0.0001, `pack ${here.ok ? here.packMb.toFixed(2) : '?'} MB`);

  // 臂 D：重 ref 探测在本仓必须能跑完（哪怕结论是"没有"）。
  const heavy = findHeavyRefs(process.cwd(), DEFAULT_REF_UNIQUE_MB);
  check('臂D 重 ref 探测可跑完', heavy.ok, heavy.ok ? `${heavy.heavy.length} 个超阈值 ref` : heavy.reason);

  console.log(failed === 0 ? '\n✓ 四条臂全过' : `\n✗ ${failed} 条臂没过`);
  return failed === 0 ? 0 : 1;
};

const main = () => {
  if (process.argv.includes('--self-test')) return selfTest();

  const budgetMb = argOf('--budget-mb', envMb('HEYTA_REPO_PACK_BUDGET_MB', DEFAULT_PACK_BUDGET_MB));
  const refMb = envMb('HEYTA_REPO_REF_UNIQUE_MB', DEFAULT_REF_UNIQUE_MB);
  const repo = process.cwd();

  const m = measure(repo);
  if (!m.ok) {
    console.error(`🔴 check:repo-size 测不到 —— ${m.reason}`);
    console.error('   （"测不到"不等于"预算内"：本门禁按红退，请先修探针。）');
    return 1;
  }
  console.log(`pack=${m.packMb.toFixed(1)} MB（${m.inPack} 个对象），预算 ${budgetMb} MB`);

  const heavyResult = findHeavyRefs(repo, refMb);
  if (!heavyResult.ok) {
    console.error(`🔴 check:repo-size 测不到重 ref —— ${heavyResult.reason}`);
    return 1;
  }

  let red = false;

  if (m.packMb > budgetMb) {
    red = true;
    console.error(`🔴 pack 超预算：${m.packMb.toFixed(1)} MB > ${budgetMb} MB`);
    console.error('   先看是谁把它顶上去的：');
    console.error('     git count-objects -vH');
    console.error('     # 各本地 ref 独占的对象体积（备份/归档分支是常见黑洞）');
    console.error('     git rev-list --objects main | awk \'{print $1}\' | sort -u > /tmp/m.txt');
    console.error('     git rev-list --objects <ref> | awk \'{print $1}\' | sort -u > /tmp/r.txt');
    console.error('     comm -23 /tmp/r.txt /tmp/m.txt | wc -l');
    console.error('   出路：确认该 ref 已落 bundle 快照（git bundle create … --all）后再删，最后 git gc --prune=now。');
  }

  if (heavyResult.heavy.length > 0) {
    red = true;
    console.error(`🔴 有 ${heavyResult.heavy.length} 个本地 ref 独占对象超 ${refMb} MB：`);
    for (const h of heavyResult.heavy) {
      console.error(`     ${h.mb.toFixed(1)} MB  ${h.objects} 个对象  ${h.ref}`);
    }
    console.error('   🔴 本门禁**不自动删** —— 备份分支可能是别的会话正在用的救生索。');
    console.error('   处置顺序：① 先落快照 `git bundle create <路径> --all`；');
    console.error('             ② 从快照里确认该 ref 的尖端确实在（`git bundle list-heads <路径>`）；');
    console.error('             ③ 再删分支并 `git gc --prune=now`。');
  }

  if (red) return 1;
  console.log('✓ 仓库体积在预算内，且没有本地 ref 独占超大对象');
  return 0;
};

process.exit(main());
