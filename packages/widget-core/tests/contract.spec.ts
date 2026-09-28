/**
 * 小组件契约测试
 * ================
 *
 * 承重断言五条 —— 每一条都对应一个**真实踩过或调研到的坑**，不是泛泛的类型检查：
 *
 *   1. 🔴 **未知 `v` fail closed 到空，且不抛异常**
 *      —— 旧组件读到新契约时唯一安全的行为是假装没有数据。
 *   2. 🔴 **`projectId: null` 必须被拒**
 *      —— 上游踩过：Android `org.json` 的 `optString` 把 JSON `null` 读成**字符串 `"null"`**，
 *         组件于是去找一个叫 "null" 的清单颜色，静默拿错色。
 *   3. 🔴 **AAD 的拼接格式逐字节冻结**
 *      —— 四端要各自复现这个字符串；它一改，四端同时解不开且**症状是"没有数据"**。
 *   4. 🔴 **超 20 条要拒绝，而不是截断**
 *      —— 截断是应用侧的职责；校验器一旦开始"帮忙修补"，
 *         写入方就再也不会知道自己超限了。
 *   5. 🔴 **`readSnapshotSafely` 永不抛**
 *      —— 组件在别人的进程里被唤醒，抛异常只会让用户看到空白，
 *         而那与"今天确实没有任务"在界面上无法区分。
 *
 * 第 3 条和第 5 条最危险：**它们坏掉的时候没有可见症状。**
 */

import { describe, expect, it } from 'vitest';

import {
  WIDGET_ALG,
  WIDGET_CONTRACT_VERSION,
  WIDGET_MAX_TASKS,
  emptyPayload,
  envelopeAad,
  parseEnvelope,
  parsePayload,
  readSnapshotSafely,
  readSnapshotOrNull,
} from '../src/index.js';

/** 一个合法的信封，作为各用例的基线。 */
function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    v: WIDGET_CONTRACT_VERSION,
    dayStr: '2026-09-27',
    validUntil: 1_790_000_000_000,
    alg: WIDGET_ALG,
    nonce: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'ZmFrZQ==',
    ...overrides,
  };
}

