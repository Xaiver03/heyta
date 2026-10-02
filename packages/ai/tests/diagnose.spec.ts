/**
 * 跨源失败诊断测试
 * ==================
 *
 * 这个文件测的不是"功能"，而是**一条不许变聪明的规则**：
 * 只有"端点在本机 **且** 宿主不住在本机"两个条件同时成立，才允许对用户说
 * "多半是你的来源被拒了"。其余一切情形都必须退回 `transient-network`。
 *
 * 为什么这条规则要钉死（实测 2026-10-02，Ollama 0.23.2，见 ADR-0045 §4）：
 *
 *   | 请求来源 | Ollama 的回应 |
 *   |---|---|
 *   | 无 `Origin` | 200 |
 *   | `http://127.0.0.1:4321` | 200 + 回显 `Access-Control-Allow-Origin` |
 *   | `https://heyta.waytofuture.cn` | **403，完全没有 `ACAO`** |
 *
 *   403 不带 `ACAO` ⇒ 浏览器把它拦成 `TypeError: Failed to fetch` ⇒
 *   `routing.ts` 只能归成 `'network'`。所以**状态码这条路技术上不存在**，
 *   能用的只有下面这张表里的配置推导。
 *
 * 🔴 两类错误不对称，决定了默认值：
 *   - 把网络抖动说成"来源被拒" ⇒ 用户去改一个**根本不用改**的白名单，
 *     而且那是一次**放宽**（把新来源放进本机服务的允许列表）—— 一个由他做出的
 *     安全决定，被一次误诊诱导出来。
 *   - 把来源被拒说成"检查网络" ⇒ 少了一句指引，但没有多余动作。
 *   所以**任何未知量都走后面那条**：`undefined` 一律 `transient-network`，
 *   非 `network` 的原因码一律不诊断。
 *
 * ⚠️ 变异验证（交付时实际跑过，结果写在实施报告里）：
 *   1. 把 `diagnoseNetworkFailure` 改成恒返回 `transient-network` ⇒ 本文件的
 *      "origin-likely-rejected" 那一档必须整片红；
 *   2. 反过来把它改成恒返回 `origin-likely-rejected` ⇒ 那五条**保守方向**的
 *      用例必须红。只钉一个方向的表是半个门禁。
 */

import { describe, expect, it } from 'vitest';

import {
  diagnoseNetworkFailure,
  originToWhitelist,
  type NetworkFailureSignal,
} from '../src/index.js';

/** 生产 Web 壳的来源（HTTPS 域名，非回环）—— 实测被 Ollama 回 403 的那个。 */
const PROD_ORIGIN = 'https://heyta.waytofuture.cn';
/** 开发机上的 vite / 落地页：字面回环，实测被放行。 */
const LOOPBACK_ORIGIN = 'http://127.0.0.1:5173';
/** 内置预设 1：Ollama。 */
const OLLAMA = 'http://localhost:11434/v1';
/** 内置预设 2：LM Studio。 */
const LM_STUDIO = 'http://127.0.0.1:1234/v1';
/** 用户自备的远程端点。 */
const REMOTE = 'https://api.example.com/v1';

function signal(overrides: Partial<NetworkFailureSignal>): NetworkFailureSignal {
  return { reason: 'network', endpointUrl: OLLAMA, hostOrigin: PROD_ORIGIN, ...overrides };
}

