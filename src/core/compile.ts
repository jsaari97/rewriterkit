import type { ExtractorConfig, FieldRule, PrimitiveValue, TransformSpec } from '../types/public';

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

export interface CompiledListPlan {
  field: string;
  itemSelector: string;
  fields: Map<string, CompiledFieldPlan>;
}

export interface CompiledListFieldTarget {
  list: string;
  field: string;
}

export interface CompiledPlan {
  topFields: Map<string, CompiledFieldPlan>;
  topSelectors: Map<string, string[]>;
  lists: Map<string, CompiledListPlan>;
  listItemSelectors: Map<string, string[]>;
  listFieldSelectors: Map<string, CompiledListFieldTarget[]>;
}

function compileFieldRule(fieldName: string, rule: FieldRule): CompiledFieldPlan {
  return {
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
}

function pushMapArrayValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function compileConfig(config: ExtractorConfig): CompiledPlan {
  const topFields = new Map<string, CompiledFieldPlan>();
  const topSelectors = new Map<string, string[]>();
  const lists = new Map<string, CompiledListPlan>();
  const listItemSelectors = new Map<string, string[]>();
  const listFieldSelectors = new Map<string, CompiledListFieldTarget[]>();

  for (const [outputKey, rule] of Object.entries(config.fields)) {
    if (rule.kind === 'list') {
      const compiledListFields = new Map<string, CompiledFieldPlan>();

      for (const [itemFieldName, itemFieldRule] of Object.entries(rule.fields)) {
        const compiledField = compileFieldRule(itemFieldName, itemFieldRule);
        compiledListFields.set(itemFieldName, compiledField);

        for (const selector of compiledField.selectors) {
          pushMapArrayValue(listFieldSelectors, selector, {
            list: outputKey,
            field: itemFieldName,
          });
        }
      }

      lists.set(outputKey, {
        field: outputKey,
        itemSelector: rule.itemSelector,
        fields: compiledListFields,
      });

      pushMapArrayValue(listItemSelectors, rule.itemSelector, outputKey);
      continue;
    }

    const compiledField = compileFieldRule(outputKey, rule);
    topFields.set(outputKey, compiledField);

    for (const selector of compiledField.selectors) {
      pushMapArrayValue(topSelectors, selector, outputKey);
    }
  }

  return {
    topFields,
    topSelectors,
    lists,
    listItemSelectors,
    listFieldSelectors,
  };
}
