/**
 * 冲突解决视图模型测试
 * ======================
 *
 * 🔴 这个文件存在的理由：**用户只能靠这个界面决定放弃哪一边的改动。**
 *
 * 在这之前，「我的」屏在冲突时只显示一句"解决界面尚未实现"——
 * 数据两边都没丢，但谁也没法往下走。现在有了界面，
 * 那么"界面会不会误导用户"就成了新的风险面，而它必须由测试兜住：
 *
 *   1. **取不到对端版本时必须说清是"取不到"**，不能留白。
 *      留白 = 用户以为对端是空的 → 选错方向 → 覆盖掉真实数据。
 *   2. **不能给无依据的"较新"标记。** 时间戳相等是同毫秒编辑的常态（AGENTS.md #19），
 *      这时把"较新"标给任何一边都是编的。
 *   3. **原因文案必须来自 `errorCode`。**
 *      这条规则是移动端真机验收撞出来的：`reason` 装的是服务端那句英文诊断
 *      （`Concurrent modification detected for TASK:...`），于是界面把一整句英文
 *      显示了出来 —— 而词条**一直躺在表里从没被用过**。
 *      查表查不到时给"通用但仍然准确"的兜底句，**绝不回落成原始字符串**。
 *   4. **两个选择必须真的是两个方向**，且不可用的那个要说明为什么。
 *
 * ⚠️ i18n 迁移后，这里同时钉住 zh 与 en：
 *   - zh 必须含汉字（原因句是对用户做决定的依据）；
 *   - en 必须**不含**汉字（en 表漏 key 时最容易把中文复制过去交差）。
 */

import { describe, expect, it } from 'vitest';
import { MODELED_ENTITY_TYPES, UNMODELED_ENTITY_TYPES } from '@heyta/op-log';
import type { ConflictInfo } from '@heyta/sync-client';
import { translate } from '@heyta/i18n';

import {
  ENTITY_LABEL_KEYS,
  choiceBlockedReason,
  describeChoice,
  entityLabelOf,
  positionLabel,
  reasonLabelOf,
  toConflictView,
} from '../src/sync/conflict-view';

const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

/** 全部合法实体类型 —— 由 op-log 的"已物化 / 已登记未物化"两个清单并出来。 */
const ALL_ENTITY_TYPES = [
  ...MODELED_ENTITY_TYPES,
  ...UNMODELED_ENTITY_TYPES.map((e) => e.entityType),
];

const CJK = /[\u4E00-\u9FFF]/;

function conflict(over: Partial<ConflictInfo> = {}): ConflictInfo {
  return {
    id: 'c1',
    entityType: 'TASK',
    entityId: 't1',
    // 🔴 写成**真实形状**：`reason` 是服务端那句英文诊断，编码在 `errorCode` 里。
    // 这里原本写的是 `reason: 'CONFLICT_CONCURRENT'`，把"编码"和"诊断"混成了一个
    // 字段 —— 于是测试一直全绿，而真机上显示的是一整句英文。
    // mock 是按实现者的理解写的，理解错了 mock 跟着错（AGENTS.md #4/#7）。
    reason: 'Concurrent modification detected for TASK:t1',
    errorCode: 'CONFLICT_CONCURRENT',
    local: {
      opId: 'op-local',
      clientId: 'phone',
      timestamp: 1_700_000_000_000,
      opType: 'UPD',
      payload: { title: '本机的标题' },
    },
    remote: {
      opId: 'op-remote',
      clientId: 'laptop',
      timestamp: 1_700_000_100_000,
      opType: 'UPD',
      payload: { title: '对方的标题' },
    },
    ...over,
  };
}

