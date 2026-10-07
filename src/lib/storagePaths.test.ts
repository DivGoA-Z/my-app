import { describe, expect, it, vi } from 'vitest';

// The storage client is replaced so nothing reaches Supabase; `removed`
// records what deleteSwatch asked to delete.
const removed: string[][] = [];
vi.mock('./Supabaseclient', () => ({
  supabase: {
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
  },
}));

const { panoramaStoragePath } = await import('./panoramaStorage');
const { quotePdfStoragePath } = await import('./quotePdfStorage');
const { swatchObjectPath, deleteSwatch } = await import('./finishes');

describe('storage paths (§107)', () => {
  it('puts every upload under the business folder, which storage requires', () => {
    expect(panoramaStoragePath('biz_a', 'layout-1', 'cam-1')).toBe('biz_a/layout-1/cam-1.jpg');
    expect(quotePdfStoragePath('biz_a', 'proj-1', 3)).toBe('biz_a/proj-1/v3.pdf');
  });

  it('reads the full object path back from a swatch URL', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/material-swatches/biz_a/finish_1.jpg?v=123';
    expect(swatchObjectPath(url)).toBe('biz_a/finish_1.jpg');
    expect(swatchObjectPath('/textures/wood/color.jpg')).toBeNull();
  });

  it('deletes only a swatch in the business\'s own folder', async () => {
    removed.length = 0;
    const base = 'https://x.supabase.co/storage/v1/object/public/material-swatches/';
    await deleteSwatch('biz_a', `${base}biz_a/f.jpg?v=1`);
    // A starter copy shares the source business's photo; a pre-§107 file
    // has no folder. Neither is this business's to delete.
    await deleteSwatch('biz_a', `${base}biz_default/f.jpg`);
    await deleteSwatch('biz_a', `${base}f.jpg`);
    expect(removed).toEqual([['biz_a/f.jpg']]);
  });
});
