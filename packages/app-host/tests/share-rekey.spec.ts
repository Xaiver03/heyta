/**
 * M3 换钥编排：`createShareKeyRotation` 的判据
 * ==========================================
 *
 * 这一片要证的不是"函数会跑"，而是那句产品承诺的两个半边：
 * **被移除的人解不开以后写的内容**，**而在册的人还解得开**。
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 换出来的是一把**新钥**、世代 +1 | 复封同一把（§9.1 记着 autoSeal 今天就是这样）⇒ "移除"只改了个数字 |
 * | 名册 = 移除**之后**的那份 | 先换钥后移除 ⇒ 把要收回的钥匙当场又送一遍 |
 * | 自己的信封排第一、新钥先落本地环 | 顺序反了 ⇒ 存在"新钥只活在内存里"的窗口 |
 * | 非 owner / 未登录 / 没解锁 ⇒ 零请求 | 一个 commenter 反复换钥把清单锁死 |
 * | 收钥只收**世代对得上**的那枚信封 | 把旧信封当新钥存 ⇒ 全员以为更新了就锁在门外 |
 * | 旧钥解不开新世代的载荷（真密码学） | 只在传输面 404 ⇒ 服务端泄露或他早有副本就读得懂 |
 */

import {
  decryptShareRecord,
  deriveShareIdentityKeyPair,
  encryptShareRecord,
  generateShareIdentitySeed,
  generateShareListKey,
} from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import {
  createShareKeyRotation,
  forgetShareLocally,
  ShareKeyOutOfSyncError,
  ShareNotOwnerError,
  type ShareLocalKey,
  type ShareRekeyApi,
  type ShareRosterMemberRow,
} from '../src/share-rekey.js';
import { ShareKeyUnavailableError, ShareNotSignedInError } from '../src/share-comments.js';

const SHARE = '11111111-1111-4111-8111-111111111111';

interface HarnessOptions {
  /** owner 之外在册的成员（每人一对真身份键；行里的公钥按线上的 base64 形状给）。 */
  readonly members?: readonly { memberId: string; publicKeyB64: string }[];
  /** 名册里出现但**没有**公钥的行（用来验"如实报出来而不是静默跳过"）。 */
  readonly keylessMemberIds?: readonly string[];
  /** 服务端此刻的世代（> 本机 ⇒ 别的设备已经换过）。 */
  readonly serverEpoch?: number;
  readonly yourRole?: string;
  /** 指定哪一枚 PUT 要抛。 */
  readonly failPutFor?: string;
  readonly signedIn?: boolean;
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const fromB64 = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'base64'));

