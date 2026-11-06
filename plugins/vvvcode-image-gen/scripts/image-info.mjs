import { inflateSync } from 'node:zlib';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
export function pngDimensions(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) throw new Error('Expected a PNG image.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
export function resolutionSize(resolution, ratio = 1) {
  const edge = { '1K': 1024, '2K': 2048, '4K': 3840 }[resolution.toUpperCase()];
  if (!edge) throw new Error('Resolution must be 1K, 2K or 4K.');
  if (!Number.isFinite(ratio) || ratio < 1 / 3 || ratio > 3) throw new Error('Unsupported aspect ratio; use 1:3 through 3:1.');
  let width = ratio >= 1 ? edge : edge * ratio;
  let height = ratio >= 1 ? edge / ratio : edge;
  const scale = Math.min(1, Math.sqrt(8294400 / (width * height)));
  width = Math.max(16, Math.floor(width * scale / 16) * 16);
  height = Math.max(16, Math.floor(height * scale / 16) * 16);
  return `${width}x${height}`;
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

export function inspectGif(bytes) {
  let offset = 13, delay = 0, loopCount = null, trailer = false;
  const requireBytes = count => {
    if (offset + count > bytes.length) throw new Error('Truncated GIF.');
  };
  if (bytes.length < 13 || !/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) throw new Error('Expected a GIF image.');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  if (bytes[10] & 128) offset += 3 * (1 << ((bytes[10] & 7) + 1));
  const frameDurationsMs = [];
  const readBlocks = () => {
    const parts = [];
    for (;;) {
      requireBytes(1);
      const size = bytes[offset++];
      if (size === 0) return Buffer.concat(parts);
      requireBytes(size); parts.push(bytes.subarray(offset, offset + size)); offset += size;
    }
  };
  while (offset < bytes.length) {
    requireBytes(1);
    const block = bytes[offset++];
    if (block === 0x3b) { trailer = true; break; }
    if (block === 0x21) {
      requireBytes(1); const label = bytes[offset++];
      if (label === 0xf9) {
        requireBytes(6);
        if (bytes[offset] !== 4 || bytes[offset + 5] !== 0) throw new Error('Invalid GIF control extension.');
        delay = bytes.readUInt16LE(offset + 2) * 10; offset += 6;
      } else if (label === 0xff) {
        requireBytes(1); const size = bytes[offset++]; requireBytes(size);
        const name = bytes.toString('ascii', offset, offset + size); offset += size;
        const data = readBlocks();
        if (['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(name) && data.length >= 3 && data[0] === 1) loopCount = data.readUInt16LE(1);
      } else readBlocks();
    } else if (block === 0x2c) {
      requireBytes(9); const packed = bytes[offset + 8]; offset += 9;
      if (packed & 128) offset += 3 * (1 << ((packed & 7) + 1));
      requireBytes(1); offset++; readBlocks();
      frameDurationsMs.push(delay); delay = 0;
    } else throw new Error('Invalid GIF block.');
  }
  if (!trailer || !frameDurationsMs.length) throw new Error('Truncated GIF or missing frames.');
  return { format: 'gif', width, height, frameCount: frameDurationsMs.length,
    frameDurationsMs, durationMs: frameDurationsMs.reduce((sum, ms) => sum + ms, 0), loopCount,
    infiniteLoop: loopCount === 0 };
}
