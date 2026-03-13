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

export type OutputRule = FieldRule | ListRule;

export interface ExtractorConfig {
  version: '1';
  fields: Record<string, OutputRule>;
}

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
  warnings: string[];
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
  warnings: string[];
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

export interface ExtractionResult {
  data: Record<string, unknown>;
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
