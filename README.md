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

const config: ExtractorConfig = {
  version: '1',
  fields: {
    title: {
      selectors: ['h1.title', 'h1'],
      type: 'text',
      required: true,
      trim: true,
    },
    price: {
      selectors: ['.price'],
      type: 'text',
      trim: true,
      transforms: ['parseNumber'],
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
};

const result = await extract(html, config, {
  baseUrl: 'https://example.com/catalog/',
});

console.log(result.ok);
console.log(result.data);
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

## API

### `extract(input, config, options?)`

```ts
function extract(input: string | Response, config: ExtractorConfig, options?: ExtractOptions): Promise<ExtractionResult>;
```

Behavior:
- Validates config before extraction.
- Returns `ok: false` with `INVALID_CONFIG` errors for invalid config.
- Uses selector priority order and finalizes the winning selector after stream completion.
- Continues extraction across non-fatal field errors.
- Throws runtime `ExtractionRuntimeError` with code `INVALID_INPUT` or `INTERNAL_ERROR` for fatal setup/runtime failures.

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

`ExtractionResult` returns:
- `data`: extracted output for all declared fields.
- `diagnostics`: per-field extraction metadata.
- `ok`: overall success flag.
- `errors`: aggregate non-fatal extraction errors.

Missing value behavior:
- `one` cardinality returns `null`.
- `many` cardinality returns `[]`.

## Diagnostics Example

```json
{
  "title": {
    "field": "title",
    "matched": true,
    "selectorTried": ["h1", ".title"],
    "winningSelector": "h1",
    "matchCount": 1,
    "valueProduced": true,
    "usedDefault": false,
    "required": true,
    "warnings": [],
    "errors": []
  }
}
```

## Development

```bash
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
