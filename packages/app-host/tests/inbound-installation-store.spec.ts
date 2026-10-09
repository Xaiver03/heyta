import { describe, expect, it } from 'vitest';
import { INDEXEDDB_SCHEMA, MemoryDbAdapter, STORES } from '@heyta/storage';
import { AUTOMATION_INSTALLATION_META_KEY, createAutomationInstallationMetaStore } from '../src/inbound-installation-store.js';
import { AutomationTicketError, loadOrCreateAutomationInstallationId } from '../src/inbound-entitlement-tickets.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';

const db = async () => { const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await adapter.init(); return adapter; };
const rawRow = async (adapter: Awaited<ReturnType<typeof db>>) =>
  adapter.get<{ key: string; value: unknown }>(STORES.META, AUTOMATION_INSTALLATION_META_KEY);

describe('automation installation identity store', () => {
  it('mints once, then the same id survives a rebuilt host instance', async () => {
    const adapter = await db();
    try {
      const first = await loadOrCreateAutomationInstallationId(createAutomationInstallationMetaStore(adapter));
      expect(first).toMatch(UUID);
      // 新建 store 实例 = 同一条持久化通道重启后重新接线，必须读到同一枚身份。
      expect(await loadOrCreateAutomationInstallationId(createAutomationInstallationMetaStore(adapter))).toBe(first);
      expect(await rawRow(adapter)).toEqual({ key: AUTOMATION_INSTALLATION_META_KEY, value: first });
    } finally { adapter.close(); }
  });

  it('refuses to overwrite a bound identity, and leaves the stored one intact', async () => {
    const adapter = await db();
    try {
      const store = createAutomationInstallationMetaStore(adapter);
      await store.save(FIRST);
      await expect(store.save(SECOND)).rejects.toThrow('INSTALLATION_ID_ALREADY_BOUND');
      expect(await store.load()).toBe(FIRST);
      // 两个并发首次调用都读到空时，后写的那个不能静默换掉身份。
      expect(await loadOrCreateAutomationInstallationId(store)).toBe(FIRST);
    } finally { adapter.close(); }
  });

  it('treats re-saving the same identity as a no-op', async () => {
    const adapter = await db();
    try {
      const store = createAutomationInstallationMetaStore(adapter);
      await store.save(FIRST);
      await expect(store.save(FIRST)).resolves.toBeUndefined();
      expect(await store.load()).toBe(FIRST);
    } finally { adapter.close(); }
  });

  it('fails closed on a corrupt row instead of reading it as a fresh installation', async () => {
    const adapter = await db();
    try {
      await adapter.put(STORES.META, { key: AUTOMATION_INSTALLATION_META_KEY, value: { not: 'a string' } });
      const store = createAutomationInstallationMetaStore(adapter);
      await expect(store.load()).rejects.toThrow('STORED_INSTALLATION_ID_INVALID');
      await expect(loadOrCreateAutomationInstallationId(store)).rejects.toThrow('STORED_INSTALLATION_ID_INVALID');
      // 判错之后原行必须还在：把它按空处理会写成一次静默换身份。
      expect(await rawRow(adapter)).toEqual({ key: AUTOMATION_INSTALLATION_META_KEY, value: { not: 'a string' } });
    } finally { adapter.close(); }
  });

  it.each(['not-a-uuid', '', '11111111-1111-5111-8111-111111111111'])('rejects the non-UUIDv4 value %s without writing it', async (value) => {
    const adapter = await db();
    try {
      const store = createAutomationInstallationMetaStore(adapter);
      await expect(store.save(value)).rejects.toBeInstanceOf(AutomationTicketError);
      expect(await rawRow(adapter)).toBeUndefined();
    } finally { adapter.close(); }
  });
});
