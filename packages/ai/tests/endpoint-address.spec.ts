/**
 * 端点地址**类别**测试（ADR-0053 §3.1 / §3.2）
 * ==========================================
 *
 * 这个文件盯三件事，顺序按"哪一条最容易被悄悄改掉"排：
 *
 *   1. 🔴 **只紧不松**（`下面那张冻住旧算法的表`）—— 补进类别维度**不许**让任何
 *      过去被判"远端"的地址变成"本机"。判据不是注释，是一份**旧算法的冻结副本**：
 *      新判定比旧判定宽，表就红。
 *   2. **逐档正反样本** —— 五档各有输入，且 `known: false` 的分支必须带 `reason`。
 *   3. **形状不许骗人** —— `category === 'loopback'` 与 `isLoopbackEndpoint()`
 *      必须同进同出；消费者拿到 `known: false` 时**不可能**读到具体类别。
 */

import { describe, expect, it } from 'vitest';

import {
  AiConfigError,
  assertEnableable,
  classifyDestination,
  classifyEndpointAddress,
  createProvider,
  describeEndpointAddress,
  isLoopbackAddress,
  isLoopbackEndpoint,
  requiresEgressConsent,
  type EndpointAddressCategory,
} from '../src/index.js';

/**
 * 🔴 **旧算法的冻结副本**（改动前的 `supply.ts` L73-88 逐字搬来，只改了函数名）。
 *
 * 为什么要在测试里留一份旧的：这一轮承诺的是"只紧不松"，而**新算法自己证明自己
 * 不比旧的宽**是空话。判据必须有一个不依赖被测实现的对照物。
 *
 * ⚠️ 这段代码**不许"顺手改进"** —— 它的全部价值就在于它是 2026-10-05 之前那一版。
 * 哪天 `isLoopbackEndpoint` 被合法地放宽了（要新 ADR），删掉它、并把这张表换成
 * 当时的对照物，而不是把它改成和新实现一样。
 */
function legacyIsLoopback(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === '::1' || host === '[::1]') return true;
  if (host === 'localhost') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

/** 旧算法在 `own` 模式下推导出的目的地（空端点 → none，回环 → none，其余 → user-endpoint）。 */
function legacyDestination(endpoint: string): 'none' | 'user-endpoint' {
  if (endpoint === '') return 'none';
  return legacyIsLoopback(endpoint) ? 'none' : 'user-endpoint';
}

const SAMPLES: readonly string[] = [
  // 回环
  'http://localhost:11434/v1',
  'https://LOCALHOST/v1',
  'http://127.0.0.1:1234/v1',
  'http://127.1.2.3:8080/v1',
  'http://[::1]:11434/v1',
  'http://[::1]/v1',
  // URL 会把非规范 IPv4 写法折叠成点分十进制（实测）—— 旧算法因此也认它们是回环
  'http://127.1/v1',
  'http://2130706433/v1',
  'http://0177.0.0.1/v1',
  // 链路本地
  'http://169.254.1.1:11434/v1',
  'http://[fe80::1]/v1',
  // 私网
  'http://10.0.0.5:11434/v1',
  'http://172.16.0.1/v1',
  'http://172.31.255.255/v1',
  'http://192.168.1.20:11434/v1',
  'http://100.64.0.1/v1',
  'http://[fd00::1]/v1',
  // 公网字面量
  'https://1.1.1.1/v1',
  'https://8.8.8.8:443/v1',
  'https://172.15.0.1/v1',
  'https://100.63.0.1/v1',
  // 域名 / 局域网命名形态 / 单标签
  'https://api.openai.com/v1',
  'https://api.deepseek.com/v1',
  'http://my-nas.lan:11434/v1',
  'http://nas.local/v1',
  'http://router.home.arpa/v1',
  'http://box.internal/v1',
  'http://lamp.home/v1',
  'http://myhost/v1',
  'http://localhost.evil.com/v1',
  'http://a.localhost/v1',
  'http://./v1',
  // 保留与特殊用途段
  'http://0.0.0.0:11434/v1',
  'http://224.0.0.1/v1',
  'http://239.255.255.255/v1',
  'http://240.0.0.1/v1',
  'http://255.255.255.255/v1',
  'http://192.0.0.1/v1',
  'http://192.0.2.1/v1',
  'http://192.88.99.1/v1',
  'http://198.18.0.1/v1',
  'http://198.19.0.1/v1',
  'http://198.51.100.5/v1',
  'http://203.0.113.5/v1',
  'http://[::]/v1',
  'http://[::2]/v1',
  'http://[fc00::1]/v1',
  'http://[2001:db8::1]/v1',
  // 穿不透的两类（旧算法同样判远端）
  'http://[::ffff:127.0.0.1]/v1',
  'http://user:pw@127.0.0.1/v1',
  'http://127.0.0.1:80@evil.com/v1',
  // 解析不出来的写法
  'not a url',
  'localhost:11434',
  'ftp://127.0.0.1/v1',
  'http://[fe80::1%25en0]/v1',
  'http://[0:0:0:0:0:0:1]/v1',
  // 空端点
  '',
];

