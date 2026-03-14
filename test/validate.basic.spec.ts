import { describe, expect, it } from 'vitest';
import { validateConfig, type ExtractorConfig } from '../src';

describe('validateConfig', () => {
  it('accepts a valid v1 config', () => {
    const config: ExtractorConfig = {
      version: '1',
      fields: {
        title: {
          selectors: ['h1', '.title'],
          type: 'text',
          required: true,
          transforms: ['trim'],
        },
        imageUrl: {
          selectors: ['img.hero'],
          type: 'attribute',
          attribute: 'src',
        },
        hasPrice: {
          selectors: ['.price'],
          type: 'exists',
        },
      },
    };

    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid field semantics', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        htmlBody: {
          selectors: ['article'],
          type: 'html',
        },
        flag: {
          selectors: ['.flag'],
          type: 'exists',
          required: true,
          default: false,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'unsupported_type')).toBe(true);
    expect(result.errors.some((issue) => issue.code === 'invalid_exists_required')).toBe(true);
    expect(result.errors.some((issue) => issue.code === 'invalid_exists_default')).toBe(true);
  });

  it('rejects invalid regexReplace patterns during validation', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
          transforms: [
            {
              kind: 'regexReplace',
              pattern: '[',
              replacement: '',
            },
          ],
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'invalid_regex' && issue.path === 'fields.title.transforms[0].pattern')).toBe(true);
  });

  it('rejects unknown top-level kind values', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        products: {
          kind: 'lsit',
          itemSelector: '.product',
          fields: {},
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'invalid_kind' && issue.path === 'fields.products.kind')).toBe(true);
  });

  it('rejects explicit field kind markers', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        title: {
          kind: 'field',
          selectors: ['h1'],
          type: 'text',
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'invalid_kind' && issue.path === 'fields.title.kind')).toBe(true);
  });

  it('rejects trim property', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
          trim: true,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'unexpected_property' && issue.path === 'fields.title.trim')).toBe(true);
  });

  it('validates list rules with nested field rules', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        products: {
          kind: 'list',
          itemSelector: '.product',
          fields: {
            title: {
              selectors: ['.title'],
              type: 'text',
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
  });
});
