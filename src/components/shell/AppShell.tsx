// src/components/shell/AppShell.tsx
//
// The frame around every business-level page (docs/UX_PLAN.md §5; §70,
// §73). One navigation, always in the same place (UI principle 4):
//   - laptop (lg, ≥1024px): a labelled sidebar
//   - tablet (md, 768–1023px): an icon rail, labels under the icons
//   - phone (<768px): a bottom tab bar — four tabs plus "More"
// Premium A ("Atelier", chosen 3 Oct 2026): the navigation is dark
// forest with a brass mark and a brass dot on the current page.
//
// Order, as you set it (§73): Home · Customers · Production · Catalogue ·
// Rate card · Workshop · Settings. Rate card and Workshop moved out of
// Settings, which now holds only the account (and, later, business
// details).
//
// The design editor and its sub-screens (3D, cutting list, Designer)
// are NOT inside this shell: the editor is a full-screen workspace.

import { useState, type ReactNode } from 'react';
import {
  Home,
  Users,
  Hammer,
  LayoutGrid,
  IndianRupee,
  Ruler,
  Settings,
  LogOut,
  MoreHorizontal,
  X,
  Gauge,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import {
  CATALOGUE_SECTIONS,
  scrollToCatalogueSection,
  useActiveCatalogueSection,
} from '../inventory/catalogueSections';
import { cn } from '@/lib/utils';

export type ShellPage = 'home' | 'customers' | 'production' | 'catalogue' | 'rates' | 'workshop' | 'settings' | 'usage';

const NAV: { page: ShellPage; label: string; Icon: typeof Home }[] = [
  { page: 'home', label: 'Home', Icon: Home },
  { page: 'customers', label: 'Customers', Icon: Users },
  { page: 'production', label: 'Production', Icon: Hammer },
  { page: 'catalogue', label: 'Catalogue', Icon: LayoutGrid },
  { page: 'rates', label: 'Rate card', Icon: IndianRupee },
  { page: 'workshop', label: 'Workshop', Icon: Ruler },
  { page: 'settings', label: 'Settings', Icon: Settings },
  // Everyone's own AI usage and limits (§134); the software owner also
  // sets every business's limits there (§132).
  { page: 'usage', label: 'Usage', Icon: Gauge },
];

// The phone's four tabs; the rest live under "More".
const PHONE_TABS: ShellPage[] = ['home', 'customers', 'production', 'catalogue'];

// The business's initial on a brass tile — a stand-in until a business
// can upload its logo (Settings → Business, not built yet).
// The business's logo when it has one (§95), on a white tile so a dark
// or transparent logo still reads on the dark sidebar; otherwise, or if
// the image fails to load, the first letter of the name.
function BusinessMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
        <img src={logoUrl} alt={`${name} logo`} className="max-h-full max-w-full object-contain" onError={() => setFailedUrl(logoUrl)} />
      </div>
    );
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-[17px] font-extrabold text-sidebar-primary-foreground">
      {name.trim().charAt(0).toUpperCase() || 'K'}
    </div>
  );
}

