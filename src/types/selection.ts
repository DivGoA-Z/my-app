// src/types/selection.ts
//
// What is currently selected, as ONE value.
//
// This replaces five mutually-exclusive ids — selectedCabinetId,
// selectedObstacleId, selectedApplianceId, selectedOpeningId,
// selectedFixtureId — each of which had to clear the other four. That
// was twenty lines of store code all saying the same thing, and adding
// a sixth selectable type meant editing every one of them.
//
// The overlap picker is what made the refactor necessary rather than
// merely tidy: a picker deals inherently in "an item of SOME type at
// this point", and it cannot express that against five separate fields
// without a switch at every call site.

export type SelectableType = 'cabinet' | 'appliance' | 'obstacle' | 'opening' | 'fixture';

export interface SelectionRef {
  type: SelectableType;
  id: string;
}

export const SELECTABLE_TYPE_LABELS: Record<SelectableType, string> = {
  cabinet: 'Cabinet',
  appliance: 'Appliance',
  obstacle: 'Structure',
  opening: 'Door / window',
  fixture: 'Light',
};

export function isSelected(
  selection: SelectionRef | null,
  type: SelectableType,
  id: string
): boolean {
  return selection?.type === type && selection.id === id;
}

// The selected id, but only if it's of the type asked for. Returns null
// otherwise, which is what lets each inspector keep its existing
// "nothing of mine is selected" early return unchanged.
export function selectedIdOf(
  selection: SelectionRef | null,
  type: SelectableType
): string | null {
  return selection?.type === type ? selection.id : null;
}
