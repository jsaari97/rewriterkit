export type PrimitiveValue = string | number | boolean | null;

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

export interface FieldRule {
  selectors: string[];
  type: 'text' | 'attribute' | 'exists';
  cardinality?: 'one' | 'many';
  required?: boolean;
  default?: PrimitiveValue | PrimitiveValue[] | null;
  attribute?: string;
  transforms?: TransformSpec[];
  description?: string;
}

export interface ListRule {
  kind: 'list';
  itemSelector: string;
  fields: Record<string, FieldRule>;
}

export type OutputRule = FieldRule | ListRule;

export interface ExtractorConfig {
  version: '1';
  fields: Record<string, OutputRule>;
}

type LastArrayEntry<TArray extends readonly unknown[]> = TArray extends readonly [...infer TRest, infer TLast]
  ? TRest['length'] extends number
    ? TLast
    : never
  : never;

type InferScalarFromTransforms<TTransforms> = TTransforms extends readonly TransformSpec[]
  ? LastArrayEntry<TTransforms> extends 'parseNumber' | 'parseInteger'
    ? number
    : LastArrayEntry<TTransforms> extends 'parseBoolean'
      ? boolean
      : string
  : string;

type InferDefaultForOne<TRule extends FieldRule> = TRule extends { default: infer TDefault }
  ? TDefault extends readonly unknown[]
    ? never
    : TDefault
  : never;

type InferDefaultForMany<TRule extends FieldRule> = TRule extends { default: infer TDefault }
  ? TDefault extends readonly (infer TItem)[]
    ? TItem
    : never
  : never;

type InferFieldScalar<TRule extends FieldRule> = TRule['type'] extends 'exists'
  ? boolean
  : InferScalarFromTransforms<TRule['transforms']>;

export type InferFieldValue<TRule extends FieldRule> = TRule['type'] extends 'exists'
  ? boolean
  : TRule['cardinality'] extends 'many'
    ? Array<InferFieldScalar<TRule> | InferDefaultForMany<TRule>>
    : InferFieldScalar<TRule> | InferDefaultForOne<TRule> | null;

type InferListItemValue<TListRule extends ListRule> = {
  [TFieldName in keyof TListRule['fields']]: TListRule['fields'][TFieldName] extends FieldRule
    ? InferFieldValue<TListRule['fields'][TFieldName]>
    : never;
};

export type InferOutputRuleValue<TRule extends OutputRule> = TRule extends ListRule
  ? Array<InferListItemValue<TRule>>
  : TRule extends FieldRule
    ? InferFieldValue<TRule>
    : never;

export type InferExtractedData<TConfig extends ExtractorConfig> = {
  [TFieldName in keyof TConfig['fields']]: TConfig['fields'][TFieldName] extends OutputRule
    ? InferOutputRuleValue<TConfig['fields'][TFieldName]>
    : never;
};

export interface ExtractOptions {
  baseUrl?: string;
}

export interface FieldDiagnostics {
  field: string;
  matched: boolean;
  selectorTried: string[];
  winningSelector?: string;
  matchCount: number;
  valueProduced: boolean;
  usedDefault: boolean;
  required: boolean;
  errors: string[];
}

export interface ExtractionError {
  code: 'INVALID_CONFIG' | 'INVALID_INPUT' | 'REQUIRED_FIELD_MISSING' | 'TRANSFORM_FAILED' | 'INTERNAL_ERROR';
  message: string;
  field?: string;
  list?: string;
  itemIndex?: number;
}

export interface ListDiagnostics {
  field: string;
  itemSelector: string;
  itemCount: number;
  errors: string[];
  items: Array<{
    index: number;
    fields: Record<string, FieldDiagnostics>;
  }>;
}

export interface ExtractionDiagnostics {
  fields: Record<string, FieldDiagnostics>;
  lists: Record<string, ListDiagnostics>;
}

export interface ExtractionResult<TData = Record<string, unknown>> {
  data: TData;
  diagnostics: ExtractionDiagnostics;
  ok: boolean;
  errors: ExtractionError[];
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}
