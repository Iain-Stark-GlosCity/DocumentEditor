/**
 * Typed settings: a schema of known keys with defaults and validators, and a small store.
 *
 * Adding a setting is a one-line change: add an entry to `SETTINGS_SCHEMA`. The key type,
 * value type, default and validation all follow from it. Unknown keys and invalid values in a
 * stored file are ignored, so a hand-edited or newer settings file can never break start-up.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

export interface SettingDef<T> {
  readonly default: T;
  validate(value: unknown): value is T;
}

/** A value that must be one of the given strings. */
export function oneOf<const T extends string>(options: readonly T[], fallback: T): SettingDef<T> {
  return { default: fallback, validate: (v): v is T => options.includes(v as T) };
}

export function bool(fallback: boolean): SettingDef<boolean> {
  return { default: fallback, validate: (v): v is boolean => typeof v === "boolean" };
}

/** A finite number in `[min, max]`; `integer` rejects fractions. */
export function num(
  fallback: number,
  min: number,
  max: number,
  integer = false,
): SettingDef<number> {
  return {
    default: fallback,
    validate: (v): v is number =>
      typeof v === "number" &&
      Number.isFinite(v) &&
      v >= min &&
      v <= max &&
      (!integer || Number.isInteger(v)),
  };
}

export const SETTINGS_SCHEMA = {
  "appearance.theme": oneOf(["system", "light", "dark"], "system"),
  "editor.fontSize": num(14, 8, 40),
  "editor.wordWrap": bool(true),
  "editor.lineNumbers": bool(false),
  "editor.viewMode": oneOf(["source", "live", "split"], "source"),
  "preview.syncScroll": bool(true),
  "preview.loadRemoteImages": bool(true),
  "files.autoSave": oneOf(["off", "afterDelay", "onFocusChange"], "off"),
  "files.autoSaveDelayMs": num(1500, 100, 600_000, true),
  "files.recoveryIntervalMs": num(3000, 100, 600_000, true),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS_SCHEMA)[K] extends SettingDef<infer T> ? T : never;
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, key);
}

const KEYS = Object.keys(SETTINGS_SCHEMA) as SettingKey[];

function defaults(): SettingValues {
  const values: Record<string, unknown> = {};
  for (const key of KEYS) values[key] = SETTINGS_SCHEMA[key].default;
  return values as SettingValues;
}

// The schema is a table keyed by strings; this keeps the (unavoidable) widening in one place.
function def(key: SettingKey): SettingDef<unknown> {
  return SETTINGS_SCHEMA[key] as SettingDef<unknown>;
}

export class SettingsStore {
  private readonly store: StoreApi<SettingValues> = createStore<SettingValues>()(() => defaults());

  get<K extends SettingKey>(key: K): SettingValue<K> {
    return this.store.getState()[key] as SettingValue<K>;
  }

  /** Reads a setting by an arbitrary string key, or returns `fallback` if the key is unknown. */
  getOr<T>(key: string, fallback: T): T {
    return isSettingKey(key) ? (this.store.getState()[key] as unknown as T) : fallback;
  }

  /** Throws if the value is not valid for the key; settings are never silently coerced. */
  set<K extends SettingKey>(key: K, value: SettingValue<K>): void {
    if (!def(key).validate(value)) {
      throw new RangeError(`Invalid value for setting "${key}": ${JSON.stringify(value)}`);
    }
    if (Object.is(this.store.getState()[key], value)) return;
    this.store.setState({ [key]: value } as Partial<SettingValues>);
  }

  reset(key: SettingKey): void {
    this.store.setState({ [key]: def(key).default } as Partial<SettingValues>);
  }

  /** Calls back when the value of one key changes. Returns an unsubscribe function. */
  subscribe<K extends SettingKey>(
    key: K,
    callback: (value: SettingValue<K>, previous: SettingValue<K>) => void,
  ): () => void {
    return this.store.subscribe((state, prev) => {
      if (state[key] !== prev[key]) {
        callback(state[key] as SettingValue<K>, prev[key] as SettingValue<K>);
      }
    });
  }

  /** Calls back after any setting changes, once per key that changed. */
  subscribeAll(callback: (key: SettingKey) => void): () => void {
    return this.store.subscribe((state, prev) => {
      for (const key of KEYS) if (state[key] !== prev[key]) callback(key);
    });
  }

  /** Applies stored JSON. Unknown keys and invalid values are ignored; bad JSON is a no-op. */
  load(json: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    const next: Record<string, unknown> = { ...defaults() };
    for (const [key, value] of Object.entries(parsed)) {
      if (isSettingKey(key) && def(key).validate(value)) next[key] = value;
    }
    this.store.setState(next as unknown as SettingValues);
  }

  /** JSON containing only the settings that differ from their defaults. */
  serialise(): string {
    const state = this.store.getState();
    const out: Record<string, unknown> = {};
    for (const key of KEYS) if (state[key] !== def(key).default) out[key] = state[key];
    return JSON.stringify(out, null, 2) + "\n";
  }
}
