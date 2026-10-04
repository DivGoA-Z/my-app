// src/components/editor/DesignEditor.tsx
//
// The design editor's frame (docs/UX_PLAN.md §6, mockup "Design editor";
// §81, stage 1 of the editor rebuild). Replaces the old page that stacked
// seven toolbars, four checkboxes, the canvas, every inspector and the
// quote side by side.
//
//   top bar   ← Customers · customer · Plan | 3D | Elevation · saved · Room · Cutting list · Present
//   left      icon rail; ONE tool panel open at a time (tap again to close)
//   centre    the plan (sized to fill the space), the 3D view or the elevation
//   right     the inspector for what's selected, otherwise the quote
//   bottom    design checks · undo/redo · the live total · Finalise quote
//
// Stage 1 reuses today's tool panels, inspectors and quote unchanged
// inside this frame; they're restyled in later stages. On a tablet or
// phone the tool panel and right panel become slide-overs (stage 4
// refines touch).

import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Camera,
  Check,
  Columns3,
  DoorOpen,
  Lamp,
  Paintbrush,
  Layers,
  MoreHorizontal,
  Presentation,
  ReceiptText,
  Redo2,
  Refrigerator,
  Scissors,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Checkbox } from '../ui/checkbox';
import { useLayoutStore } from '../../store/layoutStore';
import { useBOM } from '../../hooks/useBOM';
import { useDesignAlerts } from '../../hooks/useDesignAlerts';
import { RoomCanvas } from '../canvas/RoomCanvas';
import { CabinetLayer } from '../canvas/CabinetLayer';
import { ObstacleLayer } from '../canvas/ObstacleLayer';
import { ApplianceLayer } from '../canvas/ApplianceLayer';
import { OpeningLayer } from '../canvas/OpeningLayer';
import { FixtureLayer } from '../canvas/FixtureLayer';
import { CameraLayer } from '../canvas/CameraLayer';
import { RemainingSpaceLayer } from '../canvas/RemainingSpaceLayer';
import { PickChooser } from '../canvas/PickChooser';
import { DesignAlertsPanel } from '../canvas/DesignAlertsPanel';
import { CabinetToolbar } from '../toolbar/CabinetToolbar';
import { ObstacleToolbar } from '../toolbar/ObstacleToolbar';
import { ApplianceToolbar } from '../toolbar/ApplianceToolbar';
import { OpeningToolbar } from '../toolbar/OpeningToolbar';
import { LightingToolbar } from '../toolbar/LightingToolbar';
import { CameraToolbar } from '../toolbar/CameraToolbar';
import { RoomSurfacesPanel } from '../toolbar/RoomSurfacesPanel';
import { RoomSettingsPanel } from '../toolbar/RoomSettingsPanel';
import { CabinetInspector } from '../inspector/CabinetInspector';
import { ObstacleInspector } from '../inspector/ObstacleInspector';
import { ApplianceInspector } from '../inspector/ApplianceInspector';
import { OpeningInspector } from '../inspector/OpeningInspector';
import { FixtureInspector } from '../inspector/FixtureInspector';
import { QuoteSidebar } from '../quote/QuoteSidebar';
import { Room3DCanvas } from '../canvas3d/Room3DCanvas';
import { WallElevationView } from '../elevation/WallElevationView';
import type { InventorySection } from '../inventory/InventoryManager';
import type { WallOrientation } from '../../types/layout';
import { useElementSize } from './useElementSize';
import { cn } from '@/lib/utils';

type Tool = 'cabinets' | 'appliances' | 'pillars' | 'doors' | 'lights' | 'cameras' | 'surfaces';
type EditorView = 'plan' | '3d' | 'elevation';

