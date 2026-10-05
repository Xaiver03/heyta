/**
 * `check` 链与哨兵共用的**1 分钟负载**读数口（唯一所有者）。
 *
 * 为什么要有这个文件：同一句"从 `sysctl -n vm.loadavg` 里取 1 分钟那一位"原先住在两处 ——
 * `selfhost-land-main.mjs` 的 `parseLoadRaw`（JS）与哨兵 v3 的 `sysctl | tr | awk '{print $1}'`（shell）。
 * 抄件必漂，而这一条漂过的账已经登记过：**§7 第 168 条**——`tr -d '{} '` 把分隔空格一起删掉
 * （侥幸还对），而"修它"的那版用 `$2` ⇒ **静默读成 5 分钟那位**，于是"负载高"与"负载低"
 * 都可能是同一个坏探针的读数。两个形状各修过一次，判据却有两份。
 *
 * 🔴 自检是**结构性的**，不是注释：`load1Selfcheck()` 喂一份**三位互不相同**的合成样本，
 *    要求读回第一位，并要求空读数**不是**一个数（`Number('')` === 0，而 0 恰好是"最安静"——
 *    §8.122 那族假 0 的第三个面目）。读不到数一律交 NaN，由调用方按"判不了"处理，
 *    **绝不当成"负载低"**。
 */
import { execFileSync } from 'node:child_process';

/** `vm.loadavg` 的原始输出 → 1 分钟位；形状不对就给 NaN（不猜、不当 0）。 */
export function parseLoad1(raw) {
  const t = String(raw ?? '').replace(/[{}]/gu, '').trim().split(/\s+/u)[0] ?? '';
  return /^\d+(?:\.\d+)?$/u.test(t) ? Number(t) : Number.NaN;
}

/** 读系统当前负载的 1 分钟位（读不到 ⇒ NaN，调用方按判不了处理）。 */
export function readLoad1() {
  let raw = '';
  try {
    raw = execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' });
  } catch (e) {
    return { raw: `sysctl 失败：${e?.message ?? e}`, value: Number.NaN };
  }
  return { raw: raw.trim(), value: parseLoad1(raw) };
}

/**
 * 探针自检：坏了返回**原因**，好的返回 null。
 * 三条都要真判：取错位、把空读成 0、把整串读成一个不可能的巨数 —— 三种坏法的共同症状都是"看着像读数"。
 */
export function load1Selfcheck() {
  const one = parseLoad1('{ 11.11 22.22 33.33 }');
  if (one !== 11.11) return `合成样读到 ${one}，而 1 分钟位应当是 11.11 ⇒ 取的不是第一位`;
  if (Number.isFinite(parseLoad1(''))) return '空读数被解析成了数 ⇒ 会把它当成"负载低"放行';
  if (Number.isFinite(parseLoad1('{ abc def ghi }'))) return '非数字样本被解析成了数';
  const whole = parseLoad1('{ 1.5 2.5 3.5 }');
  if (whole !== 1.5) return `三位样本读到 ${whole}（应当 1.5）`;
  return null;
}
