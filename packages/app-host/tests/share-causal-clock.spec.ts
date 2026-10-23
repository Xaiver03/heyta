/**
 * ADR-0067 裁决二「因果时钟回流到 dispatcher」的判据
 * =================================================
 *
 * 这批判据钉的是一格**从行为上看不出来**的缺陷：`vectorClock` 一直写死 `{我:1}` 时，
 * 同步照样能跑、评论照样能互见、e2e 照样全绿 —— 因为到 M2 为止**没有任何一条链靠因果边定序**，
 * 大家各自把"timestamp 谁大"当顺序。而共享多写者下这个近似的代价是：
 * 同一个人在同一份清单上的第 2 条改动与他的第 1 条**判成并发**（`{我:1}` vs `{我:1}`
 * 只可能是 `EQUAL`/`CONCURRENT`），于是并发判定会把"我自己按顺序写的东西"报成冲突。
 *
 * ⇒ 所以这里断言的不是"op 里有个 vectorClock 字段"（那一直成立），
 *   而是**两条本地 op 之间存在因果边**这一件事本身。
 *
 * | 判据 | 坏法（= 摘掉关键分支时该红的那一枚） |
 * |---|---|
 * | ① 本地连写两条 ⇒ 第二条 `{我:2}`，且与第一条判 `LESS_THAN` | `share-client.ts` 写回 `vectorClock: { [clientId]: 1 }` |
 * | ② 两份清单各走各的钟 | `baseClock` 忽略 shareId（建实例时抓死一份 / 恒返同一个对象） |
 * | ③ 拉回远端 `{b:3}` 之后本地下一条 = `{b:3, 我:1}` | 基准只读本地那几维，远端的钟不回流 |
 * | ④ 换一个新实例（冷启动）后钟从盘上续上 | 基准读内存缓存，缓存空时从 `{}` 起算 |
 * | ⑤ 未登录连基准都不读 | `isSignedIn` 那道闸被挪到读日志之后 |
 *
 * ⚠️ ②③④⑤ 都是**接错线**的形状而不是算法的形状，`share-client.ts` 自己量不到 ——
 *    所以这枚尺子必须从 `createShareCommentDispatch`（生产路径）进来。
 */

import { compareVectorClocks, deriveShareIdentityKeyPair, OpType, VectorClockComparison } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import type { ShareOpIntent } from '../src/comment-actions.js';
import type { ShareOpDownloadPort, ShareOpUploadPort, ShareOpWire, ShareOpWireRow } from '../src/share-client.js';
import { createShareCommentDispatch, type ShareLogStorage } from '../src/share-comments.js';
import { emptyShareLogState, type ShareLogState } from '../src/share-op-log.js';
/** 签名件夹具：真派生一枚 Ed25519（固定种子），签的是生产原语。
 * 签名本身对不对由 `share-client.spec.ts` / sync-core 那两族判据钉，这里只补"有没有签名件"这一档。 */
const shareAuthorKeyPair = deriveShareIdentityKeyPair(new Uint8Array(32).fill(21));
const signerFor = async () => ({ memberId: 'member-1', ed25519SecretKey: shareAuthorKeyPair.ed25519SecretKey });


const T0 = 1_700_000_000_000;
const ME = 'device-me';
const REMOTE = 'device-b';

type Clock = Record<string, number>;

/** 一条评论意图（时钟与这条的语义无关，拿它当"随便一条能上行的 op"）。 */
const intent = (n: number): ShareOpIntent => ({
  entityType: 'COMMENT',
  entityId: `comment-${String(n)}`,
  opType: OpType.Create,
  payload: { taskId: 't-1', authorUserId: 'u-me', body: `第 ${String(n)} 句` },
});

/**
 * 一个最小的假 share 服务端：`uploadOps` 把线 op 落成带 `serverSeq` 的行，
 * `downloadOps` 按游标给出。
 *
 * 🔴 它存在的意义是让"别人先写、我后拉"这一形在本机可测 —— 裁决二那条**回流**只有在
 *    远端的钟进了本地日志之后才量得到，纯函数测不到。
 */