describe('🔴 只紧不松：新判定不许比 2026-10-05 之前那一版宽', () => {
  it(`样本表非空（现量 ${SAMPLES.length} 条）`, () => {
    // 一条对空表跑的判据是装饰。样本被删空 ⇒ 这里红，而不是"全绿"。
    expect(SAMPLES.length).toBeGreaterThanOrEqual(40);
    const v6 = SAMPLES.filter((s) => s.includes('['));
    expect(v6.length).toBeGreaterThanOrEqual(8);
  });

  it('回环面不扩大：新版说"本机"的，旧版必须也说是', () => {
    const widened: string[] = [];
    for (const sample of SAMPLES) {
      if (isLoopbackEndpoint(sample) && !legacyIsLoopback(sample)) widened.push(sample);
    }
    // 打印违规样本，不只报个布尔 —— 排障时要知道是哪一条。
    expect(widened).toEqual([]);
  });

  it('回环面也不缩小：旧版认的那些（e2e 与 verify 脚本正靠它们免授权）必须还认', () => {
    const narrowed: string[] = [];
    for (const sample of SAMPLES) {
      if (legacyIsLoopback(sample) && !isLoopbackEndpoint(sample)) narrowed.push(sample);
    }
    expect(narrowed).toEqual([]);
  });

  it('自备模式的目的地逐条等于旧算法的结论', () => {
    for (const sample of SAMPLES) {
      expect(classifyDestination({ mode: 'own', endpoint: sample }), sample).toBe(
        legacyDestination(sample),
      );
    }
  });

  it('需要授权的样本一个都不许变成免授权（把目的地折叠成"要不要问用户"再比）', () => {
    for (const sample of SAMPLES) {
      const before = requiresEgressConsent(legacyDestination(sample));
      const after = requiresEgressConsent(classifyDestination({ mode: 'own', endpoint: sample }));
      if (before) expect(after, `${sample} 从要授权变成了免授权`).toBe(true);
    }
  });
});