function makeHarness(options: HarnessOptions = {}) {
  const ownerIdentity = deriveShareIdentityKeyPair(generateShareIdentitySeed());
  const listKeyV1 = generateShareListKey();
  const calls: string[] = [];
  const roster: ShareRosterMemberRow[] = [
    // 🔴 owner 自己的成员行**没有** identityPublicKey（`POST /shares` 不收它）。
    // 这条不是凑数：换钥时如果只照名册的公钥发信封，owner 会被自己漏掉。
    { memberId: 'm-owner', identityPublicKey: null },
    ...(options.members ?? []).map((m) => ({ memberId: m.memberId, identityPublicKey: m.publicKeyB64 })),
    ...(options.keylessMemberIds ?? []).map((memberId) => ({ memberId, identityPublicKey: null })),
  ];
  /** memberId → 收到的信封（含服务端那一行会带的 memberKeyEpoch）。 */
  const delivered = new Map<string, { keyEpoch: number; envelope: unknown }>();
  /** 本机密钥环当前那把（纪律 4 的"旧世代仍要留在环里"由宿主实现负责，在 web 那侧钉）。 */
  let currentKey: ShareLocalKey = { keyEpoch: 1, listKey: listKeyV1 };

  const api: ShareRekeyApi = {
    shareDetail: async (shareId) => {
      calls.push('shareDetail');
      expect(shareId, 'detail 问的是这一份共享').toBe(SHARE);
      return { keyEpoch: options.serverEpoch ?? currentKey.keyEpoch, yourRole: options.yourRole ?? 'owner' };
    },
    listMembers: async () => {
      calls.push('listMembers');
      return {
        members: roster.map((m) => {
          const got = delivered.get(m.memberId);
          return {
            ...m,
            keyEnvelope: got?.envelope ?? null,
            memberKeyEpoch: got?.keyEpoch ?? 1,
          };
        }),
      };
    },
    putMemberEnvelope: async (shareId, memberId, input) => {
      calls.push(`put:${memberId}`);
      if (options.failPutFor === memberId) throw new Error('simulated 500');
      delivered.set(memberId, { keyEpoch: input.keyEpoch, envelope: input.keyEnvelope });
      return { memberId, memberKeyEpoch: input.keyEpoch };
    },
    removeMember: async (_shareId, memberId) => {
      calls.push(`remove:${memberId}`);
      // 服务端当场把他从名册里摘掉（`removedAt` 置位）。
      const at = roster.findIndex((m) => m.memberId === memberId);
      if (at >= 0) roster.splice(at, 1);
      return { removed: true };
    },
  };

  const rotation = createShareKeyRotation({
    api,
    isSignedIn: () => options.signedIn ?? true,
    decodeMemberPublicKey: fromB64,
    keys: {
      load: async () => currentKey,
      save: async (_shareId, next) => {
        calls.push('save');
        currentKey = next;
      },
      ownIdentity: async () => ({
        memberId: 'm-owner',
        x25519PublicKey: ownerIdentity.x25519PublicKey,
        x25519SecretKey: ownerIdentity.x25519SecretKey,
      }),
    },
  });

  return {
    api,
    rotation,
    calls,
    delivered,
    roster,
    listKeyV1,
    ownerIdentity,
    currentKeyOf: () => currentKey,
  };
}

