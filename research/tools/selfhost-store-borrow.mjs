/**
 * 借 store（`HEYTA_CARRIER_LINK_STORE_FROM`）那条守卫的**判定本体** + 它自己的牙。
 *
 * 为什么单独一枚文件：这条守卫先前只住在 `selfhost-merge-carrier.mjs` 的 `borrowStore` 里，
 * 于是它只有**现场读数**（10-05 一次成功配对、一次退 3 响亮拒绝），没有臂 ——
 * 摘掉"两侧锁必须逐字节相同"那一行，没有任何东西会失败。这正是本仓立过两次的那条
 * （"只有通过读数、没有牙"）：读数证明它那天在工作，不证明它明天还在工作。
 *
 * 🔴 判定搬到这里、载体的 `borrowStore` 只留 fs 动作（软链 + 回读）。
 *    臂必须打在**跑的那份**上，所以载体 import 本文件而不是自己再写一遍 ——
 *    手搭一份哨兵判定 = 两套裁决标准（AGENTS §3.5 那条教训的自检版）。
 *
 * 射程（这枚文件判什么、不判什么）：
 *  - 判：一次软链该建 / 该跳 / 该响亮拒绝，以及拒绝的理由是哪一道守卫。
 *  - 不判：软链是否建成、链路是否通（那是 fs 回读，留在载体里，它的读数在每次跑的时候现打）。
 *  - 不判：`BORROW_SRC` 为空的情形 —— 那是调用方的开关（没给旋钮就整段不执行）。
 *
 * 用法：`node research/tools/selfhost-store-borrow.mjs --selftest`
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 两道拒绝守卫的理由标识（臂按这两个名字认领，不按整句话 —— 整句话改措辞不该让臂失效）。 */
export const R_LOCK = '两侧锁不是同一把';
export const R_SRC = '借来那一侧没有 .pnpm 那一层';
/** `sha256Of` 读不到时的取值。🔴 它**不是**一个哈希，所以"两个都读不到"不能当成"相同"。 */
export const UNREADABLE = '读不到';

const relLabel = (rel) => (rel === '' ? '（根）' : rel);

/**
 * 一次软链的判定。纯函数：不碰 fs、不读 env。
 *
 * 🔴 顺序是承重的，两个 skip 分支必须排在两道 refuse **之后**：
 *    "目标树本来就有 store"不等于"借来的那把锁是对的" —— 先跳过的话，
 *    一棵锁不同源的树会带着上一趟留下的 store 直接进落笔前门禁（假绿，而且比红难发现）。
 *
 * @param {{rel?: string, lockSrc: string, lockDst: string, srcHasPnpm: boolean,
 *          dstHasStore: boolean, dstNmExists: boolean}} w
 * @returns {{action: 'link'|'skip'|'refuse', reason?: string, detail?: string}}
 */
export function borrowStep({ rel = '', lockSrc, lockDst, srcHasPnpm, dstHasStore, dstNmExists }) {
  // 读不出数 ≠ 相等。这一档先于逐字节比较：旋钮指到一枚不是 pnpm 根的目录时，
  // 两侧可能同时读不到锁，而字符串比较会把"都不知道"判成"一致"。
  if (lockSrc === UNREADABLE || lockDst === UNREADABLE) {
    return {
      action: 'refuse',
      reason: R_LOCK,
      detail: `${relLabel(rel)}那侧的锁读不出来（借来方=${lockSrc} / 载体=${lockDst}）`
        + ` ⇒ "两侧逐字节相同"这个前提没被观测到，不软链`,
    };
  }
  if (lockSrc !== lockDst) {
    return {
      action: 'refuse',
      reason: R_LOCK,
      detail: `${relLabel(rel)}那侧 借来方的锁=${String(lockSrc).slice(0, 16)} `
        + `而 ${relLabel(rel)}载体的锁=${String(lockDst).slice(0, 16)} ⇒ 那边装出来的字节不是这一把锁的`,
    };
  }
  if (!srcHasPnpm) {
    return { action: 'refuse', reason: R_SRC, detail: `${relLabel(rel)}那侧的源里读不到 node_modules/.pnpm` };
  }
  if (rel === '' && dstHasStore) return { action: 'skip', reason: '目标树本来就有根 store，不覆盖' };
  if (rel !== '' && dstNmExists) return { action: 'skip', reason: '目标树那一层已存在，不覆盖' };
  return { action: 'link' };
}

/** 两枚"合法世界"：根与 e2e 各一枚，两枚都应当走到 link。 */
const GOOD = {
  root: { rel: '', lockSrc: 'aaaa'.repeat(16), lockDst: 'aaaa'.repeat(16), srcHasPnpm: true, dstHasStore: false, dstNmExists: false },
  e2e: { rel: 'e2e/', lockSrc: 'bbbb'.repeat(16), lockDst: 'bbbb'.repeat(16), srcHasPnpm: true, dstHasStore: false, dstNmExists: false },
};
const withOver = (base, over) => ({ ...base, ...over });

/**
 * control 五条 + 若干拒绝臂（每条**按理由认领**）。臂数由输出自己打印，文档里不许抄。
 * 臂的 expect 全是 `true`：实长得不是那一道守卫就是红。
 */
