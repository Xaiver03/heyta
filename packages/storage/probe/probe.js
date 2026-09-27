/**
 * 浏览器侧 OPFS 探针的**页面外壳**。
 *
 * 两件事，各自有明确的理由：
 *
 * ① **裸驱动探针**（`worker.js`）—— 证明 OPFS 只能跑在 Worker 里，
 *    以及驱动本身在真浏览器里行为正确。它是"为什么必须 Worker"的一手证据。
 *
 * ② **桥接探针**（`oplog-worker.js`）—— 用**真实 schema + 真实桥接**，
 *    从**页面主线程**经真 `postMessage` 操作 Worker 里的库。
 *    这才是 web 端存储的最终形态，也是 M4-3 的端到端证据。
 *
 * 把②放在页面而不是 Worker 里是有意的：**主线程那一侧才是新代码**。
 * 之前所有能跑的验证都在 Worker 内部，而真正要迁过去的是主线程的调用方式。
 *
 * ⚠️ 用 `.js` 而不是 `.ts`：探针不进任何 tsconfig 的编译范围，
 * 它要验的也不是"类型对不对"。驱动脚本见 `scripts/verify-web-sqlite.mjs`。
 */

import { createWorkerOpLogSession } from '../src/sqlite/oplog-worker-bridge.js';

const out = document.getElementById('out');

/**
 * 把**两个**探针的结果画出来。
 *
 * ⚠️ 两者是独立的 async 流程，谁先完成不确定 —— 所以任一方完成时都重画一次，
 * 把当前拿到的都渲染上。截图是在两边都报完之后才拍的
 * （见 `scripts/verify-web-sqlite.mjs`），所以**截图里必须能同时看到它们** ——
 * 否则"人真的看过界面"这条硬性规定就落不了地。
 */
function render() {
  const sections = [];
  for (const [title, result] of [
    ['① 裸驱动探针（worker.js）', window.__heytaSqliteProbe],
    ['② 桥接探针（主线程 → Worker 真实 schema）', window.__heytaOpLogProbe],
  ]) {
    if (result === undefined) {
      sections.push(`${title}\n  ⏳ 进行中…`);
      continue;
    }
    const lines = (result.steps ?? []).map(
      (s) => `  ${s.name}${s.detail === undefined ? '' : ` → ${JSON.stringify(s.detail)}`}`,
    );
    lines.push(result.status === 'ok' ? '  ✅ 完成' : `  🔴 ${result.error}`);
    sections.push(`${title}\n${lines.join('\n')}`);
  }
  out.textContent = sections.join('\n\n');
}

window.__heytaSqliteProbe = undefined;
window.__heytaOpLogProbe = undefined;

const rawWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

rawWorker.onmessage = (event) => {
  window.__heytaSqliteProbe = event.data;
  render();
};

rawWorker.onerror = (event) => {
  window.__heytaSqliteProbe = { status: 'error', steps: [], error: `Worker 错误：${event.message}` };
  render();
};

/**
 * 桥接探针。
 *
 * 🔴 **顺序不能反**：先 `createWorkerOpLogSession`（它同步挂上监听），
 * 再去 await 任何东西。若先 await，Worker 的 `ready` 可能在监听装上之前就发出，
 * 那条消息会**直接丢失** —— 表现为永远卡在 `ready`，而不是一个错误。
 */
async function runOpLogProbe() {
  const steps = [];
  const step = (name, detail) => steps.push({ name, detail });

  try {
    const worker = new Worker(new URL('./oplog-worker.js', import.meta.url), { type: 'module' });
    const session = createWorkerOpLogSession(worker);

    step('① 存储 Worker 已起，代理已挂上监听');

    // 🔴 必须等它：`clientId` 是 LWW 决胜依据，不能拿一个还没定的值去建时钟。
    const { clientId } = await session.ready;
    step('② Worker 交握完成，clientId 来自库内', {
      clientIdIsNonEmpty: typeof clientId === 'string' && clientId.length > 0,
      clientIdLength: clientId.length,
    });

    /**
     * 🔴 **op 的形状必须照线协议来，一个字段都不能自己编。**
     *
     * 我第一版写的是 `{ opId, opType: 'create', clock }` —— 看起来合理，
     * 实际全错：真实字段是 `id` / `opType: 'CRT'` / `vectorClock`，
     * 而且 `entityType` 必须是大写 `'TASK'`。
     *
     * 后果**极难发现**：`op.opId` 取不到值 → 唯一索引列是 **NULL** →
     * 而 SQLite 的 UNIQUE 索引**允许多个 NULL** → 去重静默失效，
     * 同一条 op 被写进去两次，**全程不报任何错**。
     * 现场就是这个现象（探针⑥原本报"多了一条"），而代码是对的。
     *
     * ⚠️ 所以这里**照着 `OP_FIELDS` 的字段名写**、并补齐 `schemaVersion` 等必填项。
     * 这条教训值得记住：**唯一索引 + NULL 是"看起来在防护、实际什么都没防"的组合**。
     */
    const makeProbeOp = () => ({
      id: 'probe-op-1',
      entityType: 'TASK',
      entityId: 'probe-task',
      opType: 'CRT',
      payload: { title: '来自主线程经 Worker 的写入' },
      clientId,
      timestamp: Date.now(),
      vectorClock: { [clientId]: 1 },
      schemaVersion: 1,
    });

    const before = await session.store.getLastLocalSeq();
    step('③ 刷新前已有 op 数（= 本地序号）', before);

    if (before === 0) {
      const appended = (await session.store.appendLocal([makeProbeOp()])).length;
      step('④ 经桥接追加了 op', appended);
    } else {
      step('④ 已有数据，跳过写入（说明上一轮真的落盘了）');
    }

    const all = await session.store.getAllOps();
    step('⑤ 经桥接读回', {
      count: all.length,
      firstOpId: all[0]?.op?.id,
      payloadRoundTripped:
        JSON.stringify(all[0]?.op?.payload) ===
        JSON.stringify({ title: '来自主线程经 Worker 的写入' }),
    });

    // 幂等：同一个 opId 再写一次，靠唯一索引吸收，不该报错也不该多一条。
    const dupCount = (await session.store.appendLocal([makeProbeOp()])).length;
    const afterDup = await session.store.getAllOps();
    step('⑥ 重复 opId 被吸收（不报错、不多一条）', {
      appendedByDuplicate: dupCount,
      totalAfterDuplicate: afterDup.length,
    });

    // 同步游标（簿记）也过一遍桥 —— 它是 `OpLogStore` 的方法里最容易漏转发的。
    await session.store.setLastServerSeq(7);
    const serverSeq = await session.store.getLastServerSeq();
    step('⑦ 同步游标经桥接往返', serverSeq);

    const result = {
      status: 'ok',
      steps,
      clientId,
      opCount: afterDup.length,
      serverSeq,
    };
    window.__heytaOpLogProbe = result;
    render();
    return result;
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    step('🔴 失败', message);
    const result = { status: 'error', steps, error: message };
    window.__heytaOpLogProbe = result;
    render();
    return result;
  }
}

void runOpLogProbe();