describe('M3 换钥：rotateShareKey', () => {
  it('🔴 换出来的是**另一把钥**、世代 +1（复封同一把就是 §9.1 那个坏法）', async () => {
    const h = makeHarness({ members: [{ memberId: 'm-bob', publicKeyB64: b64(deriveShareIdentityKeyPair(generateShareIdentitySeed()).x25519PublicKey) }] });
    const before = h.currentKeyOf();
    const reading = await h.rotation.rotateShareKey(SHARE);

    expect(reading.fromEpoch, '起点是本机那一代').toBe(1);
    expect(reading.toEpoch, '新世代 = 旧世代 + 1').toBe(2);
    const after = h.currentKeyOf();
    expect(after.keyEpoch, '环里当前那把的世代推进了').toBe(2);
    expect(
      Buffer.from(after.listKey).equals(Buffer.from(before.listKey)),
      '换钥必须铸一把**新的** listKey —— 同一把贴个新号等于没换',
    ).toBe(false);
  });

  it('🔴 自己的信封排第一，且**每个在册成员都收到**（含 owner 那一行没有公钥这件事）', async () => {
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const h = makeHarness({ members: [{ memberId: 'm-bob', publicKeyB64: b64(bob.x25519PublicKey) }] });
    const reading = await h.rotation.rotateShareKey(SHARE);

    expect(reading.sealedMemberIds, '两行都收到').toEqual(['m-owner', 'm-bob']);
    expect(h.calls.slice(h.calls.indexOf('put:m-owner')), '第一发是给自己').toEqual([
      'put:m-owner',
      'put:m-bob',
    ]);
    expect(reading.failedMemberIds, '这一轮没有失败的').toEqual([]);
  });

  it('🔴 新钥先落本地环，再发信封（顺序反了会造出一把谁都没拿到的钥）', async () => {
    const h = makeHarness({ members: [{ memberId: 'm-bob', publicKeyB64: b64(deriveShareIdentityKeyPair(generateShareIdentitySeed()).x25519PublicKey) }] });
    await h.rotation.rotateShareKey(SHARE);
    const saveAt = h.calls.indexOf('save');
    const firstPut = h.calls.findIndex((c) => c.startsWith('put:'));
    expect(saveAt, '落环这步真的发生了').toBeGreaterThanOrEqual(0);
    expect(saveAt, '落环必须早于第一发信封').toBeLessThan(firstPut);
  });

  it('🔴 一枚 PUT 失败不拖垮整轮，但要如实报进 failedMemberIds', async () => {
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const carol = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const h = makeHarness({
      members: [
        { memberId: 'm-bob', publicKeyB64: b64(bob.x25519PublicKey) },
        { memberId: 'm-carol', publicKeyB64: b64(carol.x25519PublicKey) },
      ],
      failPutFor: 'm-bob',
    });
    const reading = await h.rotation.rotateShareKey(SHARE);
    expect(reading.sealedMemberIds, 'bob 失败，其余照发').toEqual(['m-owner', 'm-carol']);
    expect(reading.failedMemberIds, 'bob 被如实登记（下一轮补封会再试）').toEqual(['m-bob']);
  });

  it('名册里有行没有公钥 ⇒ 进 skippedMemberIds，不当"已下发"', async () => {
    const h = makeHarness({ keylessMemberIds: ['m-nokey'] });
    const reading = await h.rotation.rotateShareKey(SHARE);
    expect(reading.skippedMemberIds, '没有公钥就封不了，必须说出来').toEqual(['m-nokey']);
    expect(reading.sealedMemberIds, '只有 owner 自己收到').toEqual(['m-owner']);
  });

  it('🔴 非 owner ⇒ 抛错、零 PUT、本地环不动（否则一个 commenter 能锁死整份清单）', async () => {
    const h = makeHarness({ yourRole: 'editor' });
    await expect(h.rotation.rotateShareKey(SHARE)).rejects.toBeInstanceOf(ShareNotOwnerError);
    expect(h.calls, '只问了 detail，一个写请求都没发').toEqual(['shareDetail']);
    expect(h.currentKeyOf().keyEpoch, '本地还是原来那一代').toBe(1);
  });

  it('未登录 ⇒ 抛错且**零请求**（连 detail 都不问）', async () => {
    const h = makeHarness({ signedIn: false });
    await expect(h.rotation.rotateShareKey(SHARE)).rejects.toBeInstanceOf(ShareNotSignedInError);
    expect(h.calls, '未登录不该有任何网络动作').toEqual([]);
  });

  it('钥匙没解锁 ⇒ 抛错且零请求（本地读就能否掉，不必先问服务端）', async () => {
    const h = makeHarness();
    // 让环里读不出钥：模拟 vault 锁定
    const locked = createShareKeyRotation({
      api: h.api,
      isSignedIn: () => true,
      decodeMemberPublicKey: fromB64,
      keys: {
        load: async () => undefined,
        save: async () => { throw new Error('不该走到这里'); },
        ownIdentity: async () => undefined,
      },
    });
    await expect(locked.rotateShareKey(SHARE)).rejects.toBeInstanceOf(ShareKeyUnavailableError);
  });

  it('服务端世代超前 ⇒ 先收新钥再往上换；收不到就抛，且零 save', async () => {
    const h = makeHarness({ serverEpoch: 5 });
    await expect(h.rotation.rotateShareKey(SHARE)).rejects.toBeInstanceOf(ShareKeyOutOfSyncError);
    expect(h.calls.filter((c) => c === 'save' || c.startsWith('put:')), '对不上就一个字节都不写').toEqual([]);
  });
});

