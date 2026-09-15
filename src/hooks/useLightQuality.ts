// src/hooks/useLightQuality.ts
//
// How many fixtures may become real three.js lights, as a DEVICE
// preference rather than part of the design.
//
// Deliberately not on the layout and not in the Zustand store's
// project state. A kitchen reviewed on a laptop with every light on
// must not open on a phone carrying that setting — and a shared link
// must not impose the sender's hardware on the recipient. So it lives
// in localStorage, per browser, and defaults to 'auto'.
//
// localStorage is wrapped because it throws outright in a few real
// contexts (private windows with site data blocked, some embedded
// webviews), and a lighting preference is not worth taking the app
// down for.

import { useCallback, useState } from 'react';
import type { LightQuality } from '../lib/fixtures';

const STORAGE_KEY = 'kitchen.lightQuality';

function isQuality(value: string | null): value is LightQuality {
  return value === 'auto' || value === 'all' || value === 'low';
}

function read(): LightQuality {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isQuality(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function useLightQuality(): [LightQuality, (next: LightQuality) => void] {
  // Read once on mount rather than on every render — and via the lazy
  // initialiser, so a throwing localStorage can't break the first
  // paint.
  const [quality, setQualityState] = useState<LightQuality>(read);

  const setQuality = useCallback((next: LightQuality) => {
    setQualityState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference just won't persist. Not worth surfacing: the
      // session still honours it.
    }
  }, []);

  return [quality, setQuality];
}
