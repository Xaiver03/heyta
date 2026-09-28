/**
 * golden fixture 测试 —— **四端原生解析器的锁**
 * ================================================
 *
 * 这组测试的存在理由只有一个：**证明夹具是真的，而且是有判别力的。**
 *
 * 一条"手写的密文夹具"是本仓库 §5 说的最坏情况 —— 检查存在、但不可能失败。
 * 具体到小组件，它的失效方式非常隐蔽：
 *
 *   密文是坏的 → 四端都解不开 → 而契约规定"解不开就降级为空列表"
 *              → 四端**全都测试通过** → 实际上没有任何一端真的解密过。
 *
 * 所以这里不只是"跑一遍解析"，而是逐条堵死上面那条路径：
 *
 *   1. 🔴 **密文能被独立重新推导** —— 用同一套配方再算一遍，必须逐字节相同。
 *      这条一红就说明：夹具是手写的，或者配方被人改过而夹具没重生成。
 *   2. 🔴 **真解密** —— 用 AES-256-GCM 解开并深等于 `*.plaintext.json`。
 *   3. 🔴 **`v99` 是判别用例，不是摆设** —— 它的密文**有效**，
 *      所以"无视版本直接解密"的错误实现会**解出数据**（测试会抓住它），
 *      而正确实现在 `v` 处就拒绝。
 *   4. 🔴 **AAD 用的是 `envelopeAad()`** —— 不是测试里手写的字符串。
 *
 * ## 关于下面重复的那份密钥常量
 *
 * `TEST_KEY` / `TEST_NONCE` 在 `fixture-source.ts` 里也有一份，这里**故意再写一遍**。
 *
 * 理由：四端的原生测试代码（Swift / Kotlin / ArkTS）会**各自硬编码**这份密钥来解夹具。
 * 如果这里改成从 `fixture-source.ts` import，那么"换掉密钥并重新生成夹具"会一路自洽地通过
 * —— 而四端的测试代码会全红，且原因（"夹具的密钥换了"）不会出现在任何 TS 报错里。
 * 重复这一份，就把"换密钥"变成一次**必须有人看一眼**的改动。
 */

import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  emptyPayload,
  envelopeAad,
  parseEnvelope,
  parsePayload,
  readSnapshotSafely,
  type WidgetEnvelope,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');

/** 与 `fixture-source.ts` 同一套配方 —— **故意重复**，理由见文件头。 */
const TEST_KEY = createHash('sha256').update('heyta-widget-golden-key-v1').digest();
const TEST_NONCE = createHash('sha256')
  .update('heyta-widget-golden-nonce-v1')
  .digest()
  .subarray(0, 12);
const TAG_LENGTH = 16;

function load<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

/** 用契约的 `envelopeAad()` 算 AAD —— 生成侧与契约分叉时这里会失败。 */
function decrypt(envelope: WidgetEnvelope): unknown {
  const raw = Buffer.from(envelope.ciphertext, 'base64');
  const tag = raw.subarray(raw.length - TAG_LENGTH);
  const body = raw.subarray(0, raw.length - TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', TEST_KEY, Buffer.from(envelope.nonce, 'base64'), {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAAD(Buffer.from(envelopeAad(envelope), 'utf8'));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
}

function encrypt(plaintextCompact: string, aad: string): string {
  const cipher = createCipheriv('aes-256-gcm', TEST_KEY, TEST_NONCE, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintextCompact, 'utf8'), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]).toString('base64');
}

const rawV1 = load('v1.golden.json');
const rawV99 = load('v99.unknown.golden.json');
const expectedPlaintext = load('v1.golden.plaintext.json');

/**
 * 加密时用的是 **compact** JSON（`JSON.stringify` 默认），
 * 而发布出来的 `*.plaintext.json` 是 **pretty-printed**（2 空格缩进）。
 *
 * 🔴 **这个区别是契约的一部分，四端必须知道**：JSON 没有规范化的字节表示，
 * 所以任何一端都**不能拿明文文件去做字节比对** —— 必须解析成结构再深比较。
 * 浏览器/平台 JSON 库的输出空白各不相同，字节比对必然误报。
 */
const compactPlaintext = JSON.stringify(expectedPlaintext);

/** 解出来的载荷，供下面多条断言复用。 */
function decryptedPayload(): any {
  return decrypt(rawV1);
}

