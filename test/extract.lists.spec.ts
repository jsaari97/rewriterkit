import { describe, expect, it } from 'vitest';
import { extract } from '../src';

describe('extract list behavior', () => {
  it('extracts list-of-objects under top-level fields', async () => {
    const html = `
      <section>
        <article class="product">
          <h2 class="title">One</h2>
          <span class="price">12.50</span>
          <a class="link" href="/one">One</a>
        </article>
        <article class="product">
          <h2 class="title">Two</h2>
          <a class="link" href="/two">Two</a>
        </article>
      </section>
    `;

    const result = await extract(
      html,
      {
        version: '1',
        fields: {
          products: {
            kind: 'list',
            itemSelector: '.product',
            fields: {
              title: {
                selectors: ['.title'],
                type: 'text',
                transforms: ['trim'],
                required: true,
              },
              price: {
                selectors: ['.price'],
                type: 'text',
                transforms: ['parseNumber'],
              },
              url: {
                selectors: ['a.link'],
                type: 'attribute',
                attribute: 'href',
                transforms: ['absoluteUrl'],
              },
            },
          },
        },
      },
      { baseUrl: 'https://example.com/' },
    );

    expect(result.ok).toBe(true);
    expect(result.data.products).toEqual([
      { title: 'One', price: 12.5, url: 'https://example.com/one' },
      { title: 'Two', price: null, url: 'https://example.com/two' },
    ]);
    expect(result.diagnostics.lists.products.itemCount).toBe(2);
    expect(result.diagnostics.lists.products.items[0].fields.title.winningSelector).toBe('.title');
    expect(result.diagnostics.lists.products.items[1].fields.price.valueProduced).toBe(false);
  });

  it('adds per-item errors for required list fields', async () => {
    const html = `
      <div class="product"><span class="title">Alpha</span></div>
      <div class="product"><span class="price">10</span></div>
    `;

    const result = await extract(html, {
      version: '1',
      fields: {
        products: {
          kind: 'list',
          itemSelector: '.product',
          fields: {
            title: {
              selectors: ['.title'],
              type: 'text',
              required: true,
            },
            price: {
              selectors: ['.price'],
              type: 'text',
            },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    const secondProduct = result.data.products[1];
    expect(secondProduct.title).toBeNull();
    expect(
      result.errors.some(
        (error) => error.code === 'REQUIRED_FIELD_MISSING' && error.list === 'products' && error.itemIndex === 1 && error.field === 'title',
      ),
    ).toBe(true);
  });
});