describe('diagnoseNetworkFailure —— 只有两个条件同时成立才说"来源被拒"', () => {
  it('表驱动：每一行的期望值都是实测结论，不是猜测', () => {
    const cases: readonly { name: string; signal: NetworkFailureSignal; want: string }[] = [
      {
        name: '回环端点 + 生产域名宿主 ⇒ 来源被拒',
        signal: signal({ endpointUrl: OLLAMA, hostOrigin: PROD_ORIGIN }),
        want: 'origin-likely-rejected',
      },
      {
        name: '回环端点（LM Studio 预设）+ 生产域名宿主 ⇒ 来源被拒',
        signal: signal({ endpointUrl: LM_STUDIO, hostOrigin: PROD_ORIGIN }),
        want: 'origin-likely-rejected',
      },
      {
        name: 'IPv6 回环端点 + 生产域名宿主 ⇒ 来源被拒（回环写法不影响结论）',
        signal: signal({ endpointUrl: 'http://[::1]:11434/v1', hostOrigin: PROD_ORIGIN }),
        want: 'origin-likely-rejected',
      },
      {
        name: '原生壳的来源（自定义 scheme）也算非回环 ⇒ 来源被拒',
        signal: signal({ endpointUrl: OLLAMA, hostOrigin: 'heyta-local://app' }),
        want: 'origin-likely-rejected',
      },
      {
        name: '两个内置预设 + Windows 壳的 https://heyta.local ⇒ 来源被拒',
        signal: signal({ endpointUrl: OLLAMA, hostOrigin: 'https://heyta.local' }),
        want: 'origin-likely-rejected',
      },
      {
        name: '🔴 回环端点 + 回环宿主 ⇒ 暂时性（实测这一档是被**放行**的）',
        signal: signal({ endpointUrl: OLLAMA, hostOrigin: LOOPBACK_ORIGIN }),
        want: 'transient-network',
      },
      {
        name: '回环端点 + localhost 宿主 ⇒ 暂时性',
        signal: signal({ endpointUrl: OLLAMA, hostOrigin: 'http://localhost:5173' }),
        want: 'transient-network',
      },
      {
        name: '远程端点 + 生产域名宿主 ⇒ 暂时性（跨源解释不了：远程端点本来就要带 Origin）',
        signal: signal({ endpointUrl: REMOTE, hostOrigin: PROD_ORIGIN }),
        want: 'transient-network',
      },
      {
        name: '远程端点 + 回环宿主 ⇒ 暂时性',
        signal: signal({ endpointUrl: REMOTE, hostOrigin: LOOPBACK_ORIGIN }),
        want: 'transient-network',
      },
      {
        name: '局域网 IP 端点（我们证明不了它在本机）⇒ 暂时性',
        signal: signal({ endpointUrl: 'http://192.168.1.7:11434/v1', hostOrigin: PROD_ORIGIN }),
        want: 'transient-network',
      },
      {
        name: '端点地址非法（解析不出主机名 ⇒ isLoopbackEndpoint 判远端）⇒ 暂时性',
        signal: signal({ endpointUrl: 'not-a-url', hostOrigin: PROD_ORIGIN }),
        want: 'transient-network',
      },
      {
        name: '空字符串端点 ⇒ 暂时性（未知量不猜）',
        signal: signal({ endpointUrl: '', hostOrigin: PROD_ORIGIN }),
        want: 'transient-network',
      },
    ];

    for (const { name, signal: s, want } of cases) {
      expect(diagnoseNetworkFailure(s), name).toBe(want);
    }
  });

  it('🔴 未知量一律不猜：endpointUrl 或 hostOrigin 缺失 ⇒ 暂时性', () => {
    // 少了端点 URL：诊断没有输入，只能闭嘴。
    expect(diagnoseNetworkFailure({ reason: 'network', endpointUrl: undefined, hostOrigin: PROD_ORIGIN })).toBe(
      'transient-network',
    );
    // 少了宿主来源（node-host、SSR、jsdom 的 'null' 都被上游洗成 undefined）。
    expect(diagnoseNetworkFailure({ reason: 'network', endpointUrl: OLLAMA, hostOrigin: undefined })).toBe(
      'transient-network',
    );
    // 两个都缺。
    expect(diagnoseNetworkFailure({ reason: 'network', endpointUrl: undefined, hostOrigin: undefined })).toBe(
      'transient-network',
    );
  });

  it('🔴 只有 network 值得诊断：其余原因码传输层已经知道答案了', () => {
    // `http-error` 说明**请求真的发出去并拿到了状态码** ⇒ 跨源拦不住它，
    // 所以那一档根本不是本函数该插嘴的地方（它有别的词条与别的落点）。
    expect(diagnoseNetworkFailure({ reason: 'http-error', endpointUrl: OLLAMA, hostOrigin: PROD_ORIGIN })).toBe(
      'transient-network',
    );
    for (const reason of [
      'not-configured',
      'egress-not-authorized',
      'empty-response',
      'no-route',
      'fallback-needs-consent',
    ] as const) {
      expect(
        diagnoseNetworkFailure({ reason, endpointUrl: OLLAMA, hostOrigin: PROD_ORIGIN }),
        `${reason} 不该被诊断成来源被拒`,
      ).toBe('transient-network');
    }
    // 原因码缺失（模块被加载两份时的形状）同样不猜。
    expect(diagnoseNetworkFailure({ reason: undefined, endpointUrl: OLLAMA, hostOrigin: PROD_ORIGIN })).toBe(
      'transient-network',
    );
  });

  it('两个条件必须**同时**成立：任一换成回环/远程，结论就换向', () => {
    // 这四行合起来才是"且"：只钉成立的那一侧，把 && 改成 || 也不会红。
    expect(diagnoseNetworkFailure(signal({ endpointUrl: OLLAMA, hostOrigin: PROD_ORIGIN }))).toBe(
      'origin-likely-rejected',
    );
    expect(diagnoseNetworkFailure(signal({ endpointUrl: OLLAMA, hostOrigin: LOOPBACK_ORIGIN }))).toBe(
      'transient-network',
    );
    expect(diagnoseNetworkFailure(signal({ endpointUrl: REMOTE, hostOrigin: PROD_ORIGIN }))).toBe(
      'transient-network',
    );
    expect(diagnoseNetworkFailure(signal({ endpointUrl: REMOTE, hostOrigin: LOOPBACK_ORIGIN }))).toBe(
      'transient-network',
    );
  });
});

describe('originToWhitelist —— 给用户的必须是浏览器真发出去的那个串', () => {
  it('空与 undefined 都不给值（宁可不给，也不给一个复制过去没用的空串）', () => {
    expect(originToWhitelist('')).toBeUndefined();
    expect(originToWhitelist(undefined)).toBeUndefined();
  });

  it('🔴 其他一律**原样**返回：不去尾斜杠、不转小写、不补协议、不剥端口', () => {
    // 端点比对的是请求头里的 `Origin`，多一个斜杠、少一个端口都对不上。
    // 这里任何一次"顺手加工"都会让用户复制一个**用不了**的值。
    expect(originToWhitelist(PROD_ORIGIN)).toBe(PROD_ORIGIN);
    expect(originToWhitelist('https://heyta.waytofuture.cn/')).toBe('https://heyta.waytofuture.cn/');
    expect(originToWhitelist('http://localhost:5173')).toBe('http://localhost:5173');
    expect(originToWhitelist('heyta-local://app')).toBe('heyta-local://app');
    expect(originToWhitelist('HTTPS://Example.COM:8443')).toBe('HTTPS://Example.COM:8443');
  });

  it('与诊断同源：宿主来源原样成为要放行的值', () => {
    // 这两个函数必须对同一个 `hostOrigin` 给出一致的答案 ——
    // 诊断说"来源被拒"时给的那个值，就是这次失败里真的被拒的那个来源。
    const hostOrigin = 'https://heyta.example.test';
    expect(diagnoseNetworkFailure(signal({ hostOrigin }))).toBe('origin-likely-rejected');
    expect(originToWhitelist(hostOrigin)).toBe(hostOrigin);
  });
});