function makeServer(seed: readonly ShareOpWireRow[] = []): {
  /** 按上行顺序记录的 `[shareId, 行]`（`shareId` 留着，② 那一枚要按清单分组）。 */
  uploaded: Array<{ shareId: string; row: ShareOpWireRow }>;
  api: ShareOpUploadPort & ShareOpDownloadPort;
} {
  const rows: ShareOpWireRow[] = [...seed];
  const uploaded: Array<{ shareId: string; row: ShareOpWireRow }> = [];
  return {
    uploaded,
    api: {
      uploadOps: async (shareId, ops) => {
        for (const wire of ops as readonly ShareOpWire[]) {
          const nextSeq = rows.reduce((m, r) => Math.max(m, r.serverSeq), 0) + 1;
          const row: ShareOpWireRow = { ...wire, serverSeq: nextSeq, clientTimestamp: wire.timestamp };
          rows.push(row);
          uploaded.push({ shareId, row });
        }
        // 假服务端"全收"：回执必须逐条给出 `{id, serverSeq}` —— dispatcher 判"写成功"
        // 读的就是这一格（ADR-0069 裁决四：共享这条腿没有队列，被拒的 op 不许折进日志）。
        return { accepted: ops.map((op) => ({ id: (op as ShareOpWire).id })), rejected: [] };
      },
      downloadOps: async (_shareId, after) => ({
        ops: rows.filter((row) => row.serverSeq > after),
        cursor: { latestServerSeq: rows.reduce((m, r) => Math.max(m, r.serverSeq), 0) },
      }),
    },
  };
}

/** 一台"设备"：一份盘 + 一个 dispatcher 实例（实例里的内存缓存每次新建都是空的）。 */
function makeDevice(
  server: ReturnType<typeof makeServer>,
  disk: Map<string, ShareLogState> = new Map(),
  cursors: Map<string, number> = new Map(),
) {
  const storage: ShareLogStorage = {
    load: (shareId) => disk.get(shareId) ?? emptyShareLogState(),
    save: (shareId, log) => {
      disk.set(shareId, log);
    },
    list: () => [...disk.keys()],
    cursor: (shareId) => cursors.get(shareId) ?? 0,
    setCursor: (shareId, seq) => {
      cursors.set(shareId, seq);
    },
  };
  return {
    disk,
    dispatch: createShareCommentDispatch({
      signerFor,
      api: server.api,
      // `ct:` 前缀当密文（与同族其余判据同一替身形状）。
      cipherFor: async () => ({
        encrypt: async (payload: string) => `ct:${payload}`,
        decrypt: async (payload: string) => payload.replace(/^ct:/, ''),
      }),
      storage,
      currentUserId: () => 'u-me',
      clientId: ME,
      schemaVersion: 1,
      isSignedIn: () => true,
      // 🔴 时钟与时刻**故意取恒定值**：这一枚要证的必须是钟，不是 timestamp 谁大。
      now: () => T0,
      newOpId: () => `op-${String(Math.random())}`,
    }),
  };
}

const clocksFor = (server: ReturnType<typeof makeServer>, shareId: string): Clock[] =>
  server.uploaded.filter((e) => e.shareId === shareId).map((e) => e.row.vectorClock as Clock);

