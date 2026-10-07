// src/lib/svgToPng.ts
//
// Rasterises an SVG string (lib/elevationSheet.ts) to a PNG Blob in the
// browser: SVG → <img> → <canvas> → PNG. `scale` renders at a multiple
// of the SVG's own size, because image models are given the PNG and thin
// lines at 1× blur into the background. The SVG must be self-contained
// (no external fonts or images), or the browser draws it without them.

export async function svgToPng(svg: string, widthPx: number, heightPx: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The elevation drawing could not be rendered.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(widthPx * scale);
    canvas.height = Math.round(heightPx * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas available.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
