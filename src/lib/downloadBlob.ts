// src/lib/downloadBlob.ts
//
// Triggers a browser download of an in-memory Blob with no server
// round trip — a temporary, never-appended <a download> click.
// Originally written for the quote PDF (QuoteFreezePanel.tsx);
// promoted here once the cabinet catalogue's Excel export needed the
// exact same thing, rather than a second copy.

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
