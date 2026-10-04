#!/usr/bin/env node
/**
 * `scripts/check-selfhost-entry-command.mjs` 里 **R8（漏登记哨兵）** 的变异台。
 *
 * 为什么单独一份：R8 是 2026-10-05 新加的判据，而"任何新增判据先注入验证它能失败"是硬约束
 * （AGENTS §8.3「不能失败的检查没有价值」）。它同时管**两个方向**（多出来没人管的抄件 / 登记的豁免
 * 读不到那个形状了）加**一个分母**（探针没接上时不许按"全仓干净"过），三件事各要一条自己的臂，
 * 不然"红过"只证明了其中一件。
 *
 * 做法：把门禁复制成 `scripts/.r8-arm-copy.mjs`（同目录 ⇒ 它自己算出来的 repoRoot 不变），
 * 在**副本**上做字面替换后跑，真门禁一个字节都不动；每臂跑完立刻删副本（`finally`）。
 * ⚠️ 副本是未跟踪文件 ⇒ `git grep` 不搜它 ⇒ 它不会进入 R8 自己的普查分母（不然每一臂都会多一条
 *    "副本没登记"的红，那是装置在判自己）。
 *
 * 用法：node research/tools/selfhost-entry-command-arms.mjs            # 跑全部臂（条数由末尾自己打）
 *      退出码：0 = 全臂符合期望；1 = 有臂不符合（判据没牙 / 守卫被摘弱 / 缺臂）；2 = 装置自己坏了。
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(ROOT, 'scripts/check-selfhost-entry-command.mjs');
const COPY = join(ROOT, 'scripts/.r8-arm-copy.mjs');

const results = [];
const record = (name, ok, reading) => {
  results.push({ name, ok, reading });
  console.log(`${ok ? '  ok' : 'RED '} ${name}\n      ${reading}`);
};

/** 跑一次副本，回 `{rc, out}`（stdout+stderr 合并；不看 rc 单独判，判据看的是**打印出来的话**）。 */
function runCopy() {
  let rc = 0;
  let out = '';
  try {
    const r = execFileSync(process.execPath, [COPY], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    out = r;
  } catch (e) {
    rc = e.status ?? 1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  return { rc, out };
}

/** 那条判据的**计数**：只数 [R8] 的红行，别把 R1–R7 的红算进来（它们各自有别的臂）。 */
const r8Reds = (out) => (out.match(/\[R8\]/g) || []).length;
const naming = (out, file) => {
  const lines = out.split('\n');
  return lines.filter((l) => l.includes('[R8]') && l.includes(file)).length;
};

/**
 * 自己量一次普查分母（A5 用）。
 * 🔴 必须**自己调同一个命令**而不是去读门禁打印的那个数字：门禁的 `notes` 只在零失败时才打印，
 *    一旦有红，"当前几枚"这个读数就整体消失 —— A5 那一臂恰好总是有红。
 *    命令、参数、`-I`、`cwd` 都照门禁本体抄，否则量的就不是同一个东西。
 */
function censusWith(shape) {
  try {
    return execFileSync('git', ['grep', '-I', '-l', '-E', shape], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    const out = String(e.stdout ?? '').trim();
    if (!out) throw new Error(`自量分母的 git grep 没命中（形状写坏了？），这不是"0 枚"：${shape}`);
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  }
}

function mutate(from, to, expectHits = 1) {
  const src = readFileSync(COPY, 'utf8');
  const parts = src.split(from);
  if (parts.length - 1 !== expectHits) {
    throw new Error(`替换锚点在门禁源码里出现 ${parts.length - 1} 次（期望 ${expectHits}）⇒ 装置与被检对象漂了：${from.slice(0, 60)}`);
  }
  writeFileSync(COPY, parts.join(to));
}

/** 把副本恢复到"刚从真门禁抄过来"的状态。 */
const fresh = () => writeFileSync(COPY, readFileSync(GATE, 'utf8'));

const SELF_FILE = 'scripts/check-selfhost-entry-command.mjs';
const PHASE2 = 'docs/plans/phase-2-multi-platform.md';
const DEPLOY = 'docs/runbooks/deployment.md';

try {
  if (!existsSync(GATE)) throw new Error(`读不到门禁本体：${GATE}`);

  // A0 正向对照：原样副本必须绿。没有这条，后面几臂"红"可能只是副本根本跑不起来。
  //    `baseCount > 0` 是这条臂的第二半：**绿的时候必须报得出当前分母是几枚** ——
  //    否则"R8 全仓干净"就是一个没有分母的结论（A4 判的正是同一个毛病的另一头）。
  fresh();
  let baseCount = 0;
  {
    const { rc, out } = runCopy();
    const m = out.match(/R8 全仓普查：命中 (\d+) 枚/);
    baseCount = m ? Number(m[1]) : 0;
    record('A0 原样副本 ⇒ 退 0、一条 [R8] 红都没有、且现量报出普查分母',
      rc === 0 && r8Reds(out) === 0 && baseCount > 0,
      `rc=${rc} · [R8] 红 ${r8Reds(out)} 条 · 当前分母=${baseCount} 枚（A5 不读这个数：有红时 notes 整体不打印，那一臂自己量）`);
  }

  // A1 漏登记方向：把 phase-2 那枚豁免改成不存在的文件名 ⇒
  //    ① 真文件从三张表里掉了出去（该红），② 改名后的豁免没有对象（也该红）。
  fresh();
  mutate(`file: '${PHASE2}',`, "file: 'docs/plans/这枚文件不存在.md',", 1);
  {
    const { rc, out } = runCopy();
    record('A1 摘掉一份抄件的登记 ⇒ 点名那枚真文件的"不在三张表里"红',
      rc === 1 && naming(out, PHASE2) >= 1 && /不在 SCAN_SET/.test(out),
      `rc=${rc} · [R8] 共 ${r8Reds(out)} 条 · 点名 ${PHASE2} 的 ${naming(out, PHASE2)} 条`);
  }

  // A2 豁免对象消失方向（上面那条改名的红里同时带着，这里单独认领它的措辞）。
  {
    const { out } = runCopy();
    record('A2 同一次改名 ⇒ 还有一条"豁免已经读不到那个形状"的红（两个方向各有措辞）',
      /豁免已经读不到那个形状/.test(out),
      `[R8] 共 ${r8Reds(out)} 条（A1 的那条 + 这条），措辞命中=${/豁免已经读不到那个形状/.test(out)}`);
  }

  // A3 needle 失效方向：文件还登记着，但它声称的形状在文件里读不到。
  fresh();
  mutate(`needle: 'docker-compose.monitoring.yml -f docker-compose.build.yml up',`,
    "needle: '这一串在文件里根本不存在_ZZZ',", 1);
  {
    const { rc, out } = runCopy();
    record('A3 登记的 needle 读不到 ⇒ 红"豁免的承重断言不成立"，且不许把它误报成漏登记',
      rc === 1 && /豁免的承重断言不成立/.test(out) && naming(out, DEPLOY) >= 1 && !/不在 SCAN_SET/.test(out),
      `rc=${rc} · [R8] ${r8Reds(out)} 条 · 点名 ${DEPLOY} ${naming(out, DEPLOY)} 条 · 漏登记措辞出现=${/不在 SCAN_SET/.test(out)}`);
  }

  // A4 分母方向：探针什么都读不到时，不许按"全仓干净"过。
  fresh();
  mutate("const COPY_SHAPE = 'docker compose.*docker-compose\\\\.build\\\\.yml';",
    "const COPY_SHAPE = '这一串永不可能出现在任何文件_ZZZ';", 1);
  {
    const { rc, out } = runCopy();
    record('A4 普查形状换成永不命中 ⇒ 红在"没有分母（探针没接上）"，不是静默通过',
      rc === 1 && /没有分母|分母读出来一半就断了/.test(out),
      `rc=${rc} · [R8] ${r8Reds(out)} 条 · 措辞命中=${(out.match(/没有分母|分母读出来一半就断了/) || ['（无）'])[0]}`);
  }

  // A5 POSIX 形状那一坑的定点回归：`[^\\n]` 在 git grep 里是"除反斜杠和 n 之外"，
  //    它会把带 monitoring 的那行**静默**判不命中 ⇒ 分母自己缩小。
  /* 🔴 这一臂第一版的期望是**错的**，写在这里是因为它暴露了装置的一个盲区：
   *    我原本断"不红、但普查行报出的命中枚数比 A0 少"。实测 rc=1，而且根本没有普查行 ——
   *    `notes` 是在 `failures.length > 0` 那个分支**之后**才打印的，所以**任何一条红都会把
   *    "当前分母是几枚"那行一起吞掉**。也就是说：形状写坏时现形的方式不是"数字变小"，
   *    而是"deployment.md 还在表里，普查却读不到它" ⇒ 报成"豁免没有对象"。
   *    这条红是**响的**（点名文件 + 让人删登记或改形状），这正是我们要钉的行为。
   *    分母自己缩小多少这件事不靠门禁的打印 —— 本臂**自己用同一个 git grep 量两种形状**，
   *    并把差集打出来（写死 11/12 就是把当时的形状当判据，R7 批评过的那个错）。 */
  fresh();
  mutate("const COPY_SHAPE = 'docker compose.*docker-compose\\\\.build\\\\.yml';",
    "const COPY_SHAPE = 'docker compose[^\\\\n]*docker-compose\\\\.build\\\\.yml';", 1);
  {
    const { rc, out } = runCopy();
    const wide = censusWith('docker compose.*docker-compose\\.build\\.yml');
    const narrow = censusWith('docker compose[^\\n]*docker-compose\\.build\\.yml');
    const lost = wide.filter((f) => !narrow.includes(f));
    record('A5 形状退回 JS 的 [^\\n] 写法 ⇒ 响亮地红在"豁免没有对象"，不是静默把那份抄件当不存在',
      rc === 1 && naming(out, DEPLOY) >= 1 && /豁免已经读不到那个形状/.test(out) &&
        narrow.length < wide.length && lost.includes(DEPLOY),
      `rc=${rc} · 点名 ${DEPLOY} 的红 ${naming(out, DEPLOY)} 条 · 自量分母：正写法 ${wide.length} 枚 / 坏写法 ${narrow.length} 枚 · 坏写法丢掉=${lost.join(',') || '（无）'}`);
  }

  // A6 自指那一臂：摘掉门禁给自己的那条登记 ⇒ 它必须把自己判成漏登记。
  fresh();
  {
    const src = readFileSync(COPY, 'utf8');
    const start = src.indexOf('  {\n    // 🔴 这条是**自指**的');
    const end = src.indexOf("  {\n    file: '" + PHASE2 + "',");
    if (start < 0 || end < 0 || end <= start) throw new Error('摘除自登记条目的两段锚点没对上 ⇒ 门禁的表结构变了，本臂要跟着改');
    writeFileSync(COPY, src.slice(0, start) + src.slice(end));
  }
  {
    const { rc, out } = runCopy();
    record('A6 摘掉门禁给自己的那条登记 ⇒ 它把自己判成漏登记（自指不是豁免的借口）',
      rc === 1 && naming(out, SELF_FILE) >= 1,
      `rc=${rc} · [R8] ${r8Reds(out)} 条 · 点名 ${SELF_FILE} ${naming(out, SELF_FILE)} 条`);
  }

  // 收尾复原对照：全部跑完再原样跑一次，证明**变异没漏进真门禁**。
  const gateNow = readFileSync(GATE, 'utf8');
  const clean = !gateNow.includes('这枚文件不存在') && !gateNow.includes('_ZZZ') && gateNow.includes(`file: '${SELF_FILE}',`);
  record('C1 真门禁本体没被任何一臂改到（三个变异串都不在，自登记那条在）', clean,
    `门禁字节数=${gateNow.length} · 变异串残留=${['这枚文件不存在', '_ZZZ'].filter((s) => gateNow.includes(s)).join(',') || '无'}`);
} catch (e) {
  console.error(`❌ 装置自己坏了（这不是判据红，是探针没接上）：${e.message}`);
  process.exitCode = 2;
} finally {
  if (existsSync(COPY)) rmSync(COPY);
}

const bad = results.filter((r) => !r.ok).length;
console.log(`R8 变异台：臂数 ${results.length} · 红 ${bad} · 副本已删=${!existsSync(COPY)}`);
/* 🔴 臂数下限就是本文件里 record() 的条数（A0–A6 + C1 = 8）。写死它是刻意的：
 *    一臂被注释掉或抛异常中断时，"红 0"不能读成"全绿" —— 缺臂 = 装置坏了（退 1 并报出来）。 */
if (bad > 0 || results.length < 8) {
  console.log('❌ 有臂不符合期望 ⇒ R8 的牙没钉牢（或者装置与被检对象漂了）');
  process.exit(1);
}
console.log('✅ R8 三个方向各有臂打红过：漏登记、豁免失效、分母读不出；另钉住一处 POSIX 形状自己缩小分母的坑');
