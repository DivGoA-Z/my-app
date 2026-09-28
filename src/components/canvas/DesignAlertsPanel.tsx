// src/components/canvas/DesignAlertsPanel.tsx
//
// Replaces CollisionWarningBanner + CabinetClearanceWarningBanner +
// KitchenChecksBanner (three separate aggregate-count-only boxes) with
// one panel that always shows the actual explanation for every alert,
// not just a count — and narrows to whatever's currently selected.
//
// Your request: select a cabinet/appliance/obstacle/opening and see
// ONLY the alerts about that item, each with its own explanation;
// select nothing and see everything. Room-door-vs-item swing clearance
// (lib/clearance.ts) is folded in here too — it's the same category of
// problem as the other three and belongs in the same place, gated by
// the same "Show clearance warnings" toggle OpeningToolbar's own
// summary doesn't touch (that one stays as its own contextual readout
// while you're actively placing openings — different job, not
// redundant with this).
//
// The three existing toggles (showOverlapWarnings/showClearanceWarnings/
// showKitchenChecks) still gate what's INCLUDED here — detection itself
// never stops running (same "hide more, never reveal a mute" rule
// DECISIONS.md's "Global overlap/clearance toggles" entry already
// established), only what's drawn does.

import { useLayoutStore } from '../../store/layoutStore';
import { useDesignAlerts, type DesignAlert, type DesignAlertCategory } from '../../hooks/useDesignAlerts';

export interface DesignAlertsPanelProps {
  showOverlapWarnings: boolean;
  showClearanceWarnings: boolean;
  showKitchenChecks: boolean;
}

const CATEGORY_ENABLED = (
  category: DesignAlertCategory,
  props: DesignAlertsPanelProps
): boolean => {
  switch (category) {
    case 'collision':
      return props.showOverlapWarnings;
    case 'cabinet-clearance':
    case 'opening-clearance':
      return props.showClearanceWarnings;
    case 'kitchen':
      return props.showKitchenChecks;
  }
};

function styleFor(alert: DesignAlert): { border: string; bg: string; text: string } {
  return alert.category === 'collision'
    ? { border: 'border-red-300', bg: 'bg-red-50', text: 'text-red-700' }
    : { border: 'border-amber-300', bg: 'bg-amber-50', text: 'text-amber-800' };
}

export function DesignAlertsPanel(props: DesignAlertsPanelProps) {
  const selection = useLayoutStore((state) => state.selection);
  const allAlerts = useDesignAlerts();

  const enabled = allAlerts.filter((a) => CATEGORY_ENABLED(a.category, props));

  const visible = selection
    ? enabled.filter((a) => a.itemIds.includes(selection.id))
    : enabled;

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {selection && (
        <span className="text-[10px] text-gray-400">
          Showing alerts for the selected item only — deselect (Escape) to see all.
        </span>
      )}
      {visible.map((alert) => {
        const style = styleFor(alert);
        return (
          <div
            key={alert.id}
            className={`rounded border ${style.border} ${style.bg} ${style.text} text-sm px-3 py-2`}
          >
            {alert.message}
          </div>
        );
      })}
    </div>
  );
}