export function AppShell({
  page,
  onNavigate,
  children,
}: {
  page: ShellPage;
  onNavigate: (page: ShellPage) => void;
  children: ReactNode;
}) {
  const businessName = useAuthStore((s) => s.businessName) ?? 'Your business';
  const logoUrl = useAuthStore((s) => s.businessProfile?.logoUrl ?? null);
  const email = useAuthStore((s) => s.session?.user.email) ?? '';
  const signOut = useAuthStore((s) => s.signOut);
  const activeSection = useActiveCatalogueSection(page === 'catalogue');
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <nav
        aria-label="Main"
        className="sticky top-0 hidden h-dvh w-[80px] shrink-0 flex-col items-center gap-1 overflow-y-auto bg-sidebar py-5 text-sidebar-foreground md:flex lg:w-[256px] lg:items-stretch lg:px-4"
      >
        <div className="mb-5 flex items-center gap-3 lg:px-2">
          <BusinessMark name={businessName} logoUrl={logoUrl} />
          <span className="hidden truncate text-[15px] font-bold text-white lg:block">{businessName}</span>
        </div>
        {NAV.map(({ page: p, label, Icon }) => (
          <div key={p} className="flex flex-col">
            <button
              type="button"
              onClick={() => onNavigate(p)}
              aria-current={page === p ? 'page' : undefined}
              className={cn(
                'flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors lg:h-11 lg:w-auto lg:flex-row lg:justify-start lg:gap-3 lg:px-3.5 lg:text-[15px]',
                page === p
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/60 hover:text-white'
              )}
            >
              <Icon className="size-5" strokeWidth={1.7} />
              {label}
              <span
                className={cn(
                  'ml-auto hidden size-1.5 rounded-full lg:block',
                  page === p ? 'bg-sidebar-primary' : 'bg-transparent'
                )}
              />
            </button>
            {/* Under Catalogue, while it's open: its sections (laptop only;
                tablet and phone use the page's jump bar). */}
            {p === 'catalogue' && page === 'catalogue' && (
              <div className="mb-1 ml-6 hidden flex-col border-l border-sidebar-border pl-2 lg:flex">
                {CATALOGUE_SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollToCatalogueSection(s.id)}
                    aria-current={activeSection === s.id ? 'location' : undefined}
                    className={cn(
                      'h-9 rounded-lg px-3 text-left text-sm font-medium transition-colors',
                      activeSection === s.id ? 'bg-sidebar-accent text-white' : 'hover:bg-sidebar-accent/60 hover:text-white'
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-1 border-t border-sidebar-border pt-3 lg:flex-row lg:gap-2.5 lg:px-2">
          <span className="hidden min-w-0 flex-1 truncate text-sm lg:block">{email}</span>
          <button
            type="button"
            onClick={() => signOut()}
            aria-label="Sign out"
            title="Sign out"
            className="flex size-11 items-center justify-center rounded-[10px] hover:bg-sidebar-accent hover:text-white"
          >
            <LogOut className="size-5" strokeWidth={1.7} />
          </button>
        </div>
      </nav>

      {/* Bottom padding on phones so content clears the tab bar. */}
      <main className="min-w-0 flex-1 pb-24 md:pb-0">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[76px] grid-cols-5 bg-sidebar pb-2 text-sidebar-foreground md:hidden"
      >
        {PHONE_TABS.map((p) => {
          const { label, Icon } = NAV.find((n) => n.page === p)!;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onNavigate(p)}
              aria-current={page === p ? 'page' : undefined}
              className={cn('flex flex-col items-center justify-center gap-1 text-xs font-semibold', page === p && 'text-sidebar-primary')}
            >
              <Icon className="size-[22px]" strokeWidth={1.7} />
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className={cn(
            'flex flex-col items-center justify-center gap-1 text-xs font-semibold',
            !PHONE_TABS.includes(page) && 'text-sidebar-primary'
          )}
        >
          <MoreHorizontal className="size-[22px]" strokeWidth={1.7} />
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 rounded-t-3xl bg-card p-4 pb-8 shadow-float">
            <div className="flex items-center justify-between pb-2">
              <span className="text-[17px] font-bold">More</span>
              <button type="button" aria-label="Close" onClick={() => setMoreOpen(false)} className="flex size-11 items-center justify-center rounded-[10px] bg-secondary">
                <X className="size-5" />
              </button>
            </div>
            {NAV.filter((n) => !PHONE_TABS.includes(n.page)).map(({ page: p, label, Icon }) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onNavigate(p);
                }}
                className={cn('flex h-12 items-center gap-3 rounded-xl px-3 text-base font-semibold', page === p ? 'bg-accent text-accent-foreground' : 'hover:bg-secondary')}
              >
                <Icon className="size-5" strokeWidth={1.7} />
                {label}
              </button>
            ))}
            <button type="button" onClick={() => signOut()} className="flex h-12 items-center gap-3 rounded-xl px-3 text-base font-semibold text-muted-foreground hover:bg-secondary">
              <LogOut className="size-5" strokeWidth={1.7} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// The standard page header inside the shell: an uppercase eyebrow, the
// title, and the page's ONE primary action (UI principle 1).
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        {subtitle && (
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{subtitle}</span>
        )}
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em] md:text-[36px]">{title}</h1>
      </div>
      {action}
    </div>
  );
}
