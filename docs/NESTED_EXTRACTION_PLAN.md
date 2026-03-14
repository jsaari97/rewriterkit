# Nested Extraction Plan (v1, Unified `fields` Map)

## 1. Purpose

This document defines how RewriterKit v1 adds list/object extraction using a **single top-level `fields` map**.

Primary target use case:

- Extract repeating item lists (for example product cards) as:
  - `products: Array<{ title, price, url, ... }>`

## 2. Why This Is Needed

Current implementation supports multi-value extraction (`cardinality: 'many'`) but returns parallel arrays.

Parallel arrays are insufficient when:

- Per-item fields are missing inconsistently.
- We need stable object grouping at item boundaries.
- Caller code should not perform index zipping.

## 3. Scope

### In scope

- List-of-objects extraction.
- Per-item selector evaluation and transforms.
- Per-item diagnostics and errors.
- Single-pass HTMLRewriter-compatible runtime.
- Unified top-level config model for flat fields and lists.

### Out of scope (initial nested release)

- Arbitrary deep recursive list nesting (lists inside lists).
- Cross-item joins/references.
- Computed fields/expressions.

## 4. v1 Strategy

Because the package is not published yet, nested extraction will be integrated into **v1** directly.

Design rules:

- Keep `version: '1'`.
- Keep top-level key as `fields`.
- Widen `fields` values from only `FieldRule` to `OutputRule` (`FieldRule | ListRule`).
- Keep existing field semantics unchanged.

## 5. Proposed v1 Config Shape

```ts
export interface ExtractorConfig {
  version: '1';
  fields: Record<string, OutputRule>;
}

export type OutputRule = FieldRule | ListRule;

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

export interface ListRule {
  kind: 'list';
  itemSelector: string;
  fields: Record<string, FieldRule>;
}
```

Validation baseline:

- `fields` must be a non-empty object.
- each top-level key maps to either a valid `FieldRule` or `ListRule`.

### Example

```ts
const config = {
  version: '1',
  fields: {
    pageTitle: {
      selectors: ['h1.page-title', 'h1'],
      type: 'text',
      trim: true,
    },
    products: {
      kind: 'list',
      itemSelector: '.product-card',
      fields: {
        title: {
          selectors: ['.title', 'h2'],
          type: 'text',
          required: true,
          trim: true,
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
        isOutOfStock: {
          selectors: ['.out-of-stock'],
          type: 'exists',
        },
      },
    },
  },
};
```

Expected output:

```json
{
  "pageTitle": "Products",
  "products": [
    { "title": "A", "price": 9.99, "url": "https://x/a", "isOutOfStock": false },
    { "title": "B", "price": null, "url": "https://x/b", "isOutOfStock": true }
  ]
}
```

## 6. Rule Discrimination

Top-level `fields.<key>` rule classification:

- `kind: 'list'` => `ListRule`
- `kind: 'field'` or no `kind` => `FieldRule`

Invalid cases:

- if `kind` is present and not `'list'` or `'field'`, validation fails.
- if `kind: 'list'` and field-rule-only properties are present at that level, validation fails.

## 7. Semantics

## 7.1 Output mapping

- Every top-level `fields` key becomes a key in `result.data`.
- Field rules produce scalar/array values.
- List rules produce arrays of objects.

## 7.2 Item scoping (for list rules)

- `itemSelector` match opens an item context.
- Field matches are routed to the **nearest active item context** in that list.
- On item end tag, item context finalizes and is appended in document order.

## 7.3 Selector winner logic

Per field (top-level field or list-item field):

- Try selectors in configured order.
- First usable selector wins.
- Use only winner values for final value.

Usability rules remain:

- `text`: matched element counts (including empty string content).
- `attribute`: usable only if at least one matched element has attribute.
- `exists`: any match counts.

## 7.4 Defaults and required

Per field:

- If no value produced, apply default if provided.
- If still missing and required, emit `REQUIRED_FIELD_MISSING`.

## 7.5 Cardinality

- `one`: scalar or `null`.
- `many`: array preserving document order.
- No automatic collapse from array to scalar.

## 8. Runtime Design (HTMLRewriter-Compatible)

## 8.1 Compile plan

Compile `fields` into:

- top-level field plans
- list plans keyed by output key
- selector dispatch tables for:
  - list item selectors
  - list field selectors
  - top-level field selectors

## 8.2 Streaming state

For each list output key:

- `activeItemStack: ItemRuntimeState[]`
- `results: unknown[]`

For each active item:

- field runtime state equivalent to existing v1 field state.

For top-level fields:

