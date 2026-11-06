// Original geometric brand icon. Deterministic SVG + antialiased PNG, no extra dependencies.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const destination = new URL('../plugins/vvvcode-image-gen/assets/', import.meta.url);
const shapes = [
  { kind: 'rect', x: 16, y: 16, w: 480, h: 480, r: 96, color: '#F2F4F7' },
  { kind: 'rect', x: 88, y: 112, w: 336, h: 288, r: 40, color: '#222B45' },
  { kind: 'rect', x: 104, y: 128, w: 304, h: 256, r: 24, color: '#FFFFFF' },
  { kind: 'polygon', points: [[104, 328], [202, 244], [278, 316], [330, 268], [408, 332], [408, 360], [104, 360]], color: '#B5D9F4' },
  { kind: 'circle', x: 188, y: 208, r: 29, color: '#0070C0' },
  { kind: 'circle', x: 400, y: 112, r: 60, color: '#F2F4F7' },
  { kind: 'polygon', points: [[400, 56], [415, 97], [456, 112], [415, 127], [400, 168], [385, 127], [344, 112], [385, 97]], color: '#0070C0' },
];
const svgShape = shape => shape.kind === 'rect'
  ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.r}" fill="${shape.color}"/>`
  : shape.kind === 'circle' ? `<circle cx="${shape.x}" cy="${shape.y}" r="${shape.r}" fill="${shape.color}"/>`
    : `<polygon points="${shape.points.map(point => point.join(',')).join(' ')}" fill="${shape.color}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="stickerwu imagegen">\n${shapes.map(svgShape).join('\n')}\n</svg>\n`;
function contains(shape, x, y) {
  if (shape.kind === 'circle') return (x - shape.x) ** 2 + (y - shape.y) ** 2 <= shape.r ** 2;
  if (shape.kind === 'rect') {
    const cx = Math.max(shape.x + shape.r, Math.min(x, shape.x + shape.w - shape.r));
    const cy = Math.max(shape.y + shape.r, Math.min(y, shape.y + shape.h - shape.r));
    return (x - cx) ** 2 + (y - cy) ** 2 <= shape.r ** 2;
  }
  let inside = false;
  for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
    const [xi, yi] = shape.points[i], [xj, yj] = shape.points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const raster = shapes.map(shape => ({ ...shape, rgb: [1, 3, 5].map(offset => parseInt(shape.color.slice(offset, offset + 2), 16)) })).reverse();
const raw = Buffer.alloc(512 * (512 * 4 + 1));
for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
  const sums = [0, 0, 0]; let covered = 0;
  for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
    const shape = raster.find(candidate => contains(candidate, x + dx, y + dy));
    if (shape) { covered++; for (let channel = 0; channel < 3; channel++) sums[channel] += shape.rgb[channel]; }
  }
  const index = y * 2049 + 1 + x * 4;
  if (covered) for (let channel = 0; channel < 3; channel++) raw[index + channel] = Math.round(sums[channel] / covered);
  raw[index + 3] = Math.round(255 * covered / 4);
}
function chunk(type, bytes) {
  const label = Buffer.from(type), content = Buffer.concat([label, bytes]); let crc = 0xFFFFFFFF;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
  return Buffer.concat([head, content, tail]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(512, 0); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
await mkdir(destination, { recursive: true });
await writeFile(new URL('icon.svg', destination), svg);
await writeFile(new URL('icon.png', destination), png);
console.log(JSON.stringify({ icon: '512x512 PNG', bytes: png.length, source: 'original geometric SVG', paidRequests: 0 }));
