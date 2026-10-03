// src/test/store.ts
//
// Puts the real Zustand store into a known state for a screen test
// (§66): the app's seeded rate card and workshop settings, nothing
// loaded, and every action a test cares about replaced by a spy — so a
// test checks what the screen ASKED the store to do, and nothing ever
// reaches Supabase.

import { vi } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { defaultRateCard } from '../types/rates';
import { defaultConstructionSettings } from '../types/construction';

const initial = useLayoutStore.getState();

export function resetStore(overrides: Partial<ReturnType<typeof useLayoutStore.getState>> = {}) {
  useLayoutStore.setState(
    {
      ...initial,
      rateCard: defaultRateCard(),
      constructionSettings: defaultConstructionSettings(),
      cabinets: [],
      cabinetCatalog: [],
      quotes: [],
      currentProject: null,
      currentLayout: null,
      updateRateCard: vi.fn(async (card) => {
        useLayoutStore.setState({ rateCard: card });
      }),
      loadQuotes: vi.fn(async () => {}),
      upsertCabinetCatalogItem: vi.fn(async () => {}),
      ...overrides,
    },
    true
  );
  return useLayoutStore.getState();
}
