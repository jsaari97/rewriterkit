import type { TransformSpec } from '../types/public';

export interface ApplyTransformsInput {
  value: unknown;
  cardinality: 'one' | 'many';
  transforms: TransformSpec[];
  baseUrl?: string;
}

export interface ApplyTransformsResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

function transformTypeName(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

function expectString(value: unknown, transformName: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: `Transform '${transformName}' expects a string but received ${transformTypeName(value)}.`,
    };
  }

  return {
    ok: true,
    value,
  };
}

function applyScalarTransform(value: unknown, transform: TransformSpec, baseUrl?: string): ApplyTransformsResult {
  if (transform === 'trim') {
    const candidate = expectString(value, 'trim');
    if (!candidate.ok) {
      return candidate;
    }

    return { ok: true, value: candidate.value.trim() };
  }

  if (transform === 'normalizeWhitespace') {
    const candidate = expectString(value, 'normalizeWhitespace');
    if (!candidate.ok) {
      return candidate;
    }

    return { ok: true, value: candidate.value.replace(/\s+/g, ' ').trim() };
  }

  if (transform === 'toLowerCase') {
    const candidate = expectString(value, 'toLowerCase');
    if (!candidate.ok) {
      return candidate;
    }

    return { ok: true, value: candidate.value.toLowerCase() };
  }

  if (transform === 'toUpperCase') {
    const candidate = expectString(value, 'toUpperCase');
    if (!candidate.ok) {
      return candidate;
    }

    return { ok: true, value: candidate.value.toUpperCase() };
  }

  if (transform === 'parseNumber') {
    const candidate = expectString(value, 'parseNumber');
    if (!candidate.ok) {
      return candidate;
    }

    const parsed = Number(candidate.value);
    if (Number.isNaN(parsed)) {
      return {
        ok: false,
        error: `Transform 'parseNumber' failed to parse '${candidate.value}' as a number.`,
      };
    }

    return { ok: true, value: parsed };
  }

  if (transform === 'parseInteger') {
    const candidate = expectString(value, 'parseInteger');
    if (!candidate.ok) {
      return candidate;
    }

    const normalized = candidate.value.trim();
    if (!/^[+-]?\d+$/.test(normalized)) {
      return {
        ok: false,
        error: `Transform 'parseInteger' failed to parse '${candidate.value}' as an integer.`,
      };
    }

    return { ok: true, value: Number.parseInt(normalized, 10) };
  }

  if (transform === 'parseBoolean') {
    const candidate = expectString(value, 'parseBoolean');
    if (!candidate.ok) {
      return candidate;
    }

    const normalized = candidate.value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return { ok: true, value: true };
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return { ok: true, value: false };
    }

    return {
      ok: false,
      error: `Transform 'parseBoolean' failed to parse '${candidate.value}' as a boolean.`,
    };
  }

  if (transform === 'absoluteUrl') {
    const candidate = expectString(value, 'absoluteUrl');
    if (!candidate.ok) {
      return candidate;
    }

    try {
      return { ok: true, value: new URL(candidate.value).href };
    } catch {
      if (!baseUrl) {
        return {
          ok: false,
          error: "Transform 'absoluteUrl' encountered a relative URL but no `baseUrl` was provided.",
        };
      }

      try {
        return {
          ok: true,
          value: new URL(candidate.value, baseUrl).href,
        };
      } catch {
        return {
          ok: false,
          error: `Transform 'absoluteUrl' could not resolve '${candidate.value}' using base URL '${baseUrl}'.`,
        };
      }
    }
  }

  if (typeof transform === 'object' && transform.kind === 'regexReplace') {
    const candidate = expectString(value, 'regexReplace');
    if (!candidate.ok) {
      return candidate;
    }

    try {
      const regex = new RegExp(transform.pattern, transform.flags);
      return { ok: true, value: candidate.value.replace(regex, transform.replacement) };
    } catch {
      return {
        ok: false,
        error: "Transform 'regexReplace' encountered an invalid pattern or flags.",
      };
    }
  }

  return {
    ok: false,
    error: `Unsupported transform '${String(transform)}'.`,
  };
}

export function applyTransforms(input: ApplyTransformsInput): ApplyTransformsResult {
  const transformOrder = [...input.transforms];

  if (input.cardinality === 'many') {
    if (!Array.isArray(input.value)) {
      return {
        ok: false,
        error: 'Internal transform error: expected an array for a many-cardinality field.',
      };
    }

    const out: unknown[] = [];

    for (const entry of input.value) {
      let current: unknown = entry;
      for (const transform of transformOrder) {
        const transformed = applyScalarTransform(current, transform, input.baseUrl);
        if (!transformed.ok) {
          return transformed;
        }
        current = transformed.value;
      }
      out.push(current);
    }

    return {
      ok: true,
      value: out,
    };
  }

  let current: unknown = input.value;
  for (const transform of transformOrder) {
    const transformed = applyScalarTransform(current, transform, input.baseUrl);
    if (!transformed.ok) {
      return transformed;
    }
    current = transformed.value;
  }

  return {
    ok: true,
    value: current,
  };
}
