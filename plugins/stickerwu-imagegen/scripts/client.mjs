import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectPng, pngDimensions } from './image-info.mjs';
import { normalizeOptions, MODELS, SUPPORTED_MODELS } from '../ui/image-options.mjs';
import { imageType } from './formats.mjs';
import { imageEvents } from './stream.mjs';
export { MODELS, SUPPORTED_MODELS };
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
async function fileBlob(path) {
  const bytes = await readFile(path);
  if (bytes.length > 50 * 1024 * 1024) throw new Error('Input image exceeds 50 MiB.');
  const type = imageType(bytes);
  if (!['png','jpeg','webp'].includes(type)) throw new Error('Input image must be a still PNG, JPEG or WebP; GIF/SVG are output only.');
  return new Blob([bytes], { type: `image/${type}` });
}
export async function requestImages({
  apiKey, baseUrl, mode = 'generate', model = 'sunburst', prompt, images = [], mask, markup,
  size, quality, complexity, background, outputFormat, frameCount, frameDurationMs,
  outputCompression, stream, partialImages, onProgress = () => {},
  n = 1, outputDir = 'outputs', timeout = 300000, fetchImpl = fetch, signal,
} = {}) {
  signal?.throwIfAborted();
  if (!apiKey) throw new Error('Configure a key for this endpoint or set STICKERWU_IMAGEGEN_API_KEY (legacy VVVCODE_API_KEY) before making a request.');
  if (!['generate', 'edit'].includes(mode)) throw new Error('Mode must be generate or edit.');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required.');
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error('Count must be 1 to 4.');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 1800000) throw new Error('Timeout must be 1000–1800000 ms.');
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  if (mode === 'edit' && (!images.length || images.length > 10)) throw new Error('Edit requires 1–10 source images.');
  if (mode === 'generate' && (images.length || mask || markup)) throw new Error('Images, mask and markup require edit mode.');
  if (markup && mask) throw new Error('Do not combine markup with mask.');
  ({model,size,quality,complexity,background,outputFormat,outputCompression,stream,partialImages,frameCount,frameDurationMs}
    = normalizeOptions({model,mode,n,mask,markup,size,quality,complexity,background,outputFormat,
      outputCompression,stream,partialImages,frameCount,frameDurationMs}));
  if (markup) {
    const overlay = await readFile(markup);
    const info = inspectPng(overlay);
    if (overlay.length > 50 * 1024 * 1024 || info.width * info.height > 16777216) throw new Error('Markup exceeds PNG size limits.');
    if (!info.transparencyVerified || !(info.transparentPixels + info.translucentPixels > 0)) throw new Error('Markup must be a transparent PNG containing transparent pixels.');
    const source = await readFile(images[0]);
    if (imageType(source) === 'png') {
      const first = pngDimensions(source);
      if (first.width !== info.width || first.height !== info.height) throw new Error('Markup dimensions must match the first image.');
      if (first.width * first.height > 16777216) throw new Error('First image exceeds markup pixel limit.');
    }
    // For oriented JPEG/WebP inputs, the provider validates dimensions after orientation.
  }
  const headers = { Authorization: `Bearer ${apiKey}` };
  const fields = { model, prompt, n, size, ...(quality ? { quality } : {}),
    ...(complexity ? { complexity } : {}),
    ...(background ? { background } : {}), ...(outputFormat ? { output_format: outputFormat } : {}),
    ...(frameCount !== undefined ? { frame_count: frameCount } : {}),
    ...(frameDurationMs !== undefined ? { frame_duration_ms: frameDurationMs } : {}),
    ...(outputCompression !== undefined ? { output_compression: outputCompression } : {}),
    ...(stream !== undefined ? {stream} : {}),
    ...(partialImages !== undefined ? {partial_images:partialImages} : {}) };
  let body;
  if (mode === 'edit') {
    body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
    for (const path of images) body.append(images.length === 1 ? 'image' : 'image[]', await fileBlob(path), basename(path));
    if (mask) body.append('mask', await fileBlob(mask), basename(mask));
    if (markup) body.append('markup', await fileBlob(markup), basename(markup));
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(fields);
  }
  const endpoint = `${normalizeBase(baseUrl)}/images/${mode === 'edit' ? 'edits' : 'generations'}`;
  try {
    // No automatic retries: a timeout may still have incurred a charge upstream.
    requestSignal.throwIfAborted();
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers, body, signal: requestSignal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`);
    let payload;
    if(stream) {
      if(!response.headers.get('content-type')?.includes('text/event-stream'))
        throw new Error('Requested streaming but provider did not return text/event-stream.');
      const data=[], prefix=mode==='edit'?'image_edit':'image_generation';
      let partials=0;
      for await(const event of imageEvents(response, { signal: requestSignal })) {
        requestSignal.throwIfAborted();
        if(event.type==='error' || event.error)throw new Error(event.error?.message || event.message || 'Image stream failed.');
        if(event.type===`${prefix}.partial_image`) {
          if(++partials>3 || !event.b64_json)throw new Error('Invalid partial image event.');
          const bytes=Buffer.from(event.b64_json,'base64'),ext=imageType(bytes);
          if(!['png','jpeg','webp'].includes(ext))throw new Error('Invalid preview format.');
          await mkdir(outputDir,{recursive:true});
          const file=resolve(outputDir,`preview-${randomUUID()}.${ext}`);
          await writeFile(file,bytes,{flag:'wx'});
          await onProgress({event:'partial_image',index:event.partial_image_index,file,format:ext});
        } else if(event.type===`${prefix}.completed`) {
          if(!event.b64_json)throw new Error('Completed event has no image data.');
          data.push(event);
        }
      }
      if(data.length!==n)throw new Error('Image stream ended without the expected completed event(s); previews are not final results.');
      payload={data};
    } else payload = await response.json();
    if (!Array.isArray(payload.data) || !payload.data.length) throw new Error('API returned no image data.');
    const buffers = [];
    for (const item of payload.data) {
      let bytes;
      if (item.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
      else if (item.url) {
        const url = new URL(item.url);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Image URL must use HTTPS.');
        // Never forward the provider key to a result CDN.
        requestSignal.throwIfAborted();
        const download = await fetchImpl(url.href, { signal: requestSignal, redirect: 'error' });
        if (!download.ok) throw new Error(`Image download HTTP ${download.status}`);
        bytes = Buffer.from(await download.arrayBuffer());
      } else throw new Error('Result has neither b64_json nor url.');
      const ext = imageType(bytes);
      if (outputFormat && ext !== outputFormat) {
        await mkdir(outputDir,{recursive:true});
        const evidence=resolve(outputDir,`unexpected-${randomUUID()}.${ext}`);
        await writeFile(evidence,bytes,{flag:'wx'});
        throw new Error(`Requested ${outputFormat} but provider returned ${ext}; original saved for inspection: ${evidence}. No conversion, success claim or retry.`);
      }
      buffers.push({ bytes, ext });
    }
    requestSignal.throwIfAborted();
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