describe('M3 收钥：adoptRotatedShareKey', () => {
  it('🔴 owner 换钥后，在册成员从自己那行收到**同一把新钥**', async () => {
    const bobIdentity = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const h = makeHarness({ members: [{ memberId: 'm-bob', publicKeyB64: b64(bobIdentity.x25519PublicKey) }] });
    const reading = await h.rotation.rotateShareKey(SHARE);
    const ownerNewKey = h.currentKeyOf();

    // bob 那一侧：环里还是 epoch1，服务端已经 epoch2，他的行里有 epoch2 的信封。
    let bobKey = { keyEpoch: 1, listKey: h.listKeyV1 };
    const bobRotation = createShareKeyRotation({
      api: h.api,
      isSignedIn: () => true,
      decodeMemberPublicKey: fromB64,
      keys: {
        load: async () => bobKey,
        save: async (_shareId, next) => { bobKey = next; },
        ownIdentity: async () => ({
          memberId: 'm-bob',
          x25519PublicKey: bobIdentity.x25519PublicKey,
          x25519SecretKey: bobIdentity.x25519SecretKey,
        }),
      },
    });
    const adopted = await bobRotation.adoptRotatedShareKey(SHARE);

    expect(adopted.adopted, '这一轮真的收到了新钥').toBe(true);
    expect(adopted.keyEpoch, '收下来的是服务端那一代').toBe(reading.toEpoch);
    expect(
      Buffer.from(bobKey.listKey).equals(Buffer.from(ownerNewKey.listKey)),
      'bob 收到的必须是 owner 刚铸的那把（不是他自己那把旧的）',
    ).toBe(true);
  });

  it('还没人到 ⇒ adopted:false、本地那把**不动**', async () => {
    const h = makeHarness({ serverEpoch: 2 });
    const before = h.currentKeyOf();
    const adopted = await h.rotation.adoptRotatedShareKey(SHARE);
    expect(adopted.adopted, '名册里那一行的信封还是旧世代 ⇒ 不收').toBe(false);
    expect(h.currentKeyOf().listKey, '没收到就不该覆盖本地').toBe(before.listKey);
  });

  it('🔴 信封在、但那一行的世代与服务端不一致 ⇒ 不收（把旧信封当新钥存 = 全员锁在门外）', async () => {
    const h = makeHarness({ members: [{ memberId: 'm-bob', publicKeyB64: b64(deriveShareIdentityKeyPair(generateShareIdentitySeed()).x25519PublicKey) }] });
    await h.rotation.rotateShareKey(SHARE);
    // 手工造"到了一半"的状态：owner 自己的行到了 epoch2，bob 那行还没轮到（epoch1 的信封）。
    h.delivered.set('m-bob', {
      keyEpoch: 1,
      envelope: h.delivered.get('m-owner')?.envelope ?? null,
    });
    let bobKey = { keyEpoch: 1, listKey: h.listKeyV1 };
    const bobRotation = createShareKeyRotation({
      api: h.api,
      isSignedIn: () => true,
      decodeMemberPublicKey: fromB64,
      keys: {
        load: async () => bobKey,
        save: async (_shareId, next) => { bobKey = next; },
        ownIdentity: async () => ({
          memberId: 'm-bob',
          x25519PublicKey: new Uint8Array(32),
          x25519SecretKey: new Uint8Array(32),
        }),
      },
    });
    const adopted = await bobRotation.adoptRotatedShareKey(SHARE);
    expect(adopted.adopted, '世代不对就不解、不存').toBe(false);
    expect(bobKey.listKey, '旧的那把还在环里（旧世代的内容还读得到）').toBe(h.listKeyV1);
  });

  it('本机世代已经不小于服务端 ⇒ 一次 detail 之后停手（零 listMembers）', async () => {
    const h = makeHarness();
    const adopted = await h.rotation.adoptRotatedShareKey(SHARE);
    expect(adopted.adopted).toBe(false);
    expect(h.calls, '不落后就不去翻名册').toEqual(['shareDetail']);
  });
});

