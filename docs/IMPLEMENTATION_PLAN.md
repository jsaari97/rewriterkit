# Declarative HTML Extraction Library for Cloudflare HTMLRewriter

## 1. Overview

This document specifies a developer-facing library that turns declarative extraction rules into structured JSON using Cloudflare Workers `HTMLRewriter`.

The library is **not** responsible for fetching content. Its input is raw HTML or an existing `Response` object. Its output is extracted data plus diagnostics.

Primary goal: make `HTMLRewriter` practical for schema-driven extraction use cases such as scraping, metadata extraction, product/article parsing, and resilient selector maintenance.

## 2. Goals

### 2.1 Primary goals

- Accept raw HTML or `Response` as input.
- Accept a declarative extraction schema.
- Extract structured data using `HTMLRewriter`.
- Return extraction diagnostics in a predictable format.
- Support live-updatable extraction configs stored outside code.
- Be safe, deterministic, and easy to test.
- Work in Cloudflare Workers-compatible runtimes.

### 2.2 Non-goals

- Fetching URLs.
- Browser automation.
- JavaScript execution.
- CAPTCHA solving, anti-bot bypass, or proxy handling.
- Full DOM querying beyond what is practical with `HTMLRewriter`.
- Arbitrary user scripting in v1.
- Visual rule editor in v1.

## 3. Product positioning

This library is an **HTML extraction engine**, not a full scraper.

The intended architecture is:

1. Caller fetches or otherwise obtains HTML.
2. Caller passes HTML and extractor config into the library.
3. Library applies rules via `HTMLRewriter`.
4. Library returns structured data and diagnostics.

## 4. Runtime assumptions

- Primary target: Cloudflare Workers.
- The implementation must use the platform `HTMLRewriter` API, or a compatible abstraction for tests.
- The public API must not assume Node-only features.
- The library should be written in TypeScript.
- The package should be ESM-first.

## 5. Public API

## 5.1 Core functions

The library must expose two public entry points.

```ts
export async function extract(input: string | Response, config: ExtractorConfig, options?: ExtractOptions): Promise<ExtractionResult>;

export function validateConfig(config: unknown): ValidationResult;
```

### 5.1.1 `extract`

Behavior:

- If `input` is a `string`, treat it as raw HTML.
- If `input` is a `Response`, consume its body as HTML.
- Validate config before extraction.
- Run extraction rules.
- Return data and diagnostics.
- Never throw for ordinary selector misses.
- Throw only for fatal setup/runtime errors, such as invalid input types or impossible internal states.

### 5.1.2 `validateConfig`

Behavior:

- Validate shape and semantics of the config.
- Return structured validation errors.
- Must be safe to call independently of extraction.

## 5.2 Type definitions

### 5.2.1 Extractor config

```ts
export interface ExtractorConfig {
  version: '1';
  fields: Record<string, FieldRule>;
}
```

### 5.2.2 Field rule

```ts
export interface FieldRule {
  selectors: string[];
  type: 'text' | 'html' | 'attribute' | 'exists';
  cardinality?: 'one' | 'many';
  required?: boolean;
  default?: PrimitiveValue | PrimitiveValue[] | null;
  attribute?: string;
  transforms?: TransformSpec[];
  trim?: boolean;
  description?: string;
}
```

### 5.2.3 Primitive value

```ts
export type PrimitiveValue = string | number | boolean | null;
```

### 5.2.4 Transform spec

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

### 5.2.5 Extract options

```ts
export interface ExtractOptions {
  baseUrl?: string;
  includeDiagnostics?: boolean;
  includeMatchValues?: boolean;
  maxMatchesPerField?: number;
}
```

### 5.2.6 Result

```ts
export interface ExtractionResult {
  data: Record<string, unknown>;
  diagnostics: Record<string, FieldDiagnostics>;
  ok: boolean;
  errors: ExtractionError[];
}
```

### 5.2.7 Field diagnostics

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

### 5.2.8 Errors

```ts
export interface ExtractionError {
  code: 'INVALID_CONFIG' | 'INVALID_INPUT' | 'REQUIRED_FIELD_MISSING' | 'ATTRIBUTE_REQUIRED' | 'TRANSFORM_FAILED' | 'INTERNAL_ERROR';
  message: string;
  field?: string;
}
```

### 5.2.9 Validation result

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

## 6. Field semantics

## 6.1 Shared semantics

Each field is evaluated independently.

Rules:

- `selectors` are tried in order.
- The first selector that yields at least one usable match becomes the `winningSelector`.
- Once a winning selector is found, later selectors are not evaluated for that field.
- `cardinality` defaults to `'one'`.
- `required` defaults to `false`.
- `trim` defaults to `false`.
- `transforms` default to `[]`.