const TOOLS: { id: Tool; label: string; Icon: typeof Boxes }[] = [
  { id: 'cabinets', label: 'Cabinets', Icon: Boxes },
  { id: 'appliances', label: 'Appliances', Icon: Refrigerator },
  { id: 'pillars', label: 'Pillars', Icon: Columns3 },
  { id: 'doors', label: 'Doors', Icon: DoorOpen },
  { id: 'lights', label: 'Lights', Icon: Lamp },
  { id: 'cameras', label: 'Cameras', Icon: Camera },
  { id: 'surfaces', label: 'Surfaces', Icon: Paintbrush },
];

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

// Fallback room size before a project has loaded.
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

export function DesignEditor({
  onBack,
  onPresent,
  onOpenCutList,
  onOpenDesigner,
  onManageCatalogue,
}: {
  onBack: () => void;
  onPresent: () => void;
  onOpenCutList: (quoteId?: string) => void;
  onOpenDesigner: (cabinetId: string) => void;
  onManageCatalogue: (section: InventorySection) => void;
}) {
  const currentProject = useLayoutStore((s) => s.currentProject);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const isLoading = useLayoutStore((s) => s.isLoading);
  const loadError = useLayoutStore((s) => s.loadError);
  const isSaving = useLayoutStore((s) => s.isSaving);
  const saveError = useLayoutStore((s) => s.saveError);
  const lastAutosaveAt = useLayoutStore((s) => s.lastAutosaveAt);
  const saveProject = useLayoutStore((s) => s.saveProject);
  const undo = useLayoutStore((s) => s.undo);
  const redo = useLayoutStore((s) => s.redo);
  const canUndo = useLayoutStore((s) => s.undoStack.length > 0);
  const canRedo = useLayoutStore((s) => s.redoStack.length > 0);
  const selection = useLayoutStore((s) => s.selection);
  const select = useLayoutStore((s) => s.select);
  const bom = useBOM();

  const [view, setView] = useState<EditorView>('plan');
  // Elevation: the measured drawing or the 3D wall view, for one wall.
  const [elevMode, setElevMode] = useState<'drawing' | '3d'>('3d');
  const [elevWall, setElevWall] = useState<WallOrientation>('north');
  const { measure: measureElev, width: elevWidth } = useElementSize<HTMLDivElement>();
  // Open the cabinets panel on a laptop; on a tablet or phone the plan
  // starts uncovered (the panel would sit over it).
  const [tool, setTool] = useState<Tool | null>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'cabinets' : null
  );
  // The quote panel opens and closes on every screen size (your request,
  // §84): open by default on a wide laptop, where there's room beside the
  // plan; a slide-over below that. Selecting an item always shows its
  // inspector, whatever this says.
  const [quoteOpen, setQuoteOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
  const [checksOpen, setChecksOpen] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  // The four display switches (moved here from App.tsx in §81):
  // Purely a display preference for the 2D plan — cabinet width×depth×
  // height labels and the remaining-space gap labels both get dense on
  // a busy layout. Not persisted: this is about decluttering THIS
  // session's screen, not a property of the layout itself.
  // Same session-only shape as showDimensions, for the red overlap
  // highlight and the amber clearance highlight/zones — a GLOBAL
  // master on top of each item's own ignoreOverlap/ignoreClearance
  // (CabinetInspector). The global only ever hides MORE: turning it
  // off suppresses the warning everywhere regardless of any item's
  // own setting, but turning it back on doesn't override an
  // individual item's mute — that per-item choice still applies
  // underneath. See CabinetLayerProps' own comment for exactly what
  // "off" hides.
  // Third, independent toggle for the trade-ergonomics banner
  // (aisle width, sink-hob distance, etc — lib/kitchenChecks.ts) —
  // same "visible by default, hideable on a busy layout" shape as the
  // other two, since a kitchen with a genuinely tight aisle will keep
  // showing that finding on every render otherwise.
  const [showDimensions, setShowDimensions] = useState(true);
  const [showOverlapWarnings, setShowOverlapWarnings] = useState(true);
  const [showClearanceWarnings, setShowClearanceWarnings] = useState(true);
  const [showKitchenChecks, setShowKitchenChecks] = useState(true);
  const alerts = useDesignAlerts().filter((a) =>
    a.category === 'collision'
      ? showOverlapWarnings
      : a.category === 'kitchen'
        ? showKitchenChecks
        : showClearanceWarnings
  );

  const { measure: measureCanvas, width: canvasWidth, height: canvasHeight } = useElementSize<HTMLDivElement>();
  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;
  // Every layer gets the SAME size, so they share one scale and line up.
  const size = { maxWidthPx: Math.max(320, canvasWidth), maxHeightPx: Math.max(280, canvasHeight) };

  async function handleManualSave() {
    await saveProject();
    const error = useLayoutStore.getState().saveError;
    if (error) toast.error('Failed to save project', { description: error });
    else toast.success('Project saved');
  }

  // Finalise = show the quote and bring its freeze-and-send section into
  // view; that's what the session is for.
  function finalise() {
    select(null);
    setQuoteOpen(true);
    requestAnimationFrame(() => document.getElementById('quote-finalise')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const toolPanel: Record<Tool, ReactNode> = {
    cabinets: <CabinetToolbar onManageInventory={() => onManageCatalogue('cabinets')} />,
    appliances: <ApplianceToolbar onManageInventory={() => onManageCatalogue('appliances')} />,
    pillars: <ObstacleToolbar onManageInventory={() => onManageCatalogue('obstacles')} />,
    doors: <OpeningToolbar />,
    lights: <LightingToolbar />,
    cameras: <CameraToolbar />,
    surfaces: <RoomSurfacesPanel />,
  };

  const inspector =
    selection?.type === 'cabinet' ? (
      <CabinetInspector onOpenDesigner={onOpenDesigner} />
    ) : selection?.type === 'appliance' ? (
      <ApplianceInspector />
    ) : selection?.type === 'obstacle' ? (
      <ObstacleInspector />
    ) : selection?.type === 'opening' ? (
      <OpeningInspector />
    ) : selection?.type === 'fixture' ? (
      <FixtureInspector />
    ) : null;
  const rightOpen = !!inspector || quoteOpen;

  const saved = isSaving ? 'Saving…' : saveError ? 'Not saved' : lastAutosaveAt ? `Saved ${new Date(lastAutosaveAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved';

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* ---- Top bar ---- */}
      {/* relative z-40: the top bar's pop-ups (Room) must sit above the
          editor body; the quote panel was painting over them (§82). */}
      <header className="relative z-40 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-3 md:gap-3 md:px-4">
        <Button variant="outline" size="icon-touch" onClick={onBack} aria-label="Back to customers">
          <ArrowLeft />
        </Button>
        <div className="hidden min-w-0 flex-col sm:flex">
          <span className="truncate text-base font-bold">{currentProject?.clientName ?? 'Design'}</span>
          <span className="hidden truncate text-[13px] text-muted-foreground sm:block">
            {[currentProject?.locality, 'Kitchen'].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="flex flex-1 justify-center">
          <div role="tablist" aria-label="View" className="flex rounded-xl bg-secondary p-1">
            {(['plan', '3d', 'elevation'] as EditorView[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'h-9 rounded-[9px] px-2.5 text-sm font-semibold md:px-4',
                  view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {v === 'plan' ? 'Plan' : v === '3d' ? '3D' : 'Elevation'}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={handleManualSave}
          title="Everything saves automatically a moment after each edit. Click to save right now."
          className={cn('hidden items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] lg:flex', saveError ? 'text-destructive' : 'text-muted-foreground hover:bg-secondary')}
        >
          {!saveError && !isSaving && <Check className="size-4 text-primary" />}
          {saved}
        </button>
        <div className="hidden md:block">
          <RoomSettingsPanel />
        </div>
        <div className="md:hidden">
          <RoomSettingsPanel compact />
        </div>
        <Button variant="outline" size="touch" className="hidden lg:inline-flex" onClick={() => onOpenCutList()}>
          <Scissors /> Cutting list
        </Button>
        {/* Smaller screens: the same, as an icon, so the cutting list is
            always one tap from the design. */}
        <Button variant="outline" size="icon-touch" className="hidden md:inline-flex lg:hidden" aria-label="Cutting list" onClick={() => onOpenCutList()}>
          <Scissors />
        </Button>
        {/* Open or close the quote panel (your request, §84). */}
        <Button
          variant={rightOpen && !inspector ? 'secondary' : 'outline'}
          size="touch"
          className="hidden md:inline-flex"
          aria-pressed={quoteOpen}
          aria-label="Quote panel"
          onClick={() => {
            select(null);
            setQuoteOpen((o) => !o);
          }}
        >
          <ReceiptText /> <span className="hidden md:inline">Quote</span>
        </Button>
        <Button variant="outline" size="touch" className="hidden md:inline-flex" onClick={onPresent}>
          <Presentation /> Present
        </Button>
        {/* Phone (§87): the three that don't fit go in one menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-touch" className="md:hidden" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className="min-h-11 text-[15px]" onSelect={() => onOpenCutList()}>
              <Scissors /> Cutting list
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 text-[15px]"
              onSelect={() => {
                select(null);
                setQuoteOpen(true);
              }}
            >
              <ReceiptText /> Quote
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 text-[15px]" onSelect={onPresent}>
              <Presentation /> Present to customer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {(loadError || saveError) && (
        <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {loadError ? `Failed to load: ${loadError}` : `Failed to save: ${saveError}`}
        </div>
      )}

      {/* Phone (§87): a column, with the tools as a strip of tabs along
          the bottom and their panels rising as a sheet over the plan.
          Tablet and up: a left rail with the panel beside it. */}
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        {/* ---- Left rail (bottom strip on phone) + one tool panel ---- */}
        <nav
          aria-label="Tools"
          className="order-last flex h-[72px] w-full shrink-0 flex-row items-center gap-1 overflow-x-auto border-t border-border bg-card px-2 md:order-none md:h-auto md:w-[76px] md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-t-0 md:border-r md:px-0 md:py-3"
        >
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              onClick={() => setTool((t) => (t === id ? null : id))}
              className={cn(
                'flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors',
                tool === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <Icon className="size-[22px]" strokeWidth={1.7} />
              {label}
            </button>
          ))}
        </nav>
        {tool && (
          <aside
            aria-label={TOOLS.find((t) => t.id === tool)?.label}
            className="absolute inset-x-0 bottom-[72px] z-20 flex max-h-[62%] flex-col rounded-t-2xl border-t border-border bg-card shadow-float md:inset-x-auto md:inset-y-0 md:bottom-auto md:left-[76px] md:max-h-none md:w-[320px] md:max-w-[calc(100vw-76px)] md:rounded-none md:border-t-0 md:border-r lg:static lg:shadow-none"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-[17px] font-semibold">{TOOLS.find((t) => t.id === tool)?.label}</span>
              <Button variant="ghost" size="icon-touch" aria-label="Close panel" onClick={() => setTool(null)}>
                <X />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 [&>*]:w-full">{toolPanel[tool]}</div>
          </aside>
        )}

        {/* ---- Centre: plan, 3D or elevation ---- */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {isLoading ? (
            <p className="m-auto text-sm text-muted-foreground">Loading the design…</p>
          ) : view === 'plan' ? (
            <div ref={measureCanvas} className="relative min-h-0 flex-1 overflow-hidden">
              {/* The overlap chooser: fixed-positioned itself, but it
                  lives here so it unmounts with the plan. */}
              <PickChooser />
              {/* What the plan draws, on its own button (§88): these are
                  view settings, not design problems, so they don't live
                  under the checks button any more. */}
              <div className="absolute top-3 right-3 z-10">
                <Button
                  variant="outline"
                  size="touch"
                  aria-label="Guides"
                  aria-expanded={showOpen}
                  onClick={() => setShowOpen((o) => !o)}
                  className="bg-card shadow-card"
                >
                  <Layers /> <span className="hidden sm:inline">Guides</span>
                </Button>
                {showOpen && (
                  <div className="absolute top-full right-0 mt-2 flex w-64 flex-col gap-2.5 rounded-2xl bg-card p-4 text-sm shadow-float">
                    <span className="text-[13px] font-semibold text-muted-foreground">Guides drawn on the plan</span>
                    {(
                      [
                        ['Dimensions', showDimensions, setShowDimensions],
                        ['Overlaps', showOverlapWarnings, setShowOverlapWarnings],
                        ['Clearances (door swings, gaps)', showClearanceWarnings, setShowClearanceWarnings],
                        ['Kitchen ergonomics', showKitchenChecks, setShowKitchenChecks],
                      ] as const
                    ).map(([label, value, setter]) => (
                      <label key={label} className="flex min-h-9 items-center gap-2.5">
                        <Checkbox checked={value} onCheckedChange={(c) => setter(c === true)} />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {canvasWidth > 0 && (
                <RoomCanvas widthMm={roomWidthMm} depthMm={roomDepthMm} {...size}>
                  <CabinetLayer
                    widthMm={roomWidthMm}
                    depthMm={roomDepthMm}
                    {...size}
                    showDimensions={showDimensions}
                    showOverlapWarnings={showOverlapWarnings}
                    showClearanceWarnings={showClearanceWarnings}
                  />
                  <ObstacleLayer widthMm={roomWidthMm} depthMm={roomDepthMm} {...size} />
                  <ApplianceLayer widthMm={roomWidthMm} depthMm={roomDepthMm} {...size} showOverlapWarnings={showOverlapWarnings} />
                  {/* After appliances, so swing arcs draw over what they may hit. */}
                  <OpeningLayer widthMm={roomWidthMm} depthMm={roomDepthMm} {...size} />
                  <FixtureLayer widthMm={roomWidthMm} depthMm={roomDepthMm} {...size} />
                  <CameraLayer widthMm={roomWidthMm} depthMm={roomDepthMm} {...size} />
                  {/* Last: a readout only, so its labels are never hidden. */}
                  <RemainingSpaceLayer widthMm={roomWidthMm} depthMm={roomDepthMm} {...size} visible={showDimensions} />
                </RoomCanvas>
              )}
            </div>
          ) : view === '3d' ? (
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <Room3DCanvas widthMm={roomWidthMm} depthMm={roomDepthMm} />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* One wall picker for both the measured drawing and the 3D
                  wall view (§82), so switching mode keeps the wall. */}
              <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
                <div role="tablist" aria-label="Elevation mode" className="flex rounded-xl bg-secondary p-1">
                  {(['drawing', '3d'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={elevMode === m}
                      onClick={() => setElevMode(m)}
                      className={cn(
                        'h-9 rounded-[9px] px-4 text-sm font-semibold',
                        elevMode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                      )}
                    >
                      {m === 'drawing' ? 'Drawing' : '3D'}
                    </button>
                  ))}
                </div>
                <div role="radiogroup" aria-label="Wall" className="flex flex-wrap gap-1.5">
                  {(['north', 'east', 'south', 'west'] as WallOrientation[]).map((w) => (
                    <button
                      key={w}
                      type="button"
                      role="radio"
                      aria-checked={elevWall === w}
                      onClick={() => setElevWall(w)}
                      className={cn(
                        'h-9 rounded-full px-3.5 text-sm font-semibold capitalize',
                        elevWall === w ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {w} wall
                    </button>
                  ))}
                </div>
              </div>
              <div ref={measureElev} className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
                {elevMode === 'drawing' ? (
                  <WallElevationView embedded orientation={elevWall} onOrientationChange={setElevWall} maxWidthPx={elevWidth} />
                ) : (
                  <Room3DCanvas widthMm={roomWidthMm} depthMm={roomDepthMm} wallView={elevWall} />
                )}
              </div>
            </div>
          )}
        </main>

        {/* ---- Right: inspector for the selection, otherwise the quote ---- */}
        <aside
          aria-label={inspector ? 'Selected item' : 'Quote'}
          className={cn(
            'absolute inset-y-0 right-0 z-20 w-[400px] max-w-full flex-col overflow-y-auto border-l border-border bg-card shadow-float xl:static xl:shadow-none',
            rightOpen ? 'flex' : 'hidden'
          )}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-2">
            <span className="text-[17px] font-semibold">{inspector ? 'Selected' : 'Quote'}</span>
            <Button
              variant="ghost"
              size="icon-touch"
              aria-label="Close"
              onClick={() => {
                select(null);
                setQuoteOpen(false);
              }}
            >
              <X />
            </Button>
          </div>
          <div className="flex flex-col gap-4 p-4 [&>*]:w-full [&>aside]:border-0 [&>aside]:p-0 [&>div]:w-full">
            {inspector ?? <QuoteSidebar onOpenCutList={(quoteId) => onOpenCutList(quoteId)} />}
          </div>
        </aside>
      </div>

      {/* ---- Bottom bar ---- */}
      <footer className="relative flex h-16 shrink-0 items-center gap-2 border-t border-border bg-card px-3 md:gap-3 md:px-4">
        <Button
          variant="ghost"
          size="touch"
          onClick={() => setChecksOpen((o) => !o)}
          aria-expanded={checksOpen}
          // The phone shows just the count, so name it in full.
          aria-label={alerts.length ? `${alerts.length} ${alerts.length === 1 ? 'check' : 'checks'}` : 'No issues'}
          className={cn('rounded-full', alerts.length ? 'bg-warning-soft text-warning-foreground hover:bg-warning-soft' : 'text-muted-foreground')}
        >
          {alerts.length ? <AlertTriangle /> : <Check />}
          {alerts.length ? (
            <span>
              {alerts.length}
              <span className="hidden sm:inline"> {alerts.length === 1 ? 'check' : 'checks'}</span>
            </span>
          ) : (
            <span className="hidden sm:inline">No issues</span>
          )}
        </Button>
        {checksOpen && (
          <div className="absolute bottom-[72px] left-3 z-30 flex max-h-[60vh] w-[min(440px,calc(100vw-24px))] flex-col gap-3 overflow-y-auto rounded-2xl bg-card p-4 shadow-float">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold">Design checks</span>
              <Button variant="ghost" size="icon-touch" aria-label="Close checks" onClick={() => setChecksOpen(false)}>
                <X />
              </Button>
            </div>
            <DesignAlertsPanel
              showOverlapWarnings={showOverlapWarnings}
              showClearanceWarnings={showClearanceWarnings}
              showKitchenChecks={showKitchenChecks}
            />
            {alerts.length === 0 && <p className="text-sm text-muted-foreground">Nothing to fix right now.</p>}
          </div>
        )}
        <div className="hidden gap-1.5 sm:flex">
          <Button variant="outline" size="icon-touch" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Cmd+Z)">
            <Undo2 />
          </Button>
          <Button variant="outline" size="icon-touch" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Cmd+Shift+Z)">
            <Redo2 />
          </Button>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            select(null);
            setQuoteOpen((o) => !o);
          }}
          className="flex flex-col items-end rounded-lg px-2 py-1 hover:bg-secondary"
          aria-label="Show the quote"
        >
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-base font-extrabold tracking-tight sm:text-lg md:text-xl">{INR.format(bom.grandTotal)}</span>
        </button>
        <Button size="touch-lg" className="shrink-0 px-4 shadow-cta sm:px-5" onClick={finalise}>
          {/* One text node, so the button's gap doesn't split the words. */}
          <span>
            Finalise<span className="hidden sm:inline"> quote</span>
          </span>
        </Button>
      </footer>
    </div>
  );
}
