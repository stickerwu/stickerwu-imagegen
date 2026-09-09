import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MODELS = {
  sunburst: 'gpt-image-2.5-sunburst',
  flare: 'gpt-image-2.5-flare',
};
export function normalizeBase(value = 'https://apis.vvvcode.com/') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Base URL must be HTTPS without credentials, query or fragment.');
  return url.href.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
}
export function safeError(error, key = '') {
  let message = String(error?.message || error);
  if (key) message = message.split(key).join('[REDACTED]');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 1000);
}
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('Expected PNG, JPEG or WebP image bytes.');
}
async function fileBlob(path) {
  const bytes = await readFile(path);
  if (bytes.length > 50 * 1024 * 1024) throw new Error('Input image exceeds 50 MiB.');
  return new Blob([bytes], { type: `image/${imageType(bytes)}` });
}
export async function requestImages({
  apiKey, baseUrl, mode = 'generate', model = 'sunburst', prompt, images = [], mask,
  size, quality, n = 1, outputDir = 'outputs', timeout = 300000, fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error('Set VVVCODE_API_KEY before making a request.');
  if (!['generate', 'edit'].includes(mode)) throw new Error('Mode must be generate or edit.');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required.');
  model = MODELS[model] || model;
  if (!Object.values(MODELS).includes(model)) throw new Error('Model must be flare or sunburst.');
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error('Count must be 1 to 4.');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 1800000) throw new Error('Timeout must be 1000–1800000 ms.');
  if (mode === 'edit' && (!images.length || images.length > 10)) throw new Error('Edit requires 1–10 source images.');
  if (mode === 'generate' && (images.length || mask)) throw new Error('Images and mask require edit mode.');
  size ??= mode === 'edit' ? 'auto' : '1024x1024';
  if (size !== 'auto' && !/^[1-9]\d{1,4}x[1-9]\d{1,4}$/.test(size)) throw new Error('Size must be auto or WIDTHxHEIGHT.');
  const headers = { Authorization: `Bearer ${apiKey}` };
  const fields = { model, prompt, n, size, ...(quality ? { quality } : {}) };
  let body;
  if (mode === 'edit') {
    body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
    for (const path of images) body.append(images.length === 1 ? 'image' : 'image[]', await fileBlob(path), basename(path));
    if (mask) body.append('mask', await fileBlob(mask), basename(mask));
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(fields);
  }
  const endpoint = `${normalizeBase(baseUrl)}/images/${mode === 'edit' ? 'edits' : 'generations'}`;
  try {
    // No automatic retries: a timeout may still have incurred a charge upstream.
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers, body, signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`);
    const payload = await response.json();
    if (!Array.isArray(payload.data) || !payload.data.length) throw new Error('API returned no image data.');
    const buffers = [];
    for (const item of payload.data) {
      let bytes;
      if (item.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
      else if (item.url) {
        const url = new URL(item.url);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Image URL must use HTTPS.');
        // Never forward the provider key to a result CDN.
        const download = await fetchImpl(url.href, { signal: AbortSignal.timeout(timeout), redirect: 'error' });
        if (!download.ok) throw new Error(`Image download HTTP ${download.status}`);
        bytes = Buffer.from(await download.arrayBuffer());
      } else throw new Error('Result has neither b64_json nor url.');
      buffers.push({ bytes, ext: imageType(bytes) });
    }
    await mkdir(outputDir, { recursive: true });
    const paths = [];
    for (const { bytes, ext } of buffers) {
      const path = resolve(outputDir, `${mode}-${randomUUID()}.${ext}`);
      await writeFile(path, bytes, { flag: 'wx' });
      paths.push(path);
    }
    return paths;
  } catch (error) {
    throw new Error(safeError(error, apiKey));
  }
}
