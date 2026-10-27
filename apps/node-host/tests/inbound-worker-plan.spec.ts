/**
 * `planWorkerRun` 的授权矩阵 —— 这台无头壳上"要不要问用户"那一格的**全部**分支。
 *
 * 为什么要有这一份，而不靠集成套件里那一臂：集成那趟跑在明文回环测试服务器上，
 * 目的地永远算成 `none`（共享层按端点算，不按 flag 算），于是"要出境而没授权 ⇒ 拒"
 * 与"托管白名单 ⇒ 放行"那两支在本地**根本走不到** —— 硬凑就得把字节发到一个真地址上。
 * 这一份把判定本身逐臂钉住：它不发任何请求，因此也不需要一个能发请求的对象。
 *
 * 🔴 每一臂都写清了它挡的那种失法。最贵的是 4 与 6：
 * 它们挡的是"为了让链跑绿，把批准的话与发出去的字节分开写"。
 */
import { describe, expect, it } from 'vitest';
import { planWorkerRun, type WorkerRunRequest } from '../src/inbound-worker.js';
import type { SecretStore } from '@heyta/ai';

/** 一枚够用的假存储：这里只判"有没有把 Store 递进去"，不判钥匙串。 */
const secretStore: SecretStore = { get: async () => undefined };

/** 境内托管白名单上的那个主机（表在 `@heyta/ai/src/managed-endpoints.ts`，这里不另抄一份规则）。 */
const MANAGED_SERVER = 'https://heyta.waytofuture.cn';

const endpointRequest = (over: Partial<WorkerRunRequest> = {}): WorkerRunRequest => ({
  serverUrl: 'https://account.example.cn',
  mode: 'endpoint',
  endpointUrl: 'https://gpu.example.cn/v1',
  endpointModel: 'some-model',
  endpointKeyId: 'my-gpu',
  secretStore,
  now: () => 1_700_000_000_000,
  ...over,
});

describe('planWorkerRun —— 出境授权的每一支', () => {
  it('① 自带远端端点 + 正确的词 ⇒ 放行，并记下这一次授权', () => {
    const plan = planWorkerRun(endpointRequest({ approveEgress: 'user-endpoint' }));
    expect(plan.destination).toBe('user-endpoint');
    // 同意记录必须**逐项对得上**：功能是自动收集、目的地是被算出来的那一个、时刻是 now。
    expect(plan.consents).toEqual([{ feature: 'inbound-automation', destination: 'user-endpoint', grantedAt: 1_700_000_000_000 }]);
    expect(plan.routing.mode).toBe('own');
    expect(plan.routing.endpoints[0]?.capabilities).toContain('structured_output');
  });

  it('② 自带远端端点、少了词 ⇒ 拒，且说的是缺哪一个词（挡"默认放行"）', () => {
    expect(() => planWorkerRun(endpointRequest())).toThrow(/--approve-egress <user-endpoint>/);
  });

  it('③ 词表之外的自造词 ⇒ 拒（挡"把授权给了一个不存在的目的地"）', () => {
    expect(() => planWorkerRun(endpointRequest({ approveEgress: 'local' }))).toThrow(/只接受 heyta-cloud 或 user-endpoint/);
  });

  it('④ 🔴 远端自带端点却批准 heyta-cloud ⇒ 拒（假披露：说"到了 heyta 手里"，实际发到别人家）', () => {
    const error = (() => { try { planWorkerRun(endpointRequest({ approveEgress: 'heyta-cloud' })); return undefined; } catch (e) { return e as Error; } })();
    expect(error?.message).toMatch(/错配/);
    expect(error?.message).toMatch(/--approve-egress user-endpoint/);
  });

  it('⑤ 白名单上的 --server + heyta-cloud ⇒ 放行，路由里确实是托管端点', () => {
    const plan = planWorkerRun({ serverUrl: MANAGED_SERVER, mode: 'managed', approveEgress: 'heyta-cloud', now: () => 1_700_000_000_000 });
    expect(plan.destination).toBe('heyta-cloud');
    expect(plan.consents).toEqual([{ feature: 'inbound-automation', destination: 'heyta-cloud', grantedAt: 1_700_000_000_000 }]);
    expect(plan.routing.mode).toBe('managed');
    expect(plan.routing.routes['inbound-automation']?.[0]?.endpointId).toBe('heyta-managed');
  });

  it('⑥ 🔴 不在白名单上的 --server 走托管档 ⇒ 拒，且**不许命令行改口**（ADR-0056 §3.3 那个洞）', () => {
    // 这一臂是本文件最值钱的一臂：一台自托管服务器完全可以让 CLI 闭眼说"明文到了 heyta 手里"，
    // 而那句话是产品对用户的隐私承诺本身。拒它的必须是共享层算出来的目的地，不是这里的偏好。
    expect(() => planWorkerRun({ serverUrl: 'https://my-box.example.cn', mode: 'managed', approveEgress: 'heyta-cloud' }))
      .toThrow(/不是托管目的地/);
    expect(() => planWorkerRun({ serverUrl: 'http://127.0.0.1:3000', mode: 'managed', approveEgress: 'heyta-cloud' }))
      .toThrow(/不是托管目的地/);
  });

  it('⑦ 回环端点（明文不出设备）⇒ 放行且**不记任何同意**', () => {
    const plan = planWorkerRun(endpointRequest({ endpointUrl: 'http://127.0.0.1:11434/v1' }));
    expect(plan.destination).toBe('none');
    expect(plan.consents).toEqual([]);
    // 这句是给人看的：它必须说清"没出境"，而不是留一句含糊的"已授权"。
    expect(plan.destinationLabel).toContain('明文不出这台设备');
  });

  it('⑧ 回环端点上挂一句用不上的授权 ⇒ 拒（挡"同意记录变成装饰"）', () => {
    expect(() => planWorkerRun(endpointRequest({ endpointUrl: 'http://localhost:11434/v1', approveEgress: 'user-endpoint' })))
      .toThrow(/明文不出这台设备/);
  });

  it('⑨ 自带端点缺参数 / 两档都给 ⇒ 拒，并指回钥匙串那条路（密钥不进 argv）', () => {
    expect(() => planWorkerRun(endpointRequest({ endpointKeyId: undefined }))).toThrow(/ai key set/);
    expect(() => planWorkerRun(endpointRequest({ secretStore: undefined }))).toThrow(/SecretStore/);
    expect(() => planWorkerRun(endpointRequest({ endpointUrl: '   ' }))).toThrow(/--ai-endpoint/);
  });

  it('⑩ 间隔与 --once 原样递下去（"多久一趟"的下限由共享层判，这里不另立一套）', () => {
    const plan = planWorkerRun(endpointRequest({ approveEgress: 'user-endpoint', intervalMs: 5_000, once: true }));
    expect(plan.intervalMs).toBe(5_000);
    expect(plan.once).toBe(true);
    expect(planWorkerRun(endpointRequest({ approveEgress: 'user-endpoint' })).intervalMs).toBe(30_000);
  });
});
