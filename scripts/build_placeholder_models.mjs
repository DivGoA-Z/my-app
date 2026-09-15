#!/usr/bin/env node
// scripts/build_placeholder_models.mjs
//
// Generates simple box-based placeholder .glb meshes for appliance
// slots that have no suitable real CC0 model from ambientCG/Poly
// Haven/Khronos (the three sources this pipeline is restricted to —
// no Sketchfab, per the no-login/no-captcha sourcing constraint).
//
// Each placeholder is a small stack of boxes shaped roughly like the
// real appliance (a hob is a slab with raised burner rings; an oven
// is a body + a darker glass-look door panel) so it reads as the
// right kind of object in the 3D view rather than a featureless cube,
// while staying at a handful of triangles — the opposite failure mode
// from a 200k-tri "real" model that stutters on a phone.
//
// Placeholders are a fallback of last resort, not a substitute for
// real assets: swap any of these out the moment a matching CC0 .glb
// turns up on ambientCG/Poly Haven/Khronos.
//
// Pure Node + fs. No three.js (see scripts/gltf_to_glb.mjs's sibling
// note: THREE.GLTFExporter needs browser globals — Image/FileReader/
// canvas — that don't reliably exist under plain Node, so this writes
// the glTF JSON + binary buffer by hand instead).

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'public', 'models');

// ---- Minimal box-mesh glTF builder ----
// Each "box" is { center: [x,y,z], size: [w,h,d], color: [r,g,b,a], metalness, roughness }.
// All boxes share one glTF buffer; each gets its own material (small
// part counts here, so per-box materials are simpler than an atlas).

