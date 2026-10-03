import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 日志里不许出现可识别个人信息（批次 E / 工单 E7）。
 *
 * 来历：隐私政策自己写着「开启另外写盘时日志为明文，而当前代码里**没有**日志轮转与
 * 到期删除机制」，`server/docs/backup-and-recovery.md` 也只管数据库备份 —— 也就是说
 * 一旦某行日志带上了邮箱，它就是一个**没有保留期、没有人负责清除**的副本。
 * 而注销账号那条真删路径（`DELETE /api/account` 级联）够不着它。
 *
 * 实测的两处（2026-10-03 改掉）：`admin.routes.ts` 的「解锁用户」与「强制登出」
 * 都把 `user.email` 原样打进 `Logger.info`。这不是"少写一个字段"的问题：
 * GDPR 第四条(1) 下邮箱是直接标识符，而管理端日志的读者是运营者之外还可能有
 * 日志聚合系统 —— 那条通道上没有任何删除承诺。
 *
 * 所以这里钉三件事：
 *   1. `server/src` 现在**一处都不许有**（正向判据）；
 *   2. 这个匹配器**抓得到我们真的犯过的那个形状**（拿 `git show HEAD:` 的历史版本喂它 ——
 *      没有这条，"全 0"可能只是正则坏了，本轮第一版探针就坏过一次：`[^)]*` 撞上
 *      `String(user.id)` 的右括号，于是两条真违规被报成"零命中"）；
 *   3. 它**不是见谁都红**（改掉之后的那行必须不命中）。
 */

/** 一行里既有 `Logger.` 又把 email/phone 的**值**插进模板 ⇒ 违规。 */
function piiInLogLines(source: string): string[] {
  const hits: string[] = [];
  for (const line of source.split('\n')) {
    if (!/\bLogger\.[a-zA-Z]+\(/.test(line)) continue;
    // 只认"插值里带 email/phone 这个名字"的形状；`"non-existent email"` 那种纯文案不算。
    if (!/\$\{[^}]*\b(?:email|phoneNumber|phone)\b/i.test(line)) continue;
    hits.push(line.trim());
  }
  return hits;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      out.push(...walk(p));
    } else if (name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** `git show` 要在仓库根跑；vitest 的 cwd 是 `server/`，两种都试一次。 */
function showAtHead(relPath: string): string {
  for (const cwd of [process.cwd(), resolve(process.cwd(), '..')]) {
    try {
      return execFileSync('git', ['show', `HEAD:${relPath}`], { cwd, encoding: 'utf8' });
    } catch {
      // 换下一个 cwd
    }
  }
  throw new Error(`拿不到 HEAD:${relPath} —— 这条判据的前提是它在 HEAD 里`);
}

/** Find the last real pre-fix source in history so this regression probe keeps
 * its teeth after the fix itself is committed. */
function showHistoricalVersion(relPath: string): string {
  for (const cwd of [process.cwd(), resolve(process.cwd(), '..')]) {
    try {
      const commits = execFileSync('git', ['log', '--format=%H', '--all', '--', relPath], {
        cwd,
        encoding: 'utf8',
      }).trim().split(/\s+/).filter(Boolean);
      for (const commit of commits) {
        const source = execFileSync('git', ['show', `${commit}:${relPath}`], {
          cwd,
          encoding: 'utf8',
        });
        if (piiInLogLines(source).length >= 2) return source;
      }
    } catch {
      // Try the repository root if Vitest was started from server/.
    }
  }
  throw new Error(`找不到 ${relPath} 的历史违规版本`);
}

describe('日志里不许出现可识别个人信息（E7）', () => {
  const SRC_DIR = resolve(process.cwd(), process.cwd().endsWith('server') ? 'src' : 'server/src');

  it('前提：扫描确实覆盖了 server 的源码（0 个文件 = 探针坏了，不是"没有泄漏"）', () => {
    const files = walk(SRC_DIR);
    expect(files.length, `在 ${SRC_DIR} 下只数到 ${files.length} 个 .ts —— 先怀疑路径`).toBeGreaterThan(50);
    const totalBytes = files.reduce((n, f) => n + readFileSync(f, 'utf8').length, 0);
    expect(totalBytes).toBeGreaterThan(100_000);
  });

  it('🔴 server/src 里一处都不许把 email/phone 的值打进日志', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC_DIR)) {
      for (const line of piiInLogLines(readFileSync(f, 'utf8'))) {
        offenders.push(`${f.replace(SRC_DIR, 'server/src')}: ${line}`);
      }
    }
    expect(
      offenders,
      `这些日志行把可识别个人信息写进了没有保留期、也没有删除机制的日志：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('🔴 判据自己有牙齿：把本轮改掉的那两行原文喂回去，必须逐行判红', () => {
    // 真源用 HEAD 的那份管理端路由 —— 这就是"这次改动是承重的"的唯一证明方式，
    // 而不是我自己编一个假想违规。
    const historical = showHistoricalVersion('server/src/admin/admin.routes.ts');
    expect(historical.length).toBeGreaterThan(1000);
    const hits = piiInLogLines(historical);
    expect(
      hits.length,
      `HEAD 版的管理端路由里有我们刚改掉的 email 插值，匹配器却一条都没抓到（命中 ${hits.length}）⇒ 正则坏了`,
    ).toBeGreaterThanOrEqual(2);
    // 抓到的必须**只有邮箱那两条**，不能把别的行也拖进来。
    for (const h of hits) expect(h).toMatch(/user\.email/);
  });

  it('反向：改掉之后的形状不该被判红（否则这条规则是"见谁都红"）', () => {
    expect(piiInLogLines('Logger.info(`Admin unlocked user #${String(user.id)}`);')).toEqual([]);
    // 纯文案里出现 "email" 这个词不算泄漏（这两句在 HEAD 里就是合规的）。
    expect(
      piiInLogLines("Logger.debug('Magic link requested for non-existent email');"),
    ).toEqual([]);
    // 正向对照：同一条规则对真违规必须命中。
    expect(
      piiInLogLines('Logger.info(`Admin unlocked user #${String(user.id)} (${user.email})`);').length,
    ).toBe(1);
  });
});
