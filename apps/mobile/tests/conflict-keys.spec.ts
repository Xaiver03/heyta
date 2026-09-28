/**
 * 冲突：实体名 / 原因 → 共享词条 key
 * ====================================
 *
 * 🔴 这个文件是原 `conflict-view.spec.ts` 里**仍然有意义**的那部分断言的落脚点。
 *
 * 迁之前，实体名与原因的查表住在 `apps/mobile/src/sync/conflict-view.ts`，
 * web 的 `ConflictDialog.tsx` 另有一份。**key 相同，所以句子不漂移；
 * 会漂移的是集合本身** —— 加一个新实体只改一端时，另一端不会报错、
 * 也没有测试会红，只会静默地把 `AI_FEEDBACK` 这种内部标识符显示给用户。
 *
 * 现在两张表都收进 `@heyta/ui` 的 `sync/model.ts`，两端从同一份取。
 * 这个文件钉住三件事：
 *
 *   1. **表与法律实体清单对齐**（`@heyta/op-log` 的 `MODELED_ENTITY_TYPES` +
 *      `UNMODELED_ENTITY_TYPES`，后者由 `entity-coverage` 测试钉在
 *      `@heyta/shared-schema` 的 `ENTITY_TYPES` 上）。漏一个、多一个都红。
 *   2. **两种语言都真翻了**（zh 含汉字 / en 不含汉字）。
 *   3. **查不到时给兜底句**，绝不把服务端那句英文诊断漏进界面。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么用相对路径直接 import 共享层的**源码**
 *
 * 移动端单测跑在 node 里，`@heyta/ui` 的入口会拖进 `react-native` 的 Flow
 * 源码、直接解析失败（实测）。而 `sync/model.ts` 是**零 import 的纯模块**，
 * 所以测试直接从源码路径 import 它 —— 用的是**同一份实现**，不是复制一份表。
 * ⚠️ 代价：这个路径成了隐式契约，重命名 `model.ts` 会让它红（这是好事），
 * 但读起来略绕。最小的一步见 `apps/mobile/src/sync/status-text.ts` 文件头。
 */

import { describe, expect, it } from 'vitest';
import { MODELED_ENTITY_TYPES, UNMODELED_ENTITY_TYPES } from '@heyta/op-log';
import { translate } from '@heyta/i18n';

import {
  CONFLICT_REASON_FALLBACK_KEY,
  CONFLICT_REASON_KEYS,
  ENTITY_LABEL_KEYS,
  conflictLookupCode,
  conflictReasonKey,
  conflictReasonLabelOf,
  entityLabelKey,
  entityLabelOf,
} from '../../../packages/ui/src/sync/model';

const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

/** 全部合法实体类型 —— 由 op-log 的"已物化 / 已登记未物化"两个清单并出来。 */
const ALL_ENTITY_TYPES = [
  ...MODELED_ENTITY_TYPES,
  ...UNMODELED_ENTITY_TYPES.map((e) => e.entityType),
];

/** 一个汉字都没有的串，说明英文词条没被翻译成中文以外的东西 —— 用于反向检查。 */
const CJK = /[\u4E00-\u9FFF]/;

describe('实体名表（共享 `sync/model.ts` 的唯一一份）', () => {
  it('🔴 每个合法实体类型都有词条（漏一个 = 界面上出现英文代号）', () => {
    const missing = ALL_ENTITY_TYPES.filter((t) => ENTITY_LABEL_KEYS[t] === undefined);
    expect(missing).toEqual([]);
  });

  it('🔴 表里没有多余的键（防止实体被删掉后这里腐烂）', () => {
    const stale = Object.keys(ENTITY_LABEL_KEYS).filter((k) => !ALL_ENTITY_TYPES.includes(k));
    expect(stale).toEqual([]);
  });

  it('🔴 每个实体名两种语言都给得出，且都不是代号', () => {
    for (const type of ALL_ENTITY_TYPES) {
      const key = entityLabelKey(type);
      expect(key).toBeDefined();
      expect(zh(key!)).toMatch(CJK); // 中文界面必须是中文
      expect(en(key!)).not.toMatch(CJK); // 英文界面不能漏出中文
      expect(en(key!)).not.toBe('SOMETHING_NEW');
      // 也顺带钉住"不是原样把类型名当名字返回"。
      expect(en(key!)).not.toBe(type);
    }
  });

  it('已知实体的名字与迁移前逐字相同（行为不变）', () => {
    expect(entityLabelOf('TASK', zh)).toBe('任务');
    expect(entityLabelOf('PROJECT', zh)).toBe('清单');
    expect(entityLabelOf('TASK', en)).toBe('Task');
    expect(entityLabelOf('PROJECT', en)).toBe('List');
  });

  it('未知实体原样返回，不编一个名字', () => {
    expect(entityLabelKey('SOMETHING_NEW')).toBeUndefined();
    expect(entityLabelOf('SOMETHING_NEW', zh)).toBe('SOMETHING_NEW');
    expect(entityLabelOf('SOMETHING_NEW', en)).toBe('SOMETHING_NEW');
  });
});

