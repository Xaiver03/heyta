/**
 * 助手会话动作层（ADR-0045 D-4 (ii) 的写路径）
 * =============================================
 *
 * 与 `event-actions.spec.ts` 同一取舍：**真实引擎 + 真实 SQLite（`:memory:`）**，零 mock。
 *
 * 四条判据各钉一件事，每条都做过变异（读数在
 * `packages/app-host/tests/mutate-assistant-session.mjs`）：
 *
 *   1. **一条消息 = 一个实体、一次意图 = 一条 op**（AGENTS §3.4）。
 *      这是 D-4 选实体粒度的**操作化定义**：并发追加必须得到两条实体，
 *      清除必须得到**一条** DEL（带批量域）而不是 N 条。
 *   2. 🔴 **每条落库的消息都带着 `destinationKind` 与 `originClientId`**。
 *      少写任何一格，"这句是谁答的 / 是哪台设备写的"就永久不可判 ——
 *      而它是判据 3 唯一的运行时依据，所以这条必须独立成判据。
 *   3. 🔴 **未确认的提案在别的设备上不可确认**（产品裁决第 4 条）。
 *      三个面各钉一次：读侧 `isConfirmableHere` 为假、`isExpiredHere` 为真、
 *      **写侧 `setDisposition` 抛错**。第三条是关键的那一条：
 *      判定只放界面就等于没有（见那个方法上的注释）。
 *   4. **词表同源**：目的地档位必须等于 `@heyta/ai` 的 `DestinationDisclosure` 那三档
 *      （+ 保守的 `'unknown'`）。两边各写一份就是 §7 #4"词表两套定义"的形状。
 *
 * ⚠️ 反面也要钉住：**本机自己写的未确认提案不是过期**。摘掉这一半的变异会让
 * 本机唯一的正常路径（点确认）被打断，而"跨设备不可确认"那条测试照样绿 ——
 * 因为它只断言了禁用态。
 */

import {
  ASSISTANT_TURN_DESTINATION_KINDS,
  type AssistantTurn,
} from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createAssistantSessionActions,
  type AssistantSessionActions,
} from '../src/assistant-session-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: AssistantSessionActions;
let clock = 1_700_000_000_000;
let turnSeq = 0;
let sessionSeq = 0;

const LOCAL = 'dev-local';

function freshSession(): string {
  sessionSeq += 1;
  return `sess-${String(sessionSeq)}`;
}

/** 真·另一台设备：**独立引擎 + 独立 SQLite + 自己的 clientId**。 */
async function otherDevice(clientId: string): Promise<{
  actions: AssistantSessionActions;
  engine: OpLogEngine;
  /** 那台设备 → 本机（真实 `applyRemote` 边界）。 */
  pullTo: () => Promise<void>;
  /** 本机 → 那台设备。 */
  pushFrom: () => Promise<void>;
  close: () => void;
}> {
  const otherAdapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await otherAdapter.init();
  const otherEngine = new OpLogEngine({
    clientId,
    store: new DbOpLogStore(otherAdapter),
    now: () => clock,
  });
  return {
    actions: createAssistantSessionActions(
      { dispatch: (intent) => otherEngine.dispatch(intent), getState: () => otherEngine.getState() },
      { clientId, now: () => clock, newTurnId: () => 'aturn-other' },
    ),
    engine: otherEngine,
    // 🔴 走**真实**的 `applyRemote` 边界，而不是在本机引擎上假装写了一条"别人的" op ——
    // 后者测不到"来自远端的 op 不得再次触发副作用"（AGENTS §3.4）那一条。
    pullTo: async () => {
      await engine.applyRemote(await otherEngine.getAllOps());
    },
    pushFrom: async () => {
      await otherEngine.applyRemote(await engine.getAllOps());
    },
    close: () => otherAdapter.close(),
  };
}

beforeEach(async () => {
  clock = 1_700_000_000_000;
  turnSeq = 0;
  sessionSeq = 0;
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    clientId: LOCAL,
    store: new DbOpLogStore(adapter),
    now: () => clock,
  });
  actions = createAssistantSessionActions(
    { dispatch: (intent) => engine.dispatch(intent), getState: () => engine.getState() },
    {
      clientId: LOCAL,
      now: () => clock,
      newTurnId: () => {
        turnSeq += 1;
        return `aturn-t-${String(turnSeq).padStart(3, '0')}`;
      },
    },
  );
});

afterEach(() => {
  adapter.close();
});

