// src/storage.ts
// localStorage persistence. Provider config (including API keys) and search
// config are stored separately from scan results so each can be saved on its
// own. Keys live only on this device.

import {
  AppState,
  EMPTY_STATE,
  ProviderConfig,
  DEFAULT_PROVIDER_CONFIG,
  SearchConfig,
  DEFAULT_SEARCH_CONFIG,
} from "./types";

const STATE_KEY = "opendesk-state-v2";
const PROVIDER_KEY = "opendesk-provider-v1";
const SEARCH_KEY = "opendesk-search-v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch (error) {
    console.error(`Failed to load "${key}", using defaults:`, error);
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Failed to persist "${key}":`, error);
    return false;
  }
}

export function loadState(): AppState {
  return readJson<AppState>(STATE_KEY, EMPTY_STATE);
}

export function saveState(state: AppState): boolean {
  return writeJson(STATE_KEY, state);
}

export function loadProviderConfig(): ProviderConfig {
  // Nested objects (models, keys) need a deeper merge than the shallow default.
  const loaded = readJson<ProviderConfig>(PROVIDER_KEY, DEFAULT_PROVIDER_CONFIG);
  return {
    provider: loaded.provider,
    models: { ...DEFAULT_PROVIDER_CONFIG.models, ...loaded.models },
    keys: { ...DEFAULT_PROVIDER_CONFIG.keys, ...loaded.keys },
  };
}

export function saveProviderConfig(config: ProviderConfig): boolean {
  return writeJson(PROVIDER_KEY, config);
}

export function loadSearchConfig(): SearchConfig {
  return readJson<SearchConfig>(SEARCH_KEY, DEFAULT_SEARCH_CONFIG);
}

export function saveSearchConfig(config: SearchConfig): boolean {
  return writeJson(SEARCH_KEY, config);
}
