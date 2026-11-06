// Pure shared validation: usable unchanged in the browser and Node.js.
export const MODELS = { sunburst:'gpt-image-2.6-sunburst', flare:'gpt-image-2.6-flare' };
export const SUPPORTED_MODELS = [...Object.values(MODELS),'gpt-image-2.5-sunburst','gpt-image-2.5-flare'];
export const QUALITIES = ['auto','low','medium','high','xhigh','max'];
export const OPTION_KEYS = ['model','size','quality','complexity','background','outputFormat',
  'outputCompression','stream','partialImages','frameCount','frameDurationMs'];
const fail = message => { throw new Error(message); };
export function normalizeOptions(input = {}) {
  const { mode='generate', n=1, mask, markup } = input;
  const value = Object.fromEntries(OPTION_KEYS.filter(key => input[key] !== undefined).map(key => [key,input[key]]));
  value.model = MODELS[input.model || 'sunburst'] || input.model;
  if (!SUPPORTED_MODELS.includes(value.model)) fail('Unknown model.');
  const format = value.outputFormat || 'png';
  if (!['png','jpeg','webp','gif','svg'].includes(format)) fail('Invalid output format.');
  value.size ??= mode === 'edit' || format === 'gif' || format === 'svg' ? 'auto' : '1024x1024';
  if (value.size !== 'auto') {
    if (!/^[1-9]\d{1,4}x[1-9]\d{1,4}$/.test(value.size)) fail('Size must be auto or WIDTHxHEIGHT.');
    const [w,h] = value.size.split('x').map(Number);
    if (w % 16 || h % 16) fail('Size edges must be divisible by 16.');
    if (w > 3840 || h > 3840) fail('Size edge must not exceed 3840 pixels.');
    if (w/h < 1/3 || w/h > 3) fail('Size ratio must be 1:3 through 3:1.');
    if (w*h > 8294400 || format !== 'gif' && w*h < 655360) fail('Still size must contain 655360–8294400 pixels.');
  }
  if (value.quality !== undefined && !QUALITIES.includes(value.quality)) fail('Invalid quality.');
  if (value.complexity !== undefined && !['low','medium','high'].includes(value.complexity)) fail('Invalid complexity.');
  if (value.background !== undefined && !['auto','opaque','transparent'].includes(value.background)) fail('Invalid background.');
  if (value.background === 'transparent' && !['png','webp','svg'].includes(format)) fail('Transparent output requires PNG, WebP or SVG.');
  if (value.outputCompression !== undefined && (!['jpeg','webp'].includes(format) ||
    !Number.isInteger(value.outputCompression) || value.outputCompression < 0 || value.outputCompression > 100))
    fail('Output compression requires JPEG/WebP and an integer 0–100.');
  if (value.stream !== undefined && typeof value.stream !== 'boolean') fail('Stream must be boolean.');
  if (value.partialImages !== undefined && (!Number.isInteger(value.partialImages) || value.partialImages < 0 ||
    value.partialImages > 3 || !value.stream)) fail('Partial images require stream=true and an integer 0–3.');
  if (format !== 'gif' && (value.frameCount !== undefined || value.frameDurationMs !== undefined)) fail('Frame options require GIF output.');
  if (['gif','svg'].includes(format)) {
    if (!value.model.startsWith('gpt-image-2.6-')) fail(`${format.toUpperCase()} output requires a 2.6 model.`);
    if (mask || value.stream || value.partialImages !== undefined || value.outputCompression !== undefined)
      fail(`${format.toUpperCase()} does not support mask, streaming, partial images or compression.`);
  }
  if (format === 'svg' && (mode !== 'generate' || n !== 1 || markup)) fail('SVG requires generations, n=1, without input images or markup.');
  if (format === 'gif') {
    if (value.frameCount !== undefined && (!Number.isInteger(value.frameCount) || value.frameCount < 2 || value.frameCount > 16)) fail('GIF frame count must be 2–16.');
    if (value.frameDurationMs !== undefined && (!Number.isInteger(value.frameDurationMs) || value.frameDurationMs < 20 || value.frameDurationMs > 2000)) fail('GIF frame duration must be 20–2000 ms.');
  }
  return value;
}
export function resolutionSize(resolution, ratio = 1) {
  const edge = {'1K':1024,'2K':2048,'4K':3840}[String(resolution).toUpperCase()];
  if (!edge) fail('Resolution must be 1K, 2K or 4K.');
  if (!Number.isFinite(ratio) || ratio < 1/3 || ratio > 3) fail('Unsupported aspect ratio; use 1:3 through 3:1.');
  let w=ratio>=1?edge:edge*ratio, h=ratio>=1?edge/ratio:edge;
  const scale=Math.min(1,Math.sqrt(8294400/(w*h)));
  w=Math.floor(w*scale/16)*16; h=Math.floor(h*scale/16)*16;
  // Keep the documented still minimum, including narrow 1K ratios.
  if(w*h<655360) {
    const grow=Math.sqrt(655360/(w*h));
    w=Math.ceil(w*grow/16)*16; h=Math.ceil(h*grow/16)*16;
  }
  // Rounding must not push a boundary ratio beyond 3:1.
  if(w>h*3) h=Math.ceil(w/3/16)*16;
  if(h>w*3) w=Math.ceil(h/3/16)*16;
  return `${w}x${h}`;
}
