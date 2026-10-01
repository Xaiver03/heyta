/**
 * 鸿蒙小组件的解析层 + 视图模型 —— **由同一份黄金夹具驱动**。
 *
 * ## 这个文件为什么能跑在这个仓库里
 *
 * 鸿蒙的卡片是 `.ets`，本机**没有 `ark_js_vm`**（实测遍 DevEco 全目录
 * 没有任何 ark runtime），所以卡片本身跑不起来。但解析层是 `.ts` ——
 * 于是"读同一份 `v1.golden.*`、算出与其它三端相同的结果"这件事
 * **可以真验证**，而不是"写完了，看起来对"。
 *
 * ## 三件事这个文件在防
 *
 * 1. 🔴 **四端漂移**：同一份夹具，鸿蒙端算出来的行数/象限计数/连续天数
 *    必须与 Android / iOS / Windows 相同。不一样就是某一端理解错了契约。
 * 2. 🔴 **本地常量与真源契约漂移**：`WidgetParse.ts` 里必须**手抄**那几个常量
 *    （`WIDGET_CONTRACT_VERSION` / `WIDGET_ALG` / `WIDGET_MAX_TASKS` /
 *    `MAX_EPOCH_MS`），因为四端各自的编译单元无法共享 TS 常量。
 *    手抄就会漂移，而漂移的症状是"鸿蒙端把新契约当未知版本 → 永远显示占位态"，
 *    **不报错、不崩溃**。所以下面有一条把两处**逐字对照**的测试。
 * 3. 🔴 **契约变更时鸿蒙端忘了跟**：任何契约改动都会让上面第 2 条红。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATALOGS, type MessageKey } from '@heyta/i18n';
import {
  MAX_EPOCH_MS as CANON_MAX_EPOCH_MS,
  WIDGET_ALG as CANON_ALG,
  WIDGET_CONTRACT_VERSION as CANON_VERSION,
  WIDGET_MAX_TASKS as CANON_MAX_TASKS,
} from '@heyta/widget-core';
import { describe, expect, it } from 'vitest';

import * as P from '../harmony/entry/src/main/ets/widget/WidgetParse.js';
import * as M from '../harmony/entry/src/main/ets/widget/WidgetModels.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'packages', 'widget-core', 'fixtures');
const WIDGET_DIR = join(HERE, '..', 'harmony', 'entry', 'src', 'main', 'ets', 'widget');

/** 四象限标签的词条 key（`satisfies` 让 key 打错时编译期就红）。 */
const QUADRANT_KEYS = ['web.shell.nav.q1', 'web.shell.nav.q2', 'web.shell.nav.q3', 'web.shell.nav.q4'] as const satisfies readonly MessageKey[];

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

const PLAINTEXT = fixture<P.WidgetPayload>('v1.golden.plaintext.json');
const ENVELOPE = fixture<unknown>('v1.golden.json');
const UNKNOWN_VERSION = fixture<unknown>('v99.unknown.golden.json');
const TEST_DAY = '2026-09-27';
const TEST_VALID_UNTIL = 1_790_000_000_000;

// ─────────────────────────────────────────────────────────────

describe('🔴 本地常量必须与真源契约逐字相同', () => {
  it('四个常量一个都不能漂', () => {
    // 断言"两处相等"而不是"写死字面量"：契约改了、这边没跟 → 这里红，
    // 而不是**悄悄地**让鸿蒙端不认新契约。
    expect(P.WIDGET_CONTRACT_VERSION).toBe(CANON_VERSION);
    expect(P.WIDGET_ALG).toBe(CANON_ALG);
    expect(P.WIDGET_MAX_TASKS).toBe(CANON_MAX_TASKS);
    expect(P.MAX_EPOCH_MS).toBe(CANON_MAX_EPOCH_MS);
  });
});