describe('share 因果时钟（ADR-0067 裁决二）', () => {
  it('① 本地连写两条 ⇒ 第二条的本地维自增，且与第一条之间**存在因果边**', async () => {
    const server = makeServer();
    const { dispatch } = makeDevice(server);
    await dispatch.dispatchShareOp('share-1', intent(1));
    await dispatch.dispatchShareOp('share-1', intent(2));

    const [first, second] = clocksFor(server, 'share-1');
    expect(first, '第一条之前没有任何已知因果 ⇒ 本地维是 1').toEqual({ [ME]: 1 });
    expect(second, '写第二条时基准已经是 {我:1} ⇒ 必须是 2（写回死值就是这一枚红）').toEqual({ [ME]: 2 });
    // 🔴 这一句才是裁决二真正要的东西：**不是数字变大了，是因果边出现了**。
    expect(
      compareVectorClocks(first!, second!),
      '同一台设备先后写的两条必须判先后 —— 两条 timestamp 相同，只有钟能判',
    ).toBe(VectorClockComparison.LESS_THAN);
  });

  it('② 两份清单各走各的钟（基准按 shareId 现读）', async () => {
    const server = makeServer();
    const { dispatch } = makeDevice(server);
    await dispatch.dispatchShareOp('share-1', intent(1));
    await dispatch.dispatchShareOp('share-1', intent(2));
    await dispatch.dispatchShareOp('share-2', intent(3));

    expect(clocksFor(server, 'share-2'), '抓死一份钟 / 忽略 shareId 就是这一枚红').toEqual([{ [ME]: 1 }]);
    expect(clocksFor(server, 'share-1'), '而原来那一份不许被另一份的进度污染').toEqual([{ [ME]: 1 }, { [ME]: 2 }]);
  });

  it('③ 拉回远端的时钟会回流成本地下一条的基准（并对那条远端 op 形成因果边）', async () => {
    const server = makeServer([
      {
        id: 'op-b-3',
        clientId: REMOTE,
        actionType: 'add comment',
        opType: 'CRT',
        entityType: 'COMMENT',
        entityId: 'comment-b-3',
        schemaVersion: 1,
        payload: `ct:${JSON.stringify({ taskId: 't-1', authorUserId: 'u-b', body: '别人写的' })}`,
        vectorClock: { [REMOTE]: 3 },
        serverSeq: 3,
        clientTimestamp: T0 + 3,
      },
    ]);
    const { dispatch } = makeDevice(server);
    await dispatch.pullShareOps('share-1');
    await dispatch.dispatchShareOp('share-1', intent(1));

    const mine = clocksFor(server, 'share-1')[0]!;
    expect(mine, '本地维从 1 起，同时带上刚拉到的那一维（逐维合并，不是覆盖）').toEqual({ [REMOTE]: 3, [ME]: 1 });
    expect(
      compareVectorClocks({ [REMOTE]: 3 }, mine),
      '读到它之后写的这条必须在它之后 —— 否则合并器会把我自己的修改判成并发',
    ).toBe(VectorClockComparison.LESS_THAN);
  });

  it('④ 换新实例（冷启动）后钟从盘上续上，不退回 {我:1}', async () => {
    const server = makeServer();
    const disk = new Map<string, ShareLogState>();
    const cursors = new Map<string, number>();
    const first = makeDevice(server, disk, cursors);
    await first.dispatch.dispatchShareOp('share-1', intent(1));
    await first.dispatch.dispatchShareOp('share-1', intent(2));

    // 第二段：**新实例**，内存缓存是空的，日志只能从"盘"上读回来。
    const second = makeDevice(server, disk, cursors);
    await second.dispatch.dispatchShareOp('share-1', intent(3));

    expect(
      clocksFor(server, 'share-1').at(-1),
      '冷启动后第一条必须接着数（基准读日志折出来的那份钟，不是内存缓存）',
    ).toEqual({ [ME]: 3 });
  });

  it('⑤ 未登录时连基准都不读（零请求那条纪律的对偶：也不消耗时钟）', async () => {
    const server = makeServer();
    let reads = 0;
    const disk = new Map<string, ShareLogState>();
    const dispatch = createShareCommentDispatch({
      signerFor,
      api: server.api,
      cipherFor: async () => ({
        encrypt: async (payload: string) => `ct:${payload}`,
        decrypt: async (payload: string) => `ct:${payload}`,
      }),
      storage: {
        load: (shareId) => {
          reads += 1;
          return disk.get(shareId) ?? emptyShareLogState();
        },
        save: (shareId, log) => void disk.set(shareId, log),
        list: () => [...disk.keys()],
        cursor: () => 0,
        setCursor: () => undefined,
      },
      currentUserId: () => 'u-me',
      clientId: ME,
      schemaVersion: 1,
      isSignedIn: () => false,
      now: () => T0,
      newOpId: () => 'op-x',
    });
    await expect(dispatch.dispatchShareOp('share-1', intent(1))).rejects.toThrow(/登录/);
    expect(server.uploaded, '未登录 ⇒ 线上一条都不许有').toHaveLength(0);
    expect(reads, '未登录时不该去读基准（连日志都不碰）').toBe(0);
  });
});
