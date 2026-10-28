import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 负责人 2026-10-28 拍板（H-4「3-B」）：`AUTOMATION_ENTITLEMENT_MODE` 写错**不再**是每个请求各自
 * 撞一次 500，而是端口绑定之前就把进程拒了。这一族断言读的是 `src/index.ts` 的**形状**，
 * 因为这条腿的判据是"进程起没起"，vitest 里真起一次进程不会比它更可信 —— 真起的那三条读数
 * （写错 rc=1、未配置照常起、`official` 照常起）记在计划文末③那一节。
 * 摘掉 `boot()` 里那一句调用 ⇒ 第一枚用例红；把它挪到 `start()` 之后 ⇒ 第二枚断言红。
 */
describe('automation entitlement mode is verified before the port is bound', () => {
  const source = readFileSync(path.join(root, 'src/index.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const boot = source.slice(source.indexOf('const boot = async'));

  it('calls the resolver exactly once inside the boot gate', () => {
    expect(boot.match(/resolveAutomationEntitlementMode\(\)/g)?.length).toBe(1);
  });

  it('runs the check before start() so a typo cannot bind the port', () => {
    expect(boot.indexOf('resolveAutomationEntitlementMode()')).toBeGreaterThanOrEqual(0);
    expect(boot.indexOf('resolveAutomationEntitlementMode()')).toBeLessThan(boot.indexOf('return start()'));
  });

  it('refuses to start with a named reason instead of serving 500s', () => {
    expect(boot).toContain('AUTOMATION_ENTITLEMENT_MODE is invalid');
    expect(boot).toContain('process.exit(1)');
  });

  it('keeps an unset value legal — that is the refused-with-a-reason posture, not a crash', () => {
    expect(boot).toContain('mode === undefined');
  });
});
