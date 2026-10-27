#!/usr/bin/env node
/**
 * 「第三版」那一栏的变异台架（注册登录标准套件线，2026-10-28）
 * ==========================================================
 *
 * 要证明的只有一件事：`check-worktree-exceptions.mjs` 新加的 ㉑–㉚ 这十枚臂**不是恒真的**。
 * 做法是把尺复制一份、在副本上注入"写错的实现"，再看臂红不红、红的是不是该红的那几枚。
 *
 * 🔴 为什么在副本上打、不动工作树：这一棵树现在有三条线在同时写（04:1x 现量：
 * `scripts/check-undo-receipt.mjs` 的 mtime 距当时 2 分钟）。拿真文件做变异，
 * 一旦还原失手就会把别人正在读的那份改坏 —— 副本没有这个问题。
 *
 * 六种注入形状都对着一种**真实写错的形状**（不是随便删字符）：
 *   M1 谓词恒真      ⇒ ㉓㉔㉗ 必须红（否则这一栏会把正常暂存报成雷，假红到没人看）
 *   M2 谓词恒假      ⇒ ㉑㉒㉕㉖ 必须红（否则雷就洗白了，这一栏等于没写）
 *   M3 索引解析取错列 ⇒ ㉘ 必须红
 *   M4 HEAD 解析取错列 ⇒ ㉙ 必须红
 *   M5 索引解析不剔合并条目 ⇒ ㉘ 必须红
 *   M6 配对器静默截断 ⇒ ㉚ 必须红
 *
 * 用法：node research/tools/mutate-worktree-third-version.mjs
 * 退出：0 = 六种注入全部有牙；1 = 有哪一种打空过（臂在实现写错时照样绿）；2 = 探针自身不合。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const GATE = path.join(ROOT, 'scripts', 'check-worktree-exceptions.mjs');

/** 每一种注入：名字 + 原文片段 + 换成什么 + 哪些臂必须红（按臂号匹配）。 */
const MUTATIONS = [
  {
    name: 'M1 谓词恒真（什么都判成雷）',
    from: "if (idx !== head && (wt === null || idx !== wt)) rows.push",
    to: 'if (true) rows.push',
    expectArms: ['㉓', '㉔', '㉗'],
  },
  {
    name: 'M2 谓词恒假（雷全被洗白）',
    from: "if (idx !== head && (wt === null || idx !== wt)) rows.push",
    to: 'if (false) rows.push',
    expectArms: ['㉑', '㉒', '㉕', '㉖'],
  },
  {
    name: 'M3 索引行解析取到 stage 那一列',
    from: "    if (meta[2] !== '0') continue; // 合并中的条目（stage 1/2/3）不在这一栏的射程里\n    out.set(rec.slice(tab + 1), meta[1]);",
    to: "    if (meta[2] !== '0') continue;\n    out.set(rec.slice(tab + 1), meta[2]);",
    expectArms: ['㉘'],
  },
  {
    name: 'M4 HEAD 行解析取到类型那一列',
    from: '    out.set(rec.slice(tab + 1), meta[2]);\n  }\n  return out;\n}\n\n/**\n * 「索引里躺着一版谁都不在看的东西」',
    to: '    out.set(rec.slice(tab + 1), meta[1]);\n  }\n  return out;\n}\n\n/**\n * 「索引里躺着一版谁都不在看的东西」',
    expectArms: ['㉙'],
  },
  {
    name: 'M5 索引行解析不剔合并条目',
    from: "    if (meta[2] !== '0') continue; // 合并中的条目（stage 1/2/3）不在这一栏的射程里",
    to: '    // 不剔了',
    expectArms: ['㉘'],
  },
  {
    name: 'M6 配对器不等长时静默截断',
    from: '  if (paths.length !== shas.length) {\n    throw new Error(`zip：路径 ${paths.length} 枚 vs 哈希 ${shas.length} 枚 ⇒ 顺序对不上，不配拿来配对`);\n  }\n',
    to: '',
    expectArms: ['㉚'],
  },
];

const pristine = readFileSync(GATE, 'utf8');
if (pristine.length < 4000) {
  console.error(`🔴 母本读回来只有 ${pristine.length} 字节 ⇒ 探针不合，整轮作废（不拿坏母本回答"有没有牙"）`);
  process.exit(2);
}

const work = mkdtempSync(path.join(tmpdir(), 'heyta-third-version-mut-'));
let toothless = 0;
try {
  for (const m of MUTATIONS) {
    // 注入必须**打得到**母本：打不到就等于"什么都没改"，那种"绿"是自证。
    if (!pristine.includes(m.from)) {
      console.log(`🔴 ${m.name} ｜ 母本里找不到要替换的那段 ⇒ 这一发根本没打进去`);
      toothless += 1;
      continue;
    }
    const mutated = pristine.replace(m.from, m.to);
    if (mutated === pristine) {
      console.log(`🔴 ${m.name} ｜ 替换后与母本逐字节相同 ⇒ 没打进东西`);
      toothless += 1;
      continue;
    }
    const file = path.join(work, 'mutated-gate.mjs');
    writeFileSync(file, mutated);
    let rc = 0;
    let out = '';
    try {
      out = execFileSync('node', [file, '--self-test'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      rc = e.status === undefined ? 2 : e.status;
      out = String(e.stdout ?? '') + String(e.stderr ?? '');
    }
    const red = out
      .split('\n')
      .filter((l) => l.startsWith('🔴'))
      .map((l) => l.slice(2).trim());
    const missing = m.expectArms.filter((tag) => !red.some((l) => l.startsWith(tag)));
    const ok = rc !== 0 && missing.length === 0;
    if (!ok) toothless += 1;
    console.log(
      `${ok ? '✅' : '🔴'} ${m.name}\n     rc=${rc} ｜ 红 ${red.length} 条${missing.length > 0 ? ` ｜ 该有的臂没红：${missing.join(' ')}` : ''}`,
    );
    for (const l of red.slice(0, 3)) console.log(`     · ${l.slice(0, 108)}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n注入形状 ${MUTATIONS.length} 种 ｜ 打空 ${toothless} 种`);
process.exit(toothless === 0 ? 0 : 1);
