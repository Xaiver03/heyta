import { execFileSync } from 'node:child_process';
const files = process.argv.slice(2);
const PAY = /refund|renew|checkout|WX_|WECHAT|payment-entry|ADR-0053|0053-|退款|续费|下单|收银台|应付金额|促销码|支付链接/i;
for (const f of files) {
  const d = execFileSync('git', ['diff', '-U3', '--', f], { encoding: 'utf8' });
  if (!d.trim()) continue;
  const hunks = d.split(/^@@/m).slice(1);
  hunks.forEach((h, i) => {
    const lines = h.split('\n');
    const added = lines.filter((l) => l.startsWith('+'));
    const removed = lines.filter((l) => l.startsWith('-'));
    const hits = lines.filter((l) => /^[+-]/.test(l) && PAY.test(l)).length;
    const first = (added[0] ?? '').slice(0, 78);
    console.log(`${hits ? 'MINE?' : 'other'} | ${f} | h${i + 1} | +${added.length}/-${removed.length} | hits=${hits} | ${first}`);
  });
}
