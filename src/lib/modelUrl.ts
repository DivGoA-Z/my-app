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
  if (/^\/?public\//.test(path)) {
    return 'Leave out "public/": files in the public folder are served from the site root, e.g. /models/appliances/sink.glb.';
  }
  if (!/\.(glb|gltf)$/i.test(path)) {
    return 'A model address must end in .glb or .gltf. Check for a stray character after it.';
  }
  return null;
}

// Files in public/ are served from the site ROOT (/models/x.glb), but a
// catalogue row typed as "public/models/x.glb" or "/public/models/x.glb"
// asked for a path that doesn't exist: the dev server answers with the
// app's HTML page, the model fails to parse, and a plain box is drawn.
// That's how the double sink became two white boxes (§124). Loading goes
// through this, so rows already saved that way still work; the catalogue
// form flags them (modelUrlProblem) so new ones are typed right.
export function servedModelUrl(url: string): string {
  return url.replace(/^\/?public\//, '/');
}
