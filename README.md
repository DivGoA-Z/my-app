# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
-------------------------------------------------------



# 3D models

Drop `.glb` files here and point an appliance's **3D Model** field at
them (Manage Inventory → Appliances), e.g. `/models/hob-600.glb`.

Anything in `public/` is served by Vite at the matching path, so
`public/models/hob-600.glb` is reachable as `/models/hob-600.glb`.

## Where to get them

All CC0 / permissively licensed:

- **Poly Haven** — https://polyhaven.com/models
- **Khronos glTF Sample Assets** — https://github.com/KhronosGroup/glTF-Sample-Assets
- **Sketchfab** — filter by CC0 or CC-BY (CC-BY needs attribution)

Prefer `.glb` (single self-contained file) over `.gltf` (which
references external textures by relative path and is easy to break when
moving files).

## What the renderer does for you

`src/components/canvas3d/ApplianceModel.tsx` measures each model's
bounding box and scales it to the width/depth/height stored on the
appliance, then sits its base on the appliance's elevation. So a model
does **not** need to arrive at real-world scale or be centred on its
origin — those are normalised automatically.

Two consequences worth knowing:

- Scaling is **per-axis**, so the model occupies exactly the box the
  quote was priced against. If a model looks stretched, its proportions
  differ from the appliance's stored dimensions — fix the dimensions,
  since those are what the client is being charged for.
- A model that fails to load falls back to the plain box and logs a
  warning. It won't blank the 3D view.

## Keep them light

These load in the browser, often on mobile over mobile data. Aim for
low-poly assets under a couple of MB each. Draco-compressed files are
**not** currently supported — the loader has no decoder configured.