describe('冲突原因表', () => {
  it('常见冲突原因两种语言都翻得出来', () => {
    expect(conflictReasonLabelOf('CONFLICT_CONCURRENT', zh)).toContain('都改了');
    expect(conflictReasonLabelOf('CONFLICT_CONCURRENT', en)).toContain('changed');
  });

  it('LWW 自动判定的原因（编码就直接在 reason 里）也能查表命中', () => {
    // 这条路径**没有**服务端错误码，`reason` 本身就是编码。
    expect(conflictReasonLabelOf('remote-archive', zh)).toContain('归档');
    expect(conflictReasonLabelOf('remote-archive', en)).toContain('archived');
  });

  it('🔴 查不到时给兜底句，绝不把原始字符串显示出来', () => {
    const raw = 'SOME_SERVER_CODE_WE_DO_NOT_KNOW';
    const zhLabel = conflictReasonLabelOf(raw, zh);
    const enLabel = conflictReasonLabelOf(raw, en);
    expect(zhLabel).not.toBe(raw);
    expect(enLabel).not.toBe(raw);
    expect(zhLabel).toMatch(CJK); // 中文界面必须是中文
    expect(enLabel).not.toMatch(CJK); // 英文界面不能漏出中文
  });

  it('🔴 服务端那句英文诊断不能漏进中文界面', () => {
    const label = conflictReasonLabelOf('Concurrent modification detected for TASK:t1', zh);
    expect(label).not.toContain('Concurrent');
    expect(label).toMatch(CJK);
  });

  it('🔴 原因文案取 `errorCode`，不是 `reason` —— 否则界面会出现英文', () => {
    // `conflictLookupCode` 定的顺序就是 `errorCode ?? reason`。
    const code = conflictLookupCode({
      errorCode: 'CONFLICT_CONCURRENT',
      reason: 'Concurrent modification detected for TASK:t1',
    });
    expect(code).toBe('CONFLICT_CONCURRENT');
    expect(conflictReasonLabelOf(code, zh)).toBe('两台设备在对方不知情的时候都改了它');
    expect(conflictReasonLabelOf(code, en)).toBe(
      'Two devices changed it without knowing about each other',
    );
    expect(conflictReasonLabelOf(code, zh)).not.toContain('Concurrent');
    // LWW 那条没有 errorCode，`reason` 本身就是编码。
    expect(conflictLookupCode({ reason: 'remote-archive' })).toBe('remote-archive');
    expect(conflictReasonLabelOf(conflictLookupCode({ reason: 'remote-archive' }), zh)).toContain(
      '归档',
    );
  });

  it('兜底 key 在表里，两种语言都有，且越是查不到越不会回落成原文', () => {
    expect(CONFLICT_REASON_FALLBACK_KEY).toBe('common.conflict.reason.fallback');
    expect(conflictReasonKey('nope')).toBeUndefined();
    expect(zh(CONFLICT_REASON_FALLBACK_KEY)).toMatch(CJK);
    expect(en(CONFLICT_REASON_FALLBACK_KEY)).not.toMatch(CJK);
    // 表里每个 key 都必须两种语言都给得出（防止加了表项却漏了词条）。
    for (const key of Object.values(CONFLICT_REASON_KEYS)) {
      expect(zh(key)).toMatch(CJK);
      expect(en(key)).not.toMatch(CJK);
    }
  });
});

