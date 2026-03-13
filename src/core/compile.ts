import type { ExtractorConfig, PrimitiveValue, TransformSpec } from '../types/public';

export interface CompiledFieldPlan {
  field: string;
  selectors: string[];
  type: 'text' | 'attribute' | 'exists';
  cardinality: 'one' | 'many';
  required: boolean;
  trim: boolean;
  transforms: TransformSpec[];
  attribute?: string;
  defaultDefined: boolean;
  defaultValue?: PrimitiveValue | PrimitiveValue[] | null;
}

export interface CompiledPlan {
  fields: Map<string, CompiledFieldPlan>;
  selectors: Map<string, string[]>;
}

export function compileConfig(config: ExtractorConfig): CompiledPlan {
  const fields = new Map<string, CompiledFieldPlan>();
  const selectors = new Map<string, string[]>();

  for (const [fieldName, rule] of Object.entries(config.fields)) {
    const compiledField: CompiledFieldPlan = {
      field: fieldName,
      selectors: [...rule.selectors],
      type: rule.type,
      cardinality: rule.cardinality ?? 'one',
      required: rule.required ?? false,
      trim: rule.trim ?? false,
      transforms: rule.transforms ? [...rule.transforms] : [],
      attribute: rule.attribute,
      defaultDefined: Object.prototype.hasOwnProperty.call(rule, 'default'),
      defaultValue: rule.default,
    };

    fields.set(fieldName, compiledField);

    for (const selector of compiledField.selectors) {
      const interestedFields = selectors.get(selector);
      if (interestedFields) {
        interestedFields.push(fieldName);
      } else {
        selectors.set(selector, [fieldName]);
      }
    }
  }

  return {
    fields,
    selectors,
  };
}
