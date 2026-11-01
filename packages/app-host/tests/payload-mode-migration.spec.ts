/**
 * ADR-0080 S6：关掉加密的**宿主编排**（整库解密重传）。
 *
 * 这一层不碰钥匙，只做三件事：把服务器上的历史翻完、逐条换成明文、走完 staging。
 * 判据集中在"失败时不许留下半密半明"：
 *   ① 解密失败 ⇒ 一条都不 begin；
 *   ② 翻页期间历史变了 ⇒ 一条都不 begin；
 *   ③ 服务端没到 PUBLISHED ⇒ 报错，不假装成功。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  disableVaultPayloadEncryption,
  DisableEncryptionError,
  enableVaultPayloadEncryption,
} from '../src/payload-mode-migration.js';

const op = (id: string, serverSeq: number) => ({
  id,
  serverSeq,
  clientId: 'device-a',
  actionType: 'CREATE_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: id,
  timestamp: 1,
  schemaVersion: 1,
  payload: `cipher-${id}`,
  causalFullState: false,
});

const page = (operations: ReturnType<typeof op>[], opts: { complete: boolean; nextCursor?: string; latestSeq?: number } = { complete: true }) => ({
  operations,
  latestSeq: opts.latestSeq ?? 7,
  retainedFromSeq: 1,
  complete: opts.complete,
  ...(opts.nextCursor === undefined ? {} : { nextCursor: opts.nextCursor }),
  snapshot: { present: false },
});

const stage = (state: 'STAGING' | 'PUBLISHED', overrides: Record<string, unknown> = {}) => ({
  requestId: 'req-1',
  state,
  targetMode: 'readable' as const,
  keyVersion: null,
  payloadKeyVersion: null,
  expectedLatestSeq: 7,
  expectedOperationCount: 2,
  uploadedOperationCount: 2,
  expectedPayloadBytes: 10,
  uploadedPayloadBytes: 10,
  expiresAt: Date.now() + 60_000,
  migratedOperationCount: state === 'PUBLISHED' ? 2 : 0,
  latestSeq: 7,
  ...overrides,
});

const baseOptions = (overrides: Record<string, unknown> = {}) => {
  const inventory = { getPage: vi.fn().mockResolvedValue(page([op('a', 1), op('b', 2)])) };
  const remote = {
    begin: vi.fn().mockResolvedValue(stage('STAGING')),
    uploadChunk: vi.fn().mockResolvedValue(stage('STAGING')),
    status: vi.fn().mockResolvedValue(stage('PUBLISHED')),
    commit: vi.fn().mockResolvedValue(stage('PUBLISHED')),
    cancel: vi.fn().mockResolvedValue(stage('PUBLISHED')),
  };
  return {
    inventory,
    remote,
    expectedKeyVersion: 1,
    requestId: 'req-1',
    decrypt: vi.fn(async (ciphertext: string) => JSON.stringify({ from: ciphertext })),
    ...overrides,
  } as any;
};

describe('disableVaultPayloadEncryption', () => {
  it('begin 带 readable、且不带包与世代；分片后 commit', async () => {
    const options = baseOptions();

    const result = await disableVaultPayloadEncryption(options);

    const manifest = options.remote.begin.mock.calls[0]![0];
    expect(manifest.targetMode).toBe('readable');
    expect(manifest.package).toBeUndefined();
    expect(manifest.targetPayloadKeyVersion).toBeUndefined();
    expect(manifest.expectedOperationCount).toBe(2);
    // 序号来自服务器第一页，不由调用方传。
    expect(manifest.expectedLatestSeq).toBe(7);
    expect(options.remote.uploadChunk).toHaveBeenCalledTimes(1);
    expect(options.remote.commit).toHaveBeenCalledWith('req-1');
    expect(result).toMatchObject({ requestId: 'req-1', migratedOperationCount: 2, latestSeq: 7 });
  });

  it('翻页期间历史变了 ⇒ 一条都不 begin', async () => {
    const inventory = {
      getPage: vi.fn()
        .mockResolvedValueOnce(page([op('a', 1)], { complete: false, nextCursor: 'c1', latestSeq: 7 }))
        .mockResolvedValueOnce(page([op('b', 2)], { complete: true, latestSeq: 9 })),
    };
    const options = baseOptions({ inventory });

    await expect(disableVaultPayloadEncryption(options)).rejects.toMatchObject({ code: 'inventory_changed' });
    expect(options.remote.begin).not.toHaveBeenCalled();
  });

  it('解密结果不是 JSON 对象 ⇒ 整体失败，不发布混合历史', async () => {
    const options = baseOptions({
      decrypt: vi.fn(async () => 'not json at all'),
    });

    await expect(disableVaultPayloadEncryption(options)).rejects.toBeInstanceOf(DisableEncryptionError);
    expect(options.remote.begin).not.toHaveBeenCalled();
    expect(options.remote.commit).not.toHaveBeenCalled();
  });

  it('服务端没到 PUBLISHED ⇒ 报错而不是"成功"', async () => {
    const options = baseOptions();
    options.remote.commit.mockResolvedValue(stage('STAGING'));

    await expect(disableVaultPayloadEncryption(options)).rejects.toMatchObject({ code: 'migration_failed' });
  });
});

describe('enableVaultPayloadEncryption（明文 → 加密）', () => {
  const plainPage = () => ({
    operations: [
      { ...op('a', 1), payload: JSON.stringify({ title: '买牛奶' }) },
      { ...op('b', 2), payload: JSON.stringify({ title: '交水费' }) },
    ],
    latestSeq: 7,
    retainedFromSeq: 1,
    complete: true,
    snapshot: { present: false },
  });

  const cipher = (): string => Buffer.alloc(44, 7).toString('base64');
  const keyPackage = (keyVersion: number) => ({
    version: 1 as const,
    keyVersion,
    rootKeyFingerprint: 'b'.repeat(64),
    passphrase: { kdf: 'argon2id' as const, salt: Buffer.alloc(16, 1).toString('base64'), iv: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(48, 3).toString('base64') },
    recovery: { kdf: 'argon2id' as const, salt: Buffer.alloc(16, 4).toString('base64'), iv: Buffer.alloc(12, 5).toString('base64'), ciphertext: Buffer.alloc(48, 6).toString('base64') },
  });

  const options = (overrides: Record<string, unknown> = {}) => {
    const inventory = { getPage: vi.fn().mockResolvedValue(plainPage()) };
    const remote = {
      begin: vi.fn().mockResolvedValue(stage('STAGING')),
      uploadChunk: vi.fn().mockResolvedValue(stage('STAGING')),
      status: vi.fn().mockResolvedValue(stage('PUBLISHED')),
      commit: vi.fn().mockResolvedValue(stage('PUBLISHED', { targetMode: 'e2ee', keyVersion: 1, payloadKeyVersion: 1 })),
      cancel: vi.fn().mockResolvedValue(stage('PUBLISHED')),
    };
    return {
      inventory,
      remote,
      package: keyPackage(1),
      requestId: 'turn-on-1',
      encrypt: vi.fn(async () => cipher()),
      ...overrides,
    } as any;
  };

  it('begin 带 e2ee 目标：起点版本 0、目标世代 1、且携带新包', async () => {
    const opts = options();

    await enableVaultPayloadEncryption(opts);

    const manifest = opts.remote.begin.mock.calls[0]![0];
    expect(manifest.targetMode).toBe('e2ee');
    expect(manifest.expectedKeyVersion).toBe(0);
    expect(manifest.targetPayloadKeyVersion).toBe(1);
    expect(manifest.package.keyVersion).toBe(1);
    expect(opts.remote.commit).toHaveBeenCalledWith('turn-on-1');
  });

  it('起点不是明文（已是密文）⇒ 拒绝，不发布混合历史', async () => {
    const opts = options({
      inventory: { getPage: vi.fn().mockResolvedValue({
        ...plainPage(),
        operations: [{ ...op('a', 1), payload: cipher() }],
      }) },
    });

    // 🔴 断言**具体那一句**：不加这层，经 JSON 解析失败也会回同一个 code，
    // 于是"删掉混合历史守卫"这条变异不会被抓住（第一次写这条测试时就发生了）。
    await expect(enableVaultPayloadEncryption(opts)).rejects.toThrow(/already ciphertext/u);
    expect(opts.remote.begin).not.toHaveBeenCalled();
  });

  it('密钥包不是 1 版 ⇒ 直接拒绝（re-encryption 必须从 1 起）', async () => {
    const opts = options({ package: keyPackage(2) });

    await expect(enableVaultPayloadEncryption(opts)).rejects.toMatchObject({ code: 'migration_failed' });
    expect(opts.remote.begin).not.toHaveBeenCalled();
  });

  it('加密结果不是 vault 信封 ⇒ 拒绝，不发布', async () => {
    const opts = options({ encrypt: vi.fn(async () => 'plain-looking-string') });

    await expect(enableVaultPayloadEncryption(opts)).rejects.toMatchObject({ code: 'migration_failed' });
    expect(opts.remote.begin).not.toHaveBeenCalled();
  });
});
