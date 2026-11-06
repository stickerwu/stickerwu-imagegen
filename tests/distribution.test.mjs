import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

test('new plugin and skill names are installable while the legacy entry remains compatible', async () => {
  const marketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
  for (const name of ['stickerwu-imagegen', 'vvvcode-image-gen']) {
    const entry = marketplace.plugins.find(item => item.name === name);
    assert.ok(entry, `Missing marketplace entry: ${name}`);
    const root = entry.source.path;
    const plugin = JSON.parse(await readFile(`${root}/.codex-plugin/plugin.json`, 'utf8'));
    assert.equal(plugin.name, name);
    assert.equal(plugin.interface.displayName, 'stickerwu imagegen');
    const skill = await readFile(`${root}/skills/${name}/SKILL.md`, 'utf8');
    assert.match(skill, new RegExp(`^---\\s+name: ${name}\\r?$`, 'm'));
    for (const script of ['generate.mjs', 'annotate.mjs']) {
      const help = spawnSync(process.execPath, [`${root}/scripts/${script}`, '--help'], { encoding: 'utf8' });
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, /stickerwu imagegen/);
    }
  }
});

test('new distribution contains the same runtime and references as the legacy upgrade entry', () => {
  const result = spawnSync(process.execPath, ['scripts/build-stickerwu-plugin.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
test('Codex, Claude Code and Harness share a versioned prebuilt distribution', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const codex = JSON.parse(await readFile('plugins/stickerwu-imagegen/.codex-plugin/plugin.json', 'utf8'));
  const claude = JSON.parse(await readFile('plugins/stickerwu-imagegen/.claude-plugin/plugin.json', 'utf8'));
  const market = JSON.parse(await readFile('.claude-plugin/marketplace.json', 'utf8'));
  assert.equal(pkg.name, 'dsh-stickerwu-imagegen'); assert.equal(pkg.private, undefined);
  assert.equal(pkg.version, codex.version); assert.equal(pkg.version, claude.version);
  assert.equal(market.plugins[0].version, pkg.version);
  assert.equal(market.plugins[0].source, './plugins/stickerwu-imagegen');
  assert.equal(claude.name, codex.name);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.main, './adapters/deepseek-harness/index.mjs');
  assert.match(await readFile('cordis.patch.yml', 'utf8'), /name: dsh-stickerwu-imagegen/);
  assert.equal(pkg.scripts.prepare, undefined, 'Git/tarball installation must not require an allowed build script.');
  for (const key of ['interface', 'capabilities', 'defaultPrompt']) assert.equal(claude[key], undefined);
});
