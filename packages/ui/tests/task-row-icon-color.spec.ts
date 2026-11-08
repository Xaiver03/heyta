/**
 * 行着色三态：**只有清单图标着色**（产品拍板 2026-11-08）
 * =====================================================
 *
 * 产品负责人的原话：「只有清单图标着色，我确定是这样」。
 * 所以判据只有一条轴：**那枚图标画不画、画成什么色**。
 *
 * 🔴 这一族最容易写错的地方不是"颜色对不对"，是**"关"是不是真的关**：
 * 把元素画成 `opacity: 0` 或透明色，读屏仍然念得到、布局仍然占位 ——
 * 那是假关。所以这里钉的是**节点的有无**，不是参数的取值。
 *
 * 本包跑 node 环境、加载不了 RN 渲染树（见 `vitest.config.ts`），所以判源码形状。
 * 先掩码注释再判：不掩码的话，照纪律在注释里写"别用 opacity:0"的人会吃假红。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, ' '));
}

const SRC = readFileSync(join(process.cwd(), 'src/task-list/TaskRow.tsx'), 'utf8');
const CODE = stripComments(SRC);

describe('行首清单图标：着色只发生在这里', () => {
  it('「关」= 节点不存在：整枚节点挂在 `iconColorToken === undefined ? null : …` 上', () => {
    expect(CODE).toMatch(/iconColorToken === undefined \? null :/);
  });

  it('不许用 opacity:0 / 透明色冒充"关"（那是假关：读屏仍念得到、布局仍占位）', () => {
    // 只在 iconSlot 那一段里判，避免误伤别处合法的 opacity（如按压反馈）。
    const slot = /iconSlot:\s*\{[\s\S]*?\}/.exec(CODE)?.[0] ?? '';
    expect(slot, '找不到 iconSlot 样式块').not.toBe('');
    expect(slot).not.toMatch(/opacity/);
    expect(slot).not.toMatch(/transparent/i);
  });

  it('颜色由宿主给（共享层不查实体表，与 EmptyState 同一条边界）', () => {
    expect(CODE).toMatch(/readonly iconColorToken\?: CategoryColorToken \| undefined/);
    // 反向臂：共享层里不许出现项目/标签实体查询。
    expect(CODE).not.toMatch(/getState\(\)\.projects/);
    expect(CODE).not.toMatch(/resolveTagIds/);
  });

  it('不许做成行左侧色条或整行淡底（产品已否）', () => {
    const slot = /iconSlot:\s*\{[\s\S]*?\}/.exec(CODE)?.[0] ?? '';
    expect(slot).not.toMatch(/borderLeft/);
    // 整行淡底会出现在根样式里 —— 那里不许读 iconColor。
    const root = /\broot:\s*\{[\s\S]*?\}/.exec(CODE)?.[0] ?? '';
    expect(root).not.toMatch(/iconColor/);
  });
});
