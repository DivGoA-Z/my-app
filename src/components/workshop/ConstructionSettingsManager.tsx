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

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, BadgeCheck, Box, Layers, Rows3, Ruler, Scissors } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { SectionCard } from '../common/SectionCard';
import { useLayoutStore } from '../../store/layoutStore';
import { confirmDialog } from '../../store/confirmDialogStore';
import { cabinetCutParts, type CutPart } from '../../lib/cutList';
import type { PlacedCabinetItem } from '../../types/cabinet';
import {
  BACK_FIT_LABELS,
  BOTTOM_FIT_LABELS,
  DEPTH_CONVENTION_LABELS,
  DRAWER_BOX_LABELS,
  FRONTS_FROM_LABELS,
  TOP_FIT_LABELS,
  type ConstructionSettings,
} from '../../types/construction';
import { cn } from '@/lib/utils';

// The cabinets the worked examples are cut from: the 600 × 600 × 720
// base unit most numbers in DECISIONS were worked on, and a 600-wide wall
// cabinet (which has a full top, where a base unit has rails).
const EXAMPLE_BASE: PlacedCabinetItem = {
  id: 'example-base', layoutId: '', moduleType: 'base-cabinet', x: 0, y: 0, widthMm: 600, depthMm: 600, heightMm: 720,
  elevationMm: 0, rotationDeg: 0, material: 'HDMR', finishId: 'none', unitPrice: 0, quantity: 1, frontLayout: { kind: 'single-door' },
};
const EXAMPLE_WALL: PlacedCabinetItem = { ...EXAMPLE_BASE, id: 'example-wall', moduleType: 'wall-cabinet', depthMm: 350, elevationMm: 1450 };
const EXAMPLE_DRAWERS: PlacedCabinetItem = { ...EXAMPLE_BASE, id: 'example-drawers', moduleType: 'drawer-unit', frontLayout: { kind: 'drawers', count: 3 } };

