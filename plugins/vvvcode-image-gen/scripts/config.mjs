import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { normalizeBase, MODELS, SUPPORTED_MODELS } from './client.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function profileName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(name) ||
      ['constructor', 'prototype', '__proto__'].includes(name)) throw new Error('Invalid API profile name (1–64 letters, numbers, dot, underscore or hyphen).');
  return name;
}
function keyValue(value) {
  if (typeof value !== 'string' || value.length > 8192 || /\s/.test(value)) throw new Error('Expected one API key without whitespace.');
  return value;
}

// Keep the original path and active top-level fields for in-place upgrades and downgrades.
export async function createConfigStore({ env = process.env, configPath = env.STICKERWU_IMAGEGEN_CONFIG ||
  env.VVVCODE_CONFIG || join(homedir(), '.config', 'vvvcode-image-gen', 'config.json') } = {}) {
  let config = {};
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read plugin config; check its JSON format.'); }
  if (!object(config) || config.profiles !== undefined && !object(config.profiles)) throw new Error('Invalid plugin configuration.');
  const activeProfile = profileName(config.activeProfile || 'default');
  const profiles = Object.fromEntries(Object.entries(config.profiles || {}).map(([name, value]) => {
    profileName(name);
    if (!object(value)) throw new Error('Invalid API profile.');
    return [name, { baseUrl: normalizeBase(value.baseUrl), apiKey: keyValue(value.apiKey || '') }];
  }));
  const active = profiles[activeProfile] || { baseUrl: normalizeBase(), apiKey: '' };
  // Legacy clients update these fields while retaining the new profile dictionary.
  profiles[activeProfile] = {
    baseUrl: normalizeBase(config.baseUrl ?? active.baseUrl), apiKey: keyValue(config.apiKey ?? active.apiKey),
  };
  config = { ...config, configVersion: 2, activeProfile, profiles };
  function getProfile(name) {
    profileName(name);
    if (!Object.hasOwn(config.profiles, name)) throw new Error('Unknown API profile.');
    return config.profiles[name];
  }
  function resolve({ profile, baseUrl, apiKey } = {}) {
    const name = profile || config.activeProfile, entry = getProfile(name);
    // Explicit named profiles are isolated from global environment credentials.
    const envBase = profile ? undefined : env.STICKERWU_IMAGEGEN_BASE_URL || env.VVVCODE_BASE_URL;
    const envKey = profile ? undefined : env.STICKERWU_IMAGEGEN_API_KEY || env.VVVCODE_API_KEY;
    const effectiveBase = normalizeBase(baseUrl || envBase || entry.baseUrl);
    // Saved credentials belong to their saved endpoint, including temporary overrides.
    const savedKey = effectiveBase === entry.baseUrl ? entry.apiKey : '';
    return { profile: name, baseUrl: effectiveBase,
      apiKey: apiKey ?? (envKey || savedKey), model: config.model || 'sunburst',
      source: baseUrl || apiKey !== undefined ? 'override' : envBase || envKey ? 'environment' : 'profile' };
  }
  function describe(options = {}) {
    const effective = resolve(options);
    return { configPath, activeProfile: config.activeProfile, selectedProfile: effective.profile,
      baseUrl: effective.baseUrl, hasKey: Boolean(effective.apiKey), source: effective.source,
      model: effective.model, resolvedModel: MODELS[effective.model] || effective.model,
      profiles: Object.entries(config.profiles).map(([name, value]) => ({ name, baseUrl: value.baseUrl, hasKey: Boolean(value.apiKey) })) };
  }
  async function commit(next) {
    const entry = next.profiles[next.activeProfile];
    const saved = { ...next, baseUrl: entry.baseUrl, apiKey: entry.apiKey };
    await mkdir(dirname(configPath), { recursive: true });
    const temporary = `${configPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, configPath);
    config = saved;
    return describe({ profile: config.activeProfile });
  }
  return {
    resolve, describe,
    async saveProfile({ name = config.activeProfile, baseUrl, apiKey, model, activate = true } = {}) {
      profileName(name);
      const previous = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
      const url = normalizeBase(baseUrl ?? previous?.baseUrl);
      const key = apiKey === undefined ? previous?.baseUrl === url ? previous.apiKey : '' : keyValue(apiKey);
      if (model !== undefined && !MODELS[model] && !SUPPORTED_MODELS.includes(model)) throw new Error('Unknown model.');
      return commit({ ...config, ...(model === undefined ? {} : { model }),
        activeProfile: activate ? name : config.activeProfile,
        profiles: { ...config.profiles, [name]: { baseUrl: url, apiKey: key } } });
    },
    async useProfile(name) {
      getProfile(name);
      return commit({ ...config, activeProfile: name });
    },
  };
}
