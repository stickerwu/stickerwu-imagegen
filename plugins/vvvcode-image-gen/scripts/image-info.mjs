import { inflateSync } from 'node:zlib';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
export function pngDimensions(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) throw new Error('Expected a PNG image.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
export function resolutionSize(resolution, ratio = 1) {
  const edge = { '1K': 1024, '2K': 2048, '4K': 4096 }[resolution.toUpperCase()];
  if (!edge) throw new Error('Resolution must be 1K, 2K or 4K.');
  if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 10) throw new Error('Unsupported aspect ratio.');
  const short = Math.max(16, Math.round((ratio >= 1 ? edge / ratio : edge * ratio) / 16) * 16);
  return ratio >= 1 ? `${edge}x${short}` : `${short}x${edge}`;
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function inspectPng(bytes) {
  const info = pngDimensions(bytes);
  const depth = bytes[24], colorType = bytes[25], interlace = bytes[28];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const compressed = [];
  let trns;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG chunk.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'tRNS') trns = bytes.subarray(offset + 8, end - 4);
    offset = end;
    if (type === 'IEND') break;
  }
  const hasAlpha = colorType === 4 || colorType === 6 || Boolean(trns);
  Object.assign(info, { colorType, bitDepth: depth, hasAlpha });
  if (!hasAlpha) return { ...info, transparencyVerified: true, transparentPixels: 0, translucentPixels: 0 };
  if (depth !== 8 || interlace !== 0 || !channels)
    return { ...info, transparencyVerified: false, reason: 'Only non-interlaced 8-bit alpha decoding is supported.' };
  const stride = info.width * channels, expected = (stride + 1) * info.height;
  if (expected > 128 * 1024 * 1024) return { ...info, transparencyVerified: false, reason: 'PNG exceeds inspection memory limit.' };
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error('Invalid PNG scanline length.');
  let previous = Buffer.alloc(stride), transparentPixels = 0, translucentPixels = 0;
  for (let y = 0; y < info.height; y++) {
    const offset = y * (stride + 1), filter = raw[offset], row = Buffer.from(raw.subarray(offset + 1, offset + 1 + stride));
    if (filter > 4) throw new Error('Invalid PNG filter.');
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      row[x] = (row[x] + predictor) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      let alpha = 255;
      if (colorType === 6 || colorType === 4) alpha = row[x + channels - 1];
      else if (colorType === 3) alpha = trns?.[row[x]] ?? 255;
      else if (colorType === 0 && trns?.length >= 2 && row[x] === trns.readUInt16BE(0)) alpha = 0;
      else if (colorType === 2 && trns?.length >= 6 && row[x] === trns.readUInt16BE(0) && row[x + 1] === trns.readUInt16BE(2) && row[x + 2] === trns.readUInt16BE(4)) alpha = 0;
      if (alpha === 0) transparentPixels++;
      else if (alpha < 255) translucentPixels++;
    }
    previous = row;
  }
  return { ...info, transparencyVerified: true, transparentPixels, translucentPixels };
}
