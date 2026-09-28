/**
 * 夹具校验：committed 的 `fixtures/*.golden.json` 必须与**现在重建**的结果逐字节相同。
 *
 * 这一条测试是整条链路的关键接点。它一红就说明三件事之一：
 *
 *   1. 选择器/契约改了（改了字段、排序、截断）→ 夹具过期；
 *   2. 加密或 AAD 改了 → 密文过期；
 *   3. 有人手改过夹具文件（那就等于把"四端的锁"换成了"四端的假设"）。
 *
 * ## 怎么重建
 *
 * ```sh
 * UPDATE_FIXTURES=1 pnpm --filter @heyta/widget-core test tests/fixtures.spec.ts
 * ```
 *
 * 重建后必须**单独提交夹具的 diff 并看一遍** —— 四端的期望值都挂在它上面。
 * 这也是为什么重建走"环境变量显式打开"而不是"自动写"：
 * 默认必须是**校验**，不能是"悄悄改掉期望值让测试变绿"。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildFixtureFiles } from './fixture-source.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

describe('golden fixture 与真实选择器一致', () => {
  const rebuilt = buildFixtureFiles();

  for (const [name, content] of Object.entries(rebuilt)) {
    it(`${name} 逐字节等于重建结果`, () => {
      const path = join(FIXTURES, name);

      if (UPDATE) {
        writeFileSync(path, content, 'utf8');
        return;
      }

      let committed: string;
      try {
        committed = readFileSync(path, 'utf8');
      } catch {
        throw new Error(
          `夹具 ${name} 不存在。先重建：\n` +
            `  UPDATE_FIXTURES=1 pnpm --filter @heyta/widget-core test tests/fixtures.spec.ts`,
        );
      }

      // 逐字节比较，不做 JSON 深比较 —— 见 fixture-source.ts 文件头：
      // 明文文件的空白是**给人看的**，加密用的是 compact JSON。
      // 这里比的是"文件该长什么样"，所以必须比字节。
      expect(committed).toBe(content);
    });
  }

  it('🔴 重建是纯函数：连跑两次结果相同', () => {
    // 这条挡的是"夹具里混进了 Date.now() / Math.random() / 遍历顺序不稳定"。
    // 真出现那种问题时，上面三条的失败会表现得像"夹具过期"，
    // 而重建一次以后**又变绿** —— 然后下次再红。这条把那种情况直接定性。
    const first = buildFixtureFiles();
    const second = buildFixtureFiles();
    expect(second).toEqual(first);
  });
});
