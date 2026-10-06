/**
 * 批次 E5 —— `recover-user` 的解密 + 重放路径（此前**零测试**）
 * ==========================================================
 *
 * 这个文件存在的理由不是"补个覆盖率"。运维脚本 `server/scripts/recover-user.ts`
 * 的产物是**某个用户解密后的完整明文状态**，而它头上那句
 * `Status: UNVERIFIED against real encrypted data` 之所以挂在那里，是因为那条路
 * 确实一条测试都没有 —— 偏偏它是"账号被坏导入抹掉之后唯一的找回办法"。
 *
 * 🔴 把真代码跑起来之后照出两个真缺陷（不是补测试补出来的）：
 *
 *   1. **批量删除会在还原文件里复活。** 脚本自己抄了一份 prisma `select`，比快照那份
 *      少两列。少了 `entityIds`，一条批量 DEL（`deleteTasks` 把全集存进 `entityIds`、
 *      标量 `entityId` 只是第 0 个）就只删得掉第一个 ——
 *      现量：`task-2` 删掉了，**`task-3` 还在**，而用户接下来会把这份文件"导入"回去。
 *      这正是上游 #8340 在快照路径上修过的同一个 bug 的**第二份抄件**。
 *   2. **用过 REPAIR 的账号根本恢复不了。** 少了 `repairBaseServerSeq`，重放器按设计抛
 *      `LEGACY_REPAIR_REPLAY_UNSUPPORTED` —— 报的是"legacy"，而库里那条 REPAIR 是**有
 *      因果基线的新式** REPAIR。症状从"数据不对"升级成"这单做不了"，更难归因。
 *
 * 修法是把两列都收回来，而且**不再抄第二份**：脚本直接用快照路径导出的
 * `REPLAY_OPERATION_SELECT`（同一份列集合 ⇒ 结构上不可能再漂）。
 *
 * ## 为什么这里能用真密码学
 *
 * `decryptPayloads` 走的是 `@heyta/sync-core` 真的 Argon2id 派生与真的 `decryptBatch`。
 * 以前它测不到，是因为脚本用 `require` 摸隔壁包的**源码**拿函数（只有
 * `ts-node --transpile-only` 解析得动，签名也没人核），而 `main()` 挂在模块顶层 ——
 * `import` 一下这个脚本就会去读 argv、连库、再 `disconnect()`。现在 `main()` 有
 * `require.main === module` 门，纯函数才进得来。这条本身也有判据（见最后两条）。
 *
 * ⚠️ 这个文件证明的是**加解密往返 + 重放映射**这一段。它没有证明"线上那个账号能救回来"
 *    （那要一次对着真实库的演练），所以脚本头上"先对着一个已知账号试"的告诫**留着**。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { encryptBatch } from '@heyta/sync-core';
import type { ReplayOperationRow } from '../src/sync/op-replay';
import type { RecoveredOperationRow } from '../scripts/recover-user';

// 🔴 数据库是"一碰就炸"的桩：这一组全程只测纯函数。任何一次真实查询都说明有东西
//    在测试里自己跑起来了 —— 以前 `main()` 就是这么被 import 触发的。
vi.mock('../src/db', () => ({
  prisma: new Proxy(
    {},
    {
      get() {
        throw new Error('这条判据不许碰数据库');
      },
    },
  ),
  disconnectDb: vi.fn(),
}));

const { replayOpsToState } = await import('../src/sync/op-replay');
const { REPLAY_OPERATION_SELECT } = await import('../src/sync/services/snapshot-generation.service');
// `type` 只能写在 import 语句里，不能写在解构里 —— 值与类型因此分两行拿。
const { buildReplayRows, decryptPayloads, RECOVER_ARTIFACT_OPERATION_SELECT } = await import('../scripts/recover-user');

const KEY = 'e5-roundtrip-passphrase';
const WRONG_KEY = 'e5-wrong-passphrase';

const spec = (o: {
  id: string;
  seq: number;
  type: string;
  eid: string | null;
  eids?: string[];
  plain: unknown;
  base?: number | null;
}) => o;

const asRow = (o: ReturnType<typeof spec>, payload: unknown): RecoveredOperationRow => ({
  id: o.id,
  serverSeq: o.seq,
  opType: o.type,
  entityType: 'TASK',
  entityId: o.eid,
  entityIds: o.eids ?? [],
  payload,
  schemaVersion: 1,
  isPayloadEncrypted: true,
  repairBaseServerSeq: o.base ?? null,
});

const A = [
  spec({ id: 'op-1', seq: 1, type: 'CRT', eid: 'task-1', plain: { title: '一' } }),
  spec({ id: 'op-2', seq: 2, type: 'CRT', eid: 'task-2', plain: { title: '二' } }),
  spec({ id: 'op-3', seq: 3, type: 'CRT', eid: 'task-3', plain: { title: '三' } }),
  // 批量删除：全集在 entityIds，标量 entityId 只是 entityIds[0]。
  spec({ id: 'op-4', seq: 4, type: 'DEL', eid: 'task-2', eids: ['task-2', 'task-3'], plain: {} }),
];
const B = [
  ...A,
  spec({
    id: 'op-5',
    seq: 5,
    type: 'REPAIR',
    eid: null,
    plain: { TASK: { 'task-1': { title: '一改过' } } },
    base: 3,
  }),
];

/** 真加密：产物就是 `operations.payload` 那一列里存的东西。 */
const encryptRows = async (specs: typeof A): Promise<RecoveredOperationRow[]> => {
  const cipher = await encryptBatch(specs.map((o) => JSON.stringify(o.plain)), KEY);
  return specs.map((o, i) => asRow(o, cipher[i]));
};

