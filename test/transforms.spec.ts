import { describe, expect, it } from 'vitest';
import { applyTransforms } from '../src/core/transforms';
import type { TransformSpec } from '../src';

describe('applyTransforms additional coverage', () => {
  it('returns an internal error when many-cardinality input is not an array', () => {
    const result = applyTransforms({
      value: 'not-an-array',
      cardinality: 'many',
      transforms: ['trim'],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('expected an array');
  });

  it('reports null and array types for string-only transforms', () => {
    const nullResult = applyTransforms({
      value: null,
      cardinality: 'one',
      transforms: ['trim'],
    });
    expect(nullResult.ok).toBe(false);
    expect(nullResult.error).toContain('received null');

    const arrayResult = applyTransforms({
      value: [],
      cardinality: 'one',
      transforms: ['trim'],
    });
    expect(arrayResult.ok).toBe(false);
    expect(arrayResult.error).toContain('received array');
  });

  it('reports parse failures for integer and boolean transforms', () => {
    const integerResult = applyTransforms({
      value: '1.5',
      cardinality: 'one',
      transforms: ['parseInteger'],
    });
    expect(integerResult.ok).toBe(false);
    expect(integerResult.error).toContain("failed to parse '1.5' as an integer");

    const booleanResult = applyTransforms({
      value: 'maybe',
      cardinality: 'one',
      transforms: ['parseBoolean'],
    });
    expect(booleanResult.ok).toBe(false);
    expect(booleanResult.error).toContain("failed to parse 'maybe' as a boolean");
  });

  it('reports absoluteUrl failures when provided baseUrl is invalid', () => {
    const result = applyTransforms({
      value: '/item/123',
      cardinality: 'one',
      transforms: ['absoluteUrl'],
      baseUrl: '::not-a-valid-url::',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('could not resolve');
  });

  it('handles regexReplace runtime errors and unsupported transforms', () => {
    const badRegex = applyTransforms({
      value: 'abc',
      cardinality: 'one',
      transforms: [
        {
          kind: 'regexReplace',
          pattern: '[',
          replacement: '',
        },
      ],
    });
    expect(badRegex.ok).toBe(false);
    expect(badRegex.error).toContain('invalid pattern or flags');

    const unsupported = applyTransforms({
      value: 'abc',
      cardinality: 'one',
      transforms: ['notReal' as TransformSpec],
    });
    expect(unsupported.ok).toBe(false);
    expect(unsupported.error).toContain('Unsupported transform');
  });

  it('short-circuits many-cardinality pipelines when one entry fails', () => {
    const result = applyTransforms({
      value: ['first', 2],
      cardinality: 'many',
      transforms: ['toUpperCase'],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('expects a string but received number');
  });
});
