import { validateConfig } from '../config/validate';
import type { ExtractorConfig, ValidationResult } from '../types/public';
import { compileConfig, type CompiledPlan } from './compile';

const MAX_CACHE_ENTRIES = 200;

interface CacheEntry {
  validation: ValidationResult;
  compiled?: CompiledPlan;
}

const configCache = new Map<string, CacheEntry>();

function stableSerialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return JSON.stringify(value);
  }

  if (valueType !== 'object') {
    return JSON.stringify(String(value));
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry, seen)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  if (seen.has(objectValue)) {
    throw new Error('Cannot cache circular config objects.');
  }
  seen.add(objectValue);

  const serialized = Object.keys(objectValue)
    .sort()
    .flatMap((key) => {
      const entry = objectValue[key];
      if (entry === undefined) {
        return [];
      }

      return [`${JSON.stringify(key)}:${stableSerialize(entry, seen)}`];
    })
    .join(',');

  seen.delete(objectValue);
  return `{${serialized}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cacheKey(config: unknown): string | undefined {
  try {
    const serialized = stableSerialize(config, new WeakSet<object>());
    const hash = fnv1a(serialized);
    return `v1:${hash}:${serialized.length}`;
  } catch {
    return undefined;
  }
}

function cloneValidationResult(result: ValidationResult): ValidationResult {
  return {
    ok: result.ok,
    errors: result.errors.map((issue) => ({ ...issue })),
  };
}

function setCacheEntry(key: string, entry: CacheEntry): void {
  configCache.set(key, entry);

  if (configCache.size <= MAX_CACHE_ENTRIES) {
    return;
  }

  const oldestKey = configCache.keys().next().value;
  if (oldestKey) {
    configCache.delete(oldestKey);
  }
}

export function getValidatedCompiledConfig(config: ExtractorConfig): { validation: ValidationResult; compiled?: CompiledPlan } {
  const key = cacheKey(config);

  if (key) {
    const cached = configCache.get(key);
    if (cached) {
      return {
        validation: cloneValidationResult(cached.validation),
        compiled: cached.compiled,
      };
    }
  }

  const validation = validateConfig(config);
  const entry: CacheEntry = {
    validation: cloneValidationResult(validation),
    compiled: validation.ok ? compileConfig(config) : undefined,
  };

  if (key) {
    setCacheEntry(key, entry);
  }

  return {
    validation,
    compiled: entry.compiled,
  };
}

export function clearConfigCache(): void {
  configCache.clear();
}
