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

// Your own business's limits and usage (§134), for everyone's Usage page.
// `now` is the database's clock, so the projection and the limits agree
// on which day it is even if this device's clock is off.
export interface MyUsage {
  limits: Limits;
  used: UsedNumbers;
  now: Date;
}

export async function fetchMyUsage(): Promise<MyUsage> {
  const { data, error } = await supabase.rpc('my_usage_status');
  if (error) {
    // PostgREST's "function not found" (PGRST202) or Postgres's 42883.
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(error.message)) {
      throw new Error('Usage isn’t set up yet: re-run supabase/schema.sql.');
    }
    throw new Error(`Couldn’t load your usage: ${error.message}`);
  }
  const d = data as { limits: Partial<Limits>; used: UsedNumbers; now?: string };
  return { limits: pickLimits(d.limits), used: d.used, now: d.now ? new Date(d.now) : new Date() };
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

// One business's AI images, newest first (§136), for the super admin to
// review on the Usage page. The files are public; the LIST is the guarded
// part (admin_business_renders checks is_super_admin()).
export interface AdminRender {
  id: string;
  createdAt: string;
  cameraLabel: string | null;
  styling: string | null;
  model: string | null;
  imageUrl: string;
  clientName: string | null;
  designName: string | null;
}

export async function fetchBusinessRenders(businessId: string): Promise<AdminRender[]> {
  const { data, error } = await supabase.rpc('admin_business_renders', { p_business: businessId });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) {
      throw new Error('Not set up yet: re-run supabase/schema.sql.');
    }
    throw new Error(`Couldn’t load the images: ${error.message}`);
  }
  return (
    data as {
      id: string;
      created_at: string;
      camera_label: string | null;
      styling: string | null;
      model: string | null;
      image_url: string;
      client_name: string | null;
      design_name: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    cameraLabel: r.camera_label,
    styling: r.styling,
    model: r.model,
    imageUrl: r.image_url,
    clientName: r.client_name,
    designName: r.design_name,
  }));
}
