// src/components/editor/useElementSize.ts
//
// The live size of an element, so the plan canvas can fill whatever
// space the editor gives it (§81) instead of a fixed 800 × 600. A
// callback ref (element kept in state) rather than useRef: the React
// Compiler rejects reading a ref object during render.

import { useEffect, useState } from 'react';

export function useElementSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.round(s.width) === Math.round(width) && Math.round(s.height) === Math.round(height) ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { measure: setEl, element: el, width: size.width, height: size.height };
}