describe('classifyEndpointAddress —— 五档逐条正反样本', () => {
  const cases: ReadonlyArray<{ endpoint: string; category: EndpointAddressCategory; known: boolean }> = [
    { endpoint: 'http://localhost:11434/v1', category: 'loopback', known: true },
    { endpoint: 'http://127.0.0.1/v1', category: 'loopback', known: true },
    { endpoint: 'http://[::1]/v1', category: 'loopback', known: true },
    { endpoint: 'http://169.254.1.1/v1', category: 'link-local', known: true },
    { endpoint: 'http://[fe80::1]/v1', category: 'link-local', known: true },
    { endpoint: 'http://10.0.0.5/v1', category: 'private', known: true },
    { endpoint: 'http://172.16.0.1/v1', category: 'private', known: true },
    { endpoint: 'http://192.168.1.20/v1', category: 'private', known: true },
    { endpoint: 'http://100.64.0.1/v1', category: 'private', known: true },
    { endpoint: 'http://[fd00::1]/v1', category: 'private', known: true },
    { endpoint: 'https://1.1.1.1/v1', category: 'public', known: true },
    { endpoint: 'https://172.15.0.1/v1', category: 'public', known: true },
    { endpoint: 'https://api.openai.com/v1', category: 'unknown', known: false },
    { endpoint: 'http://my-nas.lan:11434/v1', category: 'unknown', known: false },
    { endpoint: 'http://nas.local/v1', category: 'unknown', known: false },
    { endpoint: 'http://myhost/v1', category: 'unknown', known: false },
    { endpoint: 'http://0.0.0.0/v1', category: 'unknown', known: false },
    { endpoint: 'http://[::ffff:127.0.0.1]/v1', category: 'unknown', known: false },
    { endpoint: 'not a url', category: 'unknown', known: false },
    { endpoint: '', category: 'unknown', known: false },
  ];

  it('每条样本落在预期的档位上', () => {
    for (const { endpoint, category, known } of cases) {
      const classified = classifyEndpointAddress(endpoint);
      expect(classified.category, endpoint).toBe(category);
      expect(classified.known, endpoint).toBe(known);
    }
  });

  it('链路本地、私网两档**不**免出境授权（补维度 ≠ 放宽）', () => {
    for (const endpoint of [
      'http://169.254.1.1/v1',
      'http://[fe80::1]/v1',
      'http://10.0.0.5/v1',
      'http://192.168.1.20:11434/v1',
      'http://100.64.0.1/v1',
      'http://[fd00::1]/v1',
    ]) {
      expect(classifyEndpointAddress(endpoint).known, endpoint).toBe(true);
      expect(classifyDestination({ mode: 'own', endpoint }), endpoint).toBe('user-endpoint');
      expect(requiresEgressConsent('user-endpoint'), endpoint).toBe(true);
    }
  });

  it('蜂窝/运营商 NAT 那一档现在**能被表达**：100.64/10 是 private，且照旧要授权', () => {
    // B34 那条"蜂窝算不算远程"过去在类型上没有主语。现在有了：
    // 类别能问出来，而答案是"不免授权" —— 于是那一问不再是开放问题。
    const classified = classifyEndpointAddress('http://100.64.0.1/v1');
    expect(classified.known && classified.category).toBe('private');
    expect(classifyDestination({ mode: 'own', endpoint: 'http://100.64.0.1/v1' })).toBe(
      'user-endpoint',
    );
  });

  it('未定性一律按最严的一档：绝不可能免授权', () => {
    for (const sample of SAMPLES) {
      const classified = classifyEndpointAddress(sample);
      if (classified.known) continue;
      expect(classified.category).toBe('unknown');
      expect(typeof classified.reason).toBe('string');
      // ⚠️ `''` 是唯一一条"未定性但目的地是 none"的样本，而那是**既有**规则、不是放宽：
      // `classifyDestination` 把"端点还没配"读成"还没到能出境的状态"（配置缺口由
      // provider 层报 `endpoint-required`，不是隐私事件）。旧算法对空串得到同一个结论，
      // 上面那张"只紧不松"的表已经逐条钉住了这一点 —— 这里把它单独说破，
      // 免得下一个读代码的人以为这是本轮开的口子。
      if (sample === '') continue;
      expect(classifyDestination({ mode: 'own', endpoint: sample }), sample).not.toBe('none');
    }
    // 明说这条既有语义（而不是只靠上面的 `continue` 绕过）：空端点是**配置缺口**，
    // 而"配置缺口"由 `assertEnableable` 报 `endpoint-required` 去管，不是隐私结论。
    expect(classifyDestination({ mode: 'own', endpoint: '' })).toBe('none');
    expect(classifyDestination({ mode: 'own' })).toBe('none');
    expect(() => {
      assertEnableable({ mode: 'own', endpoint: '' });
    }).toThrow(AiConfigError);
  });

  it('局域网命名形态在**形状里**可见（reason 而不是注释）', () => {
    for (const endpoint of [
      'http://nas.local/v1',
      'http://router.home.arpa/v1',
      'http://box.internal/v1',
      'http://my-nas.lan/v1',
      'http://lamp.home/v1',
    ]) {
      const classified = classifyEndpointAddress(endpoint);
      expect(classified.known, endpoint).toBe(false);
      if (!classified.known) expect(classified.reason, endpoint).toBe('lan-name');
    }
    // 反向：公网域名不许被说成局域网形态 —— 那会把"我们不知道它在哪"
    // 伪装成"它在你网络里"，是往宽松方向漂的第一步。
    for (const endpoint of ['https://api.openai.com/v1', 'http://a.localhost/v1']) {
      const classified = classifyEndpointAddress(endpoint);
      if (!classified.known) expect(classified.reason, endpoint).toBe('domain');
    }
  });

  it('单标签主机名与"没配"是两个不同的 reason', () => {
    const single = classifyEndpointAddress('http://myhost/v1');
    expect(!single.known && single.reason).toBe('unqualified-name');
    const empty = classifyEndpointAddress('');
    expect(!empty.known && empty.reason).toBe('empty');
    const missing = classifyEndpointAddress(undefined);
    expect(!missing.known && missing.reason).toBe('empty');
    const garbage = classifyEndpointAddress('not a url');
    expect(!garbage.known && garbage.reason).toBe('unparseable');
  });

  it('IPv4 映射的 IPv6 字面量按最严处理（它是唯一"类别更宽但故意不采纳"的一档）', () => {
    const mapped = classifyEndpointAddress('http://[::ffff:127.0.0.1]/v1');
    expect(mapped.known).toBe(false);
    if (!mapped.known) expect(mapped.reason).toBe('ipv4-mapped-ipv6');
    // 它实际连得到回环，但字面量层看不穿 ⇒ 不许免授权（旧判定同样要授权）。
    expect(isLoopbackEndpoint('http://[::ffff:127.0.0.1]/v1')).toBe(false);
  });

  it('保留段不许被说成公网', () => {
    for (const endpoint of [
      'http://0.0.0.0/v1',
      'http://224.0.0.1/v1',
      'http://240.0.0.1/v1',
      'http://192.0.2.1/v1',
      'http://198.18.0.1/v1',
      'http://198.51.100.5/v1',
      'http://203.0.113.5/v1',
      'http://192.88.99.1/v1',
      'http://[::]/v1',
      'http://[fc00::1]/v1',
      'http://[2001:db8::1]/v1',
    ]) {
      const classified = classifyEndpointAddress(endpoint);
      expect(classified.category, endpoint).toBe('unknown');
      if (!classified.known) expect(classified.reason, endpoint).toBe('reserved');
    }
  });
});