const turns = (): Record<string, AssistantTurn> =>
  engine.getState().assistantTurns as unknown as Record<string, AssistantTurn>;

const opsFor = (entityId: string) => engine.getOpsForEntity('ASSISTANT_TURN', entityId);
const storedOps = () => engine.getAllOps();

// ─────────────────────────────────────────────────────────────────────────
describe('判据 1：一条消息 = 一个实体，一次意图 = 一条 op', () => {
  it('用户发一句 + 助手回一句 ⇒ **两条实体、各一条 op**（不 fan-out 整段历史）', async () => {
    const sessionId = freshSession();
    const userId = await actions.appendTurn({
      sessionId,
      role: 'user',
      text: '帮我把「写周报」排到今天',
      destinationKind: 'local',
    });
    clock += 1_000;
    await actions.appendTurn({
      sessionId,
      role: 'assistant',
      text: '已排到今天 18:00。',
      destinationKind: 'local',
    });

    expect(Object.keys(turns()).sort()).toEqual([userId, 'aturn-t-002']);
    expect((await storedOps()).length, '两条消息必须是两条 op，不是一条带数组的 op').toBe(2);
    expect((await opsFor(userId)).length).toBe(1);
  });

  it('🔴 两台设备各追加一条 ⇒ **两条都在**（会话级实体会在这里互相吞）', async () => {
    const sessionId = 'sess-shared';
    await actions.appendTurn({ sessionId, role: 'user', text: '本机说的', destinationKind: 'local' });

    // 另一台**独立设备**（独立引擎、自己的 clientId）往同一段会话里追加，
    // 然后走真实同步边界把它送回来 —— 两台设备的时钟互不可比 = 真并发。
    const other = await otherDevice('dev-other');
    clock += 1_000;
    await other.actions.appendTurn({
      sessionId,
      role: 'user',
      text: '另一台说的',
      destinationKind: 'heyta-cloud',
    });
    await other.pullTo();

    const ids = Object.keys(turns()).sort();
    expect(ids, '并发追加必须两条都留下来').toEqual(['aturn-other', 'aturn-t-001']);
    expect(actions.turnsOf(sessionId).map((t) => t.text)).toEqual(['本机说的', '另一台说的']);
    // 🔴 送回来那条的**目的地与写入设备**没有被本机的值覆盖掉。
    const restored = turns()['aturn-other']!;
    expect(restored.destinationKind).toBe('heyta-cloud');
    expect(restored.originClientId).toBe('dev-other');
    other.close();
  });

  it('🔴 同一毫秒的两条按 id 字典序定序（少了这一段，两台设备会给出两种顺序）', async () => {
    const sessionId = 'sess-tie';
    // 刻意**不推进时钟**：两条消息的 `at` 相同，这是并发写入的常态。
    await actions.appendTurn({ sessionId, role: 'user', text: '甲', destinationKind: 'local' });
    await actions.appendTurn({ sessionId, role: 'user', text: '乙', destinationKind: 'local' });

    const first = actions.turnsOf(sessionId);
    expect(first.map((t) => t.at)).toEqual([first[0]!.at, first[1]!.at]);
    expect(first.map((t) => t.text), 'id 兜底段给出的顺序').toEqual(['甲', '乙']);

    // 顺序在**另一台设备**上必须逐字相同（同一段会话、同一批 op、不同到达顺序）。
    const other = await otherDevice('dev-other');
    await other.pushFrom();
    // 对端把同一批 op 再送回本机：本机状态不能因为"又收到一次"而变序或变多。
    const before = (await engine.getAllOps()).length;
    await other.pullTo();
    expect((await engine.getAllOps()).length).toBe(before);
    expect(actions.turnsOf(sessionId).map((t) => t.text)).toEqual(['甲', '乙']);
    other.close();
  });

  it('清空一段会话 = **一条** DEL op（批量域），且不是 N 条', async () => {
    const sessionId = freshSession();
    const other = 'sess-other';
    for (const text of ['一', '二', '三']) {
      await actions.appendTurn({ sessionId, role: 'user', text, destinationKind: 'local' });
      clock += 10;
    }
    await actions.appendTurn({ sessionId: other, role: 'user', text: '别段', destinationKind: 'local' });

    const before = (await storedOps()).length;
    const cleared = await actions.clearSession(sessionId);
    expect(cleared).toBe(3);
    expect((await storedOps()).length - before, '一次清除只能多**一条** op').toBe(1);

    for (const id of ['aturn-t-001', 'aturn-t-002', 'aturn-t-003']) {
      expect(turns()[id]?.deletedAt, `${id} 要有墓碑（不写墓碑会让对端把它复活）`).toBeDefined();
      // 🔴 墓碑**保留内容**：导出与回收站语义都建立在"字段还在"上。
      expect(turns()[id]?.text).toBeDefined();
    }
    expect(actions.turnsOf(sessionId)).toEqual([]);
    expect(actions.turnsOf(other).length, '不能波及另一段会话').toBe(1);
  });

  it('空会话的清除**不写 op**（空 DEL 是一条谁都不认识的墓碑）', async () => {
    const before = (await storedOps()).length;
    expect(await actions.clearSession('sess-nothing')).toBe(0);
    expect((await storedOps()).length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('判据 2：destinationKind 与 originClientId 每条都显式写', () => {
  it('未指定目的地 ⇒ 显式写 `unknown`，**不是省略这一格**', async () => {
    const id = await actions.appendTurn({ sessionId: 's', role: 'assistant', text: '答一句' });
    const payload = (await opsFor(id)).at(-1)!.payload as Record<string, unknown>;
    expect(payload['destinationKind']).toBe('unknown');
    expect('originClientId' in payload, '省略 originClientId 等于把判据 3 摘掉').toBe(true);
    expect(payload['originClientId']).toBe(LOCAL);
  });

  it('三档目的地都落得下来，读回不漂', async () => {
    for (const [index, kind] of (
      ['local', 'third-party-endpoint', 'heyta-cloud'] as const
    ).entries()) {
      await actions.appendTurn({
        sessionId: 's2',
        role: 'assistant',
        text: `第 ${String(index)} 答`,
        destinationKind: kind,
      });
      clock += 10;
    }
    expect(actions.turnsOf('s2').map((t) => t.destinationKind)).toEqual([
      'local',
      'third-party-endpoint',
      'heyta-cloud',
    ]);
  });

  it('🔴 载荷里**不许出现**会话级数组或别的实体的 id 集合', async () => {
    const id = await actions.appendTurn({
      sessionId: 's3',
      role: 'proposal',
      text: '要改「写周报」的截止时间',
      toolName: 'update_task',
    });
    const payload = (await opsFor(id)).at(-1)!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['at', 'destinationKind', 'disposition', 'originClientId', 'role', 'sessionId', 'text', 'toolName'].sort(),
    );
    // 提案的结构化 intent 载荷**故意不同步**（理由见 `AssistantTurn` 文件头）。
    expect(payload).not.toHaveProperty('intent');
    expect(payload).not.toHaveProperty('turns');
    expect(payload).not.toHaveProperty('steps');
  });

  it('写入侧拒绝：空文本、非法档位、提案缺 toolName —— 都**抛错**且零 op', async () => {
    const before = (await storedOps()).length;
    await expect(actions.appendTurn({ sessionId: 's', role: 'user', text: '' })).rejects.toThrow(/文本为空/);
    await expect(
      actions.appendTurn({
        sessionId: 's',
        role: 'user',
        text: 'x',
        destinationKind: 'lan' as never,
      }),
    ).rejects.toThrow(/目的地/);
    await expect(
      actions.appendTurn({ sessionId: 's', role: 'proposal', text: '要改点什么' }),
    ).rejects.toThrow(/工具/);
    expect((await storedOps()).length, '拒绝必须**什么都不写**').toBe(before);
  });

  it('空 clientId **拒绝构造**（它是判据 3 的全部依据）', () => {
    expect(() =>
      createAssistantSessionActions(
        { dispatch: (intent) => engine.dispatch(intent), getState: () => engine.getState() },
        { clientId: '' },
      ),
    ).toThrow(/clientId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('判据 3：未确认的提案只在产生它的那台设备上可确认', () => {
  /** 另一台设备写一条未确认提案，再**真的同步回本机**。 */
  async function proposalFromElsewhere(): Promise<string> {
    const other = await otherDevice('dev-other');
    const id = await other.actions.appendTurn({
      sessionId: 'sess-x',
      role: 'proposal',
      text: '把「写周报」挪到今天',
      toolName: 'update_task',
      destinationKind: 'third-party-endpoint',
    });
    await other.pullTo();
    other.close();
    return id;
  }

  it('🔴 别的设备写的未确认提案：本机**读侧判过期**', async () => {
    const id = await proposalFromElsewhere();
    const turn = turns()[id]!;
    expect(turn.originClientId, '前提是它真的带着别人的设备 id').toBe('dev-other');
    expect(actions.isConfirmableHere(turn), '跨设备的未确认提案不可确认').toBe(false);
    expect(actions.isExpiredHere(turn), '它必须按过期呈现（卡片在、按钮没有）').toBe(true);
  });

  it('🔴 同一条件的**写侧**：setDisposition 抛错，且什么都不写', async () => {
    const id = await proposalFromElsewhere();
    const before = (await storedOps()).length;
    await expect(actions.setDisposition(id, 'confirmed')).rejects.toThrow(/不能在这台设备上确认/);
    expect((await storedOps()).length, '拒绝必须零写入').toBe(before);
    expect(turns()[id]?.disposition).toBe('pending');
  });

  it('反面：本机自己写的未确认提案**不算过期**（否则点不了确认）', async () => {
    const id = await actions.appendTurn({
      sessionId: 'sess-y',
      role: 'proposal',
      text: '把「写周报」挪到今天',
      toolName: 'update_task',
    });
    const turn = turns()[id]!;
    expect(actions.isConfirmableHere(turn)).toBe(true);
    expect(actions.isExpiredHere(turn)).toBe(false);
    await actions.setDisposition(id, 'confirmed');
    expect(turns()[id]?.disposition).toBe('confirmed');
  });

  it('已确认的提案在两台设备上都**不是**过期（过期只描述"未确认 + 别处写的"）', async () => {
    const id = await actions.appendTurn({
      sessionId: 'sess-z',
      role: 'proposal',
      text: '改一件事',
      toolName: 'create_task',
    });
    await actions.setDisposition(id, 'confirmed');
    const other = await otherDevice('dev-other');
    expect(other.actions.isExpiredHere(turns()[id]!), '有处置结果的提案不是"过期"').toBe(false);
    other.close();
  });

  it('🔴 本机确认后同步给对端：对端读到 `confirmed`，来回回放**不产生新 op**', async () => {
    const id = await actions.appendTurn({
      sessionId: 'sess-confirm',
      role: 'proposal',
      text: '改一件事',
      toolName: 'create_task',
    });
    await actions.setDisposition(id, 'confirmed');

    const other = await otherDevice('dev-other');
    // 本机 → 对端，再对端 → 本机（同一批 op 回来第二次）。
    await other.pushFrom();
    expect(other.actions.turnsOf('sess-confirm').at(-1)?.disposition).toBe('confirmed');
    const beforeReturn = (await engine.getAllOps()).length;
    await other.pullTo();
    expect(
      (await engine.getAllOps()).length,
      '远端回放不得在本机产生新 op（AGENTS §3.4）',
    ).toBe(beforeReturn);
    expect(turns()[id]?.disposition).toBe('confirmed');
    other.close();
  });

  it('🔴 `originClientId` 缺席（老数据）⇒ 判不可确认，方向是保守那一侧', async () => {
    // 直接绕过动作层写一条没有 originClientId 的 op（模拟旧宿主留下的载荷形状）。
    await engine.dispatch({
      entityType: 'ASSISTANT_TURN',
      entityId: 'aturn-legacy',
      opType: OpType.Create,
      payload: { sessionId: 'sess-legacy', role: 'proposal', text: '旧版写的提案', toolName: 'x' },
    });
    const turn = turns()['aturn-legacy']!;
    expect(actions.isConfirmableHere(turn)).toBe(false);
    expect(actions.isExpiredHere(turn)).toBe(true);
  });

  it('非提案的角色不参与可确认性（用户消息永远不该有确认按钮）', async () => {
    const id = await actions.appendTurn({ sessionId: 's', role: 'user', text: '说一句' });
    const other = await otherDevice('dev-other');
    expect(other.actions.isConfirmableHere(turns()[id]!)).toBe(false);
    expect(other.actions.isExpiredHere(turns()[id]!), '普通消息不许被标成过期').toBe(false);
    other.close();
  });

  it('读侧的每一格都有运行时默认值（AGENTS §3.3：老载荷少字段不许炸）', async () => {
    await engine.dispatch({
      entityType: 'ASSISTANT_TURN',
      entityId: 'aturn-sparse',
      opType: OpType.Create,
      // 🔴 一条**只有 text** 的消息：真实旧数据里可能是任何形状。
      payload: { text: '只剩这句话' },
    });
    const turn = turns()['aturn-sparse']!;
    expect(turn.role).toBeUndefined();
    expect(actions.turnsOf('asdf').length, '没有 sessionId ⇒ 不属于任何一段会话').toBe(0);
    expect(actions.allTurns().map((t) => t.id)).toEqual(['aturn-sparse']);
    // 默认值方向：目的地 unknown、处置 pending（不许猜成本机/不许猜成已确认）。
    expect(actions.isConfirmableHere(turn)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('判据 4：词表同源，不是第二份定义', () => {
  it('🔴 目的地档位 == `@heyta/ai` 的 disclosure kinds + `unknown`', async () => {
    // `DestinationDisclosure` 是**类型**，运行时拿不到键；所以从它的构造函数取样本：
    // 三个目的地各推一次，得到的 kind 必须全在 domain 词表里，且**没有第四个**。
    const { destinationDisclosure, classifyDestination, MANAGED_MODEL_HOSTS } = await import('@heyta/ai');
    // ⚠️ 托管那一档的样本端点**从白名单现取**，不写死主机名：ADR-0056 §3.3 之后，
    // `mode: 'managed'` 单独不再推出 `heyta-cloud` —— 那个事实必须由端点证明。
    // 写死一个主机名的话，白名单一改这条就红，而红的原因与"词表同源"无关。
    const managedHost = MANAGED_MODEL_HOSTS[0]?.host;
    if (managedHost === undefined) throw new Error('境内托管白名单是空的 —— 先怀疑探针，不是放宽这条');
    const seen = new Set<string>();
    for (const config of [
      { mode: 'own' as const, endpoint: 'http://127.0.0.1:11434/api' },
      { mode: 'own' as const, endpoint: 'https://inference.example.com/v1' },
      { mode: 'managed' as const, endpoint: `https://${managedHost}/v1` },
    ]) {
      seen.add(destinationDisclosure(classifyDestination(config)).kind);
    }
    expect([...seen].sort()).toEqual(['heyta-cloud-managed', 'local', 'third-party-endpoint']);
    // 🔴 成对的那一半：**没有**境内端点的 `managed` 不许被说成到了 heyta 手里。
    // 这一档原先是恒返回 `heyta-cloud`（不看端点），ADR-0056 §3.3 点名的就是那个洞。
    expect(classifyDestination({ mode: 'managed' })).toBe('user-endpoint');
    expect(classifyDestination({ mode: 'managed', endpoint: 'https://api.openai.com/v1' })).toBe(
      'user-endpoint',
    );
    // domain 侧就是这三档 + unknown（没有"局域网"第四档，理由见 assistant-turn.ts）。
    expect(ASSISTANT_TURN_DESTINATION_KINDS).toEqual([
      'local',
      'third-party-endpoint',
      'heyta-cloud',
      'unknown',
    ]);
  });

  it('`ASSISTANT_TURN` 进了 ENTITY_TYPES 且**不是**"刻意不物化"那一档', async () => {
    const { ENTITY_TYPES } = await import('@heyta/shared-schema');
    const { UNMODELED_ENTITY_TYPES } = await import('@heyta/op-log');
    expect(ENTITY_TYPES).toContain('ASSISTANT_TURN');
    expect(UNMODELED_ENTITY_TYPES.map((u) => u.entityType)).not.toContain('ASSISTANT_TURN');
  });

  it('实体名词条：本包**不许**依赖 `@heyta/i18n`，那条对账在界外层做', async () => {
    // 🔴 `packages/app-host` 刻意不引 `@heyta/i18n`（`share-summary.ts` / `ai-output-language.ts`
    // 两个文件头各记过一次理由：加这条边等于让 packages/ 反向依赖界面词表）。
    // 所以"每个合法实体在中英两种语言里都翻好了、冲突面板不会出现代号"这条判据
    // 的真落点是 `apps/mobile/tests/conflict-keys.spec.ts` —— 它同时能拿到
    // `ENTITY_LABEL_KEYS`、op-log 的实体清单与 `@heyta/i18n`，三边一起对账。
    // 这里只钉"本包确实没有那条依赖边"，挡的是将来有人把它加回来。
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(deps).not.toHaveProperty('@heyta/i18n');
  });

  it('目的地词表**没有第四档**（局域网按既有裁决归入远端，不另开词表）', async () => {
    const { isLoopbackEndpoint } = await import('@heyta/ai');
    // 阳性对照：局域网主机名**不是**回环 ⇒ 它落 `third-party-endpoint`。
    expect(isLoopbackEndpoint('http://192.168.1.20:11434')).toBe(false);
    expect(isLoopbackEndpoint('http://my-nas.local:11434')).toBe(false);
    expect(ASSISTANT_TURN_DESTINATION_KINDS).not.toContain('lan');
  });
});
