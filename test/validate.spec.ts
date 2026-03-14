import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src';
import { isExtractorConfig } from '../src/config/validate';

function hasIssue(result: ReturnType<typeof validateConfig>, code: string, path?: string): boolean {
  return result.errors.some((issue) => issue.code === code && (path === undefined || issue.path === path));
}

describe('validateConfig additional coverage', () => {
  it('rejects non-object and top-level structural issues', () => {
    const nonObject = validateConfig(null);
    expect(nonObject.ok).toBe(false);
    expect(hasIssue(nonObject, 'invalid_type', '')).toBe(true);

    const invalidFields = validateConfig({
      version: '2',
      fields: {
        '': 'nope',
        product: 42,
      },
    });

    expect(invalidFields.ok).toBe(false);
    expect(hasIssue(invalidFields, 'invalid_version', 'version')).toBe(true);
    expect(hasIssue(invalidFields, 'invalid_field_name', 'fields.<empty>')).toBe(true);
    expect(hasIssue(invalidFields, 'invalid_type', 'fields.<empty>')).toBe(true);
    expect(hasIssue(invalidFields, 'invalid_type', 'fields.product')).toBe(true);

    const wrongFieldsType = validateConfig({
      version: '1',
      fields: [] as unknown as Record<string, unknown>,
    });
    expect(hasIssue(wrongFieldsType, 'invalid_type', 'fields')).toBe(true);
  });

  it('rejects transform, default, attribute and exists edge cases', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        badSelectors: {
          selectors: ['', '.ok'],
          type: 'text',
        },
        badTransformsShape: {
          selectors: ['h1'],
          type: 'text',
          transforms: 'trim',
        },
        badTransformEntries: {
          selectors: ['h1'],
          type: 'text',
          transforms: [
            'unknownTransform',
            123,
            { kind: 'other' },
            { kind: 'regexReplace', pattern: 123, replacement: '' },
            { kind: 'regexReplace', pattern: 'a', replacement: 123 },
            { kind: 'regexReplace', pattern: 'a', replacement: 'b', flags: 7 },
            { kind: 'regexReplace', pattern: '[', replacement: '' },
          ],
        },
        manyDefaultNotArray: {
          selectors: ['.tag'],
          type: 'text',
          cardinality: 'many',
          default: 'tag',
        },
        manyDefaultHasObject: {
          selectors: ['.tag'],
          type: 'text',
          cardinality: 'many',
          default: [{ bad: true }],
        },
        oneDefaultArray: {
          selectors: ['.one'],
          type: 'text',
          default: ['value'],
        },
        oneDefaultObject: {
          selectors: ['.one'],
          type: 'text',
          default: { bad: true },
        },
        attributeMissingName: {
          selectors: ['img'],
          type: 'attribute',
        },
        attributeUnexpected: {
          selectors: ['h1'],
          type: 'text',
          attribute: 'title',
          cardinality: 'invalid',
          required: 'yes',
          description: 123,
        },
        existsDisallowedProperties: {
          selectors: ['.flag'],
          type: 'exists',
          cardinality: 'many',
          default: false,
          required: true,
          transforms: ['trim'],
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(hasIssue(result, 'invalid_selector', 'fields.badSelectors.selectors[0]')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.badTransformsShape.transforms')).toBe(true);
    expect(hasIssue(result, 'invalid_transform', 'fields.badTransformEntries.transforms[0]')).toBe(true);
    expect(hasIssue(result, 'invalid_transform', 'fields.badTransformEntries.transforms[1]')).toBe(true);
    expect(hasIssue(result, 'invalid_transform_kind', 'fields.badTransformEntries.transforms[2]')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.badTransformEntries.transforms[3].pattern')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.badTransformEntries.transforms[4].replacement')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.badTransformEntries.transforms[5].flags')).toBe(true);
    expect(hasIssue(result, 'invalid_regex', 'fields.badTransformEntries.transforms[6].pattern')).toBe(true);
    expect(hasIssue(result, 'invalid_default', 'fields.manyDefaultNotArray.default')).toBe(true);
    expect(hasIssue(result, 'invalid_default', 'fields.manyDefaultHasObject.default[0]')).toBe(true);
    expect(hasIssue(result, 'invalid_default', 'fields.oneDefaultArray.default')).toBe(true);
    expect(hasIssue(result, 'invalid_default', 'fields.oneDefaultObject.default')).toBe(true);
    expect(hasIssue(result, 'missing_attribute', 'fields.attributeMissingName.attribute')).toBe(true);
    expect(hasIssue(result, 'unexpected_attribute', 'fields.attributeUnexpected.attribute')).toBe(true);
    expect(hasIssue(result, 'invalid_cardinality', 'fields.attributeUnexpected.cardinality')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.attributeUnexpected.required')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.attributeUnexpected.description')).toBe(true);
    expect(hasIssue(result, 'invalid_exists_cardinality', 'fields.existsDisallowedProperties.cardinality')).toBe(true);
    expect(hasIssue(result, 'invalid_exists_default', 'fields.existsDisallowedProperties.default')).toBe(true);
    expect(hasIssue(result, 'invalid_exists_required', 'fields.existsDisallowedProperties.required')).toBe(true);
    expect(hasIssue(result, 'invalid_exists_transforms', 'fields.existsDisallowedProperties.transforms')).toBe(true);
  });

  it('rejects list-rule-only edge cases', () => {
    const result = validateConfig({
      version: '1',
      fields: {
        listWithInvalidShape: {
          kind: 'list',
          selectors: ['.x'],
          type: 'text',
          trim: true,
          itemSelector: '',
          fields: [] as unknown as Record<string, unknown>,
        },
        listWithEmptyFields: {
          kind: 'list',
          itemSelector: '.item',
          fields: {},
        },
        listWithInvalidFieldName: {
          kind: 'list',
          itemSelector: '.item',
          fields: {
            '': {
              selectors: ['.title'],
              type: 'text',
            },
          },
        },
        listWithInvalidFieldType: {
          kind: 'list',
          itemSelector: '.item',
          fields: {
            title: 123 as unknown as Record<string, unknown>,
          },
        },
        nestedList: {
          kind: 'list',
          itemSelector: '.item',
          fields: {
            child: {
              kind: 'list',
              itemSelector: '.child',
              fields: {},
            },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(hasIssue(result, 'unexpected_property', 'fields.listWithInvalidShape.selectors')).toBe(true);
    expect(hasIssue(result, 'unexpected_property', 'fields.listWithInvalidShape.type')).toBe(true);
    expect(hasIssue(result, 'unexpected_property', 'fields.listWithInvalidShape.trim')).toBe(true);
    expect(hasIssue(result, 'invalid_selector', 'fields.listWithInvalidShape.itemSelector')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.listWithInvalidShape.fields')).toBe(true);
    expect(hasIssue(result, 'empty_fields', 'fields.listWithEmptyFields.fields')).toBe(true);
    expect(hasIssue(result, 'invalid_field_name', 'fields.listWithInvalidFieldName.fields.<empty>')).toBe(true);
    expect(hasIssue(result, 'invalid_type', 'fields.listWithInvalidFieldType.fields.title')).toBe(true);
    expect(hasIssue(result, 'nested_list_not_supported', 'fields.nestedList.fields.child.kind')).toBe(true);
  });
});

describe('isExtractorConfig', () => {
  it('returns true only for valid configs', () => {
    expect(
      isExtractorConfig({
        version: '1',
        fields: {
          title: {
            selectors: ['h1'],
            type: 'text',
          },
        },
      }),
    ).toBe(true);

    expect(
      isExtractorConfig({
        version: '2',
        fields: {},
      }),
    ).toBe(false);
  });
});