describe('形状不许骗人', () => {
  it('known === true 的样本，category 与 isLoopbackEndpoint 同进同出', () => {
    for (const sample of SAMPLES) {
      const classified = classifyEndpointAddress(sample);
      const claimsLoopback = classified.known && classified.category === 'loopback';
      expect(claimsLoopback, sample).toBe(isLoopbackEndpoint(sample));
      expect(isLoopbackAddress(sample)).toBe(isLoopbackEndpoint(sample));
    }
  });

  it('localhost 只认这一个精确字面量', () => {
    expect(classifyEndpointAddress('http://localhost/v1').known).toBe(true);
    expect(classifyEndpointAddress('https://LOCALHOST/v1').category).toBe('loopback');
    for (const near of ['http://a.localhost/v1', 'http://localhost.evil.com/v1', 'http://localhost./v1']) {
      expect(classifyEndpointAddress(near).category, near).toBe('unknown');
      expect(classifyEndpointAddress(near).known, near).toBe(false);
    }
  });

  it('describeEndpointAddress 把"已定性"和"未定性"说得开出来', () => {
    const local = describeEndpointAddress(classifyEndpointAddress('http://127.0.0.1/v1'));
    const openai = describeEndpointAddress(classifyEndpointAddress('https://api.openai.com/v1'));
    expect(local).toContain('字面量已定性');
    expect(local).toContain('loopback');
    expect(openai).toContain('未定性');
    expect(openai).toContain('reason=domain');
  });
});

describe('🔴 发送点复算：构造之后改端点，一个请求都不发', () => {
  it('localhost 被改成远端 ⇒ 拒，且 fetch 一次都没被调用', async () => {
    const calls: string[] = [];
    const fetchImpl = ((url: unknown) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '不该被发出去' } }] }),
      });
    }) as unknown as typeof fetch;

    const config = { mode: 'own' as const, endpoint: 'http://localhost:11434/v1', model: 'm' };
    const provider = createProvider(config, { fetchImpl });
    expect(provider.destination).toBe('none');

    // 构造之后改写配置对象（导入 / 同步 / 手工改存储都会这样）。
    config.endpoint = 'https://api.openai.com/v1';

    const result = await provider.invoke(
      { feature: 'capture', system: 's', user: '帮我记一条', fields: ['title'] },
      // ⚠️ 空授权队列：目的地是 `none` 时闸门本来就**不索要授权** ——
      // 正因如此，"端点被换掉而目的地没重算"才是那个不会被任何闸门拦住的洞。
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('http-error');
    expect(calls).toEqual([]);
  });

  it('对照组：端点没被改动时，同一条链路真的发一次请求（挡"复算把一切都不发"）', async () => {
    const calls: string[] = [];
    const fetchImpl = ((url: unknown) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '好的' } }] }),
      });
    }) as unknown as typeof fetch;

    const provider = createProvider(
      { mode: 'own', endpoint: 'http://localhost:11434/v1', model: 'm' },
      { fetchImpl },
    );
    const result = await provider.invoke(
      { feature: 'capture', system: 's', user: '帮我记一条', fields: ['title'] },
      [],
    );
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
  });
});