describe('parseEnvelope', () => {
  it('接受合法信封', () => {
    const result = parseEnvelope(validEnvelope());
    expect(result.ok).toBe(true);
  });

  it('🔴 未知 v 报 unknown-version（而不是含混的 malformed）', () => {
    const result = parseEnvelope(validEnvelope({ v: 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // 这两者必须能区分：unknown-version 是**预期内的**（旧组件遇到新契约），
    // malformed-envelope 是**真的坏了**。降级行为相同，日志含义不同。
    expect(result.reason).toBe('unknown-version');
    expect(result.detail).toContain('2');
  });

  it('v 不是整数时报 unknown-version 而不是崩溃', () => {
    for (const bad of ['1', null, undefined, 1.5, {}]) {
      const result = parseEnvelope(validEnvelope({ v: bad }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unknown-version');
    }
  });

  it('🔴 未知 alg 被拒（且"无加密"这一档故意不存在）', () => {
    const result = parseEnvelope(validEnvelope({ alg: 'none' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-alg');
  });

  it('非对象输入不抛异常', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      const result = parseEnvelope(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not-an-object');
    }
  });

  it('缺 dayStr / nonce / ciphertext 时是 malformed-envelope', () => {
    for (const key of ['dayStr', 'nonce', 'ciphertext']) {
      const raw = validEnvelope();
      delete (raw as Record<string, unknown>)[key];
      const result = parseEnvelope(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('malformed-envelope');
    }
  });

  it('validUntil 必须是安全整数且落在可表示范围内', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '1790000000000', null, 1.5, -1]) {
      const result = parseEnvelope(validEnvelope({ validUntil: bad }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('malformed-envelope');
    }
  });
});

describe('envelopeAad —— 拼接格式冻结', () => {
  it('🔴 逐字节等于 `v|dayStr|validUntil`', () => {
    // 这个断言是**四端互操作的唯一保证**。它一旦"顺手"被改成别的分隔符，
    // 四端会同时解不开，而且症状只是"组件没有数据"。
    expect(envelopeAad({ v: 1, dayStr: '2026-09-27', validUntil: 1_790_000_000_000 })).toBe(
      '1|2026-09-27|1790000000000',
    );
  });

  it('🔴 科学计数法这个雷由范围检查提前挡掉 —— 不要求四端复刻 JS 的格式化', () => {
    // 事实：JS 的 String(1e21) 是 '1e+21'，而 Swift / Kotlin / ArkTS 各不相同。
    // 如果我们"要求四端复现这个字符串"，就等于把一个 JS 实现细节写进跨端契约。
    // 正确做法是让这么大的值根本进不来 —— 两道检查分别挡住两段：
    expect(String(1e21)).toBe('1e+21');

    // ① 大到连安全整数都不是 → 被第一道拦住
    const notSafe = parseEnvelope(validEnvelope({ validUntil: 1e21 }));
    expect(notSafe.ok).toBe(false);
    if (!notSafe.ok) expect(notSafe.detail).toContain('不是安全整数');

    // ② 是安全整数、但超出 JS Date 可表示范围（8.64e15）→ 被第二道拦住
    //    9e15 的 String() 仍是十进制（指数记法从 1e21 才开始），所以它确实走到第二道
    expect(String(9e15)).toBe('9000000000000000');
    const outOfRange = parseEnvelope(validEnvelope({ validUntil: 9e15 }));
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.detail).toContain('超出可表示范围');
  });
});

describe('parsePayload', () => {
  it('接受最小合法载荷', () => {
    const result = parsePayload({ today: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.today).toEqual([]);
  });

  it('🔴 projectId 为 null 时被拒（null-project-id）', () => {
    const result = parsePayload({
      today: [{ id: 't1', title: '写周报', isDone: false, projectId: null }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('null-project-id');
      expect(result.detail).toContain('optString');
    }
  });

  it('🔴 projectId 省略时键真的不存在（不是 undefined 占位）', () => {
    const result = parsePayload({ today: [{ id: 't1', title: '写周报', isDone: false }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const task = result.payload.today[0]!;
    expect('projectId' in task).toBe(false);
  });

  it('🔴 超过 20 条被拒，而不是被截断', () => {
    const tasks = Array.from({ length: WIDGET_MAX_TASKS + 1 }, (_, i) => ({
      id: `t${i}`,
      title: `任务 ${i}`,
      isDone: false,
    }));
    const result = parsePayload({ today: tasks });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too-many-tasks');
      // 报错必须自带数字，否则排查时要自己去数
      expect(result.detail).toContain(String(WIDGET_MAX_TASKS + 1));
    }
  });

  it('恰好 20 条通过（边界用例，防止上限被写成 <）', () => {
    const tasks = Array.from({ length: WIDGET_MAX_TASKS }, (_, i) => ({
      id: `t${i}`,
      title: `任务 ${i}`,
      isDone: false,
    }));
    expect(parsePayload({ today: tasks }).ok).toBe(true);
  });

  it('缺 today 与 today 非数组分别报不同原因', () => {
    const missing = parsePayload({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('missing-today');

    const wrongType = parsePayload({ today: 'nope' });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.reason).toBe('today-not-array');
  });

  it('任务缺 id / title / isDone 时给出可定位的 detail', () => {
    const result = parsePayload({ today: [{ id: 't1', title: '写周报' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('isDone');
  });

  it('四款组件的载荷都能被完整解析', () => {
    const result = parsePayload({
      today: [{ id: 't1', title: '写周报', isDone: false, projectId: 'p1', quadrant: 2 }],
      quadrant: { '2': [{ id: 't1', title: '写周报', isDone: false, projectId: 'p1' }] },
      habits: [{ id: 'h1', title: '跑步', doneToday: true, streak: 7 }],
      focus: { active: true, remainingSeconds: 900, targetSeconds: 1500, sessionTitle: '写方案' },
      projectColors: { p1: { light: '#16a34a', dark: '#34d399' } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.payload.today).toHaveLength(1);
    expect(result.payload.habits?.[0]?.streak).toBe(7);
    expect(result.payload.focus?.active).toBe(true);
    expect(result.payload.projectColors?.p1).toEqual({ light: '#16a34a', dark: '#34d399' });
  });

  it('🔴 projectColors 只接受 { light, dark } 对象，字符串 token 被拒', () => {
    // 这条挡的是"原生拿 token 名去查表"这个错误实现：
    // 实测 `HeytaTokens.swift` 里**没有**任何类别色（grep -c category = 0），
    // 所以原生解不了 token。契约必须在解析层就把这种载荷挡掉，
    // 而不是让它跑到原生里变成一个"显示成透明"的静默失败。
    const asToken = parsePayload({ today: [], projectColors: { p1: 'color.category-1' } });
    expect(asToken.ok).toBe(false);
    if (!asToken.ok) expect(asToken.reason).toBe('malformed-section');

    // 只给一半（缺 dark）也要拒
    const halfPair = parsePayload({ today: [], projectColors: { p1: { light: '#16a34a' } } });
    expect(halfPair.ok).toBe(false);
    if (!halfPair.ok) expect(halfPair.reason).toBe('malformed-section');

    // 空字符串颜色同样拒
    const blank = parsePayload({
      today: [],
      projectColors: { p1: { light: '', dark: '#34d399' } },
    });
    expect(blank.ok).toBe(false);
  });

  it('quadrant 也用同一套上限与同一套任务校验', () => {
    const tooMany = Array.from({ length: WIDGET_MAX_TASKS + 1 }, (_, i) => ({
      id: `t${i}`,
      title: `任务 ${i}`,
      isDone: false,
    }));
    const result = parsePayload({ today: [], quadrant: { '1': tooMany } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-many-tasks');

    // 同一个 null-projectId 陷阱在 quadrant 里也必须被拦住
    const nullPid = parsePayload({
      today: [],
      quadrant: { '1': [{ id: 't1', title: 'x', isDone: false, projectId: null }] },
    });
    expect(nullPid.ok).toBe(false);
    if (!nullPid.ok) expect(nullPid.reason).toBe('null-project-id');
  });

  it('focus 只允许 active 为布尔，其余字段可选', () => {
    expect(parsePayload({ today: [], focus: { active: true } }).ok).toBe(true);
    expect(parsePayload({ today: [], focus: { active: 'yes' } }).ok).toBe(false);
    expect(parsePayload({ today: [], focus: {} }).ok).toBe(false);
  });
});

describe('readSnapshotSafely / readSnapshotOrNull —— fail closed', () => {
  const decryptTo = (payload: unknown) => () => payload;

  it('🔴 未知 v 降级为空列表（不抛）', async () => {
    const result = await readSnapshotSafely(validEnvelope({ v: 99 }), decryptTo({ today: [{ id: 't', title: 'x', isDone: false }] }));
    expect(result).toEqual(emptyPayload());
  });

  it('🔴 解密抛异常时降级为空列表（不 reject）', async () => {
    const throwing = () => {
      throw new Error('密钥尚未派生（设备刚重启）');
    };
    await expect(readSnapshotSafely(validEnvelope(), throwing)).resolves.toEqual(emptyPayload());
  });

  it('🔴 解密成功但载荷非法时也降级为空列表', async () => {
    const result = await readSnapshotSafely(validEnvelope(), decryptTo({ today: 'garbage' }));
    expect(result).toEqual(emptyPayload());
  });

  it('一切正常时返回真实载荷（证明上面的空列表不是"永远为空"）', async () => {
    // 反过来验证：这个用例确保前三条不是因为函数永远返回空而通过的。
    const result = await readSnapshotSafely(
      validEnvelope(),
      decryptTo({ today: [{ id: 't1', title: '写周报', isDone: false }] }),
    );
    expect(result.today).toHaveLength(1);
    expect(result.today[0]?.title).toBe('写周报');
  });

  it('非对象输入也降级为空列表', async () => {
    expect(await readSnapshotSafely(null, decryptTo({ today: [] }))).toEqual(emptyPayload());
    expect(await readSnapshotSafely('x', decryptTo({ today: [] }))).toEqual(emptyPayload());
  });

  // ─────────────────────────────────────────────────────────────
  // 🔴 下面这一组是"解不开密 ≠ 今天没有任务"的锁
  // ─────────────────────────────────────────────────────────────

  it('🔴 解不开密时 readSnapshotOrNull 返回 null（而不是空载荷）', async () => {
    const throwing = () => {
      throw new Error('密钥尚未派生');
    };
    expect(await readSnapshotOrNull(validEnvelope(), throwing)).toBeNull();
    // 同一个输入，另一个入口给出的是 emptyPayload —— 两者**必须不同**，
    // 否则"读不到密钥"会被渲染成"今天没有任务"，而那是在骗用户。
    expect(await readSnapshotSafely(validEnvelope(), throwing)).toEqual(emptyPayload());
  });

  it('信封非法时 readSnapshotOrNull 也返回 null', async () => {
    expect(await readSnapshotOrNull({ v: 99 }, decryptTo({ today: [] }))).toBeNull();
    expect(await readSnapshotOrNull(null, decryptTo({ today: [] }))).toBeNull();
  });

  it('载荷合法但今天确实为空时，readSnapshotOrNull 返回空载荷而不是 null', async () => {
    // 这一条与上面两条合起来才完整：null 与 emptyPayload 必须是两种状态。
    expect(await readSnapshotOrNull(validEnvelope(), decryptTo({ today: [] }))).toEqual(emptyPayload());
  });

  it('🔴 异步解密器会被 await（少了 await 会静默降级成"没有数据"）', async () => {
    // 四端里 JS 侧的 AES 必然是异步的；若 readSnapshotOrNull 忘了 await，
    // 拿到的是 Promise 对象，parsePayload 判它格式非法 → 返回 null，
    // 症状是"组件永远空着"且日志里什么都没有。
    const asyncDecryptor = async () => ({ today: [{ id: 't1', title: '异步也能解', isDone: false }] });
    const payload = await readSnapshotOrNull(validEnvelope(), asyncDecryptor);
    expect(payload?.today).toHaveLength(1);
    expect(payload?.today[0]?.title).toBe('异步也能解');
  });

  it('异步解密器抛异常（reject）也降级为 null', async () => {
    const rejecting = async () => {
      throw new Error('异步解密失败');
    };
    expect(await readSnapshotOrNull(validEnvelope(), rejecting)).toBeNull();
  });
});

  describe('🔴 focus.endsAt（灵动岛 / Live Activity 的前提）', () => {
    const parseFocus = (focus: unknown) =>
      parsePayload({ today: [], focus });

    it('缺省是合法的（向前兼容：旧发布方不写它）', () => {
      const r = parseFocus({ active: true, remainingSeconds: 720 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.payload.focus).toEqual({ active: true, remainingSeconds: 720 });
        expect(r.payload.focus).not.toHaveProperty('endsAt');
      }
    });

    it('合法的安全整数被接受', () => {
      const r = parseFocus({ active: true, endsAt: 1_790_000_000_000 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.payload.focus?.endsAt).toBe(1_790_000_000_000);
    });

    it('🔴 `null` 必须拒绝 —— 缺省可以，null 不行（与 projectId 同一条纪律）', () => {
      expect(parseFocus({ active: true, endsAt: null }).ok).toBe(false);
    });

    it('🔴 非安全整数 / 负数 / 越界 / 非数字一律拒绝', () => {
      // `1e300` 是"有限"的，但它转成 Date 就是 Invalid Date ——
      // 用 isFinite 判会放过它，用 isSafeInteger 会挡住。这是关键的一条。
      for (const bad of [1.5, -1, 1e300, Number.MAX_SAFE_INTEGER + 2, '1790000000000', true, {}]) {
        expect(parseFocus({ active: true, endsAt: bad }).ok, `应拒绝 ${String(bad)}`).toBe(false);
      }
    });

    it('边界：0 与 MAX_EPOCH_MS 都接受，越界 1 毫秒就拒绝', () => {
      expect(parseFocus({ active: true, endsAt: 0 }).ok).toBe(true);
      expect(parseFocus({ active: true, endsAt: 8_640_000_000_000_000 }).ok).toBe(true);
      expect(parseFocus({ active: true, endsAt: 8_640_000_000_000_001 }).ok).toBe(false);
    });
  });
