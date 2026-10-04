#!/usr/bin/env node
/**
 * `research/tools/selfhost-red-attribution.mjs` —— "载体门禁红了，这条红是不是本批造成的"的**唯一判据**。
 *
 * 为什么需要这一层（2026-10-04 23:4x 现量）：main **自己就红** —— 干净 main 检出 `2c69c57d`
 * 上 `check:docs` 退 1，点名 `docs/plans/calendar-profile-handoff.md:1187` 指向
 * `trash-and-archive.md §10.87`，而那份文档在 main 上只到 §10.17；这两枚文件**都不在本批写集里**。
 * 没有配对层时，载体脚本把这种红读成"解法没修好"而**永远拒绝落笔** ——
 * 屏幕上句句真话（"载体的纯 fs 门禁没全绿，先修解法"），但实际没有解法可修。
 * 这正是 Goal 第 1 项写的那句："关闭判据不是 check 全量绿…必须逐条仍可归属到非本批才算。"
 *
 * ## 放行条件（三条同时成立，缺一不可）
 *
 *  1. 这道门**有缺陷行提取式**（`defectRe`）。没有 ⇒ 判不了 ⇒ 不放行。
 *     🔴 "没法归属"永远不许被读成"归属过了" —— 那是 §8.122 那族假 0 的第四个面目。
 *  2. 同一道门在**干净 main** 上也退非 0，且载体点名的**每一条**缺陷行都能在原样的 main 输出里
 *     逐字找到。**逐字**是刻意的：只比"条数相同"或"文件名出现过"会造出一条恒真的判据 ——
 *     别人把自己的那条缺陷改到另一行（`:1187` → `:1204`）时，那是**另一件事**，必须重新判。
 *  3. 载体点名的缺陷集合**非空**。红而不点名任何缺陷 ⇒ 提取式没接上 ⇒ 判不了（不放行）。
 *
 * 满足 ⇒ 返回 `ok:true` 并交出**可复核的读数**（调用方把它打进提交说明）：
 * 放行 ≠ 吸收 —— 那条红仍然在 main 上，只是不由本批修，也不许被本批的"绿"掩埋。
 *
 * ## 拒绝的形状（各有专属臂，见 `--selftest`）
 *   · main 退 0 ⇒ 这条红是**本批带进去的**；
 *   · 有只在载体的缺陷 ⇒ 同上；
 *   · 载体红而不点名 ⇒ 探针没接上。
 *
 * `--selftest` 12 条（control 三条 + 放行方向一条 + **五条按理由认领的拒绝臂** + 聚合两条），
 * 全部合成输入（不碰 git、不碰树）。拒绝臂认领理由而不是只认领"没放行"，理由见 `attributionArms` 里那段。
 */

/**
 * @param {{gate:string, carrierRc:number, carrierOut:string, mainSha:string,
 *          mainRc:number, mainOut:string, defectRe?: RegExp}} i
 * @returns {{ok:boolean, why:string}}
 */
export function attributeRed({ gate, carrierRc, carrierOut, mainSha, mainRc, mainOut, defectRe }) {
  const lines = (s) => String(s ?? '').split('\n');
  const defects = (s) => (defectRe ? lines(s).filter((l) => defectRe.test(l)) : []);
  if (!defectRe) {
    return { ok: false, why: `${gate}：这道门没有缺陷行提取式 ⇒ 判不了（不放行）` };
  }
  if (carrierRc === 0) return { ok: false, why: `${gate}：载体没红 ⇒ 不需要归属（调用方走错分支了）` };
  if (mainRc === 0) {
    return { ok: false, why: `${gate}：载体退 ${carrierRc} 而 main(${mainSha.slice(0, 8)}) **退 0** ⇒ 这条红是本批带进去的` };
  }
  const c = defects(carrierOut);
  const m = defects(mainOut);
  if (c.length === 0) {
    return { ok: false, why: `${gate}：载体退 ${carrierRc} 但**一条缺陷都没点名** ⇒ 提取式没接上，判不了（不放行）` };
  }
  const onlyCarrier = c.filter((l) => !m.includes(l));
  if (onlyCarrier.length) {
    return {
      ok: false,
      why: `${gate}：有 ${onlyCarrier.length} 条缺陷**只在载体**（main 同道门退 ${mainRc}，逐字对不上）：` +
        onlyCarrier.slice(0, 3).map((l) => l.trim()).join(' | '),
    };
  }
  return {
    ok: true,
    why: `${gate}：载体退 ${carrierRc}、点名 ${c.length} 条，main(${mainSha.slice(0, 8)}) 同道门退 ${mainRc} ` +
      `且这 ${c.length} 条逐条都在（main 共点名 ${m.length} 条）⇒ **非本批**（不代改、不吸收，那条红仍在 main 上）`,
  };
}

/** 载体红集 → 逐条归属；任何一条不通过就整体不放行。 */
export function attributionVerdict(results) {
  const bad = results.filter((r) => !r.ok);
  if (bad.length === 0) return null;
  return bad.map((r) => r.why).join('\n  - ');
}