export function selftestArms() {
  const arms = [];
  const push = (name, expect, fn) => arms.push({ name, expect, got: fn() });
  /** 吃"根那一侧的输入"，给出判定结果。 */
  const step = (over) => borrowStep(withOver(GOOD.root, over));
  /** 吃"e2e 那一侧的输入"，给出判定结果。 */
  const stepE2e = (over) => borrowStep(withOver(GOOD.e2e, over));
  /** 断言"拒了，且理由就是这一道守卫"（吃**判定结果**，不吃原始输入 —— 喂错形状会当场红）。 */
  const refuses = (r, needle) => r.action === 'refuse' && r.reason === needle;

  // ── control：合法输入必须放行，而且放行的形状要能核对 ──
  push('control 根侧合法世界 ⇒ link', 'link', () => borrowStep(GOOD.root).action);
  push('control e2e 侧合法世界 ⇒ link', 'link', () => borrowStep(GOOD.e2e).action);
  push('control 目标已有根 store（锁同）⇒ skip 而不是 refuse', 'skip',
    () => step({ dstHasStore: true }).action);
  push('control e2e 那层已存在（锁同）⇒ skip', 'skip',
    () => stepE2e({ dstNmExists: true }).action);
  push('control 拒绝的理由里带两侧锁的 16 位指纹（可核对，不是一句"不匹配"）', true,
    () => {
      const r = step({ lockDst: 'cccc'.repeat(16) });
      return r.action === 'refuse' && r.detail.includes('aaaaaaa') && r.detail.includes('ccccccc');
    });

  // ── 拒绝臂：每一臂都必须由它那一道守卫拒绝 ──
  push(`A1 根锁不同 ⇒ ${R_LOCK}`, true, () => refuses(step({ lockSrc: 'dddd'.repeat(16) }), R_LOCK));
  // A2 单独钉"第二侧也判锁"：只判根那把的实现会在这里红。
  push('A2 根锁相同但 e2e 锁不同 ⇒ 同样 refuse（e2e 那一侧不是免检区）', true,
    () => refuses(stepE2e({ lockDst: 'eeee'.repeat(16) }), R_LOCK));
  push(`A3 源里没有 .pnpm（锁相同）⇒ ${R_SRC}`, true, () => refuses(step({ srcHasPnpm: false }), R_SRC));
  // A4/A5 是顺序的牙：skip 分支若被挪到 refuse 之前，这两臂各红一次。
  push('A4 目标本来就有根 store **且**锁不同 ⇒ 仍按锁 refuse（不许"本来就有"就跳过对账）', true,
    () => refuses(step({ dstHasStore: true, lockSrc: 'ffff'.repeat(16) }), R_LOCK));
  push('A5 e2e 那层已存在 **且** e2e 锁不同 ⇒ 仍按锁 refuse', true,
    () => refuses(stepE2e({ dstNmExists: true, lockSrc: 'gggg'.repeat(16) }), R_LOCK));
  // A6/A7 钉"读不出数 ≠ 相等"：旋钮指到一枚不是 pnpm 根的目录时，两侧可能同时读不到锁，
  //    而字符串比较会把"都不知道"判成"一致"。摘掉 borrowStep 里那一档，A7 当场红。
  push('A6 只有一侧锁读不到 ⇒ refuse R_LOCK（不许 link）', true,
    () => refuses(step({ lockSrc: UNREADABLE }), R_LOCK));
  push('A7 两侧锁都读不到 ⇒ 仍 refuse（相等必须是**被观测到**的相等）', true,
    () => refuses(step({ lockSrc: UNREADABLE, lockDst: UNREADABLE, srcHasPnpm: true }), R_LOCK));
  // A8 目标既已有根 store、源又缺 .pnpm：判定必须停在 refuse 而不是 skip ——
  //    这一臂挡的是"把环境坏掉的那趟伪装成没这一步"。
  push('A8 目标已有根 store 且源缺 .pnpm ⇒ refuse R_SRC（skip 不许抢在守卫前面）', true,
    () => refuses(step({ dstHasStore: true, srcHasPnpm: false }), R_SRC));

  return arms;
}

if (process.argv[2] === '--selftest') {
  const arms = selftestArms();
  let bad = 0;
  for (const a of arms) {
    const ok = a.got === a.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? '  ok' : 'RED '} ${a.name}（期望 ${JSON.stringify(a.expect)}，实得 ${JSON.stringify(a.got)}）`);
  }
  const refused = arms.filter((a) => a.name.startsWith('A')).length;
  console.log(`\n臂数 ${arms.length}（拒绝类 ${refused}，每条按理由认领）· 红 ${bad}`);
  if (bad) {
    console.error('❌ 借 store 那条守卫的自检不过 ⇒ 这条性质没有牙，不许拿它配对');
    process.exit(1);
  }
  console.log('✅ 借 store 守卫自检：control 与拒绝臂各由自己那道守卫认领（守卫两档 + 顺序 + "读不出数≠相等"各有臂）');
  process.exit(0);
}

const isEntry = process.argv[1]
  ? realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  : false;
if (isEntry) {
  console.log('用法：node research/tools/selfhost-store-borrow.mjs --selftest');
  console.log('（真载体的软链由 selfhost-merge-carrier.mjs 的 borrowStore 调用本文件的 borrowStep）');
}
