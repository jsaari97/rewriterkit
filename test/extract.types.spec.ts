import { describe, expect, it } from 'vitest';
import { extract, type ExtractorConfig } from '../src';

describe('extract type inference', () => {
  it('infers output value types from config literals', async () => {
    const config = {
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
          transforms: ['trim'],
          required: true,
        },
        price: {
          selectors: ['.price'],
          type: 'text',
          transforms: ['parseNumber'],
        },
        inStock: {
          selectors: ['.stock'],
          type: 'text',
          transforms: ['parseBoolean'],
        },
        tags: {
          selectors: ['.tag'],
          type: 'text',
          cardinality: 'many',
          transforms: ['trim'],
        },
        hasBadge: {
          selectors: ['.badge'],
          type: 'exists',
        },
      },
    } as const satisfies ExtractorConfig;

    const result = await extract(
      '<article><h1> Demo </h1><span class="price">10</span><span class="stock">true</span><span class="tag">a</span></article>',
      config,
    );

    const title: string = result.data.title;
    const price: number | null = result.data.price;
    const inStock: boolean | null = result.data.inStock;
    const tags: string[] = result.data.tags;
    const hasBadge: boolean = result.data.hasBadge;

    expect(title).toBe('Demo');
    expect(price).toBe(10);
    expect(inStock).toBe(true);
    expect(tags).toEqual(['a']);
    expect(hasBadge).toBe(false);
  });
});