function boxPositionsAndNormals(center, size) {
  const [cx, cy, cz] = center;
  const [w, h, d] = size.map((s) => s / 2);
  // 24 verts (4 per face, unshared, so normals are flat per-face) — a
  // deliberate trade vs. 8 shared verts: flat shading reads as a clean
  // manufactured box rather than a faceted blob, and 24 verts is still
  // nothing at this scale.
  const faces = [
    // [normal, 4 corners]
    [[0, 0, -1], [-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d]], // back
    [[0, 0, 1], [-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]], // front
    [[-1, 0, 0], [-w, -h, -d], [-w, -h, d], [-w, h, d], [-w, h, -d]], // left
    [[1, 0, 0], [w, -h, -d], [w, -h, d], [w, h, d], [w, h, -d]], // right
    [[0, 1, 0], [-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d]], // top
    [[0, -1, 0], [-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d]], // bottom
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  let vi = 0;
  for (const [n, ...corners] of faces) {
    for (const c of corners) positions.push(c[0] + cx, c[1] + cy, c[2] + cz);
    for (let i = 0; i < 4; i++) normals.push(...n);
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  }
  return { positions, normals, indices };
}

function pad4(buf, fill = 0x00) {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

function buildGlb(boxes) {
  const bufferChunks = [];
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const materials = [];
  let cursor = 0;

  function pushBufferView(typedArray, target) {
    const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const padded = pad4(buf);
    const view = { buffer: 0, byteOffset: cursor, byteLength: buf.length, target };
    bufferViews.push(view);
    bufferChunks.push(padded);
    cursor += padded.length;
    return bufferViews.length - 1;
  }

  boxes.forEach((box, i) => {
    const { positions, normals, indices } = boxPositionsAndNormals(box.center, box.size);
    const posArr = new Float32Array(positions);
    const normArr = new Float32Array(normals);
    const idxArr = new Uint16Array(indices);

    const posView = pushBufferView(posArr, 34962);
    const normView = pushBufferView(normArr, 34962);
    const idxView = pushBufferView(idxArr, 34963);

    const xs = positions.filter((_, idx) => idx % 3 === 0);
    const ys = positions.filter((_, idx) => idx % 3 === 1);
    const zs = positions.filter((_, idx) => idx % 3 === 2);

    const posAccessor = accessors.length;
    accessors.push({
      bufferView: posView, componentType: 5126, count: posArr.length / 3, type: 'VEC3',
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    });
    const normAccessor = accessors.length;
    accessors.push({ bufferView: normView, componentType: 5126, count: normArr.length / 3, type: 'VEC3' });
    const idxAccessor = accessors.length;
    accessors.push({ bufferView: idxView, componentType: 5123, count: idxArr.length, type: 'SCALAR' });

    materials.push({
      name: box.name || `part_${i}`,
      pbrMetallicRoughness: {
        baseColorFactor: box.color || [0.6, 0.6, 0.6, 1],
        metallicFactor: box.metalness ?? 0.1,
        roughnessFactor: box.roughness ?? 0.6,
      },
    });

    meshes.push({
      name: box.name || `part_${i}`,
      primitives: [{
        attributes: { POSITION: posAccessor, NORMAL: normAccessor },
        indices: idxAccessor,
        material: i,
      }],
    });

    nodes.push({ mesh: i, name: box.name || `part_${i}` });
  });

  const bin = Buffer.concat(bufferChunks);

  const gltf = {
    asset: { version: '2.0', generator: 'kitchen-app placeholder mesh writer' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };

  const jsonBuf = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  const totalLength = 12 + 8 + jsonBuf.length + 8 + bin.length;
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(bin.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, bin]);
}

// ---- Appliance shapes ----
// Units are metres, centered on X/Z=0, Y=0 at the base (feet on floor)
// — matches how ApplianceModel.tsx sits a model's bounding box base at
// the placement's elevation, per public/models/README.md.

const STEEL = { color: [0.75, 0.76, 0.78, 1], metalness: 0.8, roughness: 0.35 };
const DARK_GLASS = { color: [0.05, 0.05, 0.06, 1], metalness: 0.2, roughness: 0.15 };
const CAST_IRON = { color: [0.12, 0.12, 0.13, 1], metalness: 0.3, roughness: 0.7 };
const WHITE_ENAMEL = { color: [0.92, 0.92, 0.9, 1], metalness: 0.05, roughness: 0.4 };
const CERAMIC = { color: [0.95, 0.95, 0.95, 1], metalness: 0.05, roughness: 0.5 };

const SHAPES = {
  // 4-burner gas hob: slab body + 4 raised cast-iron trivets.
  'appliances/hob-gas-4burner.glb': (() => {
    const slabH = 0.04;
    const boxes = [
      { name: 'body', center: [0, slabH / 2, 0], size: [0.58, slabH, 0.52], ...STEEL },
    ];
    const trivetSize = [0.16, 0.02, 0.16];
    const positions = [
      [-0.16, -0.13], [0.16, -0.13],
      [-0.16, 0.13], [0.16, 0.13],
    ];
    positions.forEach(([x, z], i) => {
      boxes.push({ name: `trivet_${i}`, center: [x, slabH + 0.01, z], size: trivetSize, ...CAST_IRON });
      boxes.push({ name: `burner_${i}`, center: [x, slabH + 0.005, z], size: [0.06, 0.01, 0.06], ...CAST_IRON });
    });
    return boxes;
  })(),

  // Built-in oven: body + inset glass-front door panel + handle bar.
  'appliances/oven-built-in.glb': (() => {
    const bodyH = 0.58;
    return [
      { name: 'body', center: [0, bodyH / 2, 0], size: [0.56, bodyH, 0.54], ...WHITE_ENAMEL },
      { name: 'door_glass', center: [0, bodyH / 2, 0.271], size: [0.48, bodyH - 0.08, 0.01], ...DARK_GLASS },
      { name: 'handle', center: [0, bodyH - 0.06, 0.29], size: [0.4, 0.02, 0.02], ...STEEL },
      { name: 'control_panel', center: [0, bodyH + 0.02, 0], size: [0.56, 0.04, 0.54], ...WHITE_ENAMEL },
    ];
  })(),

  // Undermount single-bowl sink: basin shell only (fixed under a
  // countertop cutout, so no rim/deck the way a top-mount needs).
  'appliances/sink-undermount-single.glb': (() => {
    const depth = 0.18;
    return [
      { name: 'basin_outer', center: [0, -depth / 2, 0], size: [0.5, depth, 0.4], ...STEEL },
      { name: 'basin_inner', center: [0, -depth / 2 + 0.015, 0], size: [0.46, depth - 0.02, 0.36], color: [0.55, 0.56, 0.58, 1], metalness: 0.85, roughness: 0.25 },
    ];
  })(),

  // Top-mount double-bowl sink: visible deck/rim sitting on the
  // counter, two basins side by side with a center divider.
  'appliances/sink-topmount-double.glb': (() => {
    const depth = 0.16;
    const deckH = 0.02;
    return [
      { name: 'deck', center: [0, deckH / 2, 0], size: [0.86, deckH, 0.46], ...CERAMIC },
      { name: 'basin_left_outer', center: [-0.21, -depth / 2, 0], size: [0.38, depth, 0.36], ...CERAMIC },
      { name: 'basin_right_outer', center: [0.21, -depth / 2, 0], size: [0.38, depth, 0.36], ...CERAMIC },
      { name: 'divider', center: [0, -0.01, 0], size: [0.06, deckH + 0.02, 0.36], ...CERAMIC },
    ];
  })(),
};

let written = 0;
for (const [outRel, boxes] of Object.entries(SHAPES)) {
  const outPath = path.join(MODELS_DIR, outRel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const glb = buildGlb(boxes);
  fs.writeFileSync(outPath, glb);
  console.log(`wrote ${path.relative(PROJECT_ROOT, outPath)} (${(glb.length / 1024).toFixed(1)} KB, ${boxes.length} parts)`);
  written++;
}
console.log(`\n${written} placeholder model(s) written.`);