describe('信封', () => {
  it('黄金信封能过（v / alg / dayStr / validUntil 都对）', () => {
    const result = P.parseEnvelope(ENVELOPE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.v).toBe(CANON_VERSION);
    expect(result.envelope.alg).toBe(CANON_ALG);
    expect(result.envelope.dayStr).toBe(TEST_DAY);
    expect(result.envelope.validUntil).toBe(TEST_VALID_UNTIL);
  });

  it('🔴 未知版本 fail closed —— 绝不猜测', () => {
    // 旧组件读到新契约时唯一安全的行为是假装没有数据。
    // 猜字段的后果是把**错误的数据**画在用户桌面上，而用户没有理由怀疑它。
    const result = P.parseEnvelope(UNKNOWN_VERSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-version');
  });

  it('算法不是 AES-GCM-256 一律拒绝（故意没有"无加密"这一档）', () => {
    const raw = ENVELOPE as Record<string, unknown>;
    const result = P.parseEnvelope({ ...raw, alg: 'none' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-alg');
  });

  it('`validUntil` 越界必须拒绝 —— 它是跨端 AAD 一致性的护栏', () => {
    // 超出 JS 能精确表示的范围时，四端把 validUntil 转字符串的结果**不一样**，
    // 症状是"某一端解密永远失败"，且看不出为什么。
    const raw = ENVELOPE as Record<string, unknown>;
    for (const bad of [CANON_MAX_EPOCH_MS + 1, -1, 1.5, Number.NaN, '1790000000000']) {
      const result = P.parseEnvelope({ ...raw, validUntil: bad });
      expect(result.ok, `validUntil=${String(bad)} 应被拒绝`).toBe(false);
    }
    // 边界值本身合法
    expect(P.parseEnvelope({ ...raw, validUntil: CANON_MAX_EPOCH_MS }).ok).toBe(true);
  });

  it('数组不是信封（`typeof [] === "object"` 的坑）', () => {
    const result = P.parseEnvelope([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 必须报 "不是对象"，不能报 "版本不认识" —— 后者会把排查带偏
    expect(result.reason).toBe('not-an-object');
  });

  it('缺字段 / 空字符串一律拒绝', () => {
    const raw = ENVELOPE as Record<string, unknown>;
    for (const key of ['dayStr', 'nonce', 'ciphertext']) {
      expect(P.parseEnvelope({ ...raw, [key]: '' }).ok, `${key} 空字符串`).toBe(false);
      const without: Record<string, unknown> = { ...raw };
      delete without[key];
      expect(P.parseEnvelope(without).ok, `${key} 缺失`).toBe(false);
    }
  });

  it('🔴 AAD 逐字节固定 —— 四端必须算出同一个字符串', () => {
    const result = P.parseEnvelope(ENVELOPE);
    if (!result.ok) throw new Error('夹具应当能解析');
    // 写死期望值（不是"和某个函数的结果相同"）：
    // 这条字符串是 GCM 认证的一部分，改一个字符 = 那一端解密必然失败。
    expect(P.envelopeAad(result.envelope)).toBe(`1|${TEST_DAY}|${TEST_VALID_UNTIL}`);
  });

  it('过期判据与原生三端逐字相同：now >= validUntil', () => {
    const result = P.parseEnvelope(ENVELOPE);
    if (!result.ok) throw new Error('夹具应当能解析');
    expect(P.isStale(result.envelope, TEST_VALID_UNTIL - 1)).toBe(false);
    expect(P.isStale(result.envelope, TEST_VALID_UNTIL)).toBe(true);
    expect(P.isStale(result.envelope, TEST_VALID_UNTIL + 1)).toBe(true);
  });
});

describe('载荷（黄金夹具）', () => {
  const parsed = P.parsePayload(PLAINTEXT);

  it('能过', () => {
    expect(parsed.ok).toBe(true);
  });

  it('保留 `today` 的全部 6 条，顺序不变', () => {
    if (!parsed.ok) throw new Error('夹具应当能解析');
    expect(parsed.payload.today.map((t) => t.id)).toEqual([
      't_rent',
      't_write_report',
      't_fix_incident',
      't_buy_tape',
      't_photo',
      't_milk',
    ]);
  });

  it('🔴 `projectId` 缺失时**省略键**，绝不写 `null`', () => {
    // 上游 Super Productivity 踩过：Android 的 `optString("projectId")`
    // 会把 JSON `null` 读成**字符串 `"null"`**，于是去找一个叫 "null" 的
    // 清单颜色，**静默取到错误颜色**。
    if (!parsed.ok) throw new Error('夹具应当能解析');
    const tape = parsed.payload.today.find((t) => t.id === 't_buy_tape');
    expect(tape).toBeDefined();
    expect('projectId' in (tape as object)).toBe(false);
    expect(tape?.projectId).toBeUndefined();
  });

  it('超限（>20）整份拒绝 —— 校验器只拒绝，不修补', () => {
    const tooMany = { today: Array.from({ length: CANON_MAX_TASKS + 1 }, (_, i) => ({
      id: `t${i}`,
      title: 'x',
      isDone: false,
    })) };
    expect(P.parsePayload(tooMany).ok).toBe(false);
  });

  it('🔴 一条坏任务 → 整份载荷不算数（不跳过坏的留下好的）', () => {
    // "跳过坏的"会显示一份**看起来正常但少了任务**的列表，
    // 而用户以为那就是全部。
    const withBad = {
      today: [
        { id: 'a', title: '好', isDone: false },
        { id: 'b', title: '坏', isDone: 'false' }, // 字符串！
      ],
    };
    expect(P.parsePayload(withBad).ok).toBe(false);
  });

  it('`isDone` 必须是真布尔 —— 字符串 "false" 是四端共有的坑', () => {
    // Adaptive Card 会把未解析的 `${isDone}` 当字符串传过来；
    // Swift 那边是 `NSNumber` 桥接、Kotlin 是 `Boolean(x)`。
    // `Boolean('false') === true` → "取消完成"变成"标记完成"，且看起来正常。
    expect(P.parsePayload({ today: [{ id: 'a', title: 'x', isDone: 'false' }] }).ok).toBe(false);
    expect(P.parsePayload({ today: [{ id: 'a', title: 'x', isDone: 0 }] }).ok).toBe(false);
  });
});

describe('今日任务卡片', () => {
  it('6 行，顺序与夹具一致', () => {
    const parsed = P.parsePayload(PLAINTEXT);
    if (!parsed.ok) throw new Error('夹具应当能解析');
    const model = M.buildTodayModel(parsed.payload, false);
    expect(model.state).toBe('ready');
    expect(model.count).toBe(6);
    expect(model.isEmpty).toBe(false);
    expect(model.rows.map((r) => r.id)).toEqual(parsed.payload.today.map((t) => t.id));
  });

  it('完成态原样带过来', () => {
    const parsed = P.parsePayload(PLAINTEXT);
    if (!parsed.ok) throw new Error('夹具应当能解析');
    const model = M.buildTodayModel(parsed.payload, false);
    expect(model.rows.find((r) => r.id === 't_milk')?.isDone).toBe(true);
    expect(model.rows.find((r) => r.id === 't_rent')?.isDone).toBe(false);
  });

  it('项目色：浅色/深色各取一份，没色槽的任务**省略** color', () => {
    const parsed = P.parsePayload(PLAINTEXT);
    if (!parsed.ok) throw new Error('夹具应当能解析');

    const light = M.buildTodayModel(parsed.payload, false);
    const dark = M.buildTodayModel(parsed.payload, true);

    expect(light.rows.find((r) => r.id === 't_rent')?.color).toBe('#a21caf');
    expect(dark.rows.find((r) => r.id === 't_rent')?.color).toBe('#e879f9');
    // `t_buy_tape` 没有 projectId → 不能有 color（有的话说明有人给它编了一个）
    expect(light.rows.find((r) => r.id === 't_buy_tape')?.color).toBeUndefined();
    // `p_plain` 被引用但**不在 projectColors 里** → 同样省略，不能崩
    expect(light.rows.find((r) => r.id === 't_photo')?.color).toBeUndefined();
  });

  it('空列表与"不知道"是**两个状态**', () => {
    const empty = M.buildTodayModel({ today: [] }, false);
    expect(empty.state).toBe('ready');
    expect(empty.isEmpty).toBe(true);
    expect(empty.count).toBe(0);
    // ⚠️ `buildTodayModel` **不会**产出 `placeholder` ——
    //    "快照还没读到"由调用方（卡片）决定，而不是让模型猜。
    expect(empty.state).not.toBe('placeholder');
  });
});

describe('四象限卡片', () => {
  it('计数与其它三端相同：[3,1,3,1]', () => {
    const parsed = P.parsePayload(PLAINTEXT);
    if (!parsed.ok) throw new Error('夹具应当能解析');
    const model = M.buildQuadrantModel(parsed.payload, true);
    expect(model.slots.map((s) => s.count)).toEqual([3, 1, 3, 1]);
  });

  it('🔴 四个槽位全部出现，即使是 0', () => {
    // 只画非空的槽位会让用户以为某个象限不存在 ——
    // 而"我今天没有重要且紧急的事"是**有意义的信息**。
    const model = M.buildQuadrantModel({ today: [] }, true);
    expect(model.slots.map((s) => s.slot)).toEqual(['1', '2', '3', '4']);
    expect(model.slots.every((s) => s.count === 0)).toBe(true);
  });

  it('🔴 中英标签逐字等于词条表 `web.shell.nav.q1`–`q4`（U11 的第 4 处手抄）', () => {
    for (const [isZh, locale] of [
      [true, 'zh-CN'],
      [false, 'en'],
    ] as const) {
      const model = M.buildQuadrantModel({ today: [] }, isZh);
      expect(model.slots.map((s) => s.label)).toEqual(
        QUADRANT_KEYS.map((key) => CATALOGS[locale][key]),
      );
    }
    // ⚠️ 断言的是"两处相等"，不是"写死字面量"：词条表改了、这边没跟 → 这里红。
    // 之前只有中文一份，英文设备上四象限标签是整张卡片唯一没翻译的地方。
  });

  it('🔴 `.ets` 侧必须把系统语言传给象限模型（源码对账）', () => {
    // 为什么用文本断言：`.ets` 不在本仓库任何 typecheck 的 `include` 里
    // （`apps/mobile/tsconfig.json` 只包 `src/**`），而鸿蒙卡片要 DevEco 才编得动。
    // 于是"参数漏传"这个错误的表现是**英文设备上四象限显示中文**，
    // 而编译、测试、运行时都没有任何一层会失败 —— 只能拿源码对账。
    const forms = readFileSync(join(WIDGET_DIR, 'WidgetForms.ets'), 'utf8');
    const store = readFileSync(join(WIDGET_DIR, 'WidgetStore.ets'), 'utf8');
    expect(forms).toMatch(/quadrantCard\(snapshot, isZh\)/);
    expect(store).toMatch(/buildQuadrantModel\(snapshot\.payload, isZh\)/);
  });

  it('firstTitle 取**第一条未完成**的，跳过已完成的', () => {
    const model = M.buildQuadrantModel(
      {
        today: [],
        quadrant: {
          '1': [
            { id: 'a', title: '已完成', isDone: true },
            { id: 'b', title: '还没做', isDone: false },
          ],
        },
      },
      true,
    );
    expect(model.slots[0]?.firstTitle).toBe('还没做');
  });

  it('整槽都完成时 firstTitle 为空（而不是显示已完成的那条）', () => {
    const model = M.buildQuadrantModel(
      { today: [], quadrant: { '2': [{ id: 'a', title: '做完了', isDone: true }] } },
      true,
    );
    expect(model.slots[1]?.firstTitle).toBe('');
    expect(model.slots[1]?.count).toBe(1);
  });
});

describe('今日习惯卡片', () => {
  it('两行，打卡态与连续天数都对', () => {
    const parsed = P.parsePayload(PLAINTEXT);
    if (!parsed.ok) throw new Error('夹具应当能解析');
    const model = M.buildHabitsModel(parsed.payload);
    expect(model.rows.map((r) => r.id)).toEqual(['h_water', 'h_run']);
    expect(model.rows[0]?.doneToday).toBe(true);
    expect(model.rows[0]?.streak).toBe(3);
    expect(model.rows[1]?.doneToday).toBe(false);
  });

  it('streak 为 0 时**省略**（不显示"连续 0 天"）', () => {
    const model = M.buildHabitsModel({
      today: [],
      habits: [{ id: 'h', title: '喝水', doneToday: false, streak: 0 }],
    });
    expect(model.rows[0]?.streak).toBeUndefined();
  });

  it('streak 是 Double，收成整数', () => {
    const model = M.buildHabitsModel({
      today: [],
      habits: [{ id: 'h', title: '喝水', doneToday: true, streak: 3.0 }],
    });
    expect(model.rows[0]?.streak).toBe(3);
  });

  it('没有习惯时 isEmpty 为 true（且 state 仍是 ready）', () => {
    const model = M.buildHabitsModel({ today: [] });
    expect(model.isEmpty).toBe(true);
    expect(model.rows).toEqual([]);
  });
});

describe('今日专注卡片', () => {
  it('🔴 模型里**绝对不能有**倒计时字段', () => {
    // 这条盯的不是"算得对不对"，而是**"有没有人把倒计时加进来"**。
    // 契约里的 remainingSeconds 是发布那一刻的快照值、没有绝对锚点，
    // 画出来必然错 —— 而且错得**没有症状**（它看起来是对的）。
    const model = M.buildFocusModel({
      today: [],
      focus: { active: true, remainingSeconds: 720, targetSeconds: 1500, sessionTitle: '写周报' },
    });
    const keys = Object.keys(model);
    for (const forbidden of ['remaining', 'remainingSeconds', 'countdown', 'elapsed', 'left']) {
      expect(keys, `FocusModel 不应该有 ${forbidden}`).not.toContain(forbidden);
    }
    // 序列化之后也不能出现 720（那个错的值）
    expect(JSON.stringify(model)).not.toContain('720');
  });

  it('只画不会随时间变的事实：标题 + 目标时长', () => {
    const parsed = P.parsePayload(PLAINTEXT);
    if (!parsed.ok) throw new Error('夹具应当能解析');
    const model = M.buildFocusModel(parsed.payload);
    expect(model.active).toBe(true);
    expect(model.sessionTitle).toBe('写周报');
    expect(model.targetMinutes).toBe(25); // 1500 秒
  });

  it('没在专注时不装作在专注', () => {
    const model = M.buildFocusModel({ today: [], focus: { active: false } });
    expect(model.active).toBe(false);
    expect(model.sessionTitle).toBe('');
    expect(model.targetMinutes).toBe(0);
  });

  it('🔴 `focus.endsAt` 是可选的安全整数 —— 灵动岛 / Live Activity 的前提', () => {
    // 缺省合法（向前兼容）
    const omitted = P.parsePayload({ today: [], focus: { active: true } });
    expect(omitted.ok).toBe(true);
    if (omitted.ok) expect(omitted.payload.focus).not.toHaveProperty('endsAt');

    // 合法值被读进来
    const ok = P.parsePayload({ today: [], focus: { active: true, endsAt: 1_790_000_000_000 } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payload.focus?.endsAt).toBe(1_790_000_000_000);

    // 边界：0 与 MAX 都收，越界 1 毫秒就拒
    for (const [value, accepted] of [
      [0, true],
      [P.MAX_EPOCH_MS, true],
      [P.MAX_EPOCH_MS + 1, false],
      [1.5, false], // 毫秒时刻没有小数
      [-1, false],
      ['1790000000000', false],
      [true, false],
      [null, false], // 🔴 缺省可以，null 不行
    ] as Array<[unknown, boolean]>) {
      const r = P.parsePayload({ today: [], focus: { active: true, endsAt: value } });
      expect(r.ok, `endsAt=${String(value)}`).toBe(accepted);
    }
  });

  it('`focus` 缺失也不崩', () => {
    expect(M.buildFocusModel({ today: [] }).active).toBe(false);
  });

  it('秒 → 分钟**四舍五入**（90 秒该是 2 分钟，截断会显示 1）', () => {
    expect(M.secondsToMinutes(90)).toBe(2);
    expect(M.secondsToMinutes(1500)).toBe(25);
    expect(M.secondsToMinutes(0)).toBe(0);
    expect(M.secondsToMinutes(-5)).toBe(0);
    expect(M.secondsToMinutes(Number.NaN)).toBe(0);
  });

  it('目标时长文案：0 分钟不显示', () => {
    expect(M.formatTarget(25)).toBe('目标 25 分钟');
    expect(M.formatTarget(0)).toBe('');
  });
});