## 6.2 `text`

Extract text content from matched element(s).

For `cardinality: 'one'`:

- Use the first matched element for the winning selector.
- Extract textual content.

For `cardinality: 'many'`:

- Extract text content from all matched elements for the winning selector.
- Preserve document order.

## 6.3 `html`

Extract inner HTML from matched element(s).

For `cardinality: 'one'`:

- Use inner HTML of the first matched element.

For `cardinality: 'many'`:

- Extract inner HTML from all matched elements in document order.

Note: implementation may need buffering logic to reconstruct element inner HTML using `HTMLRewriter` callbacks. If this proves impractical in v1, `html` may be deferred behind a clearly documented limitation. `text`, `attribute`, and `exists` are mandatory for v1.

## 6.4 `attribute`

Extract a named attribute from matched element(s).

Rules:

- `attribute` is required when `type = 'attribute'`.
- Missing `attribute` is a config validation error.

For `cardinality: 'one'`:

- Return the first matched element's attribute value if present.
- If the first matched element lacks the attribute, continue checking later matches for the same selector.

For `cardinality: 'many'`:

- Return attribute values from all matched elements that contain the attribute.
- Preserve document order.

## 6.5 `exists`

Return a boolean indicating whether any element matches the winning selector.

Rules:

- `cardinality` must be treated as `'one'`.
- Any provided `cardinality: 'many'` is a validation error.
- Result is `true` if any match is found, otherwise `false`.
- `default` is allowed but generally unnecessary.
- `exists` should model the presence of the selected condition directly.

Naming guidance:

- Prefer names like `hasPrice`, `hasPromoBanner`, or `isOutOfStock`.
- Avoid names that require implicit negation, such as using selector `.out-of-stock` to populate `inStock`.

## 7. Selector behavior

## 7.1 Ordering

Selectors must be tested in the order provided.

## 7.2 Winning selector

A selector wins if it produces at least one value-compatible match.

Examples:

- For `text`, a matched element counts even if text is empty.
- For `attribute`, at least one matched element must contain the target attribute to count as usable.
- For `exists`, any matched element counts.

## 7.3 Document order

When multiple values are returned, values must preserve original document order.

## 7.4 No global deduplication in v1

If a selector matches duplicate-looking values, preserve them as-is.

## 8. Transforms

Transforms are applied after raw extraction.

Order:

1. Extract raw value.
2. Apply `trim` if enabled.
3. Apply `transforms` in order.
4. Store final value.

## 8.1 Transform semantics

### `trim`

- For strings: trim leading/trailing whitespace.
- For arrays of strings: trim each entry.

### `normalizeWhitespace`

- Collapse repeated whitespace into a single space.
- Trim ends.

### `toLowerCase`

- Lowercase string values.

### `toUpperCase`

- Uppercase string values.

### `parseNumber`

- Convert string to `number`.
- If parsing fails, record transform failure for the field.

### `parseInteger`

- Convert string to integer.
- If parsing fails, record transform failure for the field.

### `parseBoolean`

- Accept case-insensitive values: `true`, `false`, `1`, `0`, `yes`, `no`.
- Otherwise fail.

### `absoluteUrl`

- Resolve relative URLs against `options.baseUrl`.
- If no `baseUrl` is available and a relative URL is encountered, record transform failure.

### `regexReplace`

- Apply JavaScript regex replacement using the provided pattern, replacement, and optional flags.
- Invalid regex must be rejected at config validation time when possible.

## 8.2 Transform failure policy

On transform failure:

- The field is marked with an error.
- The global `ok` must become `false`.
- Extraction should continue for other fields.
- If a `default` exists, the implementation may use it only if the raw extraction produced no value. It must not silently replace a transform failure unless this behavior is explicitly added in a future version.

## 9. Defaults and required fields

## 9.1 Default semantics

If a field produces no value:

- Use `default` if provided.
- Mark `usedDefault = true`.

## 9.2 Required semantics

If a required field produces no value and no default exists:

- Add a field error.
- Add global error `REQUIRED_FIELD_MISSING`.
- Set `ok = false`.

## 10. Diagnostics

Diagnostics are a first-class feature.

Each field must produce diagnostics even when not matched.

Minimum required diagnostics:

- field name
- whether any selector matched
- selectors attempted
- winning selector if any
- match count
- whether a usable value was produced
- whether default was used
- warnings
- errors

Example:

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

## 11. Extraction algorithm

This section defines behavior, not necessarily internal implementation details.

For each field:

