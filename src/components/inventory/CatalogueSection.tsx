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

import type { ReactNode } from 'react';
import { SectionCard } from '../common/SectionCard';
import { CATALOGUE_SECTIONS, catalogueSectionElementId, scrollToCatalogueSection, type CatalogueSectionId } from './catalogueSections';

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
  return (
    <SectionCard
      id={catalogueSectionElementId(id)}
      Icon={meta.Icon}
      title={meta.label}
      description={description}
      count={count}
      help={help}
      actions={actions}
    >
      {children}
    </SectionCard>
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