// One option of a setting, as a large card: what it is, and what it does
// to real part sizes (worked out by the cutting list itself, so the
// example can never disagree with what the workshop is told to cut).
function OptionCards<T extends string>({
  label,
  value,
  labels,
  onChange,
  example,
  disabled,
  hint,
}: {
  label: string;
  value: T;
  labels: Record<T, string>;
  onChange: (v: T) => void;
  example?: (option: T) => ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const options = Object.keys(labels) as T[];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[15px] font-semibold">{label}</span>
      <div role="radiogroup" aria-label={label} className={cn('grid grid-cols-1 gap-2', options.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            disabled={disabled}
            onClick={() => onChange(o)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl px-4 py-3 text-left transition-colors disabled:cursor-not-allowed',
              value === o ? 'border-2 border-primary bg-accent' : 'border border-input bg-card hover:bg-secondary disabled:hover:bg-card',
              disabled && value !== o && 'opacity-60'
            )}
          >
            <span className="text-[15px] font-semibold leading-snug">{labels[o]}</span>
            {example && <span className="font-mono text-[13px] text-muted-foreground">{example(o)}</span>}
          </button>
        ))}
      </div>
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// A size in mm: what it is on the left, the box (mm inside) on the right.
function SizeRow({
  label,
  hint,
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <label className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-secondary py-3 last:border-b-0', disabled && 'opacity-60')}>
      <span className="flex min-w-0 max-w-xl flex-col">
        <span className="text-[15px] font-medium">{label}</span>
        {(hint || (disabled && disabledReason)) && (
          <span className="text-[13px] text-muted-foreground">{disabled && disabledReason ? disabledReason : hint}</span>
        )}
      </span>
      <span className="flex h-11 w-32 items-center gap-1.5 rounded-[10px] border border-input bg-card px-3">
        <Input
          type="number"
          min={0}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-auto min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[15px] shadow-none focus-visible:ring-0"
        />
        <span className="text-sm text-muted-foreground">mm</span>
      </span>
    </label>
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

  const finishes = useLayoutStore((s) => s.finishes);
  const rateCard = useLayoutStore((s) => s.rateCard);
  // Cut an example cabinet with the draft settings plus one changed
  // choice, and read a part's size off it.
  const cut = (item: PlacedCabinetItem, patch: Partial<ConstructionSettings>): CutPart[] =>
    cabinetCutParts(item, 'Example', { ...draft, ...patch }, finishes, rateCard, []);
  const size = (parts: CutPart[], name: string) => {
    const p = parts.find((x) => x.name === name);
    return p ? `${p.lengthMm} × ${p.widthMm}` : '—';
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      {locked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-accent px-4 py-3.5 text-accent-foreground">
          <BadgeCheck className="size-5 shrink-0" strokeWidth={1.8} />
          <p className="min-w-0 flex-1 text-sm">
            <strong className="font-semibold">Confirmed by your carpenter, and locked.</strong> These apply to every cabinet in
            every project.
          </p>
          <Button
            type="button"
            variant="outline"
            size="touch"
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
        </div>
      ) : (
        !draft.confirmed && (
          <div className="flex gap-3 rounded-2xl bg-warning-soft px-4 py-3.5 text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} />
            <p className="text-sm leading-relaxed">
              <strong className="font-semibold">These are assumed, not confirmed.</strong> They're the common Delhi NCR
              convention. Check each one with your carpenter, change any that differ, then tick "confirmed" at the bottom.
              Until then the cutting list says it's built on assumptions.
            </p>
          </div>
        )
      )}

      <SectionCard
        Icon={Ruler}
        title="Cabinet depth"
        description="Check this one first: it moves every side, top, bottom and shelf by a shutter's thickness."
        help={<p>The plan, 3D view and collision checks follow it too. A project can override it in Room Settings.</p>}
      >
        <OptionCards
          label="When a cabinet is 600 deep, 600 means…"
          value={draft.depthIncludesFront ? 'includes-front' : 'carcass-only'}
          labels={DEPTH_CONVENTION_LABELS}
          onChange={(v) => set('depthIncludesFront', v === 'includes-front')}
          disabled={locked}
          example={(o) => `Side panel ${size(cut(EXAMPLE_BASE, { depthIncludesFront: o === 'includes-front' }), 'Left side')}`}
        />
      </SectionCard>

      <SectionCard
        Icon={Box}
        title="How the carcass is joined"
        description="How the top, bottom and back meet the sides. Part sizes shift by a few millimetres."
        help={
          <p>
            Whether a cabinet has a full top, rails or no top is chosen per cabinet in the catalogue, because it changes the
            price. Shelves and dividers always fit between the sides. Examples: a 600 × 600 × 720 base unit (wall cabinet for
            the top), 18mm board.
          </p>
        }
      >
        <OptionCards
          label="Bottom"
          value={draft.bottomFit}
          labels={BOTTOM_FIT_LABELS}
          onChange={(v) => set('bottomFit', v)}
          disabled={locked}
          example={(o) => {
            const p = cut(EXAMPLE_BASE, { bottomFit: o });
            return `Bottom ${size(p, 'Bottom')} · sides ${size(p, 'Left side')}`;
          }}
        />
        <OptionCards
          label="Top"
          value={draft.topFit}
          labels={TOP_FIT_LABELS}
          onChange={(v) => set('topFit', v)}
          disabled={locked}
          example={(o) => {
            const p = cut(EXAMPLE_WALL, { topFit: o });
            return `Top ${size(p, 'Top')} · sides ${size(p, 'Left side')}`;
          }}
          hint="Applies to a full top and to rails alike."
        />
        <OptionCards
          label="Back panel"
          value={draft.backFit}
          labels={BACK_FIT_LABELS}
          onChange={(v) => set('backFit', v)}
          disabled={locked}
          example={(o) => `Back ${size(cut(EXAMPLE_BASE, { backFit: o }), 'Back')}`}
        />
        <div className="flex flex-col">
          <SizeRow
            label="Groove depth, each side"
            hint="How far the back sits into the sides, top and bottom."
            value={draft.grooveDepthMm}
            onChange={(v) => set('grooveDepthMm', v)}
            disabled={locked || draft.backFit !== 'grooved'}
            disabledReason={locked ? undefined : 'Only for a grooved back'}
          />
          <SizeRow
            label="Rail width"
            hint="For cabinets whose top is two rails (base units under a countertop)."
            value={draft.railWidthMm}
            onChange={(v) => set('railWidthMm', v)}
            disabled={locked}
          />
          <SizeRow
            label="Shelf and divider setback"
            hint="How far shelves stop short of the front, so the door closes."
            value={draft.shelfSetbackMm}
            onChange={(v) => set('shelfSetbackMm', v)}
            disabled={locked}
          />
        </div>
      </SectionCard>

      <SectionCard Icon={Layers} title="Fronts" description="Which sheets the shutters and drawer fronts are cut from.">
        <OptionCards
          label="Fronts are cut from"
          value={draft.frontsFrom}
          labels={FRONTS_FROM_LABELS}
          onChange={(v) => set('frontsFrom', v)}
          disabled={locked}
          example={(o) =>
            o === 'carcass-board' ? 'Share the carcass sheets; can be turned' : 'Own sheets per finish; grain kept'
          }
        />
      </SectionCard>

      <SectionCard
        Icon={Rows3}
        title="Drawer boxes"
        description="The box behind each drawer front, and how its parts are sized."
        help={
          <p>
            The runner length is picked automatically: the longest standard size (270 to 650) that fits the cabinet. Check the
            sizes against your drawer system's own sheet. Examples: a 600-wide, 3-drawer unit.
          </p>
        }
      >
        <OptionCards
          label="Drawer boxes are"
          value={draft.drawerBox}
          labels={DRAWER_BOX_LABELS}
          onChange={(v) => set('drawerBox', v)}
          disabled={locked}
          example={(o) => {
            const p = cut(EXAMPLE_DRAWERS, { drawerBox: o });
            return o === 'tandem'
              ? `Bottom ${size(p, 'Drawer bottom')} · back ${size(p, 'Drawer back')}`
              : `Side ${size(p, 'Drawer side')} · bottom ${size(p, 'Drawer bottom')}`;
          }}
        />
        <div className="flex flex-col">
          {draft.drawerBox === 'tandem' ? (
            <>
              <SizeRow label="Bottom width = inner width minus" value={draft.tandemBottomWidthDeductionMm} onChange={(v) => set('tandemBottomWidthDeductionMm', v)} disabled={locked} />
              <SizeRow label="Bottom depth = runner length minus" value={draft.tandemBottomDepthDeductionMm} onChange={(v) => set('tandemBottomDepthDeductionMm', v)} disabled={locked} />
              <SizeRow label="Back width = inner width minus" value={draft.tandemBackWidthDeductionMm} onChange={(v) => set('tandemBackWidthDeductionMm', v)} disabled={locked} />
              <SizeRow label="Back height = drawer front height minus" value={draft.tandemBackHeightReductionMm} onChange={(v) => set('tandemBackHeightReductionMm', v)} disabled={locked} />
            </>
          ) : (
            <>
              <SizeRow label="Runner clearance, both sides together" value={draft.woodenSlideClearanceMm} onChange={(v) => set('woodenSlideClearanceMm', v)} disabled={locked} />
              <SizeRow label="Box height = drawer front height minus" value={draft.woodenBoxHeightReductionMm} onChange={(v) => set('woodenBoxHeightReductionMm', v)} disabled={locked} />
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard
        Icon={Scissors}
        title="Cutting sheets"
        description="Used to lay parts out on sheets and measure waste. Sheet sizes are set per board on the Rate card."
      >
        <div className="flex flex-col">
          <SizeRow label="Saw cut width (kerf)" hint="Material lost to each saw cut." value={draft.kerfMm} onChange={(v) => set('kerfMm', v)} disabled={locked} />
          <SizeRow label="Edge trimmed off each side of a sheet" hint="Damaged factory edges cut away first." value={draft.sheetTrimMm} onChange={(v) => set('sheetTrimMm', v)} disabled={locked} />
        </div>
      </SectionCard>

      {!locked && (
        <label className="flex items-start gap-3 rounded-2xl bg-card px-4 py-4 shadow-card">
          <Checkbox className="mt-0.5" checked={draft.confirmed} onCheckedChange={(checked) => set('confirmed', checked === true)} />
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold">My carpenter has confirmed these settings</span>
            <span className="text-[13px] text-muted-foreground">Locks this page once saved, so a stray click can't change every cutting list.</span>
          </span>
        </label>
      )}

      {/* Same floating save bar as the Rate card — see its comment for
          the bug that made it necessary. */}
      <div
        className={
          dirty
            ? 'sticky bottom-20 z-30 flex flex-wrap items-center gap-3 rounded-2xl bg-sidebar px-4 py-3 text-sidebar-foreground shadow-float md:bottom-4'
            : 'flex flex-wrap items-center gap-3'
        }
      >
        {dirty && !saving && <span className="min-w-0 flex-1 text-sm text-white">Unsaved changes to how your workshop builds.</span>}
        {dirty && !saving && (
          <Button type="button" variant="ghost" size="touch" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-white" onClick={() => setDraft(settings)}>
            Discard
          </Button>
        )}
        {(dirty || !locked) && (
          <Button type="button" size="touch" onClick={save} disabled={!dirty || saving} className={dirty ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90' : ''}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  );
}
