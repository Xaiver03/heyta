import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 `JWT_SECRET` 这条测试约定的**自执行版本**（§7 第 157 条）。
 *
 * 那条记录讲的是：`getJwtSecret()`（`src/auth.ts:48`）跑在**模块顶层**，所以任何
 * import 到它的 spec 在**加载期**就要读 `process.env.JWT_SECRET`；开发机上有
 * `server/.env` 兜着（`server/.gitignore:5` 忽略它），于是"主工作树全绿"这件事
 * 对干净检出（CI 的唯一形态）**不构成任何证据**。
 *
 * 那次清扫按既有约定补了 4 个文件，但**约定本身没有门禁** —— 结果 2026-10-03 09:38
 * 另一条笔落 `account-profile.spec.ts`（`7e299118`）时用的是 `import 'dotenv/config'`：
 * 同类缺陷的第 5 个成员，而且它躲不过单跑（干净检出上 `Test Files 1 failed` + `Tests no tests`）。
 *
 * ⚠️ 为什么放在 `server/tests` 而不是新起一段 `pnpm check`：这条约束的产物只有
 * server 的测试文件，`pnpm -r test` 已经是链的一部分 —— 再加一段等于把同一件事登记两次。
 *
 * 🔴 两条判据都必须**先去注释**（`stripComments`）再匹配。这不是格式洁癖：
 * 本仓库 `check:l4` 的读数差（纯 grep 101 vs 门禁 98）就是注释里的示例代码造成的，
 * 而 `account-profile.spec.ts` 现在正把 `import 'dotenv/config'` 写在注释里解释它为什么被换掉 ——
 * 不剥注释的写法会**把一句"我不用它"读成"我在用它"**，红给你一个根本没犯的文件。
 */

const SELF = 'test-env-contract.spec.ts';

/** 剥掉块注释与行注释；保留字符串与正则字面量（本文件的 needle 都带 `.`，误伤面很小）。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const specs = readdirSync(__dirname)
  .filter((f) => f.endsWith('.spec.ts') && f !== SELF)
  .map((f) => ({ name: f, code: stripComments(readFileSync(join(__dirname, f), 'utf8')) }));

describe('JWT_SECRET 测试约定（§7 第 157 条）', () => {
  it('前提：扫描确实够得着东西（读这个变量的 spec 不止一个）', () => {
    // 没有这条，"0 个违规"可能是"0 个被看见"（§7 元规则：判据要带分母）。
    // ⚠️ 标题里刻意不写文件数：那是会随下一笔提交漂的数字。
    expect(specs.length).toBeGreaterThan(50);
    const readers = specs.filter((s) => /process\.env\.JWT_SECRET/.test(s.code));
    expect(readers.length).toBeGreaterThan(5);
  });

  it('读 `process.env.JWT_SECRET` 的 spec，必须自己在 import 之前把它放好', () => {
    const readers = specs.filter((s) => /process\.env\.JWT_SECRET/.test(s.code));
    // `??=`（约定块）与 `= `（直接赋值，如 `auth-cache.spec.ts`）都算"自己放好了"。
    const carriers = new Set(
      readers
        .filter(
          (s) =>
            /JWT_SECRET\s*\?\?=/.test(s.code) ||
            /process\.env\.JWT_SECRET\s*=[^=]/.test(s.code),
        )
        .map((s) => s.name),
    );
    const missing = readers.map((s) => s.name).filter((n) => !carriers.has(n));
    expect(missing).toEqual([]);
  });

  it('没有任何 spec 靠 `dotenv` 拿测试输入（那条路在干净检出上是断的）', () => {
    const offenders = specs
      .filter((s) => /from ['"]dotenv\/config['"]|import ['"]dotenv\/config['"]|dotenv\.config\(/.test(s.code))
      .map((s) => s.name);
    expect(offenders).toEqual([]);
  });
});