describe('实体名与原因的映射', () => {
  it('🔴 每个合法实体类型都有词条（漏一个 = 界面上出现英文代号）', () => {
    const missing = ALL_ENTITY_TYPES.filter((t) => ENTITY_LABEL_KEYS[t] === undefined);
    expect(missing).toEqual([]);
  });

  it('🔴 表里没有多余的键（防止实体被删掉后这里腐烂）', () => {
    const stale = Object.keys(ENTITY_LABEL_KEYS).filter((k) => !ALL_ENTITY_TYPES.includes(k));
    expect(stale).toEqual([]);
  });

  it('实体名两种语言都给得出，且不是代号', () => {
    expect(entityLabelOf('TASK', zh)).toBe('任务');
    expect(entityLabelOf('PROJECT', zh)).toBe('清单');
    expect(entityLabelOf('TASK', en)).toBe('Task');
    expect(entityLabelOf('PROJECT', en)).toBe('List');
  });

  it('未知实体原样返回，不编一个名字', () => {
    expect(entityLabelOf('SOMETHING_NEW', zh)).toBe('SOMETHING_NEW');
    expect(entityLabelOf('SOMETHING_NEW', en)).toBe('SOMETHING_NEW');
  });

  it('常见冲突原因两种语言都翻得出来', () => {
    expect(reasonLabelOf('CONFLICT_CONCURRENT', zh)).toContain('都改了');
    expect(reasonLabelOf('CONFLICT_CONCURRENT', en)).toContain('changed');
  });

  it('LWW 自动判定的原因（编码就直接在 reason 里）也能查表命中', () => {
    // 这条路径**没有**服务端错误码，`reason` 本身就是编码。
    expect(reasonLabelOf('remote-archive', zh)).toContain('归档');
    expect(reasonLabelOf('remote-archive', en)).toContain('archived');
  });

  it('🔴 查不到时给兜底句，绝不把原始字符串显示出来', () => {
    const raw = 'SOME_SERVER_CODE_WE_DO_NOT_KNOW';
    const zhLabel = reasonLabelOf(raw, zh);
    const enLabel = reasonLabelOf(raw, en);
    expect(zhLabel).not.toBe(raw);
    expect(enLabel).not.toBe(raw);
    expect(zhLabel).toMatch(CJK); // 中文界面必须是中文
    expect(enLabel).not.toMatch(CJK); // 英文界面不能漏出中文
  });

  it('🔴 服务端那句英文诊断不能漏进中文界面', () => {
    const label = reasonLabelOf('Concurrent modification detected for TASK:t1', zh);
    expect(label).not.toContain('Concurrent');
    expect(label).toMatch(CJK);
  });
});

describe('toConflictView', () => {
  it('🔴 原因文案取 `errorCode`，不是 `reason` —— 否则界面会出现英文', () => {
    const c = conflict({
      reason: 'Concurrent modification detected for TASK:t1',
      errorCode: 'CONFLICT_CONCURRENT',
    });
    expect(toConflictView(c, zh).reasonLabel).toBe('两台设备在对方不知情的时候都改了它');
    expect(toConflictView(c, zh).reasonLabel).not.toContain('Concurrent');
    expect(toConflictView(c, en).reasonLabel).toBe(
      'Two devices changed it without knowing about each other',
    );
  });

  it('两侧都取得到时，各自给出内容与时间；两侧的标签也跟着语言走', () => {
    const v = toConflictView(conflict(), zh);
    expect(v.local.available).toBe(true);
    expect(v.remote.available).toBe(true);
    expect(v.local.summary).toBe('本机的标题');
    expect(v.remote.summary).toBe('对方的标题');
    expect(v.local.label).toBe('本机');
    expect(v.remote.label).toBe('其他设备');
    expect(v.canKeepLocal).toBe(true);
    expect(v.canKeepRemote).toBe(true);
    expect(toConflictView(conflict(), en).local.label).toBe('This device');
  });

  it('内容用的是载荷里最有代表性的字段，不是 JSON 串', () => {
    const v = toConflictView(
      conflict({
        local: { opId: 'a', clientId: 'p', timestamp: 1, opType: 'UPD', payload: { title: '买菜' } },
      }),
      zh,
    );
    expect(v.local.summary).toBe('买菜');
    expect(v.local.summary).not.toContain('{');
  });

  it('时间戳更晚的一侧被标为较新', () => {
    const v = toConflictView(conflict(), zh);
    expect(v.remote.isNewer).toBe(true);
    expect(v.local.isNewer).toBe(false);
  });

  it('🔴 时间戳相等时**两边都不标较新**（同毫秒编辑是常态，标给谁都是编的）', () => {
    const v = toConflictView(
      conflict({
        remote: {
          opId: 'op-remote',
          clientId: 'laptop',
          timestamp: 1_700_000_000_000,
          opType: 'UPD',
          payload: { title: '对方的标题' },
        },
      }),
      zh,
    );
    expect(v.local.isNewer).toBe(false);
    expect(v.remote.isNewer).toBe(false);
  });

  it('🔴 取不到对端版本时：摘要必须是 undefined、标记为不可用、且不能"保留对端"', () => {
    const v = toConflictView(conflict({ remote: undefined }), zh);
    expect(v.remote.summary).toBeUndefined();
    expect(v.remote.time).toBeUndefined();
    expect(v.remote.available).toBe(false);
    expect(v.canKeepRemote).toBe(false);
  });

  it('🔴 取不到对端版本时也不给本机标"较新"（没有可比对象）', () => {
    const v = toConflictView(conflict({ remote: undefined }), zh);
    expect(v.local.isNewer).toBe(false);
    expect(v.remote.isNewer).toBe(false);
  });

  it('实体名与原因都进了视图模型', () => {
    const v = toConflictView(conflict(), zh);
    expect(v.entityLabel).toBe('任务');
    expect(v.reasonLabel).toBe(reasonLabelOf('CONFLICT_CONCURRENT', zh));
  });
});

