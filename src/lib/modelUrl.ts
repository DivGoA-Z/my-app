// src/lib/modelUrl.ts
//
// One rule for a 3D model address (appliance and light-fixture catalogue
// rows, typed in an edit panel or an Excel sheet). Added after a chimney
// row saved as '/models/range-hood.glb.' — one stray full stop. That
// address doesn't exist, so the server answered with the app's own web
// page, the loader failed on '<!doctype', and the chimney quietly fell
// back to a plain box (§109). Refusing it at the door is better than a
// model that silently never appears.

// Null when fine (including empty: no model, a plain box).
export function modelUrlProblem(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.trim() !== url) return 'Remove the space at the start or end of the model address.';
  const path = url.split(/[?#]/)[0];
  if (!/\.(glb|gltf)$/i.test(path)) {
    return 'A model address must end in .glb or .gltf. Check for a stray character after it.';
  }
  return null;
}
