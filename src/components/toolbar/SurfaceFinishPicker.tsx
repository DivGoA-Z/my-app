// src/components/toolbar/SurfaceFinishPicker.tsx
//
// Choosing a floor, wall or ceiling finish from the surface library
// (§120). The panel row shows the current finish as a swatch; tapping it
// opens the library: chips by group (Tiles, Stone, Wood, Paint & plaster),
// a search, every swatch with its type and ₹/m² (Principle 10), and a
// colour: the finish's own, or a custom shade, as on a cabinet. A paint
// is chosen this way too: pick Paint, then any shade.
//
// Only the types that suit the surface are listed (a wooden floor isn't
// offered for a wall); "Show all finishes" lists everything, and is on by
// itself when the surface already uses something outside that list, so
// nothing a design has disappears from view.

import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayoutStore } from '../../store/layoutStore';
import { finishSwatch } from '../../lib/designFinishes';
import {
  SLAB_SURFACE_LABELS,
  SURFACE_MATERIAL_GROUPS,
  isSlabMaterial,
  slabSurfaceOf,
  suitsSurface,
  surfaceGroupOf,
  type RoomSurface,
  type SurfaceFinish,
} from '../../types/finish';
import { ColorPicker } from '../common/ColorPicker';
import {
  DEFAULT_TILING,
  GROUT_COLOURS,
  TILE_SIZE_PRESETS,
  describeTiling,
  tilingMode,
  type SurfaceTiling,
} from '../../lib/tiling';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';

const name = (f: SurfaceFinish) => (f.brand ? `${f.brand} ${f.label}` : f.label);
const price = (f: SurfaceFinish) => `₹${Math.round(f.pricePerSqM).toLocaleString('en-IN')}/m²`;

