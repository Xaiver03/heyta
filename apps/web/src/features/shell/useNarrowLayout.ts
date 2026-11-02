import { useEffect, useState } from 'react';

import { COMPACT } from '../../lib/breakpoints';

/**
 * Matches the shell's compact layout and scope drawer breakpoint.
 *
 * 🔴 判据是 `lib/breakpoints.ts` 的 `COMPACT`，**不在这里写第三个字面量**：
 * 这个值与 `ScopeDrawer.tsx`、`narrow.css` 是同一个判断，抄三份就一定会漂
 *（门禁 `scripts/check-breakpoints.mjs` 的 B5 钉着这一点）。 */
export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(COMPACT).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(COMPACT);
    const change = () => setNarrow(query.matches);
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return narrow;
}
