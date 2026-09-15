// src/hooks/useSelection.ts
//
// Per-type read access to the single selection.
//
// The store now holds one `selection: { type, id }` instead of five
// mutually-exclusive ids (see types/selection.ts for why). These hooks
// are what kept that refactor from touching the LOGIC of fourteen
// components: each one asks for the id of its own type and gets null
// when something else is selected, which is precisely the shape it was
// already written against. One line changes per file, not the file.
//
// Each hook selects a primitive (a string or null) rather than the
// selection object, so a component only re-renders when ITS answer
// changes — picking a fixture doesn't re-render CabinetInspector.

import { useLayoutStore } from '../store/layoutStore';
import { selectedIdOf } from '../types/selection';
import type { SelectableType } from '../types/selection';

export function useSelectedId(type: SelectableType): string | null {
  return useLayoutStore((state) => selectedIdOf(state.selection, type));
}

export function useSelectedCabinetId(): string | null {
  return useSelectedId('cabinet');
}

export function useSelectedObstacleId(): string | null {
  return useSelectedId('obstacle');
}

export function useSelectedApplianceId(): string | null {
  return useSelectedId('appliance');
}

export function useSelectedOpeningId(): string | null {
  return useSelectedId('opening');
}

export function useSelectedFixtureId(): string | null {
  return useSelectedId('fixture');
}
