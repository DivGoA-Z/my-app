// src/components/common/EditPanel.tsx
//
// The one way an item is edited across the app's lists (§76, UI principle
// 4 — one way to edit a list): tap a row, this panel slides in from the
// right (full screen on a phone) with every field large and labelled,
// and the actions in a footer that stays put — Delete on the left,
// Cancel and Save on the right. Replaces rows that were permanently
// open forms of tiny inputs.

import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { cn } from '@/lib/utils';

export function EditPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  onSave,
  saveLabel = 'Save',
  saving = false,
  canSave = true,
  onDelete,
  error,
  extraActions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onSave: () => void;
  saveLabel?: string;
  saving?: boolean;
  canSave?: boolean;
  onDelete?: () => void;
  error?: string | null;
  extraActions?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background shadow-float outline-none data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right sm:max-w-[520px] sm:rounded-l-3xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <header className="flex items-start gap-3 border-b border-border bg-card px-5 py-4 sm:rounded-tl-3xl sm:px-6 sm:py-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-xl font-extrabold tracking-[-0.02em]">{title}</DialogPrimitive.Title>
              {subtitle ? (
                <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">{subtitle}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">Edit {title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-touch" aria-label="Close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-4 sm:rounded-bl-3xl sm:px-6">
            {error && <p className="w-full text-sm text-destructive">{error}</p>}
            {onDelete && (
              <Button variant="ghost" size="touch" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete} disabled={saving}>
                Delete
              </Button>
            )}
            {extraActions}
            <div className="flex-1" />
            <DialogPrimitive.Close asChild>
              <Button variant="outline" size="touch">
                Cancel
              </Button>
            </DialogPrimitive.Close>
            <Button size="touch" onClick={onSave} disabled={saving || !canSave}>
              {saving ? 'Saving…' : saveLabel}
            </Button>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// A labelled field, label above. `hint` sits under the control.
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Label className={cn('flex flex-col items-stretch gap-1.5 text-[13px] font-semibold', className)}>
      {label}
      {children}
      {hint && <span className="text-[13px] font-normal text-muted-foreground">{hint}</span>}
    </Label>
  );
}

// A number box with its unit inside it ("600 mm", "₹ 10000").
export function NumberField({
  label,
  value,
  onChange,
  unit,
  prefix,
  min,
  max,
  hint,
  className,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  prefix?: string;
  min?: number;
  max?: number;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <span className="flex h-11 items-center gap-2 rounded-[10px] border border-input bg-card px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        {prefix && <span className="text-sm font-normal text-muted-foreground">{prefix}</span>}
        <Input
          type="number"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-auto min-w-0 border-0 bg-transparent p-0 font-mono text-[15px] shadow-none focus-visible:ring-0"
        />
        {unit && <span className="text-sm font-normal text-muted-foreground">{unit}</span>}
      </span>
    </Field>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  list?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={list}
        className="h-11 rounded-[10px] bg-card text-[15px] font-normal"
      />
    </Field>
  );
}
