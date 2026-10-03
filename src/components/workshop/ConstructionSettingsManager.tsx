// src/components/workshop/ConstructionSettingsManager.tsx
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
import { confirmDialog } from '../../store/confirmDialogStore';
import {
  BACK_FIT_LABELS,
  BOTTOM_FIT_LABELS,
  DEPTH_CONVENTION_LABELS,
  DRAWER_BOX_LABELS,
  FRONTS_FROM_LABELS,
  TOP_FIT_LABELS,
  type ConstructionSettings,
} from '../../types/construction';

function ChoiceField<T extends string>({
  label,
  value,
  labels,
  onChange,
  help,
  disabled,
}: {
  label: string;
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-gray-600">
      {label}
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
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
  // "Set once, then fixed for the business" (your rule, §47): once the
  // SAVED settings are confirmed, the page is locked and changing it
  // takes a deliberate unlock with a warning — these move every cutting
  // list in every project, so they shouldn't change by a stray click.
  // Not a permission system: anyone who can open the page can unlock.
  const [unlocked, setUnlocked] = useState(false);
  const locked = settings.confirmed && !unlocked;
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
      // Saving confirmed settings re-locks the page.
      setUnlocked(false);
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
          <h3 className="text-sm font-semibold text-gray-700">How your workshop builds a cabinet</h3>
          <p className="mt-1 text-xs text-gray-500">
            How the panels are fitted together. Used by the cutting list and, later, the
            wastage calculation. Changing these moves a cabinet's price by a few rupees at most
            (part sizes shift by a few millimetres) — which panels a cabinet has, and from which
            board, are chosen per cabinet in the catalogue. Board thicknesses come from the rate
            card's Boards.
          </p>
        </div>
        {saveButton}
      </div>

      {locked && (
        <Alert className="border-emerald-300 bg-emerald-50">
          <AlertDescription className="flex flex-wrap items-center gap-2 text-emerald-900">
            <span>
              <strong className="font-semibold">Confirmed by your carpenter — locked.</strong> These
              apply to every cabinet in every project.
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: 'Change confirmed workshop settings?',
                  description:
                    'This changes part sizes on every cutting list in every project, and nudges board prices by a few rupees per cabinet. Frozen quotes are not affected. Only continue if your carpenter has changed how they build.',
                  confirmLabel: 'Unlock',
                  destructive: false,
                });
                if (ok) setUnlocked(true);
              }}
            >
              Change settings
            </Button>
          </AlertDescription>
        </Alert>
      )}

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
          label="Cabinet depth (e.g. 600) means…"
          value={draft.depthIncludesFront ? 'includes-front' : 'carcass-only'}
          labels={DEPTH_CONVENTION_LABELS}
          onChange={(v) => set('depthIncludesFront', v === 'includes-front')}
          disabled={locked}
          help="Moves every side, top, bottom and shelf by a shutter's thickness — check this one first. The 2D plan and 3D view still draw the stated depth as the finished cabinet either way."
        />
        <ChoiceField
          label="Carcass bottom — how it meets the sides"
          value={draft.bottomFit}
          labels={BOTTOM_FIT_LABELS}
          onChange={(v) => set('bottomFit', v)}
          disabled={locked}
        />
        <ChoiceField
          label="Carcass top — how it meets the sides"
          value={draft.topFit}
          labels={TOP_FIT_LABELS}
          onChange={(v) => set('topFit', v)}
          disabled={locked}
          help="Applies to a full top and to rails alike. (Whether a cabinet has a full top, rails or no top is chosen per cabinet in the catalogue — it changes the price.) Shelves and dividers always fit between the sides."
        />
        <ChoiceField
          label="Back panel"
          value={draft.backFit}
          labels={BACK_FIT_LABELS}
          onChange={(v) => set('backFit', v)}
          disabled={locked}
        />
        <ChoiceField
          label="Fronts are cut from"
          value={draft.frontsFrom}
          labels={FRONTS_FROM_LABELS}
          onChange={(v) => set('frontsFrom', v)}
          disabled={locked}
          help="From the carcass board: fronts share its sheets and can turn (laminate goes on after). Pre-laminated: fronts get their own sheets per finish, and wood/stone patterns keep their grain."
        />
        <ChoiceField
          label="Drawer boxes"
          value={draft.drawerBox}
          labels={DRAWER_BOX_LABELS}
          onChange={(v) => set('drawerBox', v)}
          disabled={locked}
          help="Decides which drawer-box parts the workshop cuts — sizes below."
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-gray-600">Sizes (mm)</legend>
        <NumberField
          label="Groove depth, each side"
          value={draft.grooveDepthMm}
          onChange={(v) => set('grooveDepthMm', v)}
          disabled={locked || draft.backFit !== 'grooved'}
          disabledReason={locked ? undefined : 'only for a grooved back'}
        />
        <NumberField
          label="Rail width (cabinets whose top is rails)"
          value={draft.railWidthMm}
          onChange={(v) => set('railWidthMm', v)}
          disabled={locked}
        />
        <NumberField
          label="Shelf / divider setback from the front"
          value={draft.shelfSetbackMm}
          onChange={(v) => set('shelfSetbackMm', v)}
          disabled={locked}
        />
      </fieldset>

      {/* Drawer box sizing (§56) — the rules every tandem system's
          sheet gives; defaults are the common figures. Only the set for
          the chosen drawer box type is editable. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-gray-600">Drawer boxes (mm)</legend>
        <span className="text-[11px] text-gray-500">
          Runner length is picked automatically — the longest standard size (270–650) that fits
          the cabinet. Check these against your drawer system's own sheet.
        </span>
        <NumberField
          label="Tandem: bottom width = inner width minus"
          value={draft.tandemBottomWidthDeductionMm}
          onChange={(v) => set('tandemBottomWidthDeductionMm', v)}
          disabled={locked || draft.drawerBox !== 'tandem'}
        />
        <NumberField
          label="Tandem: bottom depth = runner length minus"
          value={draft.tandemBottomDepthDeductionMm}
          onChange={(v) => set('tandemBottomDepthDeductionMm', v)}
          disabled={locked || draft.drawerBox !== 'tandem'}
        />
        <NumberField
          label="Tandem: back width = inner width minus"
          value={draft.tandemBackWidthDeductionMm}
          onChange={(v) => set('tandemBackWidthDeductionMm', v)}
          disabled={locked || draft.drawerBox !== 'tandem'}
        />
        <NumberField
          label="Tandem: back height = drawer front height minus"
          value={draft.tandemBackHeightReductionMm}
          onChange={(v) => set('tandemBackHeightReductionMm', v)}
          disabled={locked || draft.drawerBox !== 'tandem'}
        />
        <NumberField
          label="Wooden: runner clearance, both sides together"
          value={draft.woodenSlideClearanceMm}
          onChange={(v) => set('woodenSlideClearanceMm', v)}
          disabled={locked || draft.drawerBox !== 'wooden'}
        />
        <NumberField
          label="Wooden: box height = drawer front height minus"
          value={draft.woodenBoxHeightReductionMm}
          onChange={(v) => set('woodenBoxHeightReductionMm', v)}
          disabled={locked || draft.drawerBox !== 'wooden'}
        />
      </fieldset>

      {/* Sheet layout (§49) — only used to lay parts out on sheets and
          measure waste on the Cutting List page. Doesn't change any
          price unless you choose to use the measured waste. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-gray-600">Cutting sheets (mm) — for laying parts out and measuring waste</legend>
        <span className="text-[11px] text-gray-500">
          Sheet sizes are set per board on the rate card (Manage Inventory → Boards), since
          different boards come in different sizes.
        </span>
        <NumberField
          label="Saw cut width (kerf)"
          value={draft.kerfMm}
          onChange={(v) => set('kerfMm', v)}
          disabled={locked}
        />
        <NumberField
          label="Edge trimmed off each side of a sheet"
          value={draft.sheetTrimMm}
          onChange={(v) => set('sheetTrimMm', v)}
          disabled={locked}
        />
      </fieldset>

      <Label className="flex items-center gap-2 text-xs font-normal text-gray-700">
        <Checkbox
          checked={draft.confirmed}
          disabled={locked}
          onCheckedChange={(checked) => set('confirmed', checked === true)}
        />
        My carpenter has confirmed these settings (locks this page once saved)
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
