import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gatewayEgressAllowance, saveGatewayUpstreams } from '../src/ai/gateway-store';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('gatewayEgressAllowance', () => {
  it('http 上游 → 进入 plaintextHosts + hosts(cn)', () => {
    const d = mkdtempSync(join(tmpdir(), 'gwa-'));
    dirs.push(d);
    const file = join(d, 'gw.json');
    saveGatewayUpstreams([
      { id: 'pp', label: 'PP', baseUrl: 'http://43.161.222.56:8080/pp2/v1', apiKey: 'k', modelId: 'm', enabled: true, weight: 1, priority: 0 },
      { id: 'd', label: 'D', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', modelId: 'm', enabled: true, weight: 1, priority: 1 },
    ], {}, file);
    const a = gatewayEgressAllowance({}, file);
    expect(a.plaintextHosts).toEqual(['43.161.222.56']);
    expect(a.hosts).toEqual([{ host: '43.161.222.56', provider: 'PP', jurisdiction: 'cn', evidence: expect.any(String) }]);
  });
});
