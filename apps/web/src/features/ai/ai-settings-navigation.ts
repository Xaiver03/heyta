/**
 * "去设置"的导航通道
 * ====================
 *
 * AI 面板散落在两个页面里：三个（拆解 / 排序 / 估时）由 `App.tsx` 直接渲染，
 * 一个（捕获）由 `features/capture/CaptureComposer` 渲染。四个面板都需要
 * 同一个能力：**把用户送到设置页对应的区块前面**。
 *
 * ## 为什么是 context，而不是再往上一层透传 prop
 *
 * 🔴 `CaptureComposer` **不在**本轮的写入白名单里（它属于捕获功能的界面，
 * 与 AI 出境闸门是两件事）。为了给 `AiCapture` 传一个回调去改它，
 * 是为了一个导航参数而越界 —— 不值。
 *
 * context 让**唯一的新增接入点**落在 `App.tsx`（视图切换本来就在那里），
 * 四个面板从同一处取，形状只有一份。
 *
 * ## 🔴 它只导航，不授权
 *
 * 这个通道能做的全部事情是"切到设置页 + 定位区块"。授权仍然只能经
 * `AiSettings` 已有的 `updateRouting` / `grant()` 写入 —— 面板里直接改
 * `consents` 会造出第二套事实源（上一轮刚修掉的就是这个形状）。
 *
 * ## 组件 prop 仍然优先
 *
 * `props.onOpenSettings` 是**注入缝**：单测要断言"点了按钮、target 对不对"，
 * 直接传一个 spy 最清楚，不必每次都搭一个 Provider。
 * 生产路径上没有 prop，四个面板走的都是这里。
 */

import { createContext, useContext } from 'react';

import type { SettingsTarget } from './route-explanation.js';

/** 打开设置页并定位到某个区块。 */
export type OpenAiSettings = (target: SettingsTarget) => void;

/**
 * 默认 `undefined`：**没接就是没接**。
 *
 * 与"给出一个什么都不做的默认实现"相比，`undefined` 让调用点必须显式
 * 决定"没有这条路时渲染什么"（`RouteUnavailable` 不渲染按钮），
 * 而不是渲染一个点了没反应的按钮 —— 那比没有按钮更让人困惑。
 */
export const AiSettingsNavigationContext = createContext<OpenAiSettings | undefined>(undefined);

export function useAiSettingsNavigation(): OpenAiSettings | undefined {
  return useContext(AiSettingsNavigationContext);
}
