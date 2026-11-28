/**
 * 工具结果的结构化卡片（读结果）—— 确定性投影，模型不可改写
 * ===============================================================
 *
 * 对照参照系统（创业OS `tool-presentation/tool-result-cards`、WeKnora `tool-results/*`）：
 * 黑塔原先在助手多步循环里，只把工具观察结果**回送模型**，界面上只有一行「已读取」的 trace，
 * 用户看不到"读到了什么"。本模块把读结果投影成**声明式卡片**（纯数据、可 JSON 序列化），
 * 由界面从固定样式渲染 —— 模型不能把数字改写进正文，卡片带的是**查询原值**。
 *
 * 三条硬边界：
 * 1. **确定性**：纯函数，不调模型、不新增出境（数据本来就已经回送过模型）。
 * 2. **可序列化**：只产出 string/number，能随对话记录落盘（`ChatItem.cards`）。
 * 3. **只对已知读工具出卡**：`CARD_FIELDS` 是封闭白名单；未知工具不出卡（不猜形状）。
 */

export interface AssistantCardItem {
  /** 主行：任务的标题 / 清单名 / 标签名…（来自结果原值）。 */
  readonly primary: string;
  /** 次行：截止日 · 优先级 / 条数…（来自结果原值，已拼接）。 */
  readonly meta?: string;
}

export interface AssistantDataCard {
  /** 产出这条卡片的工具名（用于诊断；界面标题用通用的"结果 · N 项"）。 */
  readonly tool: string;
  /** 结果总数（可能大于 `items.length`，被 `MAX_CARD_ITEMS` 截断）。 */
  readonly count: number;
  readonly items: readonly AssistantCardItem[];
}

/** 一轮对话最多几张卡（超过就把答案挤下屏）。 */
export const MAX_ASSISTANT_CARDS = 2;
/** 一张卡最多列几条。 */
export const MAX_CARD_ITEMS = 8;

interface CardFieldSpec {
  readonly primary: string;
  readonly meta?: readonly string[];
}

/** 只对这批读工具出卡；字段顺序即展示顺序。 */
const CARD_FIELDS: Readonly<Record<string, CardFieldSpec>> = {
  list_tasks: { primary: 'title', meta: ['dueDate', 'priority'] },
  list_projects: { primary: 'name', meta: ['taskCount'] },
  list_events: { primary: 'title', meta: ['date', 'daysFromToday'] },
  list_habits: { primary: 'name', meta: ['target'] },
  list_tags: { primary: 'name' },
  list_notes: { primary: 'title' },
  list_reminders: { primary: 'title', meta: ['dueDate'] },
  list_focus_sessions: { primary: 'title' },
};

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** 结果可能是数组，也可能被包一层 `{ items: [...] }`。 */
function rowsOf(data: unknown): readonly unknown[] | undefined {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const inner = (data as { items?: unknown }).items;
    if (Array.isArray(inner)) return inner;
  }
  return undefined;
}

/**
 * 把若干条工具观察投影成卡片。没命中白名单 / 形状不对 / 空列表 ⇒ 不出卡（返回 [] 或跳过该条）。
 */
export function projectAssistantCards(
  observations: readonly { readonly tool: string; readonly data: unknown }[],
): readonly AssistantDataCard[] {
  const cards: AssistantDataCard[] = [];
  for (const observation of observations) {
    if (cards.length >= MAX_ASSISTANT_CARDS) break;
    const spec = CARD_FIELDS[observation.tool];
    if (spec === undefined) continue;
    const rows = rowsOf(observation.data);
    if (rows === undefined) continue;
    const items: AssistantCardItem[] = [];
    for (const row of rows.slice(0, MAX_CARD_ITEMS)) {
      if (row === null || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const primary = scalarText(record[spec.primary]);
      if (primary === '') continue;
      const meta = (spec.meta ?? [])
        .map((key) => scalarText(record[key]))
        .filter((value) => value !== '')
        .join(' · ');
      items.push(meta === '' ? { primary } : { primary, meta });
    }
    if (items.length === 0) continue;
    cards.push({ tool: observation.tool, count: rows.length, items });
  }
  return cards;
}