describe('golden fixture（v1 正例）', () => {
  it('信封本身合法', () => {
    const result = parseEnvelope(rawV1);
    expect(result.ok).toBe(true);
  });

  it('🔴 密文能被独立重新推导（证明它不是手写的）', () => {
    // 这条是整个文件的核心。手写的 base64 不可能与"用固定 key/nonce/AAD 重算"
    // 的结果逐字节相同。它一红，就说明夹具是假的 —— 那么四端所有"解密成功"的结论都不成立。
    const recomputed = encrypt(compactPlaintext, envelopeAad(rawV1));
    expect(rawV1.ciphertext).toBe(recomputed);
  });

  it('🔴 真解密后的结构深等于 *.plaintext.json', () => {
    expect(decryptedPayload()).toEqual(expectedPlaintext);
  });

  it('解密结果能通过契约校验', () => {
    const parsed = parsePayload(decryptedPayload());
    expect(parsed.ok).toBe(true);
  });

  it('🔴 今日任务：顺序与内容都被钉住（四端解析器的第一道锁）', () => {
    const parsed = parsePayload(decryptedPayload());
    if (!parsed.ok) throw new Error('unreachable');

    // 顺序本身是信息：逾期在前 → 同截止日按优先级降序 → 已完成沉底。
    // 任何一端把顺序搞错（比如字典序、或把已完成放前面），这条会红。
    expect(parsed.payload.today.map((t) => t.id)).toEqual([
      't_rent', // 逾期（09-24）
      't_write_report', // 今天到期，优先级 3
      't_fix_incident', // 今天到期，优先级 3（与上一条同分 → 保持输入顺序）
      't_buy_tape', // 今天到期，优先级 1
      't_photo', // 今天到期，无优先级
      't_milk', // 今天已完成 → 沉底
    ]);
  });

  it('🔴 四象限**四个键都在**，且每个槽位的内容正确', () => {
    const parsed = parsePayload(decryptedPayload());
    if (!parsed.ok) throw new Error('unreachable');
    const q = parsed.payload.quadrant!;

    // "键缺失"与"该象限为空"对手写解析器是两种代码路径 —— 契约要求前者不出现。
    expect(Object.keys(q).sort()).toEqual(['1', '2', '3', '4']);
    expect(q['1']!.map((t) => t.id)).toEqual(['t_write_report', 't_fix_incident', 't_read_paper']);
    expect(q['2']!.map((t) => t.id)).toEqual(['t_checkup']);
    expect(q['3']!.map((t) => t.id)).toEqual(['t_rent', 't_buy_tape', 't_photo']);
    expect(q['4']!.map((t) => t.id)).toEqual(['t_someday']);

    // 象限项必须带 `quadrant`，且与它所在的键一致 ——
    // 这是"某端把槽位号映射错"最容易暴露的地方（比如 1↔3 反了）。
    for (const slot of ['1', '2', '3', '4']) {
      for (const task of q[slot]!) expect(task.quadrant).toBe(Number(slot));
    }
  });

  it('🔴 已完成与已删除的任务在所有视图里都不出现', () => {
    const payload = decryptedPayload() as {
      today: { id: string }[];
      quadrant: Record<string, { id: string }[]>;
    };
    const everywhere = [
      ...payload.today.map((t) => t.id),
      ...Object.values(payload.quadrant).flatMap((list) => list.map((t) => t.id)),
    ];
    // t_milk 今天完成（在今日列表里，因为在象限之外它已被排除）
    expect(everywhere).toContain('t_milk');
    // 昨天就完成的 → 今日列表与象限都没有
    expect(everywhere).not.toContain('t_archive');
    // 已删除 → 哪里都没有
    expect(everywhere).not.toContain('t_deleted');
  });

  it('🔴 `projectId` 的"有"与"没有"是可区分的（省略键，不是 null）', () => {
    const payload = decryptedPayload() as { today: Record<string, unknown>[] };
    const withPid = payload.today.find((t) => t.id === 't_write_report')!;
    const withoutPid = payload.today.find((t) => t.id === 't_buy_tape')!;

    expect(withPid.projectId).toBe('p_work');
    // 🔴 不是 `null`，也不是 `""` —— 是**键不存在**。
    // Android 的 `org.json` 用 `optString` 读 JSON `null` 会得到**字符串 "null"**，
    // 所以契约直接拒绝 `projectId: null`（见 contract.ts 的 `null-project-id`）。
    expect('projectId' in withoutPid).toBe(false);
    expect(withoutPid.projectId).toBeUndefined();
  });

  it('🔴 习惯：达成状态与连续天数', () => {
    const parsed = parsePayload(decryptedPayload());
    if (!parsed.ok) throw new Error('unreachable');

    expect(parsed.payload.habits!.map((h) => h.id)).toEqual(['h_water', 'h_run']);
    const water = parsed.payload.habits!.find((h) => h.id === 'h_water')!;
    const run = parsed.payload.habits!.find((h) => h.id === 'h_run')!;

    expect(water.doneToday).toBe(true);
    expect(water.streak).toBe(3);
    // 🔴 "今天还没打卡"不该把连续天数归零 —— 它排期在今天，但记录还没打。
    // 某端若把 streak 的边界算成"今天没打就是 0"，这条会红。
    expect(run.doneToday).toBe(false);
    expect(run.streak).toBe(3);

    // 不排期（周三）与已删除的习惯都不该出现
    expect(parsed.payload.habits!.map((h) => h.id)).not.toContain('h_review');
    expect(parsed.payload.habits!.map((h) => h.id)).not.toContain('h_deleted');
  });

  it('🔴 专注：运行中，剩余秒数由结束时间戳算出', () => {
    const parsed = parsePayload(decryptedPayload());
    if (!parsed.ok) throw new Error('unreachable');
    const focus = parsed.payload.focus!;

    expect(focus.active).toBe(true);
    expect(focus.remainingSeconds).toBe(720); // 12 分钟
    expect(focus.targetSeconds).toBe(1500); // 25 分钟
    expect(focus.sessionTitle).toBe('写周报');
  });

  it('🔴 清单颜色是**已解析的两个十六进制**，而非 token 名', () => {
    const parsed = parsePayload(decryptedPayload());
    if (!parsed.ok) throw new Error('unreachable');
    const colors = parsed.payload.projectColors!;

    // 值必须是 { light, dark } 对象。若哪一端按"字符串 token"实现，这里会红。
    expect(colors['p_work']).toEqual({ light: '#16a34a', dark: '#34d399' });
    expect(colors['p_life']).toEqual({ light: '#a21caf', dark: '#e879f9' });

    // 🔴 被引用但**没设过色**的清单必须缺席 ——
    // `t_photo` 带的是 `p_plain`，而 `p_plain` 没有颜色。
    // 四端查不到时要用自己的中性色，不能崩、不能画空白。
    expect(colors).not.toHaveProperty('p_plain');
  });

  it('readSnapshotSafely 走真实解密器时返回真实载荷', async () => {
    const payload = await readSnapshotSafely(rawV1, decrypt);
    expect(payload.today).toHaveLength(6);
    expect(payload.today[0]?.title).toBe('交房租');
  });

  it('篡改 validUntil 会导致解密失败（AAD 绑定生效）', async () => {
    // 这一条证明 AAD 不是装饰：改一个**明文帧头字段**就会让认证失败。
    // 没有 AAD 的话，攻击者能改 validUntil 让过期快照看起来是新鲜的，而密文照样解得开。
    const tampered = { ...rawV1, validUntil: rawV1.validUntil + 86_400_000 };
    expect(await readSnapshotSafely(tampered, decrypt)).toEqual(emptyPayload());
  });
});

