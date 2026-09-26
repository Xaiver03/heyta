/**
 * "现在"，以及**日期真的变了**的时候刷新它
 * ==========================================
 *
 * 🔴 原来的写法是 `const now = useMemo(() => Date.now(), [])`，注释写的理由是
 * "每次渲染重取会让今天/过期与渲染不同步"。前半句对，但它把**跨零点**这件真事
 * 一起冻住了 —— 应用挂后台一夜、或者就一直开着到第二天，界面上的"今天"还是昨天。
 *
 * 症状全部是安静的：
 *   - 昨晚到期的任务今天仍显示"今天到期"（`overdue` 是拿冻结的 now 算的）；
 *   - 重复任务勾选后顺延到的那一天，第二天打开时不会被标成"今天"；
 *   - 顶栏的「9月26日 星期六」第二天还是 26 号。
 *
 * 它不报错、不崩、下拉刷新一下或重进应用就"好了"（重新 mount 会重取）——
 * 这正是验收最容易漏的一类缺陷：**只在时间流逝之后才出现**。
 * 所以修它的同时必须有一条能失败的单测（见 `tests/date.spec.ts` 的
 * `msUntilNextMidnight`；那是本文件唯一的可测部分，刻意拆出来）。
 * 本文件只做一件事：把纯函数接到平台的两个时钟上。
 *
 * 刷新时机（两条互补，缺一不可）：
 *   1. **回到前台** —— 应用可能被挂起几小时，定时器不保证准时，这条是主要保障。
 *      用 `AppState` 而不是轮询：挂起期间本来就不该有任何计算。
 *   2. **到下一个本地零点** —— 应用一直开着时，跨零点要自己醒过来。
 *      用"算到下一个零点"而不是"每 60 秒轮询"，是为了避免每分钟一次的无谓重渲染
 *      （重渲染会连带列表的排序、分组、`useMemo` 全部重算）。
 *
 * ⚠️ 这里只管**界面认哪一天是今天**。写入动作的时钟在 `@heyta/app-host`
 * 的 `createTaskActions` / `now` 选项里，两者互不影响。
 */
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { toLocalDate, type LocalDate } from '@heyta/domain';

// 🔴 相对导入**不带扩展名**。移动端的本地模块一律这么写
// （`'../lib/date'`、`'../lib/due-display'`…）。写成 `'./date.js'` 时：
//   - `vitest` 会把 `.js` 映射回 `.ts`，**单测照样全绿**；
//   - `Metro` 不会，Release 打包直接 `Unable to resolve module ./date.js`。
// 即"测试通过"与"能打包"是两件事，这条已经在本仓库咬过一次。
import { msUntilNextMidnight } from './date';

/**
 * 返回当前的"现在"，并在回到前台与跨过本地零点时更新。
 *
 * 刻意**不做**"每 N 秒重取"：那会让每一行任务的倒计时文字不停重算，
 * 而产品上需要的只是"哪一天"以及"多久没动过"这两件事。
 */
export function useToday(): { now: number; today: LocalDate } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = (): void => {
      if (cancelled) return;
      setNow(Date.now());
    };

    const schedule = (): void => {
      timer = setTimeout(() => {
        refresh();
        // 跨完这个零点，再排下一个 —— 一次只排一跳，不用递归堆叠。
        if (!cancelled) schedule();
      }, msUntilNextMidnight(Date.now()));
    };

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      // 只在**回到**前台时刷。"background"/"inactive" 期间界面不可见，
      // 刷新只会白白重算一遍。
      if (state === 'active') refresh();
    });

    schedule();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return { now, today: toLocalDate(now) };
}
