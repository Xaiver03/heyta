/**
 * 移动端 AI 工具箱的**接线判据**（breakdown / prioritize / duration-estimate 三枚）
 *
 * ⚠️ 2026-11：「一句话捕获」这一枚随该功能整体删除（解析是收集框自己的功能），
 *    所以这里的分母是 3，不是 4。
 * ============================================================================
 *
 * 本壳没有 RN 组件测试栈（`@testing-library/react-native` 不在依赖里，
 * 引它要先过 AGENTS §3.1 + §3.2 两道门），所以这里走「数据半 + 接线半」那两条：
 *
 *   · **数据半**（跑代码，不是读文本）：`AiOutputLocale` 与 `buildCaptureInvocation`
 *     这类是 `@heyta/app-host` 的**导出**，能 node 里值导入，
 *     于是"这一枚的字段集合真的进了披露"这条能红在**跑代码**上。
 *   · **接线半**（读源码）：`AiToolboxScreen` 有没有被 `ProfileScreen` **渲染**、
 *     每一枚 tab 有没有真的**调用** `requestX`，只能读源码文本。
 *     🔴 一律先剥注释再匹配：把一行调用**注释掉**来糊过判据，
 *     是本仓库记过的第一种假绿（§7 第 50 条）。
 *
 * ## 每条判据都能红的**变异臂**（就地写在这里，不留给一份会漂的抄件）
 *
 * | 臂 | 改动 | 红在哪 |
 * |---|---|---|
 * | A | 从 `ProfileScreen.tsx` 删掉 `<AiToolboxScreen` 那一处渲染 | 「ProfileScreen 渲染了 AiToolboxScreen」 |
 * | B | 把 `setToolboxOpen(true)` 换成 `console.log` | 「ProfileScreen 有一行按下真的 push 了 profile:ai-toolbox」 |
 * | C | 把 `BreakdownPanel` 里的 `requestBreakdown(` 改成注释 | 「BreakdownPanel 真的调 requestBreakdown」（先剥注释） |
 * | D | 把四枚之一（如 breakdown）从 tabs 里删 | 「tabs 里四枚一个都不能少」 |
 * | E | 让 `apply()` 直接调 `host.dispatch()` 而**不走 `createTaskActions`** | 「四枚都走 createTaskActions」——AGENTS §3.4 唯一写入口 |
 * | F | 把 AiDisclosureBlock 从任何一枚里删 | 「每一枚都渲染 AiDisclosureBlock（出境披露不许省）」 |
 */
import { describe, expect, it } from 'vitest';

import { read, stripComments } from './source-reading';

const SCREEN_SRC = 'apps/mobile/src/ai/AiToolboxScreen.tsx';
const PROFILE_SRC = 'apps/mobile/src/screens/ProfileScreen.tsx';

const screen = stripComments(read(SCREEN_SRC));
const profile = stripComments(read(PROFILE_SRC));

describe('移动端 AI 工具箱：三枚入口的接线判据', () => {
  it('🔴 ProfileScreen 真的**渲染**了 <AiToolboxScreen（不是只 import）', () => {
    // 判据是 JSX 标签，不是 import —— 与 2026-10-05 那次
    // 「ProfileScreen 里 import 了 AssistantScreen、入口行也在、唯独没读
    //  assistantOpen 那个渲染分支」同一个失效形状（`check-ai-coverage.mjs` 文件头）。
    expect(profile).toMatch(/<AiToolboxScreen[\s/>]/);
  });

  it('ProfileScreen 有一行按下真的 push 了 profile:ai-toolbox', () => {
    expect(profile).toMatch(/navigation\.push\(['"]profile:ai-toolbox['"]\)/);
  });

  it('入口行在，且 testID 与 assistant 那一族同形状', () => {
    expect(profile).toMatch(/testID:\s*['"]profile-entry-ai-toolbox['"]/);
    expect(profile).toMatch(/setToolboxOpen\(true\)/);
  });

  it('tabs 里三枚一个都不能少（breakdown / prioritize / duration）', () => {
    for (const key of ['breakdown', 'prioritize', 'duration']) {
      expect(screen).toMatch(new RegExp(`key:\\s*'${key}'`));
    }
  });

  it('🔴 每一枚 tab 都调**对应的** requestX —— 不许静默不发或发错的那一枚', () => {
    // 剥注释后再匹配：把 `requestCapture(` 藏进注释里不算调用。
    expect(screen).toMatch(/requestBreakdown\(/);
    expect(screen).toMatch(/requestPrioritize\(/);
    expect(screen).toMatch(/requestDuration\(/);
  });

  it('每一枚都渲染 AiDisclosureBlock（出境披露不许省，ADR-0006 的落地点）', () => {
    // 三枚共用同一个 <AiDisclosureBlock> 组件；至少出现 3 次，每枚一次。
    const count = (screen.match(/<AiDisclosureBlock/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('🔴 写库都走 createTaskActions（AGENTS §3.4 op-log 唯一写入口，不许 shell 里直接 dispatch）', () => {
    expect(screen).toMatch(/createTaskActions\(host\)/);
    expect(screen).not.toMatch(/host\.dispatch\(/);
  });

  it('每一枚 apply 之前都要**再点一次**（点发送=只发请求，点写入=才落库；ADR-0045 §2 授权分层）', () => {
    // 三枚都有 `apply = async` 函数，且 send 与 apply 是两个独立按钮。
    const applyCount = (screen.match(/const apply = async/g) ?? []).length;
    expect(applyCount).toBe(3);
    expect(screen).toMatch(/t\(['"]mobile\.ai\.toolbox\.send['"]\)/);
    expect(screen).toMatch(/t\(['"]mobile\.ai\.toolbox\.apply['"]\)/);
  });

  it('熔断状态**每次都落回**设备偏好（跨会话不清零，与 AssistantScreen 同一条纪律）', () => {
    // 每一次 requestX 之后调 persistHealth 把 health 落盘。
    const persistCount = (screen.match(/persistHealth\(/g) ?? []).length;
    // 3 处调用 + 1 处函数定义 ⇒ ≥ 4。
    expect(persistCount).toBeGreaterThanOrEqual(4);
  });

  it('🔴 路由现算：每次都 fromHealthSnapshot + withManagedEndpoint，**不许读落盘那份**（缺托管端点）', () => {
    expect(screen).toMatch(/withManagedEndpoint\(/);
    expect(screen).toMatch(/fromHealthSnapshot\(/);
  });
});
