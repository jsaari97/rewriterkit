import { describe, expect, it } from 'vitest';
import { extract, type ExtractionRuntimeError, type ExtractorConfig } from '../src';
import { createInternalError } from '../src/core/errors';

describe('runtime errors', () => {
  it('attaches cause for internal errors', () => {
    const cause = new Error('boom');
    const error = createInternalError('rewriter failed', cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ExtractionRuntimeError');
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.cause).toBe(cause);
  });

  it('reports INVALID_INPUT for null and array inputs', async () => {
    const config: ExtractorConfig = {
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
        },
      },
    };

    await expect(extract(null as unknown as string, config)).rejects.toMatchObject({
      name: 'ExtractionRuntimeError',
      code: 'INVALID_INPUT',
    } satisfies Pick<ExtractionRuntimeError, 'name' | 'code'>);

    await expect(extract([] as unknown as string, config)).rejects.toMatchObject({
      name: 'ExtractionRuntimeError',
      code: 'INVALID_INPUT',
    } satisfies Pick<ExtractionRuntimeError, 'name' | 'code'>);
  });
});
