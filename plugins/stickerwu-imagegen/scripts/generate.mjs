#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { requestImages, safeError, MODELS } from './client.mjs';
import { createConfigStore } from './config.mjs';
import { pngDimensions, resolutionSize } from './image-info.mjs';
import { imageMetadata } from './formats.mjs';

let apiKey = process.env.STICKERWU_IMAGEGEN_API_KEY || process.env.VVVCODE_API_KEY || '';
try {
  const { values: flags } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    'get-config': { type: 'boolean' },
    'set-config': { type: 'boolean' },
    profile: { type: 'string' },
    'use-profile': { type: 'string' },
    'list-profiles': { type: 'boolean' },
    'key-stdin': { type: 'boolean' },
    edit: { type: 'boolean' },
    image: { type: 'string', multiple: true },
    mask: { type: 'string' },
    markup: { type: 'string' },
    prompt: { type: 'string' },
    'prompt-file': { type: 'string' },
    model: { type: 'string' },
    size: { type: 'string' },
    resolution: { type: 'string' },
    ratio: { type: 'string' },
    background: { type: 'string' },
    'output-format': { type: 'string' },
    'output-compression': { type:'string' },
    stream: { type:'boolean' },
    'partial-images': { type:'string' },
    quality: { type: 'string' },
    complexity: { type: 'string' },
    'frame-count': { type: 'string' },
    'frame-duration-ms': { type: 'string' },
    count: { type: 'string' },
    timeout: { type: 'string' },
    'base-url': { type: 'string' },
    'output-dir': { type: 'string' },
  } });
  if (flags.help) {
    console.log(`stickerwu imagegen (Node.js 22+)
  --prompt "description" [--model sunburst|flare] [--size 1024x1024]
  --edit --image source.png --prompt "edit instruction" [--mask mask.png]
  --edit --image source.png --markup overlay.png --prompt-file edit.txt
  --prompt-file prompt.txt                    Avoid shell quoting issues
  --image a.png --image b.png --edit ...      Multiple reference images
  --count 1..4 --quality VALUE --timeout 300000 --output-dir outputs
  --background transparent|opaque|auto --output-format png|jpeg|webp|gif|svg
  --output-compression 0..100                 JPEG/WebP only (encoding, not quality)
  --stream [--partial-images 0..3]            Save partial previews; progress on stderr
  --output-format svg --count 1               Generation only; no streaming
  --output-format gif --frame-count 15 --frame-duration-ms 200  3-second GIF
  --complexity low|medium|high                Planning effort, separate from quality
  --resolution 1K|2K|4K [--ratio 3:4]         Fits model limits; 4K <=3840 edge, <=8.29MP
  --get-config                               Does not expose the API key
  --set-config --model flare --base-url https://apis.vvvcode.com/
  --key-stdin                                Read and save a key from stdin
  --set-config --profile work --base-url https://api.example.com/v1 --key-stdin
  --list-profiles / --use-profile work        Save/switch named API connections
  --profile work                             Use a saved profile for this run
Environment: STICKERWU_IMAGEGEN_API_KEY, STICKERWU_IMAGEGEN_BASE_URL
Legacy aliases: VVVCODE_API_KEY, VVVCODE_BASE_URL; --base-url remains supported.
Models: sunburst/flare map to gpt-image-2.6-sunburst/flare; explicit 2.5 IDs stay pinned.
Edits and GIF default to size=auto; still generation defaults to 1024x1024.
No automatic retries or fallback from edits to generations.`);
  } else {
    const store = await createConfigStore();
    const connection = flags['set-config'] || flags['key-stdin'] || flags['use-profile'] ? null :
      store.resolve({ profile: flags.profile, baseUrl: flags['base-url'] });
    apiKey = connection?.apiKey || apiKey;
    if (flags['use-profile']) {
      if (flags['set-config'] || flags['key-stdin']) throw new Error('Save or switch a profile, not both.');
      console.log(JSON.stringify(await store.useProfile(flags['use-profile']), null, 2));
    } else if (flags['get-config'] || flags['list-profiles']) {
      console.log(JSON.stringify(store.describe({ profile: flags.profile, baseUrl: flags['base-url'] }), null, 2));
    } else if (flags['set-config'] || flags['key-stdin']) {
      let savedKey;
      if (flags['key-stdin']) {
        let text = '';
        for await (const chunk of process.stdin) text += chunk;
        if (!text.trim() || /\s/.test(text.trim())) throw new Error('Expected one nonempty API key on stdin.');
        savedKey = text.trim();
        apiKey = savedKey;
      }
      await store.saveProfile({ name: flags.profile, baseUrl: flags['base-url'], apiKey: savedKey, model: flags.model });
      console.log('Configuration saved. API key is not displayed.');
    } else {
      if (flags.prompt && flags['prompt-file']) throw new Error('Use prompt or prompt-file, not both.');
      const prompt = flags['prompt-file'] ? await readFile(flags['prompt-file'], 'utf8') : flags.prompt;
      const mode = flags.edit ? 'edit' : 'generate';
      const model = flags.model || connection.model;
      if (flags.size && flags.resolution) throw new Error('Choose size or resolution, not both.');
      if (flags.ratio && !flags.resolution) throw new Error('ratio requires resolution.');
      let size = flags.size;
      if (flags.resolution) {
        let ratio = 1;
        if (flags.ratio) {
          if (!/^\d+:\d+$/.test(flags.ratio)) throw new Error('Ratio must be WIDTH:HEIGHT.');
          const [w, h] = flags.ratio.split(':').map(Number);
          ratio = w / h;
        } else if (flags.edit && flags.image?.length) {
          // Fail explicitly for non-PNG instead of guessing and distorting a source.
          const { width, height } = pngDimensions(await readFile(flags.image[0]));
          ratio = width / height;
        }
        size = resolutionSize(flags.resolution, ratio);
      }
      size ??= flags.edit || ['gif','svg'].includes(flags['output-format']) ? 'auto' : '1024x1024';
      console.error(`Mode: ${mode}; model: ${MODELS[model] || model}; size: ${size}; background: ${flags.background || 'unspecified'}`);
      const files = await requestImages({
        apiKey, mode, model, prompt, images: flags.image, mask: flags.mask, markup: flags.markup,
        size, quality: flags.quality, complexity: flags.complexity, background: flags.background,
        frameCount: flags['frame-count'] === undefined ? undefined : Number(flags['frame-count']),
        frameDurationMs: flags['frame-duration-ms'] === undefined ? undefined : Number(flags['frame-duration-ms']),
        outputFormat: flags['output-format'], n: Number(flags.count || 1),
        outputCompression: flags['output-compression']===undefined?undefined:Number(flags['output-compression']),
        stream:flags.stream,
        partialImages:flags['partial-images']===undefined?undefined:Number(flags['partial-images']),
        onProgress:event=>console.error(JSON.stringify(event)),
        timeout: Number(flags.timeout || 300000),
        baseUrl: connection.baseUrl,
        outputDir: flags['output-dir'],
      });
      const results = [];
      for (const file of files) {
        let metadata;
        try { metadata = imageMetadata(await readFile(file)); }
        catch (error) { metadata = { transparencyVerified: false, reason: safeError(error, apiKey) }; }
        const warnings = [];
        if (flags['output-format'] === 'gif') {
          if (metadata.frameCount !== Number(flags['frame-count'] || 9)) warnings.push('Encoded GIF frame count differs from requested count.');
          const delay = Math.round(Number(flags['frame-duration-ms'] || 200) / 10) * 10;
          if (metadata.frameDurationsMs?.some(ms => ms !== delay)) warnings.push('Encoded GIF frame delay differs from requested delay.');
          if (!metadata.infiniteLoop) warnings.push('Infinite GIF looping was NOT verified.');
        }
        if (size !== 'auto' && metadata.width && `${metadata.width}x${metadata.height}` !== size) warnings.push('Returned dimensions differ from requested size.');
        if (flags.background === 'transparent' &&
            (!metadata.transparencyVerified || !(metadata.transparentPixels + metadata.translucentPixels > 0)))
          warnings.push('Real transparency was NOT verified; do not claim transparent output.');
        results.push({ file, ...metadata, warnings });
      }
      console.log(JSON.stringify({ ok: true, mode, model, requestedSize: size, files, results }, null, 2));
    }
  }
} catch (error) {
  console.error(safeError(error, apiKey));
  process.exitCode = 1;
}