export function SurfaceFinishPicker({
  title,
  surface,
  finishId,
  tint,
  onFinishChange,
  onTintChange,
  tiling,
  onTilingChange,
}: {
  title: string;
  // 'countertop' (§121): the slab uses the same picker, offering slab
  // materials grouped by stone (Granite, Marble, Quartz…).
  surface: RoomSurface | 'countertop' | 'cabinet';
  finishId?: string;
  tint?: string | null;
  onFinishChange: (id: string | undefined) => void;
  onTintChange: (hex: string | null) => void;
  // Floors and walls only (§122): laid as tiles, or continuous.
  tiling?: SurfaceTiling | null;
  onTilingChange?: (tiling: SurfaceTiling | null) => void;
}) {
  const finishes = useLayoutStore((s) => s.finishes);
  const chosen = finishes.find((f) => f.id === finishId);
  const [group, setGroup] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState(false);

  const slab = surface === 'countertop';
  // 'cabinet' (§125): the shutter finishes — anything that isn't a room
  // surface or slab material — grouped by type (Acrylic, Laminate, PU…).
  const cabinet = surface === 'cabinet';
  const isCabinetFinish = (f: SurfaceFinish) => surfaceGroupOf(f) === null && !isSlabMaterial(f);
  const suits = (f: SurfaceFinish) =>
    slab ? isSlabMaterial(f) : cabinet ? isCabinetFinish(f) : suitsSurface(f, surface as RoomSurface);
  // Chips: by stone for a slab, by type for a cabinet, by kind (Tiles,
  // Stone…) for a room surface.
  const groupOf = (f: SurfaceFinish) =>
    slab || cabinet ? (suits(f) ? f.finishTypeLabel.trim() : null) : surfaceGroupOf(f);
  const suited = finishes.filter(suits);
  const forced = chosen !== undefined && !suits(chosen);
  const listAll = showAll || forced || suited.length === 0;
  const pool = listAll ? finishes : suited;
  const groups = slab || cabinet
    ? [...new Set(pool.map(groupOf).filter((g): g is string => g !== null))].sort()
    : SURFACE_MATERIAL_GROUPS.filter((g) => pool.some((f) => surfaceGroupOf(f) === g));
  const q = query.trim().toLowerCase();
  const shown = pool.filter(
    (f) =>
      (group === 'All' || (group === 'Other' ? groupOf(f) === null : groupOf(f) === group)) &&
      (!q || name(f).toLowerCase().includes(q) || f.finishTypeLabel.toLowerCase().includes(q))
  );
  const sw = finishSwatch(chosen);
  const tinted = !!tint;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`${title} finish: ${chosen ? name(chosen) : 'not specified'}`}
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-input bg-card p-1.5 text-left hover:border-primary/60"
        >
          <span
            className="size-10 shrink-0 rounded-md border border-black/5 bg-cover bg-center"
            style={
              chosen
                ? sw?.image && !tinted
                  ? { backgroundImage: `url(${sw.image})` }
                  : { backgroundColor: tint ?? sw?.color ?? '#dcd7cf', backgroundImage: sw?.image ? `url(${sw.image})` : undefined, backgroundBlendMode: 'multiply' }
                : { backgroundColor: '#f3f1ed' }
            }
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium">{chosen ? name(chosen) : 'Not specified'}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {chosen ? `${chosen.finishTypeLabel}${tinted ? ' · custom shade' : ''} · ${price(chosen)}` : 'Tap to choose'}
            </span>
            {chosen && tiling && (
              <span className="truncate text-[11px] text-muted-foreground">{describeTiling(tiling)}</span>
            )}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {cabinet
              ? 'Pick the shutter finish; any can be given a custom shade below. Prices are per m² of front.'
              : 'Pick a material; any can be given a custom shade below. Prices are per m² of visible area.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          {['All', ...groups, ...(listAll ? ['Other'] : [])].map((g) => (
            <Button key={g} size="sm" variant={group === g ? 'default' : 'secondary'} onClick={() => setGroup(g)}>
              {g}
            </Button>
          ))}
          <label className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search materials"
              className="w-28 bg-transparent text-[13px] outline-none"
            />
          </label>
        </div>

        <div role="radiogroup" aria-label={`${title} material`} className="grid min-h-0 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
          {!cabinet && <button
            type="button"
            role="radio"
            aria-checked={!finishId}
            onClick={() => onFinishChange(undefined)}
            className={cn(
              'flex flex-col justify-center gap-0.5 rounded-lg border p-2 text-left',
              !finishId ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/60'
            )}
          >
            <span className="text-xs font-medium">Not specified</span>
            <span className="text-[11px] text-muted-foreground">{slab ? 'plain light stone' : 'plain, not priced'}</span>
          </button>}
          {shown.map((f) => {
            const s = finishSwatch(f);
            const on = f.id === finishId;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                title={name(f)}
                onClick={() => onFinishChange(f.id)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border p-1 text-left',
                  on ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/60'
                )}
              >
                <span
                  className="relative block aspect-square w-full rounded-md border border-black/5 bg-cover bg-center"
                  style={s?.image ? { backgroundImage: `url(${s.image})` } : { backgroundColor: s?.color ?? '#dcd7cf' }}
                >
                  {on && (
                    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 text-[11px] leading-tight font-medium">{name(f)}</span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {isSlabMaterial(f) ? `${f.finishTypeLabel} · ${SLAB_SURFACE_LABELS[slabSurfaceOf(f)].split(' ')[0]}` : f.finishTypeLabel}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{price(f)}</span>
              </button>
            );
          })}
          {shown.length === 0 && <span className="col-span-full text-sm text-muted-foreground">Nothing matches.</span>}
        </div>

        <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
          <Checkbox checked={listAll} disabled={forced} onCheckedChange={(c) => setShowAll(c === true)} />
          {slab
            ? 'Show all finishes (laminate and other tops)'
            : cabinet
              ? 'Show all finishes (including tiles and stone)'
              : 'Show all finishes (including cabinet laminates and veneers)'}
        </Label>

        {chosen && onTilingChange && <TilingControls finish={chosen} tiling={tiling ?? null} onChange={onTilingChange} />}

        {chosen && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-[13px] font-semibold">Colour</span>
            <div role="radiogroup" aria-label={`${title} colour`} className="flex gap-1.5">
              <Button
                role="radio"
                aria-checked={!tinted}
                size="sm"
                variant={!tinted ? 'default' : 'outline'}
                onClick={() => {
                  onTintChange(null);
                  setPicking(false);
                }}
              >
                Material&rsquo;s own
              </Button>
              <Button
                role="radio"
                aria-checked={tinted}
                size="sm"
                variant={tinted ? 'default' : 'outline'}
                onClick={() => {
                  if (!tinted) onTintChange(chosen.solidColor ?? '#e8e2d6');
                  setPicking(true);
                }}
              >
                {tinted && <span className="size-3.5 rounded-sm border border-black/10" style={{ backgroundColor: tint! }} />}
                Custom shade
              </Button>
            </div>
            {tinted && picking && (
              <div className="flex flex-wrap items-start gap-3">
                <ColorPicker value={tint!} onChange={(hex) => onTintChange(hex)} />
                <p className="max-w-60 text-xs text-muted-foreground">
                  {chosen.albedoUrl || chosen.proceduralKind
                    ? 'This material has a photo, so the shade tints it like a stain: lighter shades on a white tile work best.'
                    : 'A plain colour: the shade replaces it. Pick a paint and set any shade this way.'}
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Laid as tiles (§122): tile size, straight or offset rows, and grout.
// For a photo that already shows tiles the grout is part of the photo, so
// only the size (which rescales it) is offered.
function TilingControls({
  finish,
  tiling,
  onChange,
}: {
  finish: SurfaceFinish;
  tiling: SurfaceTiling | null;
  onChange: (t: SurfaceTiling | null) => void;
}) {
  const mode = tilingMode(finish, tiling ?? DEFAULT_TILING);
  const [w, setW] = useState(String(tiling?.tileWidthMm ?? ''));
  const [h, setH] = useState(String(tiling?.tileHeightMm ?? ''));
  const set = (patch: Partial<SurfaceTiling>) => onChange({ ...(tiling ?? DEFAULT_TILING), ...patch });
  const own = finish.tileWidthMm && finish.tileHeightMm ? { tileWidthMm: finish.tileWidthMm, tileHeightMm: finish.tileHeightMm } : {};

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <Label className="flex items-center gap-2 text-[13px] font-semibold">
        <Checkbox
          checked={!!tiling}
          disabled={mode.kind === 'unknown-size'}
          onCheckedChange={(on) => onChange(on ? { ...DEFAULT_TILING, ...own } : null)}
        />
        Lay as tiles
      </Label>
      {mode.kind === 'unknown-size' && (
        <p className="text-xs text-muted-foreground">
          This photo already shows tiles, but its tile size isn&rsquo;t recorded. Set &ldquo;Tile size in this photo&rdquo;
          for it in Catalogue → Finishes to lay it at another size.
        </p>
      )}
      {tiling && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Tile size">
            {TILE_SIZE_PRESETS.map(([tw, th]) => {
              const on = tiling.tileWidthMm === tw && tiling.tileHeightMm === th;
              return (
                <Button
                  key={`${tw}x${th}`}
                  role="radio"
                  aria-checked={on}
                  size="sm"
                  variant={on ? 'default' : 'outline'}
                  onClick={() => {
                    set({ tileWidthMm: tw, tileHeightMm: th });
                    setW(String(tw));
                    setH(String(th));
                  }}
                >
                  {tw}×{th}
                </Button>
              );
            })}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              or
              <input
                aria-label="Tile width in mm"
                value={w}
                onChange={(e) => setW(e.target.value)}
                onBlur={() => Number(w) >= 20 && set({ tileWidthMm: Math.round(Number(w)) })}
                className="h-8 w-16 rounded-md border border-input bg-card px-1.5 font-mono text-[13px]"
              />
              ×
              <input
                aria-label="Tile height in mm"
                value={h}
                onChange={(e) => setH(e.target.value)}
                onBlur={() => Number(h) >= 20 && set({ tileHeightMm: Math.round(Number(h)) })}
                className="h-8 w-16 rounded-md border border-input bg-card px-1.5 font-mono text-[13px]"
              />
              mm
            </span>
          </div>
          {mode.kind === 'overlay' ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-xs text-muted-foreground">Rows</span>
                {(['straight', 'offset'] as const).map((p) => (
                  <Button key={p} size="sm" variant={tiling.pattern === p ? 'default' : 'outline'} onClick={() => set({ pattern: p })}>
                    {p === 'straight' ? 'Straight' : 'Offset (brick)'}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-xs text-muted-foreground">Grout</span>
                {[1, 2, 3, 5].map((g) => (
                  <Button key={g} size="sm" variant={tiling.groutMm === g ? 'default' : 'outline'} onClick={() => set({ groutMm: g })}>
                    {g} mm
                  </Button>
                ))}
                {GROUT_COLOURS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={`${c.label} grout`}
                    aria-label={`${c.label} grout`}
                    aria-pressed={tiling.groutColor.toLowerCase() === c.hex}
                    onClick={() => set({ groutColor: c.hex })}
                    className={cn(
                      'size-7 rounded-md border',
                      tiling.groutColor.toLowerCase() === c.hex ? 'border-primary ring-2 ring-primary' : 'border-border'
                    )}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">The grout is part of this tile&rsquo;s photo; the size rescales it.</p>
          )}
        </div>
      )}
    </div>
  );
}
