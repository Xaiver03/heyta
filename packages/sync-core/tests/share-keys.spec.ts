import { describe, expect, it } from 'vitest';
import {
  assertShareMemberKeyEnvelope,
  buildShareOpSignatureMessage,
  buildShareOpSignatureMessageFromWire,
  classifyShareOpSignature,
  type ShareOpSignatureParts,
  type ShareOpWireForSignature,
  decryptShareRecord,
  deriveShareIdentityKeyPair,
  deriveShareOperationKey,
  encryptShareRecord,
  generateShareIdentitySeed,
  generateShareListKey,
  openListKeyEnvelope,
  planShareRekey,
  reencryptShareRecord,
  sealListKeyForRecipient,
  SHARE_OP_SIGNATURE_OUTCOMES,
  shareKeyFingerprint,
  shareRecordEpoch,
  signShareOperation,
  signShareOpWire,
  verifyShareOperationSignature,
} from '../src/share-keys';

const SHARE_A = 'share-aaa';
const SHARE_B = 'share-bbb';
// record 三件套（encrypt/decrypt/reencrypt）的全身份 AAD 所需的线上身份。
const mkIdentity = (id: string) => ({
  clientId: 'device-shared', actionType: 'edit task', opType: 'UPD',
  entityType: 'TASK', entityId: id, timestamp: 1_700_000_000_000, schemaVersion: 1,
});

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('share identity keys', () => {
  it('derives stable, purpose-separated key pairs from one seed', () => {
    const seed = generateShareIdentitySeed();
    const a = deriveShareIdentityKeyPair(seed);
    const b = deriveShareIdentityKeyPair(seed);
    expect(hex(a.ed25519PublicKey)).toBe(hex(b.ed25519PublicKey));
    expect(hex(a.x25519PublicKey)).toBe(hex(b.x25519PublicKey));
    // Ed25519 and X25519 sub-seeds are HKDF-separated: one seed must never
    // serve both curves.
    expect(hex(a.ed25519SecretKey)).not.toBe(hex(a.x25519SecretKey));
    expect(hex(a.ed25519PublicKey)).not.toBe(hex(a.x25519PublicKey));
  });

  it('different seeds give different keys (fixed-seed known answer)', () => {
    const fixedSeed = new Uint8Array(32).fill(7);
    const pair = deriveShareIdentityKeyPair(fixedSeed);
    // Known answer pins the HKDF derivation across dependency upgrades.
    expect(hex(pair.ed25519PublicKey)).toMatchSnapshot();
    expect(hex(pair.x25519PublicKey)).toMatchSnapshot();
    const other = deriveShareIdentityKeyPair(new Uint8Array(32).fill(8));
    expect(hex(other.ed25519PublicKey)).not.toBe(hex(pair.ed25519PublicKey));
  });

  it('rejects seeds that are not 32 bytes', () => {
    expect(() => deriveShareIdentityKeyPair(new Uint8Array(16))).toThrow();
    expect(() => deriveShareIdentityKeyPair(new Uint8Array(0))).toThrow();
  });
});

describe('share operation keys', () => {
  it('separates domains by share id and epoch', () => {
    const listKey = generateShareListKey();
    const k1 = deriveShareOperationKey(listKey, SHARE_A, 1);
    expect(hex(deriveShareOperationKey(listKey, SHARE_A, 1))).toBe(hex(k1));
    expect(hex(deriveShareOperationKey(listKey, SHARE_B, 1))).not.toBe(hex(k1));
    expect(hex(deriveShareOperationKey(listKey, SHARE_A, 2))).not.toBe(hex(k1));
  });
});

