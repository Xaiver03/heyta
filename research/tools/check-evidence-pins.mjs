#!/usr/bin/env node
// 证据锚点对账（**只读**）：`apps/web/evidence/**/README.md` 里成对写的「png 文件名 + 32 位 md5」
// 必须等于工作树（= 版本库那一份，前提是该目录干净）里那枚字节的 md5。
//
// 为什么不挂进 `pnpm check`：2026-10-04 06:4x 首跑量出 **15 处 pin / 12 对 / 3 错**，
// 三处错全在 `apps/web/evidence/calendar-day/`（日历线 `5e23b7bf` 那批），根因不是 pin 过期，
// 是那三张图的页头印着"今天"（`Sat, 10/3`）⇒ **含当前日期的截图按构造就不可能有稳定 md5**。
// 代改别人的 pin = 替他们重新"看过"那张图；挂进门禁 = 让别人那批红挡住这条线的绿。
// 所以这里只做**探针 + 自检**，判据交给 pin 的所有者。
//
// 用法：
//   node research/tools/check-evidence-pins.mjs                          # 默认 apps/web/evidence
//   node research/tools/check-evidence-pins.mjs apps/mobile/evidence     # 换目录
//   node research/tools/check-evidence-pins.mjs --selftest               # 证明这条判据会失败
//
// 退出码：0 = 全部对上；1 = 有对不上的 pin / 一处 pin 都没数到 / 自检失败。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** README 里的一行 pin：同一段落里先出现 `xxx.png`、后出现 32 位十六进制。 */
const PAIR = /([A-Za-z0-9][A-Za-z0-9 ._\-]*\.png)[^\n]{0,80}?([0-9a-f]{32})/g;

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

function collect(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else if (e.name === 'README.md') {
      for (const m of fs.readFileSync(p, 'utf8').matchAll(PAIR)) {
        out.push({ file: path.join(path.dirname(p), m[1]), pin: m[2] });
      }
    }
  }
  return out;
}

function audit(dir) {
  const bad = [];
  let ok = 0;
  const pairs = collect(dir);
  for (const { file, pin } of pairs) {
    if (!fs.existsSync(file)) { bad.push({ file, pin, real: '（文件不存在）' }); continue; }
    const real = md5(file);
    if (real === pin) ok++;
    else bad.push({ file, pin, real });
  }
  return { total: pairs.length, ok, bad };
}

/**
 * 自检：拿一条**对得上**的 pin，把末位十六进制改一个字符再比 —— 必须判成不匹配。
 * 不做这一步，"0 处不匹配"分不清"锚点都在"和"比较器根本没比"。
 */
function selftest(dir) {
  const positives = collect(dir).filter(({ file, pin }) => fs.existsSync(file) && md5(file) === pin);
  if (positives.length === 0) { console.log('SELFTEST=skip（没有可对上的 pin 当阳性样本）'); return 1; }
  const s = positives[0];
  const flipped = s.pin.slice(0, 31) + (s.pin[31] === 'a' ? 'b' : 'a');
  const caught = md5(s.file) !== flipped;
  console.log(`SELFTEST=${caught ? 'ok' : 'FAIL'} 阳性样本=${path.relative(ROOT, s.file)} 篡改末位后${caught ? '被判为不匹配（判据有牙）' : '仍被判为匹配 ⇒ 比较器没有牙'}`);
  return caught ? 0 : 1;
}

const args = process.argv.slice(2);
const target = path.join(ROOT, args.find((a) => !a.startsWith('--')) || 'apps/web/evidence');
if (!fs.existsSync(target)) { console.error(`❌ 目录不存在：${target}`); process.exit(1); }
if (args.includes('--selftest')) process.exit(selftest(target));

const r = audit(target);
console.log(`证据目录：${path.relative(ROOT, target)} — pin ${r.total} 处，对上 ${r.ok}，不匹配 ${r.bad.length}`);
for (const b of r.bad) console.log(`  ❌ ${path.relative(ROOT, b.file)}\n       pin=${b.pin}\n       real=${b.real}`);
if (r.total === 0) { console.error('❌ 一处 pin 都没数到 —— 这本身就该红（要么路径错，要么配对正则失效）'); process.exit(1); }
process.exit(r.bad.length === 0 ? 0 : 1);
