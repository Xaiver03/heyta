/**
 * 侧栏导航行（Web 端）。从 `App.tsx` 抽出，逻辑逐字未动。
 *
 * 🔴 `count > 0` / `ht-nav__count` 这两个字符串被
 * `apps/landing/tests/mockup-shell-shape.spec.tsx` 的 #2 四象限计数对账读取 ——
 * 改这里时那份门禁跟着对账。
 */

import React from 'react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import type { NavEntry } from './view-tabs.js';

export function NavButton({
  entry,
  count,
  active,
  onClick,
}: {
  entry: NavEntry;
  count?: number;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const Icon = entry.icon;
  /*
    🔴 testID 从 `filter.kind` **推导**，不是手写的第二份名字。
    侧栏这些行此前没有任何稳定探针，测试只能去够 CSS class（而这个仓库明确
    不允许 —— 类名是样式，不是契约）。由 kind 推导意味着：加一条智能清单
    就自动有探针，不会出现"行存在但没人能点它"。
    `-label` / `-count` 分开的理由：「最近 7 天」这一行的**名字里就有数字**，
    整行的 `textContent` 是 `最近 7 天2` —— 拿它判计数会把标签上的 7 读成 2，
    判天数同源又会把计数读成天数。两个数必须各有自己的探针。
  */
  const testID = `nav-scope-${entry.filter.kind}`;
  return (
    <button type="button" className="ht-nav__item" aria-current={active} onClick={onClick} data-testid={testID}>
      {entry.swatch !== undefined ? (
        <span className={`ht-swatch ${entry.swatch}`} aria-hidden="true" />
      ) : (
        <Icon size={ICON_SIZE.sm} aria-hidden="true" />
      )}
      <span data-testid={`${testID}-label`}>{t(entry.labelKey)}</span>
      {count !== undefined && count > 0 && (
        <span className="ht-nav__count" data-testid={`${testID}-count`}>
          {count}
        </span>
      )}
    </button>
  );
}