const taskIds = (state: Record<string, unknown>): string[] =>
  Object.keys((state.TASK ?? {}) as Record<string, unknown>).sort();

/** 脚本源码，只留代码行（注释里会出现被禁的形状，判据不能咬自己的说明）。 */
const scriptCode = (): string => {
  const rel = 'scripts/recover-user.ts';
  const abs = [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)].find((p) => existsSync(p));
  if (!abs) throw new Error(`找不到 ${rel}（cwd=${process.cwd()}）—— 判据的路径前提坏了`);
  return readFileSync(abs, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
};

describe('recover-user 的解密 + 重放（E5）', () => {
  it('🔴 前提：这一轮真的跑在真密码学上（不是桩）', async () => {
    const rows = await encryptRows(A);
    for (const row of rows) {
      // 库里那一列真的是密文：base64 字母表里没有 `{`，也没有明文字段名。
      expect(String(row.payload)).not.toContain('title');
      expect(String(row.payload).startsWith('{')).toBe(false);
    }
    const decrypted = await decryptPayloads(rows, KEY);
    expect(decrypted.size, '一条都没解密 ⇒ 后面的断言全在空转').toBe(4);
    expect(decrypted.get(0)).toEqual({ title: '一' });
    expect(decrypted.get(3)).toEqual({});
  });

  it('🔴 口令不对时必须炸，不许"照样返回一堆东西"糊过去', async () => {
    const rows = await encryptRows(A);
    await expect(decryptPayloads(rows, WRONG_KEY)).rejects.toThrow(/Decryption failed/);
  });

  it('🔴 批量 DEL 之后，entities 2..n 不许在还原文件里复活', async () => {
    const rows = await encryptRows(A);
    const decrypted = await decryptPayloads(rows, KEY);
    const built = buildReplayRows(rows, decrypted);
    // 前提：映射真的把集合交出去了 —— 否则"没复活"可能是重放器自己兜的底，
    // 而不是这条判据在守。
    expect(built.filter((r) => 'entityIds' in r), '没有任何一行带 entityIds').toHaveLength(1);
    expect(built.every((r) => r.isPayloadEncrypted === false), '还有行标着已加密').toBe(true);
    expect(built.every((r) => typeof r.payload === 'object'), 'payload 没被还原成对象').toBe(true);

    const state = replayOpsToState(built);
    expect(taskIds(state)).toEqual(['task-1']);
    expect(state.TASK).not.toHaveProperty('task-3');
  });

  it('🔴 用过新式 REPAIR 的账号要能恢复（少一列就整单做不了）', async () => {
    const rows = await encryptRows(B);
    const decrypted = await decryptPayloads(rows, KEY);
    const built = buildReplayRows(rows, decrypted);
    expect(built.filter((r) => 'repairBaseServerSeq' in r)).toHaveLength(1);

    expect(replayOpsToState(built)).toEqual({ TASK: { 'task-1': { title: '一改过' } } });
  });

  it('反向腿：把那两个键从映射里摘掉，各自的坏味道必须真的出现', () => {
    // 不是形式主义：上面两条"没复活 / 能恢复"如果本来就测不到，摘掉键也不会变。
    const strip = (
      rows: ReplayOperationRow[],
      key: 'entityIds' | 'repairBaseServerSeq',
    ): ReplayOperationRow[] =>
      rows.map((r) => {
        const copy = { ...r } as Record<string, unknown>;
        delete copy[key];
        return copy as ReplayOperationRow;
      });

    const noSet = strip(buildReplayRows(A.map((o) => asRow(o, o.plain)), new Map()), 'entityIds');
    expect(taskIds(replayOpsToState(noSet))).toEqual(['task-1', 'task-3']);

    const noBase = strip(
      buildReplayRows(B.map((o) => asRow(o, o.plain)), new Map()),
      'repairBaseServerSeq',
    );
    expect(() => replayOpsToState(noBase)).toThrow(/LEGACY_REPAIR_REPLAY_UNSUPPORTED/);
  });

  it('🔴 喂给重放的那一份列集合不许再抄：必须是快照路径那份推出来的', () => {
    const code = scriptCode();
    const marker = 'const ops = await prisma.operation.findMany(';
    const at = code.indexOf(marker);
    // 前提：锚点还在。改名不改判据是假的能过 —— 锚点漂了要响亮地说。
    expect(at, `找不到重放查询的锚点：${marker}`).toBeGreaterThan(-1);
    const block = code.slice(at, at + 600).split('\n').slice(0, 14).join('\n');

    // 🔴 **钉的是"不许有第二份抄件"，不是"必须写成某一种字面形状"**。
    // 上一版写死 `select: REPLAY_OPERATION_SELECT`，而现在的实现是
    // `select: RECOVER_ARTIFACT_OPERATION_SELECT`（= 那份共享列 + 三个线协议列，
    // 因为产物要能被客户端导入器接受）。形状换了、不变量没破，判据却红了 ——
    // **把自己的更好分解读成回归**。所以现在从查询里把常量名读出来，再验那个常量。
    const selectValue = /^\s*select:\s*([A-Za-z_][\w]*)\s*,/m.exec(block)?.[1];
    expect(selectValue, `重放查询里没有 \`select: <常量>,\` 这一行（要么被改回 inline 列清单，要么锚点范围变了）`).toBeDefined();

    // 第二份抄件的形状特征：这条查询里出现任何 `xxx: true,` 的列清单。
    // ⚠️ 范围**只到这条查询**：`inspect()` 列全量 op 用的是另一份自选列（那是给人看的
    //    清单，不是重放输入）。整文件扫会把它一起抓进来 —— 第一版就是这么误报的。
    const copiedColumns = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[a-zA-Z]+: true,$/.test(l));
    expect(copiedColumns, `重放查询里还留着抄来的列清单: ${JSON.stringify(copiedColumns)}`).toEqual([]);

    // 那个常量必须是**从快照路径那份展开的**，不是自己列的（这才是"结构上不可能再漂"的依据）。
    const definition = new RegExp(`(?:export )?const ${selectValue}\\s*=\\s*\\{([\\s\\S]{0,600}?)\\}`).exec(code);
    expect(definition, `找不到常量 ${selectValue} 的定义 —— 查询引用了一个没人在本文件展开过共享列集合的东西`).not.toBeNull();
    expect(
      definition?.[1] ?? '',
      `${selectValue} 的定义里没有 \`...REPLAY_OPERATION_SELECT\` —— 它是一份手抄列清单`,
    ).toContain('...REPLAY_OPERATION_SELECT');

    // 共享的那份真的带着这两列（不写死"一共几列"，只写死"这两列必须在"）。
    expect(REPLAY_OPERATION_SELECT).toHaveProperty('entityIds');
    expect(REPLAY_OPERATION_SELECT).toHaveProperty('repairBaseServerSeq');
    // 正向对照（真对象，不是源码里的字面量）：查询实际用的那份必须**覆盖**共享那份的每一列。
    const missing = Object.keys(REPLAY_OPERATION_SELECT).filter((k) => !(k in RECOVER_ARTIFACT_OPERATION_SELECT));
    expect(missing, `${selectValue} 丢了快照那份的这些列：${missing.join(', ')}`).toEqual([]);
  });

  it('🔴 import 这个脚本不会把它自己跑起来（main 有门）', async () => {
    // 没有门的话：模块加载期 parseArgs → 打印 `Missing --user` → 动 process.exitCode。
    vi.resetModules();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitBefore = process.exitCode;
    await import('../scripts/recover-user');
    const printed = errors.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
    errors.mockRestore();
    expect(printed).not.toContain('Missing --user');
    expect(process.exitCode, '脚本在 import 期就改了退出码').toBe(exitBefore);
  });

  it('同步路径不再靠 require 摸隔壁包的源码', () => {
    const code = scriptCode();
    // `require('../../sync-core/src/encryption')` 是"测不到"的根因：只有
    // ts-node --transpile-only 解析得动，且签名没人核。
    expect(code).not.toMatch(/\brequire\(/);
    expect(code).toContain("from '@heyta/sync-core'");
  });
});
