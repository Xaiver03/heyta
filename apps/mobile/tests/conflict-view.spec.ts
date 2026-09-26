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
 *   3. **原因文案必须来自 `errorCode`，而且必须是中文。**
 *      用户会照着这句话做选择，而这个应用是**全中文**的。
 *      这条规则是移动端真机验收撞出来的：`reason` 装的是服务端那句英文诊断
 *      （`Concurrent modification detected for TASK:...`），于是界面把一整句英文
 *      显示了出来 —— 而中文文案**一直躺在表里从没被用过**。
 *      查表查不到时给"通用但仍然准确"的中文，**绝不回落成原始字符串**。
 *   4. **两个选择必须真的是两个方向**，且不可用的那个要说明为什么。
 */

import { describe, expect, it } from 'vitest';
import { MODELED_ENTITY_TYPES, UNMODELED_ENTITY_TYPES } from '@heyta/op-log';
import type { ConflictInfo } from '@heyta/sync-client';

import {
  ENTITY_LABELS,
  choiceBlockedReason,
  describeChoice,
  entityLabelOf,
  positionLabel,
  reasonLabelOf,
  toConflictView,
} from '../src/sync/conflict-view';

/** 全部合法实体类型 —— 由 op-log 的"已物化 / 已登记未物化"两个清单并出来。 */
const ALL_ENTITY_TYPES = [
  ...MODELED_ENTITY_TYPES,
  ...UNMODELED_ENTITY_TYPES.map((e) => e.entityType),
];

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

describe('实体名与原因的中文映射', () => {
  it('🔴 每个合法实体类型都有中文名（漏一个 = 界面上出现英文代号）', () => {
    const missing = ALL_ENTITY_TYPES.filter((t) => ENTITY_LABELS[t] === undefined);
    expect(missing).toEqual([]);
  });

  it('🔴 表里没有多余的键（防止实体被删掉后这里腐烂）', () => {
    const stale = Object.keys(ENTITY_LABELS).filter((k) => !ALL_ENTITY_TYPES.includes(k));
    expect(stale).toEqual([]);
  });

  it('实体名是中文，不是代号', () => {
    expect(entityLabelOf('TASK')).toBe('任务');
    expect(entityLabelOf('PROJECT')).toBe('清单');
  });

  it('未知实体原样返回，不编一个名字', () => {
    expect(entityLabelOf('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('常见冲突原因翻译成中文', () => {
    expect(reasonLabelOf('CONFLICT_CONCURRENT')).toContain('都改了');
  });

  it('LWW 自动判定的原因（编码就直接在 reason 里）也能查表命中', () => {
    // 这条路径**没有**服务端错误码，`reason` 本身就是编码。
    expect(reasonLabelOf('remote-archive')).toContain('归档');
  });

  it('🔴 查不到时给中文兜底，绝不把原始字符串显示出来', () => {
    const raw = 'SOME_SERVER_CODE_WE_DO_NOT_KNOW';
    const label = reasonLabelOf(raw);
    expect(label).not.toBe(raw);
    expect(label).toMatch(/[\u4e00-\u9fa5]/); // 必须是中文
  });

  it('🔴 服务端那句英文诊断不能漏进界面', () => {
    const label = reasonLabelOf('Concurrent modification detected for TASK:t1');
    expect(label).not.toContain('Concurrent');
    expect(label).toMatch(/[\u4e00-\u9fa5]/);
  });
});

describe('toConflictView', () => {
  it('🔴 原因文案取 `errorCode`，不是 `reason` —— 否则界面会出现英文', () => {
    const v = toConflictView(
      conflict({
        reason: 'Concurrent modification detected for TASK:t1',
        errorCode: 'CONFLICT_CONCURRENT',
      }),
    );
    expect(v.reasonLabel).toBe('两台设备在对方不知情的时候都改了它');
    expect(v.reasonLabel).not.toContain('Concurrent');
  });

  it('两侧都取得到时，各自给出内容与时间', () => {
    const v = toConflictView(conflict());
    expect(v.local.available).toBe(true);
    expect(v.remote.available).toBe(true);
    expect(v.local.summary).toBe('本机的标题');
    expect(v.remote.summary).toBe('对方的标题');
    expect(v.canKeepLocal).toBe(true);
    expect(v.canKeepRemote).toBe(true);
  });

  it('内容用的是载荷里最有代表性的字段，不是 JSON 串', () => {
    const v = toConflictView(
      conflict({
        local: { opId: 'a', clientId: 'p', timestamp: 1, opType: 'UPD', payload: { title: '买菜' } },
      }),
    );
    expect(v.local.summary).toBe('买菜');
    expect(v.local.summary).not.toContain('{');
  });

  it('时间戳更晚的一侧被标为较新', () => {
    const v = toConflictView(conflict());
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
    );
    expect(v.local.isNewer).toBe(false);
    expect(v.remote.isNewer).toBe(false);
  });

  it('🔴 取不到对端版本时：摘要必须是 undefined、标记为不可用、且不能"保留对端"', () => {
    const v = toConflictView(conflict({ remote: undefined }));
    expect(v.remote.summary).toBeUndefined();
    expect(v.remote.time).toBeUndefined();
    expect(v.remote.available).toBe(false);
    expect(v.canKeepRemote).toBe(false);
  });

  it('🔴 取不到对端版本时也不给本机标"较新"（没有可比对象）', () => {
    const v = toConflictView(conflict({ remote: undefined }));
    expect(v.local.isNewer).toBe(false);
    expect(v.remote.isNewer).toBe(false);
  });

  it('实体名与原因都进了视图模型', () => {
    const v = toConflictView(conflict());
    expect(v.entityLabel).toBe('任务');
    expect(v.reasonLabel).toBe(reasonLabelOf('CONFLICT_CONCURRENT'));
  });
});

describe('choiceBlockedReason', () => {
  it('两侧都在时，两个选择都可用（undefined = 可以点）', () => {
    const v = toConflictView(conflict());
    expect(choiceBlockedReason(v, 'keep-local')).toBeUndefined();
    expect(choiceBlockedReason(v, 'keep-remote')).toBeUndefined();
  });

  it('保留本机**永远可用**（本地那条一定在手上）', () => {
    const v = toConflictView(conflict({ remote: undefined }));
    expect(choiceBlockedReason(v, 'keep-local')).toBeUndefined();
  });

  it('🔴 取不到对端时"保留其他设备"不可用，且**必须给出原因**（只置灰不说话是死路）', () => {
    const v = toConflictView(conflict({ remote: undefined }));
    const why = choiceBlockedReason(v, 'keep-remote');
    expect(why).toBeDefined();
    expect(why).toContain('取不到');
    expect(why).toContain('保留本机');
  });
});

describe('文案', () => {
  it('两个选择的后置反馈是两句不同的话（说成一样 = 用户不知道刚才选了哪边）', () => {
    const a = describeChoice('keep-local');
    const b = describeChoice('keep-remote');
    expect(a).not.toBe(b);
    expect(a).toContain('本机');
    expect(b).toContain('其他设备');
  });

  it('位置从 1 开始数（给人看的，不是下标）', () => {
    expect(positionLabel(0, 3)).toBe('第 1 处，共 3 处');
    expect(positionLabel(2, 3)).toBe('第 3 处，共 3 处');
  });
});
