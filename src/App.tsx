// src/App.tsx

import { useEffect, useState, useRef } from 'react';
import { InventoryManager, type InventorySection } from './components/inventory/InventoryManager';
import { CatalogueJumpBar } from './components/inventory/CatalogueSection';
import { DuplicatesBanner } from './components/inventory/DuplicatesReview';
import { PresentMode } from './components/present/PresentMode';
import { CutListView } from './components/cutlist/CutListView';
import { ConstructionSettingsManager } from './components/workshop/ConstructionSettingsManager';
import { RateCardManager } from './components/inventory/RateCardManager';
import { CabinetDesignerPage, type DesignerTarget } from './components/designer/CabinetDesignerPage';
import { DesignEditor } from './components/editor/DesignEditor';
import { AppShell, PageHeader, type ShellPage } from './components/shell/AppShell';
import { HomePage } from './components/home/HomePage';
import { CustomersPage } from './components/customers/CustomersPage';
import { ProductionPage } from './components/production/ProductionPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { useLayoutStore } from './store/layoutStore';
import { useAuthStore } from './store/authStore';
import { LoginScreen } from './components/auth/LoginScreen';
import { AwaitingAccessScreen } from './components/auth/AwaitingAccessScreen';
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts';
import { useSelectionShortcuts } from './hooks/useSelectionShortcuts';
import { Toaster } from './components/ui/sonner';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { Button } from './components/ui/button';

// Fallback room size shown only before any project has loaded — once a
// project loads, the room dimensions come from its saved layout instead
// (different clients' kitchens are different sizes).
const DEFAULT_ROOM_WIDTH_MM = 3000;
const DEFAULT_ROOM_DEPTH_MM = 4000;

// The four shell pages (home, customers, catalogue, settings) sit inside
// AppShell's navigation; everything else is the design editor and its
// full-screen sub-views (§70).
type View =
  | 'home'
  | 'customers'
  | 'production'
  | 'catalogue'
  | 'rates'
  | 'workshop'
  | 'settings'
  | 'canvas'
  | 'designer'
  | 'present'
  | 'cutlist';

