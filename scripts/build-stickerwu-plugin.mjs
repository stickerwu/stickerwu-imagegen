import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Both install identities ship a self-contained copy of the same maintained runtime.
// Never edit the generated distribution or a user's installed plugin cache.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'plugins/vvvcode-image-gen');
const destination = join(root, 'plugins/stickerwu-imagegen');
const check = process.argv.includes('--check');
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else { assert.ok(entry.isFile(), 'Plugin distributions must contain regular files.'); files.push(path); }
  }
  return files;
}
const expected = [];
for (const file of await walk(source)) {
  const path = relative(source, file).replaceAll('\\', '/');
  const renamed = path.replace('skills/vvvcode-image-gen/', 'skills/stickerwu-imagegen/');
  const target = join(destination, renamed);
  let bytes = Buffer.from((await readFile(file, 'utf8')).replaceAll('\r\n', '\n'));
  if (path === '.codex-plugin/plugin.json') {
    const manifest = JSON.parse(bytes.toString('utf8'));
    manifest.name = 'stickerwu-imagegen';
    bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  } else if (path === 'skills/vvvcode-image-gen/SKILL.md') {
    const text = bytes.toString('utf8').replace(/^name: vvvcode-image-gen\r?$/m, 'name: stickerwu-imagegen')
      .replace(/This is the legacy upgrade entry; new installations\r?\nuse `stickerwu-imagegen`\./,
        'This is the `stickerwu-imagegen` entry. The legacy plugin remains available\nfor existing installations.');
    bytes = Buffer.from(text);
  }
  expected.push(renamed);
  if (check) assert.equal((await readFile(target, 'utf8')).replaceAll('\r\n', '\n'), bytes.toString('utf8'), `Rebuild distribution: ${renamed}`);
  else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
}
const actual = (await walk(destination)).map(file => relative(destination, file).replaceAll('\\', '/')).sort();
assert.deepEqual(actual, expected.sort(), 'Unexpected files in the generated distribution.');
console.log(`${check ? 'Verified' : 'Built'} stickerwu-imagegen: ${expected.length} files; legacy entry retained.`);