- keep existing runtime state logic.

## 8.3 Event handling

1. `element` matched by list `itemSelector`:
   - create new `ItemRuntimeState`
   - push on stack
   - register `onEndTag` to finalize and pop this item

2. `element` / `text` matched by list field selectors:
   - resolve target item as top of `activeItemStack`
   - collect candidates for that item+field

3. on item end:
   - finalize all item fields
   - apply transforms/default/required
   - append finalized object to list output array

4. top-level fields continue with current behavior.

## 8.4 Nested item elements

Initial rule:

- If `itemSelector` appears inside another item of same list, treat it as a new nested item context.
- Field matches route to nearest active item.

## 9. Diagnostics & Errors

## 9.1 Diagnostics contract

Top-level diagnostics contract:

```ts
interface ExtractionDiagnostics {
  fields: Record<string, FieldDiagnostics>; // top-level field rules only
  lists: Record<string, ListDiagnostics>; // top-level list rules only
}

interface ListDiagnostics {
  field: string; // top-level output key
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

If needed for backward compatibility during rollout, retain legacy `diagnostics.<fieldName>` mirror for top-level field rules, but `fields/lists` is the canonical contract.

## 9.2 Error metadata

Extend `ExtractionError` with optional location:

```ts
{
  code: 'REQUIRED_FIELD_MISSING' | 'TRANSFORM_FAILED' | ...
  field?: string;
  list?: string;      // top-level `fields` key for list rule
  itemIndex?: number;
  message: string;
}
```

## 10. Validation Rules (Extended v1)

Minimum required:

- `version === '1'`
- `fields` is non-empty object.
- top-level keys are non-empty strings.
- rule classification by `kind`:
  - `kind: 'list'` => `ListRule`
  - `kind: 'field'` or absent => `FieldRule`
  - any other `kind` => validation error
- list rules:
  - require non-empty `itemSelector`
  - require non-empty `fields`
- field rules (top-level and list item):
  - same rules as existing field validator
  - `exists` restrictions remain (`no default`, `no required`, `no many`)

## 11. Public API Plan

Keep existing signatures:

```ts
extract(input, config, options?)
validateConfig(config)
```

No new top-level API required.

## 12. Compatibility

- This is pre-publish v1 shaping; widening `fields` value type is acceptable.
- Existing flat-field configs remain valid (they are already under `fields`).
- Runtime behavior for field rules remains unchanged.

## 13. Test Plan

Required tests:

1. Basic top-level field extraction via `fields`.
2. Basic list extraction (10 items).
3. Missing field in middle item.
4. Fallback selectors per item.
5. `attribute` extraction within items.
6. `exists` per item.
7. `many` fields inside each item.
8. Required-field errors with `list` + `itemIndex`.
9. Transform success/failure per item.
10. Nested text behavior within items.
11. Nested same-itemSelector behavior (nearest context).
12. Large-list deterministic order (100+ and 500+ items).
13. Flat-field regression suite unchanged.

## 14. Performance Targets

- Single-pass HTML stream.
- No full-document buffering.
- Per-item state released on end tag.
- Memory proportional to nesting depth + output size.

## 15. Implementation Phases

### Phase A: Types + Validator

- Widen top-level `fields` map to `OutputRule`.
- Add `ListRule` + discrimination by `kind`.
- Add strict validation for unknown `kind` values.
- Add list validation for `itemSelector` and nested `fields`.

### Phase B: Runtime Core

- Compile `fields` into top-level field and list plans.
- Add list item runtime contexts.
- Route selector matches to nearest active item.
- Finalize per-item fields at item end.

### Phase C: Diagnostics + Errors

- Add `diagnostics.fields` and `diagnostics.lists`.
- Add per-item field diagnostics under list diagnostics.
- Add `list` + `itemIndex` metadata on relevant errors.

### Phase D: Hardening + Docs

- Stress tests and nesting edge tests.
- Update README with unified `fields` examples including lists.

## 16. Acceptance Criteria

Feature is acceptable when:

- all extraction rules remain under top-level `fields`.
- top-level field and list rules both work in one config.
- list extraction returns stable list-of-object output in document order.
- missing fields do not misalign adjacent items.
- per-item required/default/transform semantics match existing field rules.
- diagnostics include per-item field detail.
- errors include list and item index where relevant.

## 17. Open Decisions

1. Do we keep `kind: 'field'` optional (current proposal) or require explicit kind for all rules?
2. On transform failure, should we null only the field (current proposal) or optionally drop item?
3. Do we add item-level filtering (`skipIfMissing`) in initial release or defer?
