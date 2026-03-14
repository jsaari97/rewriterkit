import { describe, expect, it } from 'vitest';
import { extract, type ExtractionRuntimeError, type ExtractorConfig } from '../src';

describe('extract error behavior', () => {
  it('throws INVALID_INPUT runtime errors for unsupported input values', async () => {
    await expect(
      extract(42 as unknown as string, {
        version: '1',
        fields: {
          title: {
            selectors: ['h1'],
            type: 'text',
          },
        },
      }),
    ).rejects.toMatchObject({
      name: 'ExtractionRuntimeError',
      code: 'INVALID_INPUT',
    } satisfies Pick<ExtractionRuntimeError, 'name' | 'code'>);
  });

  it('returns INVALID_CONFIG errors from extract without throwing', async () => {
    const result = await extract('<div></div>', {
      version: '1',
      fields: {
        hasThing: {
          selectors: ['.thing'],
          type: 'exists',
          default: false,
        },
      },
    } as unknown as ExtractorConfig);

    expect(result.ok).toBe(false);
    expect(result.data).toEqual({});
    expect(result.diagnostics).toEqual({ fields: {}, lists: {} });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.code === 'INVALID_CONFIG')).toBe(true);
  });
});