describe('member key envelopes', () => {
  const setup = async () => {
    const owner = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const alice = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const listKey = generateShareListKey();
    return { owner, alice, bob, listKey };
  };

  it('round-trips: the recipient recovers the same list key', async () => {
    const { alice, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    const opened = await openListKeyEnvelope({
      envelope,
      recipientX25519SecretKey: alice.x25519SecretKey,
    });
    expect(hex(opened)).toBe(hex(listKey));
  });

  it('a different member cannot open it', async () => {
    const { alice, bob, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    await expect(openListKeyEnvelope({
      envelope,
      recipientX25519SecretKey: bob.x25519SecretKey,
    })).rejects.toThrow('not sealed for this recipient');
  });

  it('bindings fail closed: share id, epoch and ciphertext tampering all rejected', async () => {
    const { alice, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    // Replay to another share.
    await expect(openListKeyEnvelope({
      envelope: { ...envelope, shareId: SHARE_B },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
    // Replay to another epoch.
    await expect(openListKeyEnvelope({
      envelope: { ...envelope, keyEpoch: 2 },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
    // Flip a ciphertext byte (GCM auth).
    const raw = Buffer.from(envelope.ciphertext, 'base64');
    raw[raw.length - 1] ^= 0x01;
    await expect(openListKeyEnvelope({
      envelope: { ...envelope, ciphertext: raw.toString('base64') },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
  });

  it('carries no plaintext key material on its JSON surface', async () => {
    const { alice, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    assertShareMemberKeyEnvelope(envelope);
    const surface = JSON.stringify(envelope);
    expect(surface).not.toContain(Buffer.from(listKey).toString('base64'));
    expect(surface).not.toContain(hex(listKey));
  });
});

describe('rekey', () => {
  it('produces epoch+1 envelopes that each remaining member can open to the same new key', async () => {
    const alice = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const plan = await planShareRekey({
      shareId: SHARE_A,
      fromEpoch: 1,
      remainingMemberX25519PublicKeys: [alice.x25519PublicKey, bob.x25519PublicKey],
    });
    expect(plan.toEpoch).toBe(2);
    expect(plan.envelopes).toHaveLength(2);
    const aliceKey = await openListKeyEnvelope({
      envelope: plan.envelopes[0]!,
      recipientX25519SecretKey: alice.x25519SecretKey,
    });
    const bobKey = await openListKeyEnvelope({
      envelope: plan.envelopes[1]!,
      recipientX25519SecretKey: bob.x25519SecretKey,
    });
    expect(hex(aliceKey)).toBe(hex(plan.newListKey));
    expect(hex(bobKey)).toBe(hex(plan.newListKey));
    // The removed member (not in the remaining list) has no epoch-2 envelope;
    // their epoch-1 envelope cannot be replayed as epoch 2.
    const stale = await sealListKeyForRecipient({
      listKey: generateShareListKey(),
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    await expect(openListKeyEnvelope({
      envelope: { ...stale, keyEpoch: plan.toEpoch },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
  });

  it('refuses to rekey to an empty membership', async () => {
    await expect(planShareRekey({
      shareId: SHARE_A,
      fromEpoch: 1,
      remainingMemberX25519PublicKeys: [],
    })).rejects.toThrow('at least one remaining member');
  });
});

describe('history re-encryption', () => {
  const makeRecord = async (listKey: Uint8Array, id: string, epoch: number, body = 'task payload 中文') =>
    encryptShareRecord({
      id,
      plaintext: new TextEncoder().encode(body),
      shareId: SHARE_A,
      listKey,
      keyEpoch: epoch,
      identity: mkIdentity(id),
    });

  it('re-encrypts to the new epoch and the old key stops reading it', async () => {
    const oldListKey = generateShareListKey();
    const newListKey = generateShareListKey();
    const record = await makeRecord(oldListKey, 'op-1', 1);
    const migrated = await reencryptShareRecord({
      record,
      shareId: SHARE_A,
      fromListKey: oldListKey,
      toListKey: newListKey,
      toEpoch: 2,
      identity: mkIdentity('op-1'),
    });
    expect(migrated.keyEpoch).toBe(2);
    expect(migrated.ciphertext).not.toBe(record.ciphertext);
    const opened = new TextDecoder().decode(await decryptShareRecord({
      record: migrated,
      shareId: SHARE_A,
      listKey: newListKey,
      identity: mkIdentity('op-1'),
    }));
    expect(opened).toBe('task payload 中文');
    // Old list key must not read new-epoch data.
    await expect(decryptShareRecord({
      record: migrated,
      shareId: SHARE_A,
      listKey: oldListKey,
      identity: mkIdentity('op-1'),
    })).rejects.toThrow();
    // Wrong share binding must fail too.
    await expect(decryptShareRecord({
      record: migrated,
      shareId: SHARE_B,
      listKey: newListKey,
      identity: mkIdentity('op-1'),
    })).rejects.toThrow();
  });

  it('is idempotent: re-running a chunk yields byte-identical ciphertext', async () => {
    const oldListKey = generateShareListKey();
    const newListKey = generateShareListKey();
    const record = await makeRecord(oldListKey, 'op-2', 1);
    const first = await reencryptShareRecord({
      record, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-2'),
    });
    const second = await reencryptShareRecord({
      record, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-2'),
    });
    expect(second.ciphertext).toBe(first.ciphertext);
    // Re-running on an already-migrated record is a no-op.
    const third = await reencryptShareRecord({
      record: first, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-2'),
    });
    expect(third.ciphertext).toBe(first.ciphertext);
    // Interrupted-migration resume: different record ids still diverge (unique IVs).
    const other = await makeRecord(oldListKey, 'op-3', 1);
    const migratedOther = await reencryptShareRecord({
      record: other, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-3'),
    });
    expect(migratedOther.ciphertext).not.toBe(first.ciphertext);
  });

  it('fails closed on wrong from-key', async () => {
    const listKey = generateShareListKey();
    const wrongKey = generateShareListKey();
    const record = await makeRecord(listKey, 'op-4', 1);
    await expect(reencryptShareRecord({
      record, shareId: SHARE_A, fromListKey: wrongKey, toListKey: generateShareListKey(), toEpoch: 2,
      identity: mkIdentity('op-4'),
    })).rejects.toThrow();
  });
});

describe('op signatures', () => {
  // 签名域 = 服务端能看见、读侧会据以判定的一切字段（除 serverSeq / receivedAt）。
  // 见 ADR-0069 裁决三：vectorClock 今天不被任何完整性机制绑住，而并发判定读的就是它。
  // 🔴 按 `ShareOpSignatureParts` 标注而不是让 TS 去推字面量形状：这张表要往时钟里加
  //    第三个客户端、要能把 `vectorClockEncoding` 从 null 改成有值，推出来的窄类型会把这些
  //    合法形状判成类型错误（而 `vitest` 不做类型检查 ⇒ 只有 `pnpm test` 里那一步会抓到）。
  const baseParts: ShareOpSignatureParts = {
    opId: 'op-1',
    clientId: 'client-1',
    shareId: SHARE_A,
    signerMemberId: 'member-1',
    actionType: 'edit task',
    opType: 'UPD',
    entityType: 'TASK',
    entityId: 'task-1',
    entityIds: ['task-1', 'task-2'],
    schemaVersion: 7,
    clientTimestamp: 1_700_000_000_000,
    vectorClock: { 'client-1': 3, 'client-2': 1 },
    // 这两格在基线里**显式为 null**（缺省=没编码/没标记），于是下面那两行"改这一格"的
    // 篡改用例有地方写值，而上面那只形状数组读起来仍是 `…, null, null`。
    vectorClockEncoding: null,
    isPayloadEncrypted: null,
    ciphertext: 'cipher-text-1',
  };
  const message = (parts: Partial<typeof baseParts> = {}) =>
    buildShareOpSignatureMessage({ ...baseParts, ...parts });
  const author = deriveShareIdentityKeyPair(generateShareIdentitySeed());
  const signOn = (parts: Partial<typeof baseParts> = {}): Uint8Array =>
    signShareOperation(author.ed25519SecretKey, message(parts));
  const verifiesOn = (parts: Partial<typeof baseParts> = {}): boolean =>
    verifyShareOperationSignature(author.ed25519PublicKey, message(parts), signOn());

  it('a genuine signature verifies over the full field set', () => {
    expect(verifiesOn()).toBe(true);
  });

  // 🔴 一枚字段一条用例：一条用例里塞十二个断言，坏掉的那一枚就没人知道是哪一枚。
  const tamperTable: Array<[string, Partial<typeof baseParts>]> = [
    ['opId', { opId: 'op-2' }],
    ['clientId', { clientId: 'client-9' }],
    ['shareId', { shareId: SHARE_B }],
    // 世代不单列进域（它自描述地在 `ciphertext` 那枚信封头 9 字节里 ⇒ 改它必然改被签的字节）：
    // 这一格的判据挪到线上形状那一带，见下面"换世代重加密"那条臂。
    ['signerMemberId', { signerMemberId: 'member-2' }],
    ['actionType', { actionType: 'delete task' }],
    ['opType', { opType: 'DEL' }],
    ['entityType', { entityType: 'NOTE' }],
    ['entityId', { entityId: 'task-2' }],
    ['entityIds', { entityIds: ['task-1', 'task-3'] }],
    ['schemaVersion', { schemaVersion: 8 }],
    ['clientTimestamp', { clientTimestamp: 1_700_000_000_001 }],
    ['vectorClock', { vectorClock: { 'client-1': 4, 'client-2': 1 } }],
    ['vectorClockEncoding', { vectorClockEncoding: 'frontier-delta' }],
    ['isPayloadEncrypted', { isPayloadEncrypted: false }],
    ['ciphertext', { ciphertext: 'cipher-text-2' }],
  ];

  it.each(tamperTable)('rejects a one-field rewrite of %s', (_field, parts) => {
    expect(verifiesOn(parts)).toBe(false);
  });

  it('签名域那一只数组的**形状**钉在这里（顺序即协议）', () => {
    // 🔴 为什么单独钉形状而不是只靠上面那张逐字段表：把一枚新字段**插在中间**，
    // 上面每一条用例都照样红不了（两边都按同一个新顺序装配），但线上已有的签名会**集体**读成失败，
    // 而那一步没有任何迁移能补救。顺序只有钉成一只数组才看得见。
    // 规则：新字段一律追加在末尾（`ciphertext` 之后）。改这一行 = 改线协议。
    const shape = JSON.parse(new TextDecoder().decode(message())) as unknown[];
    expect(shape).toEqual([
      'heyta:share-op-sig',
      1,
      'op-1',
      'client-1',
      SHARE_A,
      'member-1',
      'edit task',
      'UPD',
      'TASK',
      'task-1',
      ['task-1', 'task-2'],
      7,
      1_700_000_000_000,
      { 'client-1': 3, 'client-2': 1 },
      'cipher-text-1',
      null,
      null,
    ]);
  });

  it('binds the causal clock, so a rewritten vectorClock cannot fake an ordering', () => {
    // 这一枚是 ADR-0069 裁决三存在的全部理由：不签它，服务端就能把两条并发伪装成有先后。
    expect(verifiesOn({ vectorClock: { 'client-1': 3 } })).toBe(false);
    expect(verifiesOn({ vectorClock: { 'client-1': 3, 'client-2': 1, 'client-3': 0 } })).toBe(false);
  });

  it('is stable under jsonb key reordering — the same clock must not read as tampering', () => {
    // `vector_clock` 在服务端是 jsonb：它不保留键序。签名方与验签方各自 stringify 一份
    // 逻辑上相同的时钟若拿到不同字节，每一台非签名者的设备都会把这枚合法签名读成失败。
    const reordered = { 'client-2': 1, 'client-1': 3 };
    expect(hex(message({ vectorClock: reordered }))).toBe(hex(message()));
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      message({ vectorClock: reordered }),
      signOn(),
    )).toBe(true);
  });

  it('treats entityIds as a set: order is not load-bearing, membership is', () => {
    expect(hex(message({ entityIds: ['task-2', 'task-1'] }))).toBe(hex(message()));
    expect(verifiesOn({ entityIds: ['task-2'] })).toBe(false);
  });

  it('normalises absent metadata to null, so omitting a field cannot fork the message', () => {
    // 缺省与显式 null 必须同形，否则"这一枚没传"与"这一枚是 null"会签出两个不同的域。
    const withoutOptionals = buildShareOpSignatureMessage({
      opId: baseParts.opId, clientId: baseParts.clientId, shareId: baseParts.shareId,
      ciphertext: baseParts.ciphertext,
    });
    const withNulls = buildShareOpSignatureMessage({
      ...baseParts,
      actionType: null, opType: null, entityType: null, entityId: null,
      signerMemberId: null,
      entityIds: null, schemaVersion: null, clientTimestamp: null, vectorClock: null,
      vectorClockEncoding: null, isPayloadEncrypted: null,
    });
    expect(hex(withoutOptionals)).toBe(hex(withNulls));
  });

  it('fails loudly on values JSON would silently rewrite, instead of signing a different message', () => {
    expect(() => message({ clientTimestamp: 1n as unknown as number })).toThrow(
      'Invalid share op signature clientTimestamp',
    );
    expect(() => message({ clientTimestamp: Number.NaN })).toThrow(
      'Invalid share op signature clientTimestamp',
    );
    expect(() => message({ vectorClock: { a: 1n } })).toThrow('Invalid share op signature value');
    expect(() => message({ vectorClock: { a: Number.POSITIVE_INFINITY } })).toThrow(
      'Invalid share op signature value',
    );
    expect(() => message({ entityIds: ['task-1', ''] })).toThrow(
      'Invalid share op signature entityIds',
    );
    expect(() => message({ schemaVersion: 0 })).toThrow('Invalid share op signature schemaVersion');
  });

  it('rejects a signature forged under another member key', () => {
    const forger = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      message(),
      signShareOperation(forger.ed25519SecretKey, message()),
    )).toBe(false);
  });

  it('never throws on malformed inputs — verification only returns false', () => {
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      new Uint8Array(0),
      new Uint8Array(64),
    )).toBe(false);
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      message(),
      new Uint8Array([1, 2, 3]),
    )).toBe(false);
  });
});

describe('op signatures over the wire shape (ADR-0069 裁决三/四：只有一份装配器)', () => {
  // 🔴 这一族钉的是"写侧、服务端上传边界、读侧**三处签/验的是同一批字节**"。
  // 三处各写一份装配 = 迟早漂一点，而漂移的症状不是"签不上"，是**每台非签名者的设备
  // 把一枚合法签名读成失败** —— 比根本没有签名更坏，因为它让人以为有完整性保护。
  const listKey = generateShareListKey();
  const author = deriveShareIdentityKeyPair(generateShareIdentitySeed());
  const other = deriveShareIdentityKeyPair(generateShareIdentitySeed());
  const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

  /**
   * 一条**真的走过清单钥**的线 op（载荷是真信封 —— 不是签名域的要求，而是线上本来就送这个）。
   *
   * `keyEpoch` 只影响信封里的字节：它**不在**域里单列，世代 tamper 由"信封整体被签"来兜
   * （判据见下面"换世代"那一枚臂）。
   */
  const wireFor = async (overrides: Partial<ShareOpWireForSignature> = {}, keyEpoch = 3) => {
    const id = 'op-wire-1';
    const identity = {
      clientId: 'device-A1', actionType: 'edit task', opType: 'UPD',
      entityType: 'TASK', entityId: 'task-1', timestamp: 1_700_000_000_000, schemaVersion: 1,
    };
    const record = await encryptShareRecord({
      id, plaintext: new TextEncoder().encode('{"title":"买漆"}'),
      shareId: SHARE_A, listKey, keyEpoch, identity,
    });
    return {
      id,
      clientId: identity.clientId,
      actionType: identity.actionType,
      opType: identity.opType,
      entityType: identity.entityType,
      entityId: identity.entityId,
      schemaVersion: identity.schemaVersion,
      clientTimestamp: identity.timestamp,
      vectorClock: { 'device-A1': 2, 'device-B2': 4 },
      payload: record.ciphertext,
      ...overrides,
    };
  };

  const signOn = (wire: Awaited<ReturnType<typeof wireFor>>): string =>
    signShareOpWire(author.ed25519SecretKey, { shareId: SHARE_A, signerMemberId: 'member-1', wire });

  const classifyOn = (
    wire: Awaited<ReturnType<typeof wireFor>>,
    signature: unknown,
    args: { signingPublicKey?: string | null; signerMemberId?: string | null } = {},
  ) => classifyShareOpSignature({
    // ⚠️ 这里**不能**用 `??` 兜默认值：`null` 在测试里就是"这一格没登记"，
    // 用 `??` 会把它悄悄换成一枚真公钥，于是"没登记"那一档永远测不到。
    signingPublicKey: 'signingPublicKey' in args ? args.signingPublicKey : b64(author.ed25519PublicKey),
    shareId: SHARE_A,
    signerMemberId: 'signerMemberId' in args ? args.signerMemberId : 'member-1',
    wire,
    signature,
  });

  it('写侧签出的那一枚，服务端与读侧用同一份装配器验得过', async () => {
    const wire = await wireFor();
    expect(classifyOn(wire, signOn(wire))).toBe('verified');
  });

  it('域与 buildShareOpSignatureMessage 逐字节同形（不许出现第二份"签哪些字节"）', async () => {
    const wire = await wireFor();
    expect(
      hex(buildShareOpSignatureMessageFromWire(SHARE_A, 'member-1', wire)),
    ).toBe(
      hex(buildShareOpSignatureMessage({
        opId: wire.id,
        clientId: wire.clientId,
        shareId: SHARE_A,
        signerMemberId: 'member-1',
        actionType: wire.actionType,
        opType: wire.opType,
        entityType: wire.entityType,
        entityId: wire.entityId,
        schemaVersion: wire.schemaVersion,
        clientTimestamp: wire.clientTimestamp,
        vectorClock: wire.vectorClock,
        ciphertext: wire.payload as string,
      })),
    );
  });

  // 🔴 一枚字段一条失法：一条用例里塞十个断言，坏掉的那一枚就没人知道是哪一枚。
  const wireTamperTable: Array<[string, Partial<ShareOpWireForSignature>]> = [
    ['opId', { id: 'op-wire-2' }],
    ['clientId', { clientId: 'device-Z9' }],
    ['actionType', { actionType: 'delete task' }],
    ['opType', { opType: 'DEL' }],
    ['entityType', { entityType: 'NOTE' }],
    ['entityId', { entityId: 'task-2' }],
    ['entityIds', { entityIds: ['task-1', 'task-9'] }],
    ['schemaVersion', { schemaVersion: 9 }],
    ['clientTimestamp', { clientTimestamp: 1_700_000_000_001 }],
    ['vectorClock', { vectorClock: { 'device-A1': 3, 'device-B2': 4 } }],
    ['vectorClockEncoding', { vectorClockEncoding: 'frontier-delta' }],
    ['isPayloadEncrypted', { isPayloadEncrypted: false }],
  ];

  it.each(wireTamperTable)('改一线上的 %s ⇒ 结局只能是 invalid', async (field, overrides) => {
    const signed = await wireFor();
    const tampered = { ...signed, ...overrides };
    expect(classifyOn(tampered, signOn(signed)), `${field} 必须在签名域里`).toBe('invalid');
  });

  it('改载荷一个字节 ⇒ invalid（载荷换掉等于换了一条 op）', async () => {
    const wire = await wireFor();
    const tamperedPayload = `${(wire.payload as string).slice(0, -4)}AAAA`;
    expect(classifyOn({ ...wire, payload: tamperedPayload }, signOn(wire))).toBe('invalid');
  });

  it('把这条挪到别的密钥世代 ⇒ invalid（世代不单列进域，它随整枚信封一起被签）', async () => {
    // 🔴 这一枚是"世代为什么不单列"的判据本体：换世代 = 换信封字节 = 换被签的域。
    // 少了这一格，"把 epoch 从域里拿掉"就只是一句我说它安全的说辞。
    const signed = await wireFor();
    const rekeyed = await wireFor({}, 4);
    expect(shareRecordEpoch(rekeyed.payload as string)).toBe(4);
    expect(shareRecordEpoch(signed.payload as string)).toBe(3);
    expect(classifyOn(rekeyed, signOn(signed))).toBe('invalid');
  });

  it('时钟换了键序仍是同一枚签名（服务端 jsonb 不保留键序）', async () => {
    const wire = await wireFor();
    const reordered = signOn({ ...wire, vectorClock: { 'device-B2': 4, 'device-A1': 2 } });
    expect(classifyOn(wire, reordered)).toBe('verified');
  });

  it('四态是封闭词表：缺席、伪造、别人代签、没登记公钥各归一档，不许互相顶包', async () => {
    const wire = await wireFor();
    // ① 缺席 = 没签。
    expect(classifyOn(wire, undefined)).toBe('unsigned');
    expect(classifyOn(wire, null)).toBe('unsigned');
    // ② 存在但形状不对 = 有人在动这条 op，不是"没签"。
    expect(classifyOn(wire, 123)).toBe('invalid');
    expect(classifyOn(wire, '')).toBe('invalid');
    expect(classifyOn(wire, '不是 base64 !!')).toBe('invalid');
    // ③ 别人的钥签的同一条 op。
    expect(classifyOn(wire, signShareOpWire(other.ed25519SecretKey, { shareId: SHARE_A, signerMemberId: 'member-1', wire }))).toBe('invalid');
    // ④ 这个人根本没登记签名公钥 —— 这一档客户端唯一能自己修（去补发）。
    expect(classifyOn(wire, signOn(wire), { signingPublicKey: null })).toBe('signer-unregistered');
    expect(classifyOn(wire, signOn(wire), { signingPublicKey: '' })).toBe('signer-unregistered');
    expect(SHARE_OP_SIGNATURE_OUTCOMES).toEqual(['verified', 'unsigned', 'invalid', 'signer-unregistered']);
  });

  it('先判钥再判签：没登记公钥时报的是那一档可以修的结局，而不是"没签"', async () => {
    // 两格都缺时，报"能自己修的那一档"（补发公钥）才有出路；报"没签"用户什么都做不了。
    const wire = await wireFor();
    expect(classifyOn(wire, undefined, { signingPublicKey: null })).toBe('signer-unregistered');
  });

  it('signerMemberId 由服务端写库：它变了就验不过（重署名等于伪造作者）', async () => {
    const wire = await wireFor();
    const signature = signOn(wire);
    expect(classifyOn(wire, signature, { signerMemberId: 'member-2' })).toBe('invalid');
    expect(classifyOn(wire, signature, { signerMemberId: null })).toBe('invalid');
  });

  it('跨清单重放同一枚签名 ⇒ invalid（shareId 在域里）', async () => {
    const wire = await wireFor();
    const signature = signOn(wire);
    expect(classifyShareOpSignature({
      signingPublicKey: b64(author.ed25519PublicKey),
      shareId: SHARE_B,
      signerMemberId: 'member-1',
      wire,
      signature,
    })).toBe('invalid');
  });

  it('写侧省略的那两枚，服务端落成空形状后读回来仍验得过（缺省 == 空集合）', async () => {
    // 🔴 这一枚钉的是**存储往返**，不是签名数学：服务端把 `entity_ids` 落成 `[]`、
    // `vector_clock` 落成 `{}`（jsonb 里"没给"就是空形状），下载回来的 op 与写侧签的那一份
    // 差在"没传 vs 空"。两者不同形 ⇒ 每台非签名者的设备把自己人的合法签名读成失败，
    // 而这一步在单测里只有走"签的时候省略、验的时候读回空形状"才看得见。
    const signed = await wireFor();
    const signature = signOn(signed);
    const storedBack = {
      ...signed,
      entityIds: signed.entityIds ?? [],
      vectorClock: signed.vectorClock ?? {},
    };
    expect(classifyOn(storedBack, signature)).toBe('verified');
    // 对照臂：把"缺省即空"这条规则反过来用（先给空、读回省略）也必须同形。
    const omittedEmpty = await wireFor({ entityIds: [], vectorClock: {} });
    expect(hex(buildShareOpSignatureMessageFromWire(SHARE_A, 'member-1', omittedEmpty)))
      .toBe(hex(buildShareOpSignatureMessageFromWire(SHARE_A, 'member-1', { ...omittedEmpty, entityIds: undefined, vectorClock: undefined })));
  });

  it('载荷不是信封 ⇒ invalid，而不是抛出去把整批上传拖死', async () => {
    // 服务端在调用分类器**之前**已经过一遍传输形状校验；这里证的是分类器自己不抛。
    const wire = await wireFor();
    expect(classifyOn({ ...wire, payload: {} }, signOn(wire))).toBe('invalid');
    expect(() => classifyOn({ ...wire, payload: 42 }, signOn(wire))).not.toThrow();
  });

  it('写侧装配抛错要响亮（载荷连字节都没有 ⇒ 编程错误，不是数据问题）', async () => {
    const wire = await wireFor();
    // ⚠️ 这里**不再**要求载荷是一枚合法信封：世代不单列进域（理由与翻案条件都写在
    // `ShareOpSignatureParts` 上），信封形状是**解密路径**的判据（`decryptShareRecord`），
    // 不是签名的 —— 签名只管"这批字节是谁写的、有没有被动过"，签的就是 payload 原样。
    expect(() => signShareOpWire(author.ed25519SecretKey, {
      shareId: SHARE_A, signerMemberId: 'member-1', wire: { ...wire, payload: '' },
    })).toThrow('Invalid share op signature parts');
    expect(() => signShareOpWire(author.ed25519SecretKey, {
      shareId: SHARE_A, signerMemberId: 'member-1', wire: { ...wire, payload: undefined },
    })).toThrow('Invalid share op signature parts');
    // 反向那一格也钉住：形状不合但确实是字节串的载荷**签得出来** —— 这正是替身加密器
    // 与以后换的封装还能签的原因。谁把信封解析加回签名路径，这一条就会红。
    expect(() => signShareOpWire(author.ed25519SecretKey, {
      shareId: SHARE_A, signerMemberId: 'member-1', wire: { ...wire, payload: 'not-an-envelope' },
    })).not.toThrow();
  });
});
