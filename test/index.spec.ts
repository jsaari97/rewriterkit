import { describe, expect, it } from 'vitest';
import { extract, ExtractionRuntimeError, validateConfig, type ExtractorConfig } from '../src';

describe('validateConfig', () => {
  it('accepts a valid v1 config', () => {
    const config: ExtractorConfig = {
      version: '1',
      fields: {
        title: {
          selectors: ['h1', '.title'],
          type: 'text',
          required: true,
          trim: true,
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
});

describe('extract', () => {
  it('extracts text from an HTML string', async () => {
    const html = '<main><h1> Product Title </h1></main>';

    const result = await extract(html, {
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
          trim: true,
          required: true,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.title).toBe('Product Title');
    expect(result.diagnostics.title.winningSelector).toBe('h1');
    expect(result.errors).toEqual([]);
  });

  it('extracts from a Response input', async () => {
    const response = new Response('<div><span class="name">Widget</span></div>', {
      headers: { 'content-type': 'text/html' },
    });

    const result = await extract(response, {
      version: '1',
      fields: {
        name: {
          selectors: ['.name'],
          type: 'text',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('Widget');
  });

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

  it('keeps first selector priority even for empty strings', async () => {
    const html = '<h1></h1><h1 class="fallback">Actual title</h1>';

    const result = await extract(html, {
      version: '1',
      fields: {
        title: {
          selectors: ['h1', '.fallback'],
          type: 'text',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.title).toBe('');
    expect(result.diagnostics.title.winningSelector).toBe('h1');
    expect(result.diagnostics.title.valueProduced).toBe(true);
  });

  it('continues within the same selector for attribute cardinality one', async () => {
    const html = '<img class="hero" alt="missing src"><img class="hero" src="/img/a.jpg">';

    const result = await extract(html, {
      version: '1',
      fields: {
        imageUrl: {
          selectors: ['img.hero'],
          type: 'attribute',
          attribute: 'src',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.imageUrl).toBe('/img/a.jpg');
  });

  it('supports shared selectors and preserves many-value order', async () => {
    const html = '<ul><li class="item" data-sku="2">B</li><li class="item" data-sku="1">A</li></ul>';

    const result = await extract(html, {
      version: '1',
      fields: {
        labels: {
          selectors: ['li.item'],
          type: 'text',
          cardinality: 'many',
          trim: true,
        },
        sku: {
          selectors: ['li.item'],
          type: 'attribute',
          attribute: 'data-sku',
          cardinality: 'many',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.labels).toEqual(['B', 'A']);
    expect(result.data.sku).toEqual(['2', '1']);
  });

  it('captures nested text for a matched element and preserves selector order', async () => {
    const html = '<h1 class="title">Hello <em>big</em> world</h1><h1 class="title">Second</h1>';

    const result = await extract(html, {
      version: '1',
      fields: {
        title: {
          selectors: ['h1.title'],
          type: 'text',
          trim: true,
        },
        titles: {
          selectors: ['h1.title'],
          type: 'text',
          cardinality: 'many',
          trim: true,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.title).toBe('Hello big world');
    expect(result.data.titles).toEqual(['Hello big world', 'Second']);
  });

  it('handles nested same-selector matches in deterministic document order', async () => {
    const html = '<div class="item">Outer <span class="item">Inner</span> Tail</div>';

    const result = await extract(html, {
      version: '1',
      fields: {
        items: {
          selectors: ['.item'],
          type: 'text',
          cardinality: 'many',
          transforms: ['normalizeWhitespace'],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.items).toEqual(['Outer Inner Tail', 'Inner']);
    expect(result.diagnostics.items.winningSelector).toBe('.item');
    expect(result.diagnostics.items.matchCount).toBe(2);
  });

  it('extracts exists booleans', async () => {
    const html = '<div class="available"></div>';

    const result = await extract(html, {
      version: '1',
      fields: {
        hasAvailability: {
          selectors: ['.available'],
          type: 'exists',
        },
        hasPrice: {
          selectors: ['.price'],
          type: 'exists',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.hasAvailability).toBe(true);
    expect(result.data.hasPrice).toBe(false);
  });

  it('reports required-field misses and continues extraction', async () => {
    const html = '<main><h2>Fallback</h2></main>';

    const result = await extract(html, {
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
          required: true,
        },
        subtitle: {
          selectors: ['h2'],
          type: 'text',
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.data.title).toBeNull();
    expect(result.data.subtitle).toBe('Fallback');
    expect(result.errors.some((error) => error.code === 'REQUIRED_FIELD_MISSING' && error.field === 'title')).toBe(true);
  });

  it('uses defaults when values are missing', async () => {
    const html = '<body></body>';

    const result = await extract(html, {
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
          default: 'Untitled',
        },
        tags: {
          selectors: ['.tag'],
          type: 'text',
          cardinality: 'many',
          default: ['news', 'featured'],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.title).toBe('Untitled');
    expect(result.data.tags).toEqual(['news', 'featured']);
    expect(result.diagnostics.title.usedDefault).toBe(true);
  });

  it('applies transforms in order', async () => {
    const html =
      '<div><span class="price"> 12.5 </span><a class="link" href="/item/1">item</a><span class="flag">YeS</span></div>';

    const result = await extract(
      html,
      {
        version: '1',
        fields: {
          price: {
            selectors: ['.price'],
            type: 'text',
            trim: true,
            transforms: ['parseNumber'],
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
    expect(result.diagnostics.price.usedDefault).toBe(false);
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
    expect(result.diagnostics.imageUrl.errors[0]).toContain('baseUrl');
  });

  it('reports selector diagnostics details with attribute fallback', async () => {
    const html = '<img class="hero"><img class="fallback" src="/ok.jpg">';

    const result = await extract(html, {
      version: '1',
      fields: {
        imageUrl: {
          selectors: ['img.hero', 'img.fallback'],
          type: 'attribute',
          attribute: 'src',
          default: '/default.jpg',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.imageUrl).toBe('/ok.jpg');
    expect(result.diagnostics.imageUrl.selectorTried).toEqual(['img.hero', 'img.fallback']);
    expect(result.diagnostics.imageUrl.matched).toBe(true);
    expect(result.diagnostics.imageUrl.winningSelector).toBe('img.fallback');
    expect(result.diagnostics.imageUrl.matchCount).toBe(1);
    expect(result.diagnostics.imageUrl.valueProduced).toBe(true);
    expect(result.diagnostics.imageUrl.usedDefault).toBe(false);
    expect(result.diagnostics.imageUrl.errors).toEqual([]);
  });

  it('returns null and empty arrays for missing non-required fields', async () => {
    const result = await extract('<section></section>', {
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
        },
        tags: {
          selectors: ['.tag'],
          type: 'text',
          cardinality: 'many',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.title).toBeNull();
    expect(result.data.tags).toEqual([]);
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
    expect(result.diagnostics).toEqual({});
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.code === 'INVALID_CONFIG')).toBe(true);
  });

  it('extracts many values from larger HTML payloads deterministically', async () => {
    const items = Array.from({ length: 500 }, (_, index) => `<li class="item" data-id="${index + 1}">Item ${index + 1}</li>`).join('');
    const html = `<ul>${items}</ul>`;

    const result = await extract(html, {
      version: '1',
      fields: {
        names: {
          selectors: ['li.item'],
          type: 'text',
          cardinality: 'many',
          trim: true,
        },
        ids: {
          selectors: ['li.item'],
          type: 'attribute',
          cardinality: 'many',
          attribute: 'data-id',
          transforms: ['parseInteger'],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect((result.data.names as unknown[]).length).toBe(500);
    expect((result.data.ids as unknown[]).length).toBe(500);
    expect((result.data.names as string[])[0]).toBe('Item 1');
    expect((result.data.names as string[])[499]).toBe('Item 500');
    expect((result.data.ids as number[])[0]).toBe(1);
    expect((result.data.ids as number[])[499]).toBe(500);
  });
});
