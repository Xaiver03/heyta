/**
 * 详情列（右侧那一栏）的**设备本地**收起状态。
 * =====================================================
 *
 * 与 `features/tasks/sort-pref.ts`、`features/tasks/due-display-pref.ts`、
 * `features/shell/modules.ts` 同一条推理："这一台屏幕想不想让右边常驻一栏"
 * 是**界面选择**，不是用户数据 —— 不进 op-log（AGENTS §3.4：op-log 只装用户意图），
 * 也不跨设备同步。13 寸笔记本收起、27 寸外接屏展开，是两台设备各自的自由。
 *
 * 三条纪律照抄那几份：
 * 1. **永不抛** —— 隐私模式下访问 `localStorage` 会抛，读失败退默认、写失败静默；
 * 2. 非法值（手改存储 / 旧版本残留）退回默认档，而不是让界面进入一个说不清的状态；
 * 3. 词表在这里**只有一份**：调用点不许各自 `=== 'collapsed'` 猜字符串。
 *
 * ⚠️ 默认是 `'open'`：这一栏"即使没东西也空在那里"是产品负责人对它的原话
 * （工单 W2），所以"收起"必须是一次**用户主动**的动作，不能是出厂状态。
 * 另外它只管"用户收没收"这一件事，**不管视口够不够**——
 * 几何不可行（窄、矮）时那一栏由 CSS 断点直接不出现，那条判断在
 * `styles/app/narrow.css`，两处各有各的理由，不许合成一个布尔。
 */

export type DetailPanePref = 'open' | 'collapsed';

const KEY = 'heyta.detailPane';

const VALUES: readonly DetailPanePref[] = ['open', 'collapsed'];

export function loadDetailPane(): DetailPanePref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      // 🔴 认**语义**不认字面：只有词表里的两个值算合法。
      if (typeof parsed === 'string' && (VALUES as readonly string[]).includes(parsed)) {
        return parsed as DetailPanePref;
      }
    }
  } catch {
    // 读失败 = 默认值，不崩。
  }
  return 'open';
}

export function saveDetailPane(value: DetailPanePref): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // 写失败不影响本次生效（隐私模式：这次收起仍然画得出来，只是下次启动不记得）。
  }
}