describe('choiceBlockedReason', () => {
  it('两侧都在时，两个选择都可用（undefined = 可以点）', () => {
    const v = toConflictView(conflict(), zh);
    expect(choiceBlockedReason(v, 'keep-local', zh)).toBeUndefined();
    expect(choiceBlockedReason(v, 'keep-remote', zh)).toBeUndefined();
  });

  it('保留本机**永远可用**（本地那条一定在手上）', () => {
    const v = toConflictView(conflict({ remote: undefined }), zh);
    expect(choiceBlockedReason(v, 'keep-local', zh)).toBeUndefined();
  });

  it('🔴 取不到对端时"保留其他设备"不可用，且**必须给出原因**（只置灰不说话是死路）', () => {
    const v = toConflictView(conflict({ remote: undefined }), zh);
    const why = choiceBlockedReason(v, 'keep-remote', zh);
    expect(why).toBeDefined();
    expect(why).toContain('取不到');
    expect(why).toContain('保留本机');
    // 英文侧同样要讲清"另一侧的版本拿不到"。
    const whyEn = choiceBlockedReason(v, 'keep-remote', en);
    expect(whyEn).toBeDefined();
    expect(whyEn).toContain('unavailable');
    expect(whyEn).not.toMatch(CJK);
  });
});

describe('文案', () => {
  it('两个选择的后置反馈是两句不同的话（说成一样 = 用户不知道刚才选了哪边）', () => {
    const a = describeChoice('keep-local', zh);
    const b = describeChoice('keep-remote', zh);
    expect(a).not.toBe(b);
    expect(a).toContain('本机');
    expect(b).toContain('其他设备');
    const aEn = describeChoice('keep-local', en);
    const bEn = describeChoice('keep-remote', en);
    expect(aEn).not.toBe(bEn);
    expect(aEn).toContain('this device');
    expect(bEn).toContain('other device');
  });

  it('位置从 1 开始数（给人看的，不是下标）', () => {
    expect(positionLabel(0, 3, zh)).toBe('第 1 处，共 3 处');
    expect(positionLabel(2, 3, zh)).toBe('第 3 处，共 3 处');
    expect(positionLabel(0, 3, en)).toBe('Item 1 of 3');
    expect(positionLabel(2, 3, en)).toBe('Item 3 of 3');
  });
});

describe('载荷摘要：fields 只报数量，绝不列字段名', () => {
  /** 固定一个"没有可读标题"的结构化载荷。 */
  function withPayload(payload: unknown): ConflictInfo {
    return conflict({
      local: { opId: 'op-local', clientId: 'phone', timestamp: 1, opType: 'UPD', payload },
    });
  }

  it('🔴 结构化载荷渲染成「N 个字段有改动」，内部标识符一个都不出现', () => {
    const v = toConflictView(withPayload({ completedAt: 123, dueDate: '2026-03-02' }), zh);
    expect(v.local.summary).toBe('2 个字段有改动');
    // 这两条是真正的重点：字段名是内部标识符，用户可见文案里不能有。
    expect(v.local.summary).not.toContain('completedAt');
    expect(v.local.summary).not.toContain('dueDate');
  });

  it('单数兄弟词条：1 个字段在英文里是 `1 field changed`', () => {
    const one = withPayload({ completedAt: 123 });
    expect(toConflictView(one, en).local.summary).toBe('1 field changed');
    // 中文无单复数，刻意与复数版逐字相同。
    expect(toConflictView(one, zh).local.summary).toBe('1 个字段有改动');

    const two = withPayload({ a: 1, b: 2 });
    expect(toConflictView(two, en).local.summary).toBe('2 fields changed');
  });

  it('空载荷有专门词条，与"取不到这一侧"区分开', () => {
    const empty = withPayload({});
    expect(toConflictView(empty, zh).local.summary).toBe('（空）');
    expect(toConflictView(empty, en).local.summary).toBe('(empty)');
    // 取不到（没有对端 op）仍然是 undefined —— 它不是"空载荷"。
    expect(toConflictView(conflict({ remote: undefined }), zh).remote.summary).toBeUndefined();
    // 英文侧不留中文。
    expect(toConflictView(empty, en).local.summary).not.toMatch(CJK);
  });

  it('用户自己的字原样显示、不翻译', () => {
    const v = toConflictView(withPayload({ title: '买菜' }), en);
    expect(v.local.summary).toBe('买菜');
  });
});