/* ═══════════════════════════════════════════════════════════════════
 * --selftest：control + 五臂（每条断言具体形状，不是"跑过了"）
 * ═══════════════════════════════════════════════════════════════════ */
const RE = /^   [^\s]+:\d+/;
const DEFECT_A = '   docs/plans/calendar-profile-handoff.md:1187  ->  docs/plans/trash-and-archive.md §10.87';
const DEFECT_B = '   docs/plans/other.md:12  ->  docs/adr/0099-x.md §3.4';
const carrierOut = (rows) => `检查 537 处跨文档章节引用。\n🔴 发现 ${rows.length} 处**失效的章节引用**：\n\n${rows.join('\n')}\n`;
const mainOut = (rows) => `检查 532 处跨文档章节引用。\n🔴 发现 ${rows.length} 处**失效的章节引用**：\n\n${rows.join('\n')}\n`;
const call = (over = {}) => attributeRed({
  gate: 'check:docs',
  carrierRc: 1,
  carrierOut: carrierOut([DEFECT_A]),
  mainSha: '2c69c57d300190a4e4f72a22f05de68e2191853b',
  mainRc: 1,
  mainOut: mainOut([DEFECT_A]),
  defectRe: RE,
  ...over,
});

export function attributionArms() {
  const arms = [];
  const push = (name, expect, got) => arms.push({ name, expect, got });
  /* 🔴 拒绝类一律**按拒绝理由认领**（比对 `why` 里的 needle），不是只比对"没放行"。
   * 理由与 §8.141 那条同一：这里有多道守卫会拒同一件事，只断言"拒了"的臂对"某道守卫失效"是盲的
   * —— 例如摘掉"没有提取式"那道，输入仍会被"红而不点名"那道兜住。 */
  const refuses = (r, needle) => !r.ok && r.why.includes(needle);

  const ctrl = call();
  push('control 放行', true, ctrl.ok);
  push('control 的读数说"非本批"', true, /非本批/.test(ctrl.why));
  push('control 的读数带上 main 的 SHA', true, /2c69c57d/.test(ctrl.why));
  // A5 的正向那一半：main 缺陷**更多**仍然算非本批（别人的债比我们还多，不该反过来挡我们）。
  push('A5 main 红得更多（载体 ⊂ main）仍放行', true, call({ mainOut: mainOut([DEFECT_A, DEFECT_B]) }).ok);
  // 拒绝臂：每臂认领自己那道守卫的措辞。
  push('A1 main 退 0 ⇒ 由"本批带进去"那道拒', true, refuses(call({ mainRc: 0, mainOut: '✅ 全绿\n' }), '这条红是本批带进去的'));
  push('A2 只在载体的一条 ⇒ 由"逐字对不上"那道拒', true, refuses(call({ carrierOut: carrierOut([DEFECT_A, DEFECT_B]) }), '只在载体'));
  push('A3 红而不点名 ⇒ 由"提取式没接上"那道拒', true, refuses(call({ carrierOut: '检查 537 处。\n❌ 出了点问题\n' }), '一条缺陷都没点名'));
  push('A4 没有提取式 ⇒ 由"没有提取式"那道拒', true, refuses(call({ defectRe: undefined }), '没有缺陷行提取式'));
  // A6 逐字比较的牙：把行号挪一格就不是同一条缺陷（恒真的"文件出现过"会放行）。
  push('A6 同一文件但行号不同 ⇒ 不放行', true, refuses(
    call({ mainOut: mainOut(['   docs/plans/calendar-profile-handoff.md:1204  ->  docs/plans/trash-and-archive.md §10.87']) }), '只在载体'));
  push('A6b 同一行号但目标不同 ⇒ 不放行', true, refuses(
    call({ mainOut: mainOut(['   docs/plans/calendar-profile-handoff.md:1187  ->  docs/plans/trash-and-archive.md §10.13']) }), '只在载体'));
  push('verdict 聚合：一条不过就整体不过', true,
    attributionVerdict([call(), call({ mainRc: 0, mainOut: '✅\n' })]) !== null);
  push('verdict 聚合：全过返回 null', true, attributionVerdict([call(), call()]) === null);
  return arms;
}

if (process.argv[2] === '--selftest') {
  const arms = attributionArms();
  let bad = 0;
  for (const a of arms) {
    const ok = a.got === a.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? '  ok' : 'RED '} ${a.name}（期望 ${JSON.stringify(a.expect)}，实得 ${JSON.stringify(a.got)}）`);
  }
  console.log(`\n臂数 ${arms.length} · 红 ${bad}`);
  if (bad) {
    console.error('❌ 归属判据自检不过 ⇒ 不用它放行');
    process.exit(1);
  }
  console.log('✅ 归属判据自检：control + 放行/拒绝两向 + 行号与目标各一格（逐字比较的牙）');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('selfhost-red-attribution.mjs')) {
  console.log('用法：node research/tools/selfhost-red-attribution.mjs --selftest');
  console.log('（真载体的红集归属由 selfhost-merge-carrier.mjs 调用 attributeRed / attributionVerdict）');
}
