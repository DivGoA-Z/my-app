// src/components/common/SectionCard.tsx
//
// The page-section frame (§71, generalised in §77): a card with an icon,
// a title, ONE line saying what it's for, an optional count, a divider,
// then the content. Longer explanations sit behind "How this works"
// (UI principle 3). Used by the Catalogue and the Rate card.

import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SectionCard({
  id,
  Icon,
  title,
  description,
  count,
  help,
  actions,
  children,
  className,
}: {
  id?: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  count?: number;
  help?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const titleId = id ? `${id}-title` : undefined;
  return (
    // scroll-mt keeps the heading clear of a sticky jump bar on phones.
    <section id={id} aria-labelledby={titleId} className={cn('scroll-mt-20 rounded-2xl bg-card shadow-card lg:scroll-mt-6', className)}>
      <header className="flex flex-wrap items-start gap-4 border-b border-border px-4 py-4 md:px-6 md:py-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Icon className="size-[22px]" strokeWidth={1.7} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {title}
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
