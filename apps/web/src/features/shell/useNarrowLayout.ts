import { useEffect, useState } from 'react';

/** Matches the shell's compact layout and scope drawer breakpoint. */
export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 768px)');
    const change = () => setNarrow(query.matches);
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return narrow;
}