function App() {
  const [view, setView] = useState<View>('home');
  // Where the catalogue's "Back to design" and the Workshop page's Back
  // return to — set when they're opened from inside a design.
  const [previousView, setPreviousView] = useState<View>('home');
  const [designerTarget, setDesignerTarget] = useState<DesignerTarget | null>(null);
  // Where the Designer's Back goes. Its OWN slot, not previousView:
  // Manage Inventory's Back reads previousView, so reusing it would make
  // catalogue → Designer → back → Back reload the catalogue forever.
  const [designerReturn, setDesignerReturn] = useState<View>('canvas');
  const designerScrollY = useRef(0);
  // Which frozen quote's cutting list to open on (§60); undefined = the
  // live design.
  const [cutListQuoteId, setCutListQuoteId] = useState<string | undefined>(undefined);
  // Where the cutting list's Back goes: the design, or the Customers /
  // Production page it was opened from (§72).
  const [cutListReturn, setCutListReturn] = useState<View>('canvas');
  // Which catalog section to scroll to when the inventory screen opens —
  // set by whichever toolbar's "Manage" button was clicked, undefined
  // for the dashboard's generic "Manage Inventory" button.
  const [manageSection, setManageSection] = useState<InventorySection | undefined>(undefined);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const loadProject = useLayoutStore((s) => s.loadProject);
  const loadInventory = useLayoutStore((s) => s.loadInventory);

  const session = useAuthStore((s) => s.session);
  // Keyed on the USER, not the session object. Supabase hands back a new
  // session object on every auth event — including when the browser tab
  // regains focus and on the hourly token refresh — and keying the
  // inventory load on `session` reloaded the whole catalogue each time:
  // a flash of loading placeholders, and any unsaved catalogue-row edits
  // thrown away. The user only changes on an actual sign-in/out.
  const userId = session?.user.id;
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const businessId = useAuthStore((s) => s.businessId);
  const authError = useAuthStore((s) => s.error);
  const authInit = useAuthStore((s) => s.init);

  // Cmd+Z / Cmd+Shift+Z, app-wide (skipped while a text field has
  // focus — see the hook's own comment).
  useUndoRedoShortcuts();

  // Delete/Backspace, Escape, arrow-key nudge for whatever's selected —
  // only while the 2D canvas is the active view (see the hook's own
  // comment on why a stale selection from another screen must not act).
  useSelectionShortcuts(view === 'canvas');

  // Restores an existing session (persisted across reloads — see
  // Supabaseclient.ts) or confirms there isn't one. init() is a no-op
  // past its first call, so this is safe even under StrictMode's
  // double-invoke in dev.
  useEffect(() => {
    authInit();
  }, [authInit]);

  // Inventory (cabinet catalog + obstacle presets) is business-level,
  // not tied to any one client's layout — load it once up front so
  // it's already there whether the user opens a layout or the
  // Inventory screen first. Gated on `session`: this reaches Supabase,
  // and RLS now requires being signed in for that to return anything.
  useEffect(() => {
    if (userId) loadInventory();
  }, [loadInventory, userId]);

  if (isAuthLoading) {
    return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  }

  if (!session) {
    return <LoginScreen />;
  }

  // Signed in but in no business: a new sign-up awaiting approval (§106).
  // Not shown when the membership lookup itself FAILED (authError), so a
  // network blip doesn't tell an approved user they're unapproved.
  if (!businessId && !authError) {
    return <AwaitingAccessScreen />;
  }

  // The Cabinet Designer is entered from a catalogue row or a placed
  // cabinet; Back returns to whichever screen opened it.
  function openDesigner(target: DesignerTarget, from: View) {
    setDesignerTarget(target);
    setDesignerReturn(from);
    // Remember where the page was scrolled, so Back lands on the row you
    // left from rather than the top. And drop any "scroll to section"
    // request from the toolbar's Manage button — otherwise coming back
    // replays that smooth-scroll and the page looks like it refreshed.
    designerScrollY.current = window.scrollY;
    if (from === 'catalogue') setManageSection(undefined);
    setView('designer');
  }

  function handleOpenCanvas(projectId: string) {
    setView('canvas');
    loadProject(projectId);
  }

  function handleManageInventory(section?: InventorySection) {
    setPreviousView(view);
    setManageSection(section);
    setView('catalogue');
  }

  // A job's cutting list straight from Customers or Production (§71-72),
  // without going through the editor.
  function openJobCutList(projectId: string) {
    loadProject(projectId);
    setCutListQuoteId(undefined);
    setCutListReturn(view);
    setView('cutlist');
  }

  function navigate(page: ShellPage) {
    setPreviousView(page);
    setView(page);
  }

  // The manual "Save Project" button, distinct from autosave — autosave
  // stays silent by design (the user asked for exactly that: only the
  // "Auto saved HH:MM:SS" text updates, no button-state flicker), but a
  // deliberate click deserves a toast either way, per PRINCIPLES.md's
  // "feedback on every action" rule. Reads saveError straight from the
  // store right after the awaited call rather than through the `saveError`
  // hook value above, which is one render behind at this point.

  const roomWidthMm = currentLayout?.dimensions.widthMm ?? DEFAULT_ROOM_WIDTH_MM;
  const roomDepthMm = currentLayout?.dimensions.depthMm ?? DEFAULT_ROOM_DEPTH_MM;

  // A single `content` variable rather than an early `return` per
  // branch, so <Toaster/> below only has to be mounted once and stays
  // mounted across every view switch instead of unmounting and losing
  // any in-flight toast each time `view` changes.
  let content: React.ReactNode;

  if (view === 'cutlist') {
    content = (
      // Keyed by the requested version so opening a different quote's
      // list starts fresh (the page picks its version once, on mount).
      <CutListView
        key={cutListQuoteId ?? 'current'}
        initialQuoteId={cutListQuoteId}
        onClose={() => setView(cutListReturn)}
        onOpenWorkshop={() => {
          setPreviousView('cutlist');
          setView('workshop');
        }}
        onOpenDesigner={(cabinetId) => openDesigner({ kind: 'cabinet', cabinetId }, 'cutlist')}
      />
    );
  } else if (view === 'designer' && designerTarget) {
    content = (
      <CabinetDesignerPage
        target={designerTarget}
        onBack={() => {
          setView(designerReturn);
          // After the screen it returns to has rendered.
          const y = designerScrollY.current;
          requestAnimationFrame(() => window.scrollTo(0, y));
        }}
      />
    );
  } else if (view === 'present') {
    content = (
      <PresentMode widthMm={roomWidthMm} depthMm={roomDepthMm} onExit={() => setView('canvas')} />
    );
  } else if (
    view === 'catalogue' ||
    view === 'home' ||
    view === 'customers' ||
    view === 'production' ||
    view === 'rates' ||
    view === 'workshop' ||
    view === 'settings'
  ) {
    content = (
      <AppShell page={view} onNavigate={navigate}>
        {view === 'home' && (
          <HomePage onOpenDesign={handleOpenCanvas} onNavigate={(p) => navigate(p)} />
        )}
        {view === 'customers' && <CustomersPage onOpenDesign={handleOpenCanvas} onOpenCutList={openJobCutList} />}
        {view === 'production' && <ProductionPage onOpenDesign={handleOpenCanvas} onOpenCutList={openJobCutList} />}
        {view === 'rates' && (
          <div className="flex flex-col gap-5 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
            <PageHeader title="Rate card" subtitle="What things cost you" />
            <RateCardManager />
          </div>
        )}
        {view === 'workshop' && (
          <div className="flex flex-col gap-5 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
            {/* Opened from a cutting list's "Workshop settings" link: one
                tap back to it. */}
            {previousView === 'cutlist' && (
              <Button variant="outline" size="touch" className="self-start" onClick={() => setView('cutlist')}>
                ← Back to cutting list
              </Button>
            )}
            <PageHeader title="Workshop" subtitle="How your workshop builds" />
            <ConstructionSettingsManager />
          </div>
        )}
        {view === 'settings' && <SettingsPage />}
        {view === 'catalogue' && (
          <div className="flex flex-col gap-5 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
            {/* Opened from a toolbar's "Manage" inside a design: one tap back. */}
            {previousView === 'canvas' && (
              <Button variant="outline" size="touch" className="self-start" onClick={() => setView('canvas')}>
                ← Back to design
              </Button>
            )}
            <PageHeader title="Catalogue" subtitle="What you pick from when designing" />
            <CatalogueJumpBar />
            <DuplicatesBanner />
            <InventoryManager
              initialSection={manageSection}
              onOpenDesigner={(itemId) => openDesigner({ kind: 'catalogue', itemId }, 'catalogue')}
            />
          </div>
        )}
      </AppShell>
    );
  } else {
    // The design editor (§81): its own full-screen frame — top bar, tool
    // rail, plan/3D/elevation, inspector-or-quote, bottom bar.
    content = (
      <DesignEditor
        onBack={() => setView('customers')}
        onPresent={() => setView('present')}
        onOpenCutList={(quoteId) => {
          setCutListQuoteId(quoteId);
          setCutListReturn('canvas');
          setView('cutlist');
        }}
        onOpenDesigner={(cabinetId) => openDesigner({ kind: 'cabinet', cabinetId }, 'canvas')}
        onManageCatalogue={(section) => handleManageInventory(section)}
      />
    );
  }

  return (
    <>
      {content}
      <Toaster />
      <ConfirmDialog />
    </>
  );
}

export default App;