1. Validate field rule.
2. Initialize field diagnostics.
3. Evaluate selectors in order.
4. For each selector, observe matching elements using `HTMLRewriter`.
5. Determine whether selector is usable for the given field type.
6. If usable:
   - mark it as winner
   - collect value(s)
   - stop evaluating later selectors for that field

7. If raw value exists:
   - apply `trim`
   - apply transforms in order

8. If no value exists:
   - use default if provided

9. If still no value and field is required:
   - record required-field error

10. Store final field value in `data`.
11. Store diagnostics.

### 11.1 Internal implementation guidance

A practical implementation may compile field rules into grouped selector handlers to avoid creating inefficient per-field passes.

Recommended approach:

- Group fields by selector.
- Register one rewriter handler per unique selector.
- When an element matches, dispatch that element to all fields interested in that selector.
- Each field maintains independent state, including whether a winning selector has already been found.

This avoids repeated parsing passes and maps well to `HTMLRewriter`.

## 11.2 Recommended internal state model

The implementation should compile the public config into an internal extraction plan.

Suggested internal types:

```ts
interface CompiledPlan {
  selectors: Map<string, CompiledSelectorPlan>;
  fields: Map<string, CompiledFieldPlan>;
}

interface CompiledSelectorPlan {
  selector: string;
  fieldNames: string[];
}

interface CompiledFieldPlan {
  field: string;
  selectorOrder: string[];
  type: 'text' | 'html' | 'attribute' | 'exists';
  cardinality: 'one' | 'many';
  required: boolean;
  attribute?: string;
  trim: boolean;
  transforms: TransformSpec[];
  defaultValue?: unknown;
}

interface FieldRuntimeState {
  field: string;
  winnerFound: boolean;
  winningSelector?: string;
  selectorMatchCounts: Record<string, number>;
  rawValues: unknown[];
  finalValue: unknown;
  usedDefault: boolean;
  warnings: string[];
  errors: string[];
}
```

Behavioral requirements:

- `winnerFound` prevents later selectors from taking over once a usable selector has been established.
- `selectorMatchCounts` tracks all observed element matches for selectors that were evaluated before a winner was finalized.
- `rawValues` stores values in document order.
- For `cardinality: 'one'`, the implementation may stop collecting once a usable first value is finalized for the winning selector.
- For `cardinality: 'many'`, the implementation must continue collecting values for the winning selector through the full document.

## 12. Handling `HTMLRewriter` constraints

`HTMLRewriter` is streaming and callback-oriented. The implementation must be designed around those constraints.

### 12.1 Mandatory v1 support

Must support reliably:

- text extraction
- attribute extraction
- existence checks
- multiple fields sharing selectors
- multiple selectors per field
- many-value extraction preserving order

### 12.2 Optional / deferred v1 support

`html` extraction may be difficult depending on the exact runtime strategy.

Two acceptable v1 outcomes:

1. Full support for `html` extraction.
2. `html` declared in the schema but rejected by validation with a clear message stating that it is not yet implemented.

The implementation must choose one and document it explicitly.

## 13. Validation rules

The config validator must reject invalid configs before extraction.

Minimum validation rules:

- `version` must equal `'1'`.
- `fields` must be a non-empty object.
- Field names must be non-empty strings.
- Each field must contain a non-empty `selectors` array.
- Each selector must be a non-empty string.
- `type` must be one of the allowed values.
- `cardinality` must be `'one'` or `'many'` if present.
- `attribute` is required when `type = 'attribute'`.
- `attribute` must not be required for non-attribute types.
- `exists` may not use `cardinality: 'many'`.
- `default` shape should roughly match cardinality where feasible.
- Transform specs must be valid.
- `regexReplace.pattern` must compile as a valid regex.

## 14. Output contract

## 14.1 `data`

- `data` must include all declared field keys.
- For `cardinality: 'one'` fields with no value and no default, value must be `null`.
- For `cardinality: 'many'` fields with no value and no default, value must be `[]`.
- For `exists`, value must always be boolean if extraction completed normally.
- For `text`, `html`, and `attribute` with `cardinality: 'one'`, the value domain is:
  - transformed primitive value
  - or `null`

- For `text`, `html`, and `attribute` with `cardinality: 'many'`, the value domain is:
  - array of transformed primitive values
  - or `[]`

- Implementations must not collapse a `many` field into a scalar, even when only one match exists.
- Implementations must not wrap a `one` field in an array.

### 14.1.1 Empty-string behavior

- An empty string is still considered a produced value for `text`, `html`, or `attribute`.
- Empty strings must not automatically trigger fallback selectors.
- Fallback selectors are only attempted when no usable value is produced by the selector according to the field type semantics.
- For `attribute`, a selector is usable only if at least one matched element contains the requested attribute, even if that attribute value is an empty string.

