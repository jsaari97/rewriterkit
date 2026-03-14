# Declarative HTML Extraction Library for Cloudflare HTMLRewriter

## 1. Overview

This document specifies RewriterKit, a developer-facing library that turns declarative extraction rules into structured JSON using Cloudflare Workers `HTMLRewriter`.

The library is not responsible for fetching content. Its input is raw HTML or an existing `Response`. Its output is extracted data plus diagnostics.

Primary goal: make `HTMLRewriter` practical for schema-driven extraction use cases such as scraping, metadata extraction, product/article parsing, and resilient selector maintenance.

Normative language:

- `must` indicates a required v1 behavior.
- `should` indicates guidance or a non-blocking recommendation.

## 2. Goals

### 2.1 Primary goals

- Accept raw HTML or `Response` as input.
- Accept a declarative extraction schema.
- Extract structured data using `HTMLRewriter`.
- Return extraction diagnostics in a predictable format.
- Support both scalar field extraction and list-of-object extraction.
- Be safe, deterministic, and easy to test.
- Work in Cloudflare Workers-compatible runtimes.

### 2.2 Non-goals

- Fetching URLs.
- Browser automation.
- JavaScript execution.
- CAPTCHA solving, anti-bot bypass, or proxy handling.
- Arbitrary user scripting in v1.
- Visual rule editor in v1.
- Deep recursive nested lists in v1 (list-in-list remains out of scope).

## 3. Product positioning

RewriterKit is an HTML extraction engine, not a full scraper.

Intended architecture:

1. Caller fetches or otherwise obtains HTML.
2. Caller passes HTML and extractor config into the library.
3. Library applies rules via `HTMLRewriter`.
4. Library returns structured data and diagnostics.

## 4. Runtime assumptions

- Primary target: Cloudflare Workers.
- Implementation must use platform `HTMLRewriter` API, or compatible abstraction for tests.
- Public API must not assume Node-only features.
- Library must be TypeScript.
- Package must be ESM-first.

## 5. Public API

## 5.1 Core functions

```ts
export async function extract(input: string | Response, config: ExtractorConfig, options?: ExtractOptions): Promise<ExtractionResult>;

export function validateConfig(config: unknown): ValidationResult;
```

### 5.1.1 `extract`

Behavior:

- If `input` is a `string`, treat it as raw HTML.
- If `input` is a `Response`, consume its body as HTML.
- Validate config before extraction.
- If config is invalid, return `ok: false` with `INVALID_CONFIG` errors. Do not throw for invalid config.
- Return data and diagnostics.
- Never throw for ordinary selector misses.
- Throw only for fatal setup/runtime errors (`INVALID_INPUT`, `INTERNAL_ERROR`).
- On per-field extraction errors (transform failure or required-field miss), return `ok: false` and continue evaluating other rules.

### 5.1.2 `validateConfig`

Behavior:

- Validate shape and semantics of config.
- Return structured validation errors.
- Must be safe to call independently of extraction.

## 5.2 Type definitions

### 5.2.1 Extractor config

```ts
export interface ExtractorConfig {
  version: '1';
  fields: Record<string, OutputRule>;
}
```

### 5.2.2 Output rule

```ts
export type OutputRule = FieldRule | ListRule;
```

### 5.2.3 Field rule

```ts
export interface FieldRule {
  kind?: 'field';
  selectors: string[];
  type: 'text' | 'attribute' | 'exists';
  cardinality?: 'one' | 'many';
  required?: boolean;
  default?: PrimitiveValue | PrimitiveValue[] | null;
  attribute?: string;
  transforms?: TransformSpec[];
  trim?: boolean;
  description?: string;
}
```

### 5.2.4 List rule

```ts
export interface ListRule {
  kind: 'list';
  itemSelector: string;
  fields: Record<string, FieldRule>;
}
```

### 5.2.5 Primitive value

```ts
export type PrimitiveValue = string | number | boolean | null;
```

### 5.2.6 Transform spec

