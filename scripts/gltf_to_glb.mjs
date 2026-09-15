#!/usr/bin/env node
// scripts/gltf_to_glb.mjs
//
// Packs a text .gltf + its external .bin + external images into a
// single self-contained .glb. Poly Haven ships models as separate
// .gltf/.bin/textures/*.jpg; this project's README (public/models/
// README.md) prefers .glb specifically because a multi-file .gltf
// breaks the moment any of its relative paths move, which is exactly
// what happens once a script drops these into public/models/.
//
// Pure Node + fs, no three.js — a straight binary-embed transform,
// not a re-export, so nothing about geometry or materials changes.
//
// USAGE
//   node scripts/gltf_to_glb.mjs <input.gltf> <output.glb>
// The .gltf's buffers[].uri and images[].uri are resolved relative to
// the .gltf's own directory.

import fs from 'fs';
import path from 'path';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('usage: node gltf_to_glb.mjs <input.gltf> <output.glb>');
  process.exit(1);
}

const baseDir = path.dirname(path.resolve(inputPath));
const gltf = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// glTF spec: the BIN chunk pads with 0x00, but the JSON chunk MUST pad
// with 0x20 (space) — it's still parsed as text, and a null byte is not
// valid JSON whitespace, so padding it with zeros breaks JSON.parse on
// load (silently produces a truncated/garbled trailing-bytes error).
function pad4(buf, fill = 0x00) {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

// ---- Embed every external buffer into one binary chunk ----
// Each buffer becomes a bufferView-aligned slice of one concatenated
// blob; buffers[].uri is removed (glTF: absent uri => glb-embedded,
// bufferView 0 implicitly refers to the glb BIN chunk when byteLength
// matches — but to keep this simple and robust across viewers, every
// buffer is remapped onto ONE buffer (index 0) referencing the BIN
// chunk, and every bufferView.buffer is rewritten to 0 with adjusted
// offsets.

const originalBuffers = gltf.buffers || [];
const bufferBytes = originalBuffers.map((buf) => {
  if (buf.uri.startsWith('data:')) {
    const base64 = buf.uri.split(',')[1];
    return Buffer.from(base64, 'base64');
  }
  return fs.readFileSync(path.join(baseDir, decodeURIComponent(buf.uri)));
});

const bufferOffsets = [];
let cursor = 0;
const concatenated = [];
for (const bytes of bufferBytes) {
  const padded = pad4(bytes);
  bufferOffsets.push(cursor);
  concatenated.push(padded);
  cursor += padded.length;
}

// ---- Embed every external image as a bufferView too ----
const images = gltf.images || [];
const imageBufferViewIndices = [];
for (const image of images) {
  if (image.uri && !image.uri.startsWith('data:')) {
    const bytes = fs.readFileSync(path.join(baseDir, decodeURIComponent(image.uri)));
    const padded = pad4(bytes);
    const offset = cursor;
    concatenated.push(padded);
    cursor += padded.length;
    imageBufferViewIndices.push({ image, offset, length: bytes.length });
  }
}

const binChunk = Buffer.concat(concatenated);

// Rewrite bufferViews: each originally pointed at buffers[N] with some
// byteOffset; now everything lives in buffer 0 at bufferOffsets[N] + that.
for (const view of gltf.bufferViews || []) {
  const originalBufferIndex = view.buffer;
  view.buffer = 0;
  view.byteOffset = (bufferOffsets[originalBufferIndex] || 0) + (view.byteOffset || 0);
}

let nextBufferViewIndex = (gltf.bufferViews || []).length;
gltf.bufferViews = gltf.bufferViews || [];

for (const { image, offset, length } of imageBufferViewIndices) {
  gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: length });
  image.bufferView = nextBufferViewIndex++;
  image.mimeType = image.mimeType || 'image/jpeg';
  delete image.uri;
}

gltf.buffers = [{ byteLength: binChunk.length }];

// ---- Assemble the .glb ----
const jsonBuf = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
const totalLength = 12 + 8 + jsonBuf.length + 8 + binChunk.length;
header.writeUInt32LE(totalLength, 8);

const jsonChunkHeader = Buffer.alloc(8);
jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

const binChunkHeader = Buffer.alloc(8);
binChunkHeader.writeUInt32LE(binChunk.length, 0);
binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

const glb = Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binChunk]);
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, glb);
console.log(`wrote ${outputPath} (${(glb.length / 1024).toFixed(0)} KB)`);
