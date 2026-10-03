// src/components/inventory/catalogueSections.ts
//
// The Catalogue page's sections (§71) — shared by the page's section
// frames, the sidebar's sub-list and the phone jump bar, so all three
// agree on the sections, their order and their element ids. Kept apart
// from CatalogueSection.tsx so that file exports only components.

import { useEffect, useState } from 'react';
import { Boxes, Lightbulb, Palette, Refrigerator, GripHorizontal, Columns3 } from 'lucide-react';

export type CatalogueSectionId = 'cabinets' | 'appliances' | 'finishes' | 'handles' | 'fixtures' | 'obstacles';

export const CATALOGUE_SECTIONS: { id: CatalogueSectionId; label: string; Icon: typeof Boxes }[] = [
  { id: 'cabinets', label: 'Cabinets', Icon: Boxes },
  { id: 'appliances', label: 'Appliances', Icon: Refrigerator },
  { id: 'finishes', label: 'Finishes', Icon: Palette },
  { id: 'handles', label: 'Handles', Icon: GripHorizontal },
  { id: 'fixtures', label: 'Light fixtures', Icon: Lightbulb },
  { id: 'obstacles', label: 'Pillars & shafts', Icon: Columns3 },
];

export const catalogueSectionElementId = (id: CatalogueSectionId) => `catalogue-${id}`;

// Which section is in view, for the sidebar's highlight. Watches a band
// near the top of the window: the section whose heading has most
// recently entered it is "current". No-op where IntersectionObserver
// doesn't exist (tests).
export function useActiveCatalogueSection(enabled: boolean): CatalogueSectionId | null {
  const [active, setActive] = useState<CatalogueSectionId | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace('catalogue-', '') as CatalogueSectionId);
      },
      { rootMargin: '-10% 0px -70% 0px' }
    );
    // Sections mount after the catalogue loads, so look again shortly.
    const attach = () =>
      CATALOGUE_SECTIONS.forEach((s) => {
        const el = document.getElementById(catalogueSectionElementId(s.id));
        if (el) observer.observe(el);
      });
    attach();
    const t = window.setTimeout(attach, 800);
    return () => {
      window.clearTimeout(t);
      observer.disconnect();
    };
  }, [enabled]);
  return active;
}

export function scrollToCatalogueSection(id: CatalogueSectionId) {
  document.getElementById(catalogueSectionElementId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