```ts
export type TransformSpec =
  | 'trim'
  | 'normalizeWhitespace'
  | 'toLowerCase'
  | 'toUpperCase'
  | 'parseNumber'
  | 'parseInteger'
  | 'parseBoolean'
  | 'absoluteUrl'
  | {
      kind: 'regexReplace';
      pattern: string;
      replacement: string;
      flags?: string;
    };
```

### 5.2.7 Extract options

```ts
export interface ExtractOptions {
  baseUrl?: string;
}
```

### 5.2.8 Field diagnostics

```ts
export interface FieldDiagnostics {
  field: string;
  matched: boolean;
  selectorTried: string[];
  winningSelector?: string;
  matchCount: number;
  valueProduced: boolean;
  usedDefault: boolean;
  required: boolean;
  warnings: string[];
  errors: string[];
}
```

### 5.2.9 List diagnostics

```ts
export interface ListDiagnostics {
  field: string;
  itemSelector: string;
  itemCount: number;
  warnings: string[];
  errors: string[];
  items: Array<{
    index: number;
    fields: Record<string, FieldDiagnostics>;
  }>;
}
```

### 5.2.10 Extraction diagnostics

```ts
export interface ExtractionDiagnostics {
  fields: Record<string, FieldDiagnostics>;
  lists: Record<string, ListDiagnostics>;
}
```

### 5.2.11 Errors

```ts
export interface ExtractionError {
  code: 'INVALID_CONFIG' | 'INVALID_INPUT' | 'REQUIRED_FIELD_MISSING' | 'TRANSFORM_FAILED' | 'INTERNAL_ERROR';
  message: string;
  field?: string;
  list?: string;
  itemIndex?: number;
}
```

### 5.2.12 Result

```ts
export interface ExtractionResult {
  data: Record<string, unknown>;
  diagnostics: ExtractionDiagnostics;
  ok: boolean;
  errors: ExtractionError[];
}
```

### 5.2.13 Validation result

```ts
export interface ValidationResult {
  ok: boolean;
  errors: Array<{
    path: string;
    code: string;
    message: string;
  }>;
}
```

## 6. Rule semantics

## 6.1 Rule discrimination

Top-level `fields.<key>` rule classification:

- `kind: 'list'` => `ListRule`
- `kind: 'field'` or no `kind` => `FieldRule`

Invalid cases:

- If `kind` is present and not `'list'` or `'field'`, validation must fail.
- If `kind: 'list'` and field-only properties (`selectors`, `type`, etc.) are present at that level, validation must fail.

## 6.2 Field semantics (top-level or inside list)

Shared semantics:

- `selectors` are tried in order.
- Winner is first selector yielding at least one usable match.
- Winner selection is finalized after document stream completion.
- `cardinality` defaults to `'one'`.
- `required` defaults to `false`.
- `trim` defaults to `false`.
- `transforms` default to `[]`.

### 6.2.1 `text`

- `one`: use first matched element for winner selector; extract text.
- `many`: extract text from all matched elements for winner selector in document order.

### 6.2.2 `attribute`

- `attribute` is required.
- `one`: return first element's attribute value if present; otherwise continue later matches for same selector.
- `many`: return all matched attribute values where attribute exists, in document order.

### 6.2.3 `exists`

- Always treated as `one`.
- `cardinality: 'many'` is validation error.
- `default` is validation error.
- `required` is validation error.
- `true` if any winner-selector match exists, else `false`.

Naming guidance:

- Prefer direct names (`hasPrice`, `isOutOfStock`).
- Avoid implicit negation (`inStock` sourced from `.out-of-stock`).

## 6.3 List semantics

For `ListRule`:

- `itemSelector` defines item container boundaries.
- Every matched item container finalizes one object in output array.
- Item objects use nested `fields` rules.
- Field matches are routed to nearest active item context for that list.
- Output item order must match document order.

## 7. Selector behavior

- Selectors are tested in configured order.
- A selector is usable if it yields value-compatible matches:
  - `text`: any element match counts (including empty string text).
  - `attribute`: at least one match with requested attribute.
  - `exists`: any match.
- For `many`, values preserve document order.
- No global deduplication in v1.

## 8. Transforms

Order:

