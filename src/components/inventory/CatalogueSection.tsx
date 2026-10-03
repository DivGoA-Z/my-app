// src/components/inventory/CatalogueSection.tsx
//
// One frame for every section of the Catalogue page (§71): a card with
// an icon, a title, ONE line saying what it's for, an item count, and a
// divider before the content. Longer explanations sit behind "How this
// works" (UI principle 3 — progressive disclosure), instead of the
// paragraphs of 11px text the page used to open each section with.
//
// CATALOGUE_SECTIONS is also the sidebar's sub-list and the phone's jump
// bar, so the page, the shell and the toolbars' "Manage" links all agree
// on the sections and their element ids.

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { CATALOGUE_SECTIONS, catalogueSectionElementId, scrollToCatalogueSection, type CatalogueSectionId } from './catalogueSections';
import { cn } from '@/lib/utils';

export function CatalogueSection({
  id,
  description,
  count,
  help,
  actions,
  children,
}: {
  id: CatalogueSectionId;
  description: string;
  count?: number;
  help?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const meta = CATALOGUE_SECTIONS.find((s) => s.id === id)!;
  const [showHelp, setShowHelp] = useState(false);
  return (
    // scroll-mt keeps the heading clear of the sticky jump bar on phones.
    <section
      id={catalogueSectionElementId(id)}
      aria-labelledby={`${catalogueSectionElementId(id)}-title`}
      className="scroll-mt-20 rounded-2xl border border-border bg-card lg:scroll-mt-6"
    >
      <header className="flex flex-wrap items-start gap-4 border-b border-border px-4 py-4 md:px-6 md:py-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <meta.Icon className="size-[22px]" strokeWidth={1.7} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h2 id={`${catalogueSectionElementId(id)}-title`} className="text-xl font-semibold tracking-tight">
              {meta.label}
            </h2>
            {count !== undefined && (
              <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs font-semibold text-muted-foreground">
                {count}
              </span>
            )}
          </div>
          <p className="text-[15px] text-muted-foreground">{description}</p>
          {help && (
            <button
              type="button"
              aria-expanded={showHelp}
              onClick={() => setShowHelp((v) => !v)}
              className="flex w-fit items-center gap-1 pt-0.5 text-[13px] font-semibold text-primary"
            >
              How this works
              <ChevronDown className={cn('size-4 transition-transform', showHelp && 'rotate-180')} />
            </button>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {help && showHelp && (
        <div className="flex flex-col gap-2 border-b border-border bg-background px-4 py-4 text-sm leading-relaxed text-muted-foreground md:px-6">
          {help}
        </div>
      )}
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6 md:py-5">{children}</div>
    </section>
  );
}

// The jump bar for tablet and phone, where the sidebar has no room for a
// sub-list: sticky chips under the page title.
export function CatalogueJumpBar() {
  return (
    <nav
      aria-label="Catalogue sections"
      className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8 lg:hidden"
    >
      {CATALOGUE_SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => scrollToCatalogueSection(s.id)}
          className="h-9 shrink-0 rounded-full bg-secondary px-3.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
