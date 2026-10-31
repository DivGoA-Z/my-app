// src/lib/usageAdmin.ts
//
// The super admin's Usage page (§132): AI limits (images and tokens, per
// day / week / month) for every business, and what each has used. Every
// call goes through a database function that checks is_super_admin()
// itself; the page being hidden from others is convenience, not the guard.

import { supabase } from './Supabaseclient';

export const LIMIT_KEYS = ['images_per_day', 'images_per_week', 'images_per_month', 'tokens_per_day', 'tokens_per_week', 'tokens_per_month'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
// null = no limit (defaults) / use the default (a business).
export type Limits = Record<LimitKey, number | null>;

export interface UsedNumbers {
  images_day: number;
  images_week: number;
  images_month: number;
  tokens_day: number;
  tokens_week: number;
  tokens_month: number;
}

export interface BusinessUsage {
  id: string;
  name: string;
  // The business's own numbers; null when it only uses the defaults.
  own: Limits | null;
  // What applies (own, else default) and what's been used.
  limits: Limits;
  used: UsedNumbers;
}

export interface UsageOverview {
  defaults: Limits;
  businesses: BusinessUsage[];
}

const pickLimits = (o: Partial<Record<LimitKey, number | null>> | null | undefined): Limits =>
  Object.fromEntries(LIMIT_KEYS.map((k) => [k, o?.[k] ?? null])) as Limits;

export async function fetchUsageOverview(): Promise<UsageOverview> {
  const { data, error } = await supabase.rpc('admin_usage_overview');
  if (error) throw new Error(error.message.includes('Not allowed') ? 'Only the software owner can see this page.' : `Couldn’t load usage: ${error.message}`);
  const d = data as {
    defaults: Partial<Limits>;
    businesses: { id: string; name: string; own: Partial<Limits> | null; status: { limits: Partial<Limits>; used: UsedNumbers } }[];
  };
  return {
    defaults: pickLimits(d.defaults),
    businesses: d.businesses.map((b) => ({
      id: b.id,
      name: b.name,
      own: b.own ? pickLimits(b.own) : null,
      limits: pickLimits(b.status.limits),
      used: b.status.used,
    })),
  };
}

export async function saveDefaultLimits(limits: Limits): Promise<void> {
  const { error } = await supabase.rpc('admin_set_default_usage_limits', { p_limits: limits });
  if (error) throw new Error(`Couldn’t save the defaults: ${error.message}`);
}

export async function saveBusinessLimits(businessId: string, limits: Limits): Promise<void> {
  const { error } = await supabase.rpc('admin_set_business_usage_limits', { p_business: businessId, p_limits: limits });
  if (error) throw new Error(`Couldn’t save the limits: ${error.message}`);
}

// "12,500" → 12500; "" → null; anything else → undefined (invalid).
export function parseLimit(text: string): number | null | undefined {
  const t = text.replace(/[,\s]/g, '');
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  return Number(t);
}

// 1234567 → "1.2M", 52300 → "52.3k", 999 → "999".
export function shortCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}