1. Extract raw value.
2. Apply `trim` if enabled.
3. Apply `transforms` in order.
4. Store final value.

Applies equally to top-level fields and list-item fields.

Supported transforms and semantics:

- `trim`
- `normalizeWhitespace`
- `toLowerCase`
- `toUpperCase`
- `parseNumber`
- `parseInteger`
- `parseBoolean`
- `absoluteUrl`
- `regexReplace`

Failure policy:

- Field gets error.
- Global `ok = false`.
- Continue extraction.
- Value becomes empty value (`null` for `one`, `[]` for `many`).
- Default is not applied after transform failure.

## 9. Defaults and required

If field produces no value:

- Use `default` if provided.
- Mark `usedDefault = true`.

If still no value and `required`:

- Add `REQUIRED_FIELD_MISSING`.
- Set `ok = false`.
- For list fields, include `list` and `itemIndex` on error.

## 10. Diagnostics

Diagnostics are first-class and always returned.

Contract:

- `diagnostics.fields` for top-level field rules.
- `diagnostics.lists` for list rules.
- Each list includes per-item per-field diagnostics.

Minimum per-field diagnostics:

- field name
- matched flag
- selectors tried
- winning selector
- match count
- valueProduced
- usedDefault
- required
- warnings
- errors

## 11. Extraction algorithm

High-level behavior:

1. Validate config.
2. Compile plan for top-level fields + list rules.
3. Initialize runtime state.
4. Register handlers for:
   - list `itemSelector` boundaries
   - top-level field selectors
   - list-item field selectors
5. Stream document once with `HTMLRewriter`.
6. On list item end tag, finalize item fields and append item object.
7. After stream, finalize top-level fields.
8. Return `data`, `diagnostics`, `errors`, `ok`.

### 11.1 Internal implementation guidance

Recommended:

- Compile config into grouped selector dispatch tables.
- Use one rewriter pass.
- Keep independent per-rule state.
- Finalize winners after stream completion (or item completion for list-item fields).

## 12. Handling HTMLRewriter constraints

Must support reliably:

- text extraction
- attribute extraction
- existence checks
- shared selectors across multiple rules
- multiple selectors per rule
- many-value extraction preserving order
- list extraction with item scoping via `itemSelector`

Locked v1 decision:

- `type: 'html'` remains unsupported and must fail validation.

## 13. Validation rules

Minimum required:

- `version === '1'`
- `fields` is non-empty object
- top-level field names are non-empty
- top-level rule `kind` discrimination must be enforced
- unknown `kind` must fail
- list rule requirements:
  - `kind: 'list'`
  - non-empty `itemSelector`
  - non-empty nested `fields`
  - nested list rules are rejected in v1
- field rule requirements (top-level and list-item):
  - non-empty `selectors`
  - valid `type`
  - valid optional `cardinality`
  - `attribute` required only for `type: 'attribute'`
  - `exists` restrictions (`no default`, `no required`, `no many`)
  - `default` shape matches cardinality when statically checkable
  - transform specs valid
  - `regexReplace.pattern` compiles

## 14. Output contract

## 14.1 `data`

- Includes all declared top-level `fields` keys.
- Top-level field rules produce scalar/array outputs.
- List rules produce arrays of objects.
- Missing top-level or item field values:
  - `one` => `null`
  - `many` => `[]`
- `exists` values are always boolean on normal completion.

Empty-string behavior:

- Empty string counts as produced value for `text` and `attribute`.
- Empty strings do not trigger fallback selectors.

## 14.2 `ok`

`ok` is `true` only if:

- config valid
- no required-field misses
- no transform failures
- no fatal runtime errors

## 14.3 `errors`

Aggregate error list.

Codes:

- `INVALID_CONFIG`
- `INVALID_INPUT`
- `REQUIRED_FIELD_MISSING`
- `TRANSFORM_FAILED`
- `INTERNAL_ERROR`

For invalid config response:

- `data` must be `{}`
- `diagnostics` must be `{ fields: {}, lists: {} }`
- `errors` must contain one or more `INVALID_CONFIG`