/**
 * 原 `conflict-view.spec.ts` 里那些**判断**（`toConflictView` 的较新/可用/
 * 摘要，`choiceBlockedReason`，`positionLabel`…）已随文件删除。其中：
 *   · 纯判断（较新、能不能点、摘要说什么）由共享 `packages/ui` 的
 *     `tests/sync-model.spec.ts` 覆盖（它本来就在那里）；
 *   · 渲染行为由 web 的 `apps/web/tests/conflict-dialog.spec.tsx` 覆盖
 *     （两端渲染同一个共享视图）；
 *   · 剩下的**词条取值**在这里钉住 —— 调用点搬到宿主 JSX 之后，
 *     这些句子不再有任何单测看着，但它们是用户做决定的依据。
 */
describe('冲突面板其余词条（调用点已进宿主 JSX，值仍在这里看着）', () => {
  it('两侧名字：zh「本机 / 其他设备」，en「This device / Other device」', () => {
    expect(zh('mobile.conflict.side.local')).toBe('本机');
    expect(zh('mobile.conflict.side.remote')).toBe('其他设备');
    expect(en('mobile.conflict.side.local')).toBe('This device');
    expect(en('mobile.conflict.side.remote')).toBe('Other device');
  });

  it('🔴 取不到对端时按钮为什么点不了，两种语言都要讲清', () => {
    // 只置灰不说话是死路：用户唯一能做的是反复点它。
    expect(zh('mobile.conflict.blocked.remoteMissing')).toContain('取不到');
    expect(zh('mobile.conflict.blocked.remoteMissing')).toContain('保留本机');
    expect(en('mobile.conflict.blocked.remoteMissing')).toContain('unavailable');
    expect(en('mobile.conflict.blocked.remoteMissing')).not.toMatch(CJK);
  });

  it('位置从 1 开始数（给人看的，不是下标）', () => {
    expect(zh('mobile.conflict.position', { index: 1, total: 3 })).toBe('第 1 处，共 3 处');
    expect(zh('mobile.conflict.position', { index: 3, total: 3 })).toBe('第 3 处，共 3 处');
    expect(en('mobile.conflict.position', { index: 1, total: 3 })).toBe('Item 1 of 3');
    expect(en('mobile.conflict.position', { index: 3, total: 3 })).toBe('Item 3 of 3');
  });

  it('两个选择的反馈是两句不同的话（说成一样 = 用户不知道刚才选了哪边）', () => {
    const zhLocal = zh('mobile.conflict.choice.local');
    const zhRemote = zh('mobile.conflict.choice.remote');
    expect(zhLocal).not.toBe(zhRemote);
    expect(zhLocal).toContain('本机');
    expect(zhRemote).toContain('其他设备');
    const enLocal = en('mobile.conflict.choice.local');
    const enRemote = en('mobile.conflict.choice.remote');
    expect(enLocal).not.toBe(enRemote);
    expect(enLocal.toLowerCase()).toContain('this device');
    expect(enRemote.toLowerCase()).toContain('other device');
  });
});

describe('载荷摘要词条（分支在共享视图/宿主里，至少把值钉住）', () => {
  it('单数兄弟词条：1 个字段在英文里是 `1 field changed`', () => {
    expect(en('mobile.conflict.payload.fieldsOne', { count: 1 })).toBe('1 field changed');
    expect(en('mobile.conflict.payload.fields', { count: 2 })).toBe('2 fields changed');
    // 中文无单复数，刻意与复数版逐字相同。
    expect(zh('mobile.conflict.payload.fieldsOne', { count: 1 })).toBe('1 个字段有改动');
    expect(zh('mobile.conflict.payload.fieldsOne', { count: 1 })).toBe(
      zh('mobile.conflict.payload.fields', { count: 1 }),
    );
  });

  it('空载荷有专门词条，与"取不到这一侧"区分开', () => {
    expect(zh('mobile.conflict.payload.empty')).toBe('（空）');
    expect(en('mobile.conflict.payload.empty')).toBe('(empty)');
    expect(en('mobile.conflict.payload.empty')).not.toMatch(CJK);
  });
});