describe('M3 一个意图：removeMemberAndRekey', () => {
  it('🔴 先移除、后换钥（反了就把要收回的钥匙又送一遍）', async () => {
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const carol = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const h = makeHarness({
      members: [
        { memberId: 'm-bob', publicKeyB64: b64(bob.x25519PublicKey) },
        { memberId: 'm-carol', publicKeyB64: b64(carol.x25519PublicKey) },
      ],
    });
    const reading = await h.rotation.removeMemberAndRekey(SHARE, 'm-bob');

    expect(reading.removed, '人是真移走了').toBe(true);
    expect(reading.rekeyError, '换钥这一轮没出错').toBeUndefined();
    expect(h.calls.indexOf('remove:m-bob'), '移除是第一件事').toBe(0);
    expect(h.calls.indexOf('remove:m-bob') < h.calls.indexOf('save'), '换钥在移除之后').toBe(true);
    expect(reading.rekey?.sealedMemberIds, 'bob 不在收件人里').toEqual(['m-owner', 'm-carol']);
    expect([...h.delivered.keys()], '没有给 bob 发过任何信封').toEqual(['m-owner', 'm-carol']);
  });

  it('🔴 被移除的人拿旧钥解不开新世代写的内容；在册的人拿新钥解得开（真密码学）', async () => {
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const h = makeHarness({ members: [{ memberId: 'm-bob', publicKeyB64: b64(bob.x25519PublicKey) }] });
    const reading = await h.rotation.removeMemberAndRekey(SHARE, 'm-bob');
    const newKey = h.currentKeyOf();

    const identity = {
      clientId: 'device-A', actionType: 'add comment', opType: 'CRT', entityType: 'COMMENT',
      entityId: 'c-1', timestamp: 1_700_000_000_000, schemaVersion: 1,
    };
    const written = await encryptShareRecord({
      id: 'op-after-removal', plaintext: new TextEncoder().encode('移除之后写的那条评论'),
      shareId: SHARE, listKey: newKey.listKey, keyEpoch: newKey.keyEpoch, identity,
    });

    await expect(
      decryptShareRecord({ record: written, shareId: SHARE, listKey: h.listKeyV1, identity }),
      'bob 手里那把旧钥必须解不开这条',
    ).rejects.toThrow();
    const reopened = await decryptShareRecord({ record: written, shareId: SHARE, listKey: newKey.listKey, identity });
    expect(new TextDecoder().decode(reopened), '在册的人（owner 这把新钥）读得回原文').toBe('移除之后写的那条评论');
    expect(reading.rekey?.toEpoch, '用的确实是新那一代').toBe(2);
  });

  it('人已经移走、换钥抛了 ⇒ 不谎报"移除失败"，把错误留在读数里', async () => {
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const h = makeHarness({
      members: [{ memberId: 'm-bob', publicKeyB64: b64(bob.x25519PublicKey) }],
      serverEpoch: 9,
    });
    const reading = await h.rotation.removeMemberAndRekey(SHARE, 'm-bob');
    expect(reading.removed, '服务端那一步成了就是成了').toBe(true);
    expect(reading.rekey, '换钥没做成').toBeUndefined();
    expect(reading.rekeyError, '原因要交出去给界面说').toContain('对不上');
    expect(h.calls.filter((c) => c === 'save' || c.startsWith('put:')), '换钥没成就不写任何东西').toEqual([]);
  });

  it('未登录 ⇒ 零请求，人也没被移除', async () => {
    const h = makeHarness({ signedIn: false });
    await expect(h.rotation.removeMemberAndRekey(SHARE, 'm-bob')).rejects.toBeInstanceOf(ShareNotSignedInError);
    expect(h.calls).toEqual([]);
  });

  it('🔴 钥匙没解锁 ⇒ 动手前就否掉：人没被移除、零请求（只做半件事 = 门关了钥匙还在他口袋里）', async () => {
    const h = makeHarness({ members: [{ memberId: 'm-bob', publicKeyB64: b64(deriveShareIdentityKeyPair(generateShareIdentitySeed()).x25519PublicKey) }] });
    const locked = createShareKeyRotation({
      api: h.api,
      isSignedIn: () => true,
      decodeMemberPublicKey: fromB64,
      keys: {
        load: async () => undefined,
        save: async () => { throw new Error('不该走到这里'); },
        ownIdentity: async () => undefined,
      },
    });
    await expect(locked.removeMemberAndRekey(SHARE, 'm-bob')).rejects.toBeInstanceOf(ShareKeyUnavailableError);
    expect(h.calls, '一个请求都不该发，成员行也还在名册里').toEqual([]);
    expect(h.roster.map((m) => m.memberId), 'bob 还在册').toContain('m-bob');
  });
});

describe('M3 离场清理：forgetShareLocally', () => {
  it('🔴 钥与日志+游标**两件都要清**（只清一件，评论还留在界面上或会被再拉回来）', () => {
    const dropped: string[] = [];
    forgetShareLocally(
      { dropKey: () => { dropped.push('key'); }, dropShareData: () => { dropped.push('data'); } },
      SHARE,
    );
    expect(dropped.sort()).toEqual(['data', 'key']);
  });
});