## 15. Examples

## 15.1 Product extraction (top-level fields)

```ts
const config: ExtractorConfig = {
  version: '1',
  fields: {
    title: {
      selectors: ['h1.product-title', 'h1'],
      type: 'text',
      required: true,
      trim: true,
    },
    price: {
      selectors: ['.price', '[data-price]'],
      type: 'text',
      trim: true,
      transforms: ['normalizeWhitespace'],
    },
    imageUrl: {
      selectors: ['.gallery img', 'img.product-image'],
      type: 'attribute',
      attribute: 'src',
      required: true,
      transforms: ['absoluteUrl'],
    },
    isOutOfStock: {
      selectors: ['.out-of-stock'],
      type: 'exists',
    },
  },
};
```

## 15.2 List extraction (products)

```ts
const config: ExtractorConfig = {
  version: '1',
  fields: {
    products: {
      kind: 'list',
      itemSelector: '.product-card',
      fields: {
        title: {
          selectors: ['.title'],
          type: 'text',
          trim: true,
          required: true,
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
};
```

## 16. Testing requirements

Minimum coverage areas:

- config validation success/failure
- invalid `kind` and list-rule validation errors
- single field text extraction
- fallback selectors
- shared selector handling
- attribute extraction
- exists extraction
- many-cardinality extraction
- required/default semantics
- transform success/failure
- order preservation
- null/empty output semantics
- list extraction (10+ items)
- missing list-item field behavior
- per-item required errors with `list` + `itemIndex`
- nested-text behavior in list items

Recommended style:

- fixture-based HTML
- deterministic assertions on `data`
- deterministic assertions on `diagnostics`

## 17. Performance requirements

- Do not perform one parse pass per rule.
- Prefer grouped selectors.
- Avoid unnecessary full-document structures.
- Preserve deterministic results.

Non-binding optimizations:

- precompile config
- cache validated/compiled config by hash
- reuse transform functions

## 18. Security considerations

- No execution of arbitrary config code.
- No `eval` / `new Function`.
- Regex transforms validated and applied safely.
- Treat untrusted HTML as data.
- Do not fetch external resources.

## 19. Packaging requirements

- Package name: `rewriterkit`.
- TypeScript source.
- ESM build.
- Types included.
- README quick-start examples.
- No unnecessary runtime-heavy dependencies.

## 20. Suggested implementation phases

### Phase 1

- public types
- config validation
- text/attribute/exists extraction
- diagnostics
- deterministic selector-priority finalization
- tests

### Phase 2

- transform library
- config compilation optimization
- better error reporting
- cache validated/compiled config by hash

### Phase 3

- list extraction (`kind: 'list'` + `itemSelector`)
- per-item diagnostics and error metadata
- hardening tests
- docs polish

### Phase 4 (v1.1+)

- optional `html` extraction
- debug-only match-value introspection
- developer playground/debug helpers

## 21. Acceptance criteria for v1

v1 is acceptable if:

- `extract(string, config)` works.
- `extract(Response, config)` works.
- invalid configs are rejected.
- `text`, `attribute`, `exists` are fully supported.
- `kind: 'list'` list extraction is supported.
- `html` is explicitly rejected in v1 validation.
- `one`/`many` cardinality semantics are correct.
- `required` and `default` semantics work.
- diagnostics return both top-level field and list-item details.
- extraction continues across non-fatal per-field failures.
- tests cover required scenarios.
- README can onboard a new user quickly.

## 22. Post-v1 backlog (non-blocking)

1. `html` extraction type and stream-safe semantics.
2. Public compiled-config API.
3. Debug-only exposure of raw match values.
4. Locale-aware numeric parsing extensions.
5. Deep recursive list extraction.

## 23. Recommended README one-liner

> RewriterKit — A declarative HTML extraction library built on Cloudflare HTMLRewriter that turns selector configs into structured JSON from raw HTML or Response input.

## 24. Project name

RewriterKit

Rationale:

- Communicates foundation on Cloudflare `HTMLRewriter`.
- "Kit" signals extensible toolkit.
- Short, memorable, import-friendly.
