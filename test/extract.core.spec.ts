import { describe, expect, it } from 'vitest';
import { extract } from '../src';

describe('extract core behavior', () => {
  it('extracts text from an HTML string', async () => {
    const html = '<main><h1> Product Title </h1></main>';

    const result = await extract(html, {
      version: '1',
      fields: {
        title: {
          selectors: ['h1'],
          type: 'text',
          transforms: ['trim'],
          required: true,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data.title).toBe('Product Title');
    expect(result.diagnostics.fields.title.winningSelector).toBe('h1');
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
    expect(result.diagnostics.fields.title.winningSelector).toBe('h1');
    expect(result.diagnostics.fields.title.valueProduced).toBe(true);
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
          transforms: ['trim'],
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
          transforms: ['trim'],
        },
        titles: {
          selectors: ['h1.title'],
          type: 'text',
          cardinality: 'many',
          transforms: ['trim'],
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
    expect(result.diagnostics.fields.items.winningSelector).toBe('.item');
    expect(result.diagnostics.fields.items.matchCount).toBe(2);
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
    expect(result.diagnostics.fields.title.usedDefault).toBe(true);
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
    expect(result.diagnostics.fields.imageUrl.selectorTried).toEqual(['img.hero', 'img.fallback']);
    expect(result.diagnostics.fields.imageUrl.matched).toBe(true);
    expect(result.diagnostics.fields.imageUrl.winningSelector).toBe('img.fallback');
    expect(result.diagnostics.fields.imageUrl.matchCount).toBe(1);
    expect(result.diagnostics.fields.imageUrl.valueProduced).toBe(true);
    expect(result.diagnostics.fields.imageUrl.usedDefault).toBe(false);
    expect(result.diagnostics.fields.imageUrl.errors).toEqual([]);
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
          transforms: ['trim'],
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
    expect(String((result.data.names as unknown[])[0])).toBe('Item 1');
    expect(String((result.data.names as unknown[])[499])).toBe('Item 500');
    expect((result.data.ids as number[])[0]).toBe(1);
    expect((result.data.ids as number[])[499]).toBe(500);
  });
});
