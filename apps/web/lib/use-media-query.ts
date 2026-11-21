'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe media query hook. Returns false during SSR and the first client
 * render so server and hydration markup always match, then flips to the real
 * value right after mount (before any live snapshot has loaded, so the
 * scoreboard never flashes the wrong layout).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** True on phone-sized viewports, where the scoreboard switches to the stacked portrait layout. */
export function useCompactViewport(): boolean {
  return useMediaQuery('(max-width: 640px)');
}
