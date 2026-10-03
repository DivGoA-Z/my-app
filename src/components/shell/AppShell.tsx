// src/components/shell/AppShell.tsx
//
// The frame around every business-level page — Home, Customers,
// Catalogue, Settings (docs/UX_PLAN.md §5, §70). One navigation, always
// in the same place (UI principle 4: same thing, same place):
//   - laptop (lg, ≥1024px): a labelled sidebar
//   - tablet (md, 768–1023px): an icon rail, labels under the icons
//   - phone (<768px): a bottom tab bar
// The design editor and its sub-screens (3D, cutting list, Designer)
// are NOT inside this shell: the editor is a full-screen workspace with
// its own top bar and a back button to Customers.

import type { ReactNode } from 'react';
import { Home, Users, Hammer, LayoutGrid, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import {
  CATALOGUE_SECTIONS,
  scrollToCatalogueSection,
  useActiveCatalogueSection,
} from '../inventory/catalogueSections';
import { cn } from '@/lib/utils';

export type ShellPage = 'home' | 'customers' | 'production' | 'catalogue' | 'settings';

const NAV: { page: ShellPage; label: string; Icon: typeof Home }[] = [
  { page: 'home', label: 'Home', Icon: Home },
  { page: 'customers', label: 'Customers', Icon: Users },
  { page: 'production', label: 'Production', Icon: Hammer },
  { page: 'catalogue', label: 'Catalogue', Icon: LayoutGrid },
  { page: 'settings', label: 'Settings', Icon: Settings },
];

// The business's initial in a green tile — a stand-in until a business
// can upload its logo (Settings → Business, not built yet).
function BusinessMark({ name }: { name: string }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
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
  const email = useAuthStore((s) => s.session?.user.email) ?? '';
  const signOut = useAuthStore((s) => s.signOut);
  const activeSection = useActiveCatalogueSection(page === 'catalogue');

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <nav
        aria-label="Main"
        className="sticky top-0 hidden h-dvh w-[76px] shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-4 md:flex lg:w-[248px] lg:items-stretch lg:px-3.5"
      >
        <div className="mb-4 flex items-center gap-2.5 lg:px-2">
          <BusinessMark name={businessName} />
          <span className="hidden truncate text-[15px] font-bold lg:block">{businessName}</span>
        </div>
        {NAV.map(({ page: p, label, Icon }) => (
          <button
            key={p}
            type="button"
            onClick={() => onNavigate(p)}
            aria-current={page === p ? 'page' : undefined}
            className={cn(
              'flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors lg:h-11 lg:w-auto lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[15px]',
              page === p
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <Icon className="size-5" strokeWidth={1.8} />
            {label}
          </button>
        )).flatMap((item, i) =>
          // Under Catalogue, while it's open: its sections, to jump to
          // (laptop only; tablet and phone get the page's jump bar).
          NAV[i].page === 'catalogue' && page === 'catalogue'
            ? [
                item,
                <div key="catalogue-sections" className="mb-1 ml-5 hidden flex-col border-l border-border pl-2 lg:flex">
                  {CATALOGUE_SECTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => scrollToCatalogueSection(s.id)}
                      aria-current={activeSection === s.id ? 'location' : undefined}
                      className={cn(
                        'h-9 rounded-lg px-3 text-left text-sm font-medium transition-colors',
                        activeSection === s.id
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>,
              ]
            : [item]
        )}
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-1 border-t border-border pt-3 lg:flex-row lg:items-center lg:gap-2.5 lg:px-2">
          <div className="hidden min-w-0 flex-1 flex-col lg:flex">
            <span className="truncate text-sm font-semibold">{email}</span>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            aria-label="Sign out"
            title="Sign out"
            className="flex size-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="size-5" strokeWidth={1.8} />
          </button>
        </div>
      </nav>

      {/* Bottom padding on phones so content clears the tab bar. */}
      <main className="min-w-0 flex-1 pb-24 md:pb-0">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[76px] grid-cols-5 border-t border-border bg-card pb-2 md:hidden"
      >
        {NAV.map(({ page: p, label, Icon }) => (
          <button
            key={p}
            type="button"
            onClick={() => onNavigate(p)}
            aria-current={page === p ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center justify-center gap-1 text-xs font-semibold',
              page === p ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <Icon className="size-[22px]" strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// The standard page header inside the shell: title, optional subtitle,
// and the page's ONE primary action on the right (UI principle 1).
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
      <div className="flex flex-col gap-1">
        {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
        <h1 className="text-[26px] font-bold tracking-tight md:text-[30px]">{title}</h1>
      </div>
      {action}
    </div>
  );
}
