# RewriterKit

Declarative HTML extraction for runtimes that expose the `HTMLRewriter` API.

## Overview

RewriterKit turns selector-based extraction rules into typed data output. You define a config once, run `extract()`, and receive:

- extracted `data` with type-inference from your config
- per-field `diagnostics` on selector matches, winning selector, and transform usage
- non-fatal `errors` encountered during extraction (for example missing required field or transform failure)
- an overall `ok` flag indicating whether extraction succeeded without any errors

## Features

- Selector priority/fallback behavior with deterministic output
- Cardinality support (`one` and `many`)
- Built-in transforms (string normalization, parsing, URL resolution, regex replacement)
- List extraction (`kind: 'list'`) for array-of-object output
- Structured validation via `validateConfig()`
- Strong TypeScript inference from config literals

## Installation

```bash
npm install rewriterkit
```

## Runtime Requirements

RewriterKit requires a runtime with global `HTMLRewriter` and standard Fetch API primitives (`Response`, `URL`).

- Designed for Cloudflare Workers/workerd-compatible runtimes
- If `HTMLRewriter` is missing at runtime, `extract()` throws `ExtractionRuntimeError` with code `INTERNAL_ERROR`

HTMLRewriter reference:

- [Cloudflare Workers HTMLRewriter API](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)

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
console.log(result.errors);
console.log(result.diagnostics);
```

## Cloudflare Workers Example

```ts
import { extract, type ExtractorConfig } from 'rewriterkit';

const config = {
  version: '1',
  fields: {
    title: {
      selectors: ['h1', 'title'],
      type: 'text',
      transforms: ['trim'],
      required: true,
    },
    description: {
      selectors: ["meta[name='description']"],
      type: 'attribute',
      attribute: 'content',
      transforms: ['trim'],
    },
    canonicalUrl: {
      selectors: ["link[rel='canonical']"],
      type: 'attribute',
      attribute: 'href',
      transforms: ['absoluteUrl'],
    },
  },
} as const satisfies ExtractorConfig;

export default {
  async fetch(request: Request): Promise<Response> {
    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get('url') ?? 'https://example.com/';

    const upstream = await fetch(targetUrl);
    const result = await extract(upstream, config, {
      baseUrl: upstream.url,
    });

    return Response.json({
      targetUrl,
      ok: result.ok,
      data: result.data,
      errors: result.errors,
      diagnostics: result.diagnostics,
    });
  },
};
```

## API Reference

### `extract(input, config, options?)`

```ts
function extract<TConfig extends ExtractorConfig>(
  input: string | Response,
  config: TConfig,
  options?: ExtractOptions,
): Promise<ExtractionResult<InferExtractedData<TConfig>>>;

function extract<TData>(input: string | Response, config: ExtractorConfig, options?: ExtractOptions): Promise<ExtractionResult<TData>>;
```

Behavior:

- Validates config before extraction.
- Returns `ok: false` with `INVALID_CONFIG` entries in `errors` when config is invalid.
- Preserves selector order priority. For each field, the first selector that produces usable values wins.
- Continues extraction after non-fatal field/list issues (for example missing required field or transform failures).
- Throws `ExtractionRuntimeError` for fatal runtime/setup failures (`INVALID_INPUT`, `INTERNAL_ERROR`).

Typed output:

- Preferred: config literals with `as const satisfies ExtractorConfig`.
- Override: `extract<MyDataShape>(...)` when you want an explicit data contract.

### `validateConfig(config)`

```ts
function validateConfig(config: unknown): ValidationResult;
```

Returns `{ ok, errors }` without executing extraction.

### `ExtractorConfig`

```ts
interface ExtractorConfig {
  version: '1';
  fields: Record<string, OutputRule>;
}
```

Notes:

- `version` must be exactly `'1'`.
- `fields` must contain at least one entry.

### `FieldRule` (`text`, `attribute`, `exists`)

| Option        | Type                                         | Required    | Notes                                                   |
| ------------- | -------------------------------------------- | ----------- | ------------------------------------------------------- |
| `selectors`   | `string[]`                                   | yes         | Non-empty selector list in priority order.              |
| `type`        | `'text' \| 'attribute' \| 'exists'`          | yes         | `html` is not supported in v1.                          |
| `cardinality` | `'one' \| 'many'`                            | no          | Defaults to `'one'`.                                    |
| `required`    | `boolean`                                    | no          | Allowed for `text`/`attribute` only.                    |
| `default`     | `PrimitiveValue \| PrimitiveValue[] \| null` | no          | For `many`, must be an array. Not allowed for `exists`. |
| `attribute`   | `string`                                     | conditional | Required when `type: 'attribute'`; invalid otherwise.   |
| `transforms`  | `TransformSpec[]`                            | no          | Applied left-to-right. Not allowed for `exists`.        |
| `description` | `string`                                     | no          | Optional metadata only.                                 |

`exists` constraints in v1:

- cannot use `cardinality: 'many'`
- cannot use `default`
- cannot use `required`
- cannot use `transforms`

### `ListRule`

```ts
interface ListRule {
  kind: 'list';
  itemSelector: string;
  fields: Record<string, FieldRule>;
}
```

Notes:

- Produces `Array<Record<string, ...>>` under the top-level field key.
- `fields` must be non-empty.
- Nested lists are not supported in v1.

### `TransformSpec`

Built-in string transforms:

- `trim`
- `normalizeWhitespace`
- `toLowerCase`
- `toUpperCase`
- `parseNumber`
- `parseInteger`
- `parseBoolean`
- `absoluteUrl`

Object transform:

```ts
{
  kind: 'regexReplace';
  pattern: string;
  replacement: string;
  flags?: string;
}
```

Transform behavior:

- Applied in order.
- For `cardinality: 'many'`, the chain is applied to each array item.
- `parseNumber` uses JS numeric parsing and fails on `NaN`.
- `parseInteger` accepts only whole-number strings (`+/-` optional).
- `parseBoolean` accepts (case-insensitive): `true`, `false`, `1`, `0`, `yes`, `no`.
- `absoluteUrl` resolves absolute URLs directly; relative URLs require `ExtractOptions.baseUrl`.

### `ExtractOptions`

```ts
interface ExtractOptions {
  baseUrl?: string;
}
```

Use `baseUrl` when any extracted value may need `absoluteUrl` resolution from relative URLs.

### `ExtractionResult<TData>`

```ts
interface ExtractionResult<TData = Record<string, unknown>> {
  data: TData;
  diagnostics: ExtractionDiagnostics;
  ok: boolean;
  errors: ExtractionError[];
}
```

Missing value behavior:

- `cardinality: 'one'` -> `null` when no value and no default
- `cardinality: 'many'` -> `[]` when no value and no default

## Diagnostics and Errors

`errors` contains non-fatal extraction errors that still return a result object:

- `INVALID_CONFIG`
- `REQUIRED_FIELD_MISSING`
- `TRANSFORM_FAILED`

Fatal failures throw `ExtractionRuntimeError`:

- `INVALID_INPUT` (input is not `string` or `Response`)
- `INTERNAL_ERROR` (runtime setup/rewriter failures)

Diagnostics are always returned on successful extraction flow and include:

- top-level field diagnostics (`diagnostics.fields`)
- list-level diagnostics and per-item field diagnostics (`diagnostics.lists`)
- selector attempts, winning selector, match counts, and whether defaults were used

## Development

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run check
```

## License

MIT
