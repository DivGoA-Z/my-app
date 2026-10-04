// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generateQuotePdfBlob } from './quotePdf';
import { fitLogo, LOGO_BOX_PT, type PdfBranding } from './pdfAssets';
import { calculateBOM } from './bom';
import { baseUnit, pricing } from '../test/fixtures';
import type { FrozenQuote } from '../types/quote';
import type { CustomerProject } from '../types/customer';

// 1×1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const quote = {
  id: 'q1',
  projectId: 'p1',
  version: 2,
  summary: calculateBOM([baseUnit()], [], pricing()),
  pricingContext: {},
  grandTotal: 0,
  frozenAt: '2026-10-04T10:00:00Z',
} as unknown as FrozenQuote;
const project = { id: 'p1', clientName: 'Asha Rao', phone: '+91 90000 00000', address: 'B-12', locality: 'Rohini', status: 'Lead' } as CustomerProject;

// Built-in font (fonts: null) keeps the PDF's text searchable as plain
// strings, which is what lets these tests read the header back.
const brand = (extra: Partial<PdfBranding> = {}): PdfBranding => ({ name: 'Sharma Modular Kitchens', phone: '+91 98765 43210', gstin: '', logo: null, fonts: null, ...extra });
const pdfText = async (b: PdfBranding) => new TextDecoder('latin1').decode(await generateQuotePdfBlob(quote, project, b).arrayBuffer());

describe('quote PDF header (§94)', () => {
  it('prints the business name and phone from the business record', async () => {
    const t = await pdfText(brand());
    expect(t).toContain('(Sharma Modular Kitchens)');
    expect(t).toContain('(+91 98765 43210)');
  });

  it('prints the GSTIN only when given (the business ticked it)', async () => {
    expect(await pdfText(brand({ gstin: '27AAPFU0939F1ZV' }))).toContain('(GSTIN 27AAPFU0939F1ZV)');
    expect(await pdfText(brand())).not.toContain('GSTIN');
  });

  it('draws the logo when there is one', async () => {
    const t = await pdfText(brand({ logo: { dataUrl: PNG, widthPx: 1, heightPx: 1 } }));
    expect(t).toContain('/Subtype /Image');
    expect(t).toContain('(Sharma Modular Kitchens)');
  });

  it('without the embedded font, amounts fall back to "Rs." rather than a wrong glyph', async () => {
    expect(await pdfText(brand())).toMatch(/\(Rs\. [0-9,]+\)/);
  });
});

describe('fitLogo (§94)', () => {
  it('fits a wide logo to the box width, keeping its shape', () => {
    expect(fitLogo(600, 150)).toEqual({ width: 120, height: 30 });
  });
  it('fits a tall logo to the box height', () => {
    expect(fitLogo(200, 200)).toEqual({ width: LOGO_BOX_PT.height, height: LOGO_BOX_PT.height });
  });
});
