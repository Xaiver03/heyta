import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 运维脚本落地的**全量明文产物**必须以 0600 写出（批次 E / 工单 E5 的一半）。
 *
 * `server/scripts/recover-user.ts` 的产物是某个用户解密之后的完整应用状态
 * （文件头自己就写着 "the output file holds the user's COMPLETE plaintext data"）。
 * 修之前它是 `writeFileSync(outPath, json, 'utf8')` —— 在默认 umask 022 下落成 **0644**，
 * 同机任何账户可读；而这台机器上还跑着同步服务、备份与别人的会话。
 *
 * 这里钉三件事，缺一件都只是自我安慰：
 *   1. 现在这个文件里**每一处** `writeFileSync` 都带着 `mode: 0o600`，且写完后紧跟一次
 *      `chmodSync`（`mode` 只在**创建**时生效，覆盖已存在的旧文件要靠 chmod —— 第 3 腿量过）；
 *   2. 规则抓得到修之前那个真实形状。样本用**常驻 fixture**而不是 `git show HEAD:` ——
 *      HEAD 一旦提交就变成修好的版本，那条腿会自己变红（判据不许把仓库当前状态写死）；
 *   3. 权限位是**现场量出来的**，不是从文档或 MDN 读来的。
 */

/** 只认**调用形状**：去缩进后以 `writeFileSync(` 开头、且没带 mode。注释行天然被排除。 */
function bareWriteCalls(source: string): string[] {
  return source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('writeFileSync(') && !/mode:\s*0o600/.test(l));
}

describe('明文产物权限（E5）', () => {
  const scriptRel = 'server/scripts/recover-user.ts';

  /** vitest 的 cwd 是 `server/`，两种解析都试，不靠猜。 */
  const scriptAbs = (): string => {
    for (const p of [resolve(process.cwd(), scriptRel), resolve(process.cwd(), '..', scriptRel)]) {
      if (existsSync(p)) return p;
    }
    throw new Error(`找不到 ${scriptRel}（cwd=${process.cwd()}）—— 判据的路径前提坏了`);
  };

  const current = readFileSync(scriptAbs(), 'utf8');

  it('🔴 每一处 writeFileSync 都带 mode:0o600，并且写完立刻 chmod', () => {
    const calls = current
      .split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /\bwriteFileSync\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    // 前提：这个脚本确实有产物写出点；0 处意味着它被改了形状，本条判据就悬空了。
    expect(calls.length, `${scriptRel} 里找不到 writeFileSync —— 判据已悬空`).toBeGreaterThan(0);

    for (const { l, n } of calls) {
      expect(l, `${scriptRel}:${String(n)} 的写出点没有 mode: 0o600`).toMatch(/mode:\s*0o600/);
    }
    const chmodLines = current
      .split('\n')
      .filter((l) => /\bchmodSync\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    expect(
      chmodLines.length,
      '没有 chmodSync —— `mode` 只在新建时生效，产物已存在（比如重跑恢复）时权限不会被改窄',
    ).toBeGreaterThanOrEqual(calls.length);
  });

  it('🔴 判据有牙齿：修之前的真实形状必须被同一条规则判违规', () => {
    // 逐字抄自 2026-10-03 修改前的 recover-user.ts。规则不变，变的只是喂进去的文本。
    const preFixShape = [
      'const recover = async (): Promise<void> => {',
      '  writeFileSync(outPath, JSON.stringify(state, null, 2), "utf8");',
      "  console.log('Wrote recovered state to ' + outPath);",
      '};',
    ].join('\n');

    expect(
      bareWriteCalls(preFixShape).length,
      '旧形状（无 mode 的 writeFileSync）没被抓到 ⇒ 规则是空的，绿了也不说明任何东西',
    ).toBe(1);
    // 同一条规则对修好的形状必须放行。
    expect(bareWriteCalls('  writeFileSync(outPath, body, { encoding: "utf8", mode: 0o600 });')).toEqual(
      [],
    );
    // 注释里提到这个名字不算命中（只认调用形状）。
    expect(bareWriteCalls('// writeFileSync(outPath, data, "utf8") 这是注释里的旧写法')).toEqual([]);
    // 当前文件按同一条规则必须零违规。
    expect(bareWriteCalls(current)).toEqual([]);
  });

  it('🔴 现场量一次权限位：新建落成 rw-------，而 mode 对已存在的文件确实无效', () => {
    // 只读文档不算证据 —— 这一腿就是用来证明第二个 `chmodSync` 是承重的。
    const tmp = join(tmpdir(), `heyta-e5-mode-probe-${String(process.pid)}.tmp`);
    try {
      writeFileSync(tmp, 'x', { encoding: 'utf8', mode: 0o600 });
      expect(statSync(tmp).mode & 0o777, '新建时 mode 没生效').toBe(0o600);

      // 已存在且当前更窄：mode 会被忽略（不会把它改宽），文件保持 0600。
      writeFileSync(tmp, 'y', { encoding: 'utf8', mode: 0o644 });
      expect(statSync(tmp).mode & 0o777).toBe(0o600);

      // 已存在且当前更宽（上一版留下的 0644 产物）：mode **不会**收窄它 ⇒ 必须 chmod。
      chmodSync(tmp, 0o644);
      expect(statSync(tmp).mode & 0o777).toBe(0o644);
      writeFileSync(tmp, 'w', { encoding: 'utf8', mode: 0o600 });
      expect(
        statSync(tmp).mode & 0o777,
        'mode 居然收窄了已存在的文件 ⇒ chmodSync 那条不是承重的，这条判据要重估',
      ).toBe(0o644);
      chmodSync(tmp, 0o600);
      expect(statSync(tmp).mode & 0o777).toBe(0o600);
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
  });
});