describe('golden fixture（v99 判别用例）', () => {
  it('🔴 它的密文是**有效的** —— 这是它作为判别用例的前提', () => {
    // 用一个"无视版本"的天真解密器（就是错误实现会做的事）去解 v99，
    // 必须能解出完整数据。如果这里解不出来，那么"拒绝 v99"与"解密失败降级"
    // 结果相同，测试就区分不出正确实现与错误实现。
    const naive = decrypt(rawV99 as WidgetEnvelope);
    expect((naive as { today: unknown[] }).today).toHaveLength(6);
  });

  it('🔴 契约在 v 处拒绝它（而不是解出数据再显示）', () => {
    const parsed = parseEnvelope(rawV99);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('unknown-version');
      expect(parsed.detail).toContain('99');
    }
  });

  it('🔴 即使传入一个能解开它的解密器，正确入口仍然给空列表', async () => {
    // 这是"fail closed"的可执行定义：**能不能解开不是重点，版本不认识就不给数据。**
    expect(await readSnapshotSafely(rawV99, decrypt)).toEqual(emptyPayload());
  });
});

describe('fixture 与契约的一致性', () => {
  it('v1 与 v99 的 AAD 只差版本号（证明版本真的进了 AAD）', () => {
    expect(envelopeAad(rawV1)).toBe('1|2026-09-27|1790000000000');
    expect(envelopeAad(rawV99)).toBe('99|2026-09-27|1790000000000');
  });

  it('两份 fixture 的 nonce 与 dayStr 相同（只隔离 v 这一个变量）', () => {
    expect(rawV99.nonce).toBe(rawV1.nonce);
    expect(rawV99.dayStr).toBe(rawV1.dayStr);
    expect(rawV99.validUntil).toBe(rawV1.validUntil);
    // 密文必须不同 —— 否则说明 v 没进 AAD
    expect(rawV99.ciphertext).not.toBe(rawV1.ciphertext);
  });
});
