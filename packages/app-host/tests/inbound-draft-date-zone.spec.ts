import { expect, it } from 'vitest';
import { freezeInboundTaskBatch, inboundTaskDigest } from '@heyta/inbound-core';
import { dueLocalDateOf, toLocalDate } from '@heyta/domain';

/**
 * 自动收集草稿里那枚 date-only（只给日历日、不给时刻）在**缝那一层**不许随设备时区漂。
 *
 * 🔴 为什么挑这四枚时区：`Pacific/Kiritimati` 是 UTC+14、`Etc/GMT+12` 是 UTC−12，两头相隔 26 小时；
 * `UTC` 与规则时区 `Asia/Shanghai` 各是一枚基准。规则时区把 `2026-12-31` 折成的兼容投影是
 * `2026-12-30T16:00Z` —— 这个 epoch 单独看**不是那一天**：设备时区在 UTC−12 一侧读它是 12-30，
 * 在 UTC+14 一侧读它是 12-31。所以这天全靠成对写进去的 `dueDateLocal` 锚住。
 *
 * 三件事分别有牙：
 * 1. 探针对照（第一段）先证明本进程的 `TZ` 真的换了 —— 换不动的话下面两段会一起变成空转。
 * 2. 冻结层（`freezeInboundTaskBatch`）：四种设备时区下那枚 item 与它的**摘要**逐字相同。
 *    摘要是最尖的判据：epoch 或 local 任一位漂了一个字节，32 字节十六进制就变。
 * 3. 读数层（`dueLocalDateOf`）：带着配对时四面都读成 `2026-12-31`；
 *    **反向臂**把配对摘掉后必须读成 `2026-12-30`（西半那一档），证明第 3 条不是白给的 ——
 *    这一臂就是「`dueDateLocal` 承重」这件事本身，不是测试装置。
 */
const zones = ['Pacific/Kiritimati', 'Etc/GMT+12', 'UTC', 'Asia/Shanghai'] as const;
// `2026-12-30T16:00Z` 在各档设备时区里本地读出来的日 —— 这一列就是探针对照的期望值。
const probeExpected: Record<(typeof zones)[number], number> = {
  'Pacific/Kiritimati': 31, 'Etc/GMT+12': 30, UTC: 30, 'Asia/Shanghai': 31,
};
const epoch = Date.UTC(2026, 11, 30, 16);

function freezeDateOnly() {
  return freezeInboundTaskBatch({
    eventId: 'evt-tz', ruleId: 'rule-tz', ruleVersion: 1, parseVersion: 1,
    timezone: 'Asia/Shanghai', receivedAt: 0, maxItems: 5,
    modelResult: { tasks: [{ title: 'Boundary day task', dueDate: '2026-12-31' }] },
  });
}

it('freezes one calendar day and one digest regardless of the device timezone', () => {
  const previous = process.env.TZ;
  try {
    // ① 探针对照：TZ 不生效的话这一条先红，下面两段就不可能被静默空转骗过去。
    for (const zone of zones) {
      process.env.TZ = zone;
      expect(new Date(epoch).getDate(), `${zone}：本进程的设备时区没换动，探针失效`).toBe(probeExpected[zone]);
    }

    // 基准取 UTC 那一档，后面每一档都跟它逐字对账（不靠下标猜哪一档是基准）。
    process.env.TZ = 'UTC';
    const baseline = freezeDateOnly();
    const baselineDigest = inboundTaskDigest(baseline.payload.tasks);
    const [paired] = baseline.payload.tasks;
    if (paired === undefined) throw new Error('冻结产物里没有那枚任务 —— 探针失效，这条判据不许这样过');

    for (const zone of zones) {
      process.env.TZ = zone;
      const frozen = freezeDateOnly();
      // ② 冻结层：那枚 item 与两枚摘要必须与基准逐字相同。
      expect(frozen.payload.tasks[0], `${zone}：date-only 冻结出的 item 与 UTC 基准不同 ⇒ 这天被按设备时区重折过一次`)
        .toMatchObject({ dueDateLocal: '2026-12-31', dueDate: epoch });
      expect(inboundTaskDigest(frozen.payload.tasks), `${zone}：任务摘要随设备时区变了`).toBe(baselineDigest);
      expect(frozen.resultDigest, `${zone}：确认摘要随设备时区变了（浏览器发布的就是这一枚）`)
        .toBe(baseline.resultDigest);
      // ③ 读数层：界面那三处都经 `dueLocalDateOf` 取日，配对在场时四面必须同一天。
      expect(dueLocalDateOf({ dueDate: paired.dueDate, dueDateLocal: paired.dueDateLocal }),
        `${zone}：配对在场时这一天不许随设备时区漂`).toBe('2026-12-31');
    }
    process.env.TZ = 'Etc/GMT+12';
    // 反向臂：摘掉配对之后同一个 epoch 在西半那一档必须读成前一天 —— 它读不歪就说明上面那条没牙。
    expect(toLocalDate(epoch), '反向臂：没有 dueDateLocal 时这个 epoch 应读成 12-30').toBe('2026-12-30');
    expect(dueLocalDateOf({ dueDate: epoch })).toBe('2026-12-30');
  } finally {
    process.env.TZ = previous;
  }
});
