/**
 * G-44b —— `createSyncClient()` 那条**版本号默认值**是承重的
 * ==========================================================
 *
 * `appVersion` 这条查询参数有消费者没有生产者（台账 G-44）：服务端逐设备记它
 * （`server/src/sync/sync.routes.ts` 的 `touchDevice`），运营面那张设备清单读它，
 * 而全仓库没有任何一处发过。上一轮把机制补到"宿主注入、缺省一个字都不发"（`b467e758`）
 * 之后**停在原地** —— 每个宿主都得记得传，而没有一个宿主有值可传。
 *
 * 🔴 这一轮改的是**归属**：版本号不是平台差异（AGENTS §3.5 里 `apps/*` 只许有一处差异，
 * 那是注入哪个 SQLite 驱动），它是产品语义 ⇒ 真源在仓库根 `package.json`，
 * 经 `scripts/gen-app-version.mjs` 生成到 `app-version.generated.ts`，由接线统一给。
 * "让每个宿主记得传"正是这件事烂在原地的成因，所以默认值不是便利，是**这条链唯一的上游**。
 *
 * 这里量的不是"SyncClient 会不会把参数拼进查询串"（那是 `packages/sync-client/tests/sync.spec.ts`
 * 那两腿的事），而是"**接线有没有把版本交到 SyncClient 手上**"。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));

vi.mock('@heyta/sync-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // 只换构造函数：捕获传进去的选项，其余模块表面保持真实。
    SyncClient: class {
      constructor(options: Record<string, unknown>) {
        captured.options = options;
      }
    },
  };
});

import type { OpLogEngine } from '@heyta/op-log';
import type { OpLogStore } from '@heyta/storage';
import { HEYTA_APP_VERSION } from '../src/app-version.generated.js';
import { createSyncClient, type SyncWiringOptions } from '../src/sync-wiring.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function wiring(over: Partial<SyncWiringOptions> = {}): SyncWiringOptions {
  return {
    engine: { getClientId: () => 'device-x' } as unknown as OpLogEngine,
    store: {} as unknown as OpLogStore<never>,
    baseUrl: 'https://sync.test',
    getToken: async () => 'token',
    getPassword: async () => 'password',
    applyRemote: async () => undefined,
    encryptionMode: 'password' as const,
    ...over,
  } as SyncWiringOptions;
}

/** 传进 `SyncClient` 的那个版本号；没传就是 `undefined`（= 沉默那一档）。 */
function capturedAppVersion(): string | undefined {
  const value = captured.options?.['appVersion'];
  if (value === undefined) return undefined;
  expect(typeof value, `appVersion 不是字符串：${String(value)}`).toBe('string');
  return value as string;
}

describe('createSyncClient 的客户端版本号', () => {
  it('🔴 宿主一个字都不传时，装的默认值就是生成物那份（不是空、不是占位值）', () => {
    createSyncClient(wiring());
    const sent = capturedAppVersion();
    expect(sent, '接线没把版本交给 SyncClient = 设备清单上那一列永远是空').toBeDefined();
    expect(sent).toBe(HEYTA_APP_VERSION);
    // 占位值不许当版本发：发出去就是把假版本写进运营面那份设备清单。
    expect(sent, '占位值 0.0.0 不是版本号').not.toBe('0.0.0');
    expect(sent, '空串会被服务端按"沉默"记，等于什么都没做').not.toBe('');
  });

  it('生成物与真源（仓库根 package.json 的 version）逐字相同', () => {
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { version?: string };
    expect(
      HEYTA_APP_VERSION,
      `生成物是 ${HEYTA_APP_VERSION}，真源 package.json 是 ${String(source.version)}` +
        ' ⇒ 要么生成物被手改了，要么真源动过没重跑 `node scripts/gen-app-version.mjs`',
    ).toBe(source.version);
  });

  it('宿主自己给了就用宿主那份（另构建一份客户端的人要能覆盖）', () => {
    createSyncClient(wiring({ appVersion: '9.9.9' }));
    expect(capturedAppVersion()).toBe('9.9.9');
  });
});
