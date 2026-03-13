# RewriterKit

RewriterKit is a declarative HTML extraction library built on top of Cloudflare Workers `HTMLRewriter`.

## Installation

```bash
npm install rewriterkit
```

## Quick Start

```ts
import { extract, type ExtractorConfig } from 'rewriterkit';

const html = `
  <article>
    <h1 class="title">Example Product</h1>
    <span class="price"> 19.99 </span>
    <img class="hero" src="/images/item.jpg" />
  </article>
`;

const config = {
  version: '1',
  fields: {
    title: {
      selectors: ['h1.title', 'h1'],
      type: 'text',
      required: true,
      transforms: ['trim'],
    },
    price: {
      selectors: ['.price'],
      type: 'text',
      transforms: ['trim', 'parseNumber'],
    },
    imageUrl: {
      selectors: ['img.hero'],
      type: 'attribute',
      attribute: 'src',
      transforms: ['absoluteUrl'],
    },
    hasPromo: {
      selectors: ['.promo-badge'],
      type: 'exists',
    },
  },
} as const satisfies ExtractorConfig;

const result = await extract(html, config, {
  baseUrl: 'https://example.com/catalog/',
});

console.log(result.ok);
console.log(result.data); // { title, price, imageUrl, hasPromo }
console.log(result.diagnostics);
```

## Metadata Example

```ts
import { extract } from 'rewriterkit';

const result = await extract(html, {
  version: '1',
  fields: {
    title: {
      selectors: ["meta[property='og:title']", 'title'],
      type: 'attribute',
      attribute: 'content',
      required: true,
    },
    description: {
      selectors: ["meta[name='description']", "meta[property='og:description']"],
      type: 'attribute',
      attribute: 'content',
    },
    canonicalUrl: {
      selectors: ["link[rel='canonical']"],
      type: 'attribute',
      attribute: 'href',
      transforms: ['absoluteUrl'],
    },
  },
});
```

## List Extraction Example

```ts
const result = await extract(html, {
  version: '1',
  fields: {
    products: {
      kind: 'list',
      itemSelector: '.product-card',
      fields: {
        title: {
          selectors: ['.title'],
          type: 'text',
          transforms: ['trim'],
        },
        price: {
          selectors: ['.price'],
          type: 'text',
          transforms: ['parseNumber'],
        },
        url: {
          selectors: ['a.title'],
          type: 'attribute',
          attribute: 'href',
          transforms: ['absoluteUrl'],
        },
      },
    },
  },
});
```

## Optional Explicit Output Type

```ts
type PageData = {
  title: string | null;
  tags: string[];
};

const result = await extract<PageData>(html, {
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
```

## API

### `extract(input, config, options?)`

```ts
function extract<TConfig extends ExtractorConfig>(
  input: string | Response,
  config: TConfig,
  options?: ExtractOptions,
): Promise<ExtractionResult<InferExtractedData<TConfig>>>;

function extract<TData>(
  input: string | Response,
  config: ExtractorConfig,
  options?: ExtractOptions,
): Promise<ExtractionResult<TData>>;
```

Behavior:
- Validates config before extraction.
- Returns `ok: false` with `INVALID_CONFIG` errors for invalid config.
- Uses selector priority order and finalizes the winning selector after stream completion.
- Continues extraction across non-fatal field errors.
- Throws runtime `ExtractionRuntimeError` with code `INVALID_INPUT` or `INTERNAL_ERROR` for fatal setup/runtime failures.

Typed output:
- Inferred by default from config literals (`as const satisfies ExtractorConfig`).
- Optional override: use `extract<MyDataShape>(...)` to force a custom output type.

Value inference:
- `type: 'exists'` -> `boolean`
- `type: 'text' | 'attribute'` -> `string | null` (`string[]` for `cardinality: 'many'`)
- `required: true` on one-cardinality `text`/`attribute` fields removes `null`
- terminal `parseNumber` / `parseInteger` -> `number`
- terminal `parseBoolean` -> `boolean`
- list rules -> arrays of inferred item objects

### `validateConfig(config)`

```ts
function validateConfig(config: unknown): ValidationResult;
```

Returns structured validation errors without running extraction.

## Supported Field Types

- `text`
- `attribute`
- `exists`

`html` is intentionally rejected in v1.

## Transform Support

Built-in transforms:
- `trim`
- `normalizeWhitespace`
- `toLowerCase`
- `toUpperCase`
- `parseNumber`
- `parseInteger`
- `parseBoolean`
- `absoluteUrl`
- `{ kind: 'regexReplace', pattern, replacement, flags? }`

## Result Contract

`ExtractionResult<TData>` returns:
- `data`: extracted output for all declared fields.
- `diagnostics`: extraction diagnostics split by top-level fields and lists.
- `ok`: overall success flag.
- `errors`: aggregate non-fatal extraction errors.

Missing value behavior:
- `one` cardinality returns `null`.
- `many` cardinality returns `[]`.

## Diagnostics Example

```json
{
  "fields": {
    "title": {
      "field": "title",
      "matched": true,
      "selectorTried": ["h1", ".title"],
      "winningSelector": "h1",
      "matchCount": 1,
      "valueProduced": true,
      "usedDefault": false,
      "required": true,
      "errors": []
    }
  },
  "lists": {
    "products": {
      "field": "products",
      "itemSelector": ".product-card",
      "itemCount": 2,
      "errors": [],
      "items": [
        {
          "index": 0,
          "fields": {
            "title": {
              "field": "title",
              "matched": true,
              "selectorTried": [".title"],
              "winningSelector": ".title",
              "matchCount": 1,
              "valueProduced": true,
              "usedDefault": false,
              "required": false,
              "errors": []
            }
          }
        }
      ]
    }
  }
}
```

## Development

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run check
```

## Cloudflare Workers Notes

RewriterKit is designed around Workers `HTMLRewriter` semantics, including streaming text chunks.

Reference docs:
- [HTMLRewriter API](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
