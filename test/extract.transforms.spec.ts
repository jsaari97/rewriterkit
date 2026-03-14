import { describe, expect, it } from 'vitest';
import { extract } from '../src';

describe('extract transform behavior', () => {
  it('applies transforms in order', async () => {
    const html = '<div><span class="price"> 12.5 </span><a class="link" href="/item/1">item</a><span class="flag">YeS</span></div>';

    const result = await extract(
      html,
      {
        version: '1',
        fields: {
          price: {
            selectors: ['.price'],
            type: 'text',
            transforms: ['trim', 'parseNumber'],
          },
          link: {
            selectors: ['a.link'],
            type: 'attribute',
            attribute: 'href',
            transforms: ['absoluteUrl'],
          },
          flag: {
            selectors: ['.flag'],
            type: 'text',
            transforms: ['parseBoolean'],
          },
        },
      },
      { baseUrl: 'https://example.com/catalog/' },
    );

    expect(result.ok).toBe(true);
    expect(result.data.price).toBe(12.5);
    expect(result.data.link).toBe('https://example.com/item/1');
    expect(result.data.flag).toBe(true);
  });

  it('applies regexReplace transforms', async () => {
    const html = '<h1 class="title">Product: Deluxe Edition</h1>';

    const result = await extract(html, {
      version: '1',
      fields: {
        slug: {
          selectors: ['.title'],
          type: 'text',
          transforms: [
            {
              kind: 'regexReplace',
              pattern: '^Product:\\s+',
              replacement: '',
              flags: 'i',
            },
            {
              kind: 'regexReplace',
              pattern: '\\s+',
              replacement: '-',
            },
            'toLowerCase',
          ],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.slug).toBe('deluxe-edition');
  });

  it('records transform failures and does not apply defaults afterward', async () => {
    const html = '<div><span class="price">N/A</span></div>';

    const result = await extract(html, {
      version: '1',
      fields: {
        price: {
          selectors: ['.price'],
          type: 'text',
          transforms: ['parseNumber'],
          default: 0,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.data.price).toBeNull();
    expect(result.diagnostics.fields.price.usedDefault).toBe(false);
    expect(result.errors.some((error) => error.code === 'TRANSFORM_FAILED' && error.field === 'price')).toBe(true);
  });

  it('fails absoluteUrl transform for relative values when baseUrl is missing', async () => {
    const html = '<img class="hero" src="/relative.jpg">';

    const result = await extract(html, {
      version: '1',
      fields: {
        imageUrl: {
          selectors: ['.hero'],
          type: 'attribute',
          attribute: 'src',
          transforms: ['absoluteUrl'],
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.data.imageUrl).toBeNull();
    expect(result.errors.some((error) => error.code === 'TRANSFORM_FAILED')).toBe(true);
    expect(result.diagnostics.fields.imageUrl.errors[0]).toContain('baseUrl');
  });
});
