// src/components/inventory/ConstructionSettingsManager.tsx
//
// Edits how the business's workshop builds a cabinet — the conventions
// the cutting list (lib/cutList.ts) depends on. Every decision offers
// every real alternative; the pre-selected ones are only defaults, the
// common Delhi NCR convention, until the carpenter confirms or changes
// them. See types/construction.ts and docs/DECISIONS.md §41.
//
// Same editing shape as RateCardManager: a local draft (so a half-typed
// thickness never redraws the cutting list mid-keystroke), Save at the
// top plus a sticky amber bar while dirty, save-then-set in the store.
//
// A setting that doesn't apply to the current choices (groove depth
// with a nailed-on back, say) is DISABLED, not hidden — the carpenter
// reading this screen should see every option exists, and a field that
// vanishes when another changes reads as a bug.

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useLayoutStore } from '../../store/layoutStore';
import {
  BACK_FIT_LABELS,
  BASE_TOP_LABELS,
  DRAWER_BOX_LABELS,
  PANEL_FIT_LABELS,
  type ConstructionSettings,
} from '../../types/construction';

function ChoiceField<T extends string>({
  label,
  value,
  labels,
  onChange,
  help,
}: {
  label: string;
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
  help?: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-gray-600">
      {label}
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(labels) as T[]).map((k) => (
            <SelectItem key={k} value={k}>
              {labels[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help && <span className="text-[11px] text-gray-500">{help}</span>}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <Label className="flex items-center justify-between gap-3 font-normal">
      <span className={`text-xs ${disabled ? 'text-gray-400' : 'text-gray-600'}`}>
        {label}
        {disabled && disabledReason && (
          <span className="ml-1 text-[11px] text-gray-400">({disabledReason})</span>
        )}
      </span>
      <Input
        type="number"
        min={0}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 text-right"
      />
    </Label>
  );
}

export function ConstructionSettingsManager() {
  const settings = useLayoutStore((s) => s.constructionSettings);
  const updateConstructionSettings = useLayoutStore((s) => s.updateConstructionSettings);

  const [draft, setDraft] = useState<ConstructionSettings>(settings);
  const [saving, setSaving] = useState(false);
  // Adjusted during render, not in an effect — same pattern and same
  // reasoning as RateCardManager's own resync.
  const [syncedFrom, setSyncedFrom] = useState<ConstructionSettings>(settings);
  if (syncedFrom !== settings) {
    setSyncedFrom(settings);
    setDraft(settings);
  }

  const set = <K extends keyof ConstructionSettings>(key: K, value: ConstructionSettings[K]) =>
    setDraft({ ...draft, [key]: value });

  const dirty = (Object.keys(draft) as (keyof ConstructionSettings)[]).some(
    (k) => k !== 'updatedAt' && k !== 'createdAt' && draft[k] !== settings[k]
  );

  async function save() {
    setSaving(true);
    try {
      await updateConstructionSettings(draft);
      toast.success('Construction settings saved');
    } catch (err) {
      toast.error('Failed to save construction settings', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  const saveButton = (
    <Button type="button" size="sm" onClick={save} disabled={!dirty || saving}>
      {saving ? 'Saving…' : 'Save construction'}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Construction (for the cutting list)</h3>
          <p className="mt-1 text-xs text-gray-500">
            How your workshop builds a cabinet. Every part size on the cutting list comes from
            these. They don't change any price.
          </p>
        </div>
        {saveButton}
      </div>

      {!draft.confirmed && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-900">
            <strong className="font-semibold">These are assumed, not confirmed.</strong> They're
            the common Delhi NCR convention. Check each one with your carpenter, change any that
            differ, then tick "confirmed" below — until then the cutting list says it's built on
            assumptions.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceField
          label="Bottom panel"
          value={draft.bottomFit}
          labels={PANEL_FIT_LABELS}
          onChange={(v) => set('bottomFit', v)}
        />
        <ChoiceField
          label="Top panel (wall and tall units, and base units with a full top)"
          value={draft.topFit}
          labels={PANEL_FIT_LABELS}
          onChange={(v) => set('topFit', v)}
        />
        <ChoiceField
          label="Back panel"
          value={draft.backFit}
          labels={BACK_FIT_LABELS}
          onChange={(v) => set('backFit', v)}
        />
        <ChoiceField
          label="Top of a base unit (under the countertop)"
          value={draft.baseTop}
          labels={BASE_TOP_LABELS}
          onChange={(v) => set('baseTop', v)}
        />
        <ChoiceField
          label="Drawer boxes"
          value={draft.drawerBox}
          labels={DRAWER_BOX_LABELS}
          onChange={(v) => set('drawerBox', v)}
          help="Recorded now, not applied yet — drawer box parts are still to be added to the cutting list (drawer fronts are already listed)."
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-gray-600">Sizes (mm)</legend>
        <NumberField
          label="Carcass board thickness"
          value={draft.carcassThicknessMm}
          onChange={(v) => set('carcassThicknessMm', v)}
        />
        <NumberField
          label="Thin back thickness"
          value={draft.backThicknessMm}
          onChange={(v) => set('backThicknessMm', v)}
          disabled={draft.backFit === 'inset-full'}
          disabledReason="full-thickness back uses the carcass thickness"
        />
        <NumberField
          label="Groove depth, each side"
          value={draft.grooveDepthMm}
          onChange={(v) => set('grooveDepthMm', v)}
          disabled={draft.backFit !== 'grooved'}
          disabledReason="only for a grooved back"
        />
        <NumberField
          label="Base unit rail width"
          value={draft.railWidthMm}
          onChange={(v) => set('railWidthMm', v)}
          disabled={draft.baseTop !== 'rails'}
          disabledReason="only for a railed top"
        />
        <NumberField
          label="Shelf / divider setback from the front"
          value={draft.shelfSetbackMm}
          onChange={(v) => set('shelfSetbackMm', v)}
        />
      </fieldset>

      <Label className="flex items-center gap-2 text-xs font-normal text-gray-700">
        <Checkbox
          checked={draft.confirmed}
          onCheckedChange={(checked) => set('confirmed', checked === true)}
        />
        My carpenter has confirmed these settings
      </Label>

      {/* Same sticky-while-dirty bar as RateCardManager — see its
          comment for the bug that made it necessary. */}
      <div
        className={
          dirty
            ? 'sticky bottom-0 z-10 -mx-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-2 shadow-sm'
            : 'flex items-center gap-2'
        }
      >
        {dirty && !saving && (
          <span className="text-xs text-amber-900">Unsaved construction changes.</span>
        )}
        {saveButton}
        {dirty && !saving && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={() => setDraft(settings)}
          >
            Discard changes
          </Button>
        )}
      </div>
    </div>
  );
}
