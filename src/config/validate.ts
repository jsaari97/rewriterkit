import type { ExtractorConfig, TransformSpec, ValidationIssue, ValidationResult } from '../types/public';

const FIELD_TYPES = new Set(['text', 'attribute', 'exists']);
const CARDINALITIES = new Set(['one', 'many']);
const STRING_TRANSFORMS = new Set([
  'trim',
  'normalizeWhitespace',
  'toLowerCase',
  'toUpperCase',
  'parseNumber',
  'parseInteger',
  'parseBoolean',
  'absoluteUrl',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitiveValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function pushIssue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function validateTransforms(issues: ValidationIssue[], path: string, transforms: unknown): void {
  if (!Array.isArray(transforms)) {
    pushIssue(issues, path, 'invalid_type', '`transforms` must be an array when provided.');
    return;
  }

  transforms.forEach((transform, index) => {
    const transformPath = `${path}[${index}]`;

    if (typeof transform === 'string') {
      if (!STRING_TRANSFORMS.has(transform)) {
        pushIssue(issues, transformPath, 'invalid_transform', `Unsupported transform '${transform}'.`);
      }
      return;
    }

    if (!isRecord(transform)) {
      pushIssue(issues, transformPath, 'invalid_transform', 'Transform must be a string keyword or a transform object.');
      return;
    }

    if (transform.kind !== 'regexReplace') {
      pushIssue(issues, transformPath, 'invalid_transform_kind', "Object transforms must declare kind: 'regexReplace'.");
      return;
    }

    if (typeof transform.pattern !== 'string') {
      pushIssue(issues, `${transformPath}.pattern`, 'invalid_type', '`pattern` must be a string.');
    }

    if (typeof transform.replacement !== 'string') {
      pushIssue(issues, `${transformPath}.replacement`, 'invalid_type', '`replacement` must be a string.');
    }

    if (transform.flags !== undefined && typeof transform.flags !== 'string') {
      pushIssue(issues, `${transformPath}.flags`, 'invalid_type', '`flags` must be a string when provided.');
    }

    if (typeof transform.pattern === 'string' && (transform.flags === undefined || typeof transform.flags === 'string')) {
      try {
        // Validate user-provided regex at config-load time where possible.
        new RegExp(transform.pattern, transform.flags);
      } catch {
        pushIssue(issues, `${transformPath}.pattern`, 'invalid_regex', 'Invalid regex pattern or flags.');
      }
    }
  });
}

function validateDefault(issues: ValidationIssue[], path: string, cardinality: 'one' | 'many', defaultValue: unknown): void {
  if (cardinality === 'many') {
    if (!Array.isArray(defaultValue)) {
      pushIssue(issues, path, 'invalid_default', "`default` for cardinality 'many' must be an array.");
      return;
    }

    defaultValue.forEach((entry, index) => {
      if (!isPrimitiveValue(entry)) {
        pushIssue(issues, `${path}[${index}]`, 'invalid_default', 'Array defaults must contain only primitive values.');
      }
    });

    return;
  }

  if (Array.isArray(defaultValue)) {
    pushIssue(issues, path, 'invalid_default', "`default` for cardinality 'one' must not be an array.");
    return;
  }

  if (!isPrimitiveValue(defaultValue)) {
    pushIssue(issues, path, 'invalid_default', 'Default must be a primitive value or null.');
  }
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function validateConfig(config: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isRecord(config)) {
    return {
      ok: false,
      errors: [
        {
          path: '',
          code: 'invalid_type',
          message: 'Config must be an object.',
        },
      ],
    };
  }

  if (config.version !== '1') {
    pushIssue(issues, 'version', 'invalid_version', "`version` must be exactly '1'.");
  }

  if (!isRecord(config.fields)) {
    pushIssue(issues, 'fields', 'invalid_type', '`fields` must be a non-empty object.');
  } else {
    const entries = Object.entries(config.fields);
    if (entries.length === 0) {
      pushIssue(issues, 'fields', 'empty_fields', '`fields` must contain at least one field rule.');
    }

    for (const [fieldName, rawField] of entries) {
      const fieldPath = fieldName.trim() === '' ? 'fields.<empty>' : `fields.${fieldName}`;

      if (fieldName.trim() === '') {
        pushIssue(issues, fieldPath, 'invalid_field_name', 'Field names must be non-empty strings.');
      }

      if (!isRecord(rawField)) {
        pushIssue(issues, fieldPath, 'invalid_type', 'Each field rule must be an object.');
        continue;
      }

      if (!Array.isArray(rawField.selectors) || rawField.selectors.length === 0) {
        pushIssue(issues, `${fieldPath}.selectors`, 'invalid_selectors', '`selectors` must be a non-empty array.');
      } else {
        rawField.selectors.forEach((selector, index) => {
          if (typeof selector !== 'string' || selector.trim() === '') {
            pushIssue(issues, `${fieldPath}.selectors[${index}]`, 'invalid_selector', 'Selector must be a non-empty string.');
          }
        });
      }

      if (rawField.type === 'html') {
        pushIssue(
          issues,
          `${fieldPath}.type`,
          'unsupported_type',
          "`type: 'html'` is not supported in v1; html extraction is planned for a later version.",
        );
      } else if (typeof rawField.type !== 'string' || !FIELD_TYPES.has(rawField.type)) {
        pushIssue(issues, `${fieldPath}.type`, 'invalid_type', "`type` must be one of: 'text', 'attribute', 'exists'.");
      }

      if (rawField.cardinality !== undefined && (typeof rawField.cardinality !== 'string' || !CARDINALITIES.has(rawField.cardinality))) {
        pushIssue(issues, `${fieldPath}.cardinality`, 'invalid_cardinality', "`cardinality` must be 'one' or 'many' when provided.");
      }

      if (rawField.required !== undefined && typeof rawField.required !== 'boolean') {
        pushIssue(issues, `${fieldPath}.required`, 'invalid_type', '`required` must be a boolean when provided.');
      }

      if (rawField.trim !== undefined && typeof rawField.trim !== 'boolean') {
        pushIssue(issues, `${fieldPath}.trim`, 'invalid_type', '`trim` must be a boolean when provided.');
      }

      if (rawField.description !== undefined && typeof rawField.description !== 'string') {
        pushIssue(issues, `${fieldPath}.description`, 'invalid_type', '`description` must be a string when provided.');
      }

      const resolvedType = typeof rawField.type === 'string' ? rawField.type : undefined;
      const cardinality = rawField.cardinality === 'many' ? 'many' : 'one';

      if (resolvedType === 'attribute') {
        if (typeof rawField.attribute !== 'string' || rawField.attribute.trim() === '') {
          pushIssue(issues, `${fieldPath}.attribute`, 'missing_attribute', "`attribute` is required for fields with `type: 'attribute'`.");
        }
      } else if (rawField.attribute !== undefined) {
        pushIssue(issues, `${fieldPath}.attribute`, 'unexpected_attribute', "`attribute` is only allowed when `type` is 'attribute'.");
      }

      if (resolvedType === 'exists') {
        if (rawField.cardinality === 'many') {
          pushIssue(issues, `${fieldPath}.cardinality`, 'invalid_exists_cardinality', "`exists` fields cannot use `cardinality: 'many'`.");
        }

        if (hasOwn(rawField, 'default')) {
          pushIssue(issues, `${fieldPath}.default`, 'invalid_exists_default', '`default` is not allowed for `exists` fields in v1.');
        }

        if (hasOwn(rawField, 'required')) {
          pushIssue(issues, `${fieldPath}.required`, 'invalid_exists_required', '`required` is not allowed for `exists` fields in v1.');
        }

        if (hasOwn(rawField, 'trim')) {
          pushIssue(issues, `${fieldPath}.trim`, 'invalid_exists_trim', '`trim` is not allowed for `exists` fields in v1.');
        }

        if (hasOwn(rawField, 'transforms')) {
          pushIssue(issues, `${fieldPath}.transforms`, 'invalid_exists_transforms', '`transforms` is not allowed for `exists` fields in v1.');
        }
      }

      if (hasOwn(rawField, 'default') && resolvedType !== 'exists') {
        validateDefault(issues, `${fieldPath}.default`, cardinality, rawField.default);
      }

      if (rawField.transforms !== undefined) {
        validateTransforms(issues, `${fieldPath}.transforms`, rawField.transforms);
      }
    }
  }

  return {
    ok: issues.length === 0,
    errors: issues,
  };
}

export function isExtractorConfig(config: unknown): config is ExtractorConfig {
  return validateConfig(config).ok;
}
