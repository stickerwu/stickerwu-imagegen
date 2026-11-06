import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { inspectPng, resolutionSize } from '../plugins/vvvcode-image-gen/scripts/image-info.mjs';

function chunk(type, payload) {
  const body = Buffer.concat([Buffer.from(type), payload]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(payload.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, body, tail]);
}
function image(type, rows, width = 2, height = 1) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = type;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}
test('resolution uses explicit long-edge convention and source aspect ratio', () => {
  assert.equal(resolutionSize('1K', 3 / 4), '768x1024');
  assert.equal(resolutionSize('2k', 3 / 4), '1536x2048');
  assert.equal(resolutionSize('4K', 3 / 4), '2480x3312');
  assert.equal(resolutionSize('4K', 1), '2880x2880');
  assert.equal(resolutionSize('4K', 16 / 9), '3840x2160');
  assert.throws(() => resolutionSize('8K'));
  assert.throws(() => resolutionSize('1K', Infinity));
});
test('RGB checkerboard is opaque, not transparent', () => {
  const result = inspectPng(image(2, [0, 255,255,255, 200,200,200]));
  assert.equal(result.hasAlpha, false);
  assert.equal(result.transparentPixels, 0);
});
test('RGBA measures actual zero and partial alpha', () => {
  const result = inspectPng(image(6, [0, 255,255,255,0, 200,200,200,128]));
  assert.equal(result.hasAlpha, true);
  assert.equal(result.transparentPixels, 1);
  assert.equal(result.translucentPixels, 1);
});
test('RGBA with fully opaque alpha must not count as transparent', () => {
  const result = inspectPng(image(6, [0, 255,255,255,255, 200,200,200,255]));
  assert.equal(result.transparentPixels + result.translucentPixels, 0);
});
test('PNG sub filter is decoded before alpha inspection', () => {
  const result = inspectPng(image(6, [1, 100,100,100,128, 0,0,0,128]));
  assert.equal(result.transparentPixels, 1);
  assert.equal(result.translucentPixels, 1);
});