## 14.2 `ok`

`ok` is `true` only if:

- config is valid
- no required field is missing
- no transform failed
- no fatal extraction error occurred

## 14.3 `errors`

Global `errors` is an aggregate list. Field-level details remain in diagnostics.

## 15. Examples

## 15.1 Product extraction

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
    badges: {
      selectors: ['.badge'],
      type: 'text',
      cardinality: 'many',
      trim: true,
    },
    isOutOfStock: {
      selectors: ['.out-of-stock'],
      type: 'exists',
      default: false,
    },
  },
};
```

## 15.2 Metadata extraction

```ts
const config: ExtractorConfig = {
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
};
```

## 16. Testing requirements

The implementation must include automated tests.

Minimum test coverage areas:

- config validation success and failure
- single field text extraction
- fallback selectors
- shared selector handling across multiple fields
- attribute extraction
- exists extraction
- many-cardinality extraction
- required field failure
- default value usage
- transform success
- transform failure
- order preservation for many fields
- null/empty output semantics

Recommended test style:

- fixture-based HTML inputs
- deterministic assertions on `data`
- deterministic assertions on diagnostics

## 17. Performance requirements

The implementation should be efficient enough for typical edge workloads.

Requirements:

- Do not perform one full parse pass per field.
- Prefer grouping by selector.
- Avoid storing unnecessary full-document intermediate structures.
- Preserve deterministic results.

Non-binding optimization ideas:

- precompile config into an internal plan
- cache validated/compiled configs by hash
- reuse transform functions

## 18. Security considerations

- The library must not execute arbitrary code from config.
- No `eval`, `new Function`, or equivalent.
- Regex-based transforms must be validated and applied carefully.
- The library handles untrusted HTML as input and must treat it as data only.
- Do not silently fetch linked assets or external resources.

## 19. Packaging requirements

- Package name: **rewriterkit**.
- TypeScript source.
- ESM build.
- Types included.
- README with quick-start examples.
- No mandatory runtime dependency heavier than needed for validation/testing.

Recommended package structure:

```text
/src
  /config
    schema.ts
    validate.ts
  /core
    extract.ts
    compile.ts
    state.ts
    transforms.ts
    diagnostics.ts
  /types
    public.ts
  index.ts
/tests
  fixtures/
  extract.test.ts
  validate.test.ts
```

## 20. Suggested implementation phases

### Phase 1

- public types
- config validation
- text extraction
- attribute extraction
- exists extraction
- diagnostics
- tests

### Phase 2

- many-cardinality improvements
- transform library
- config compilation optimization
- better error reporting

### Phase 3

- optional `html` extraction support
- compiled config caching
- developer playground or debug helpers

## 21. Acceptance criteria for v1

A v1 implementation is acceptable if all of the following are true:

- `extract(string, config)` works.
- `extract(Response, config)` works.
- Invalid configs are rejected.
- `text`, `attribute`, and `exists` are fully supported.
- `one` and `many` cardinality are supported where applicable.
- `required` and `default` semantics work as specified.
- Diagnostics are returned for every field.
- Extraction continues across non-fatal per-field failures.
- Tests cover the required scenarios.
- The README can explain the library in under five minutes to a new user.

## 22. Open questions

These are intentionally left for implementation/design decisions and should be resolved explicitly during development.

1. Whether `html` extraction is included in v1 or deferred.
2. Whether config compilation is exposed publicly or remains internal.
3. Whether `includeMatchValues` should expose raw intermediate values for debugging.
4. Whether `parseNumber` should support locale-aware parsing in a later version.
5. Whether nested object output paths should be supported in v2.

## 22.1 Current recommendation for v1

To keep the first implementation shippable and robust, the recommended v1 decisions are:

- Support `text`, `attribute`, and `exists` fully.
- Defer `html` extraction unless it is proven clean and reliable with the chosen `HTMLRewriter` strategy.
- Keep config compilation internal.
- Include diagnostics by default.
- Do not support nested output paths in v1.
- Treat empty strings as valid produced values.

## 23. Recommended README one-liner

> **RewriterKit** — A declarative HTML extraction library built on top of Cloudflare HTMLRewriter that turns selector configs into structured JSON from raw HTML or Response input.

Example:

```ts
import { extract } from 'rewriterkit';

const result = await extract(html, config);
```

## 24. Project name

**RewriterKit**

Rationale:

- Clearly communicates that the library builds on top of Cloudflare `HTMLRewriter`.
- "Kit" signals a toolkit that may grow beyond extraction utilities.
- Short, memorable, and suitable for npm and GitHub.
- Works naturally in code imports (`import { extract } from "rewriterkit"`).
