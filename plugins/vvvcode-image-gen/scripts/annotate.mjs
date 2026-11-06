#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createReviewSession } from './review-server.mjs';
import { safeError } from './client.mjs';

let apiKey = process.env.VVVCODE_API_KEY || '';
try {
  const { values: flags } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, image: { type: 'string' }, session: { type: 'string' },
    'output-dir': { type: 'string' }, model: { type: 'string' }, size: { type: 'string' },
    quality: { type: 'string' }, complexity: { type: 'string' }, background: { type: 'string' },
    timeout: { type: 'string' }, 'base-url': { type: 'string' }, 'prompt-file': { type: 'string' },
    'idle-timeout': { type: 'string' }, open: { type: 'boolean' },
  } });
  if (flags.help) {
    console.log(`VVVCode on-demand infinite image canvas (Node.js 22+)
  node annotate.mjs [--image result.png] --output-dir outputs [--open]
  node annotate.mjs --session outputs/review-SESSION-ID [--open]
  --model sunburst|flare --size auto|WIDTHxHEIGHT --quality VALUE
  --complexity low|medium|high --background auto|opaque|transparent
  --prompt-file edit.txt --timeout 300000 --idle-timeout 3600000
The URL opens a local infinite canvas. Empty frames generate; images edit.
Each Submit makes exactly one API request. Ordinary generate.mjs stays headless.
Source images, transparent markup, prompts and results stay in a review subfolder.
stdout is newline-delimited JSON: ready, submitted, generated, error, finished.
No request runs at startup. No automatic paid retries. No key in the browser.
Use Finish in the page to stop; inactive sessions close after one hour.`);
  } else {
    let config = {};
    try { config = JSON.parse(await readFile(join(homedir(), '.config', 'vvvcode-image-gen', 'config.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read plugin config; check its JSON format.'); }
    apiKey ||= config.apiKey || '';
    const session = await createReviewSession({
      image: flags.image, session: flags.session, outputDir: flags['output-dir'], apiKey,
      baseUrl: flags['base-url'] || process.env.VVVCODE_BASE_URL || config.baseUrl,
      model: flags.model || (flags.session ? undefined : config.model) || (flags.session ? undefined : 'sunburst'), size: flags.size,
      quality: flags.quality, complexity: flags.complexity, background: flags.background,
      timeout: Number(flags.timeout || 300000), idleTimeout: Number(flags['idle-timeout'] || 3600000),
      prompt: flags['prompt-file'] ? await readFile(flags['prompt-file'], 'utf8') : '',
      onEvent: event => console.log(JSON.stringify(event)),
    });
    if (flags.open) {
      const [program, args] = process.platform === 'win32'
        ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `Start-Process -FilePath '${session.url}' -WindowStyle Hidden`]]
        : process.platform === 'darwin' ? ['open', [session.url]] : ['xdg-open', [session.url]];
      const child = spawn(program, args, { stdio: 'ignore', windowsHide: true });
      child.on('error', error => console.error(`Open the ready URL manually: ${safeError(error, apiKey)}`));
    }
    await session.done;
  }
} catch (error) {
  console.error(safeError(error, apiKey)); process.exitCode = 1;
}
