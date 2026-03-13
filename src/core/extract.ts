import type {
  ExtractOptions,
  ExtractionError,
  ExtractionResult,
  ExtractorConfig,
  FieldDiagnostics,
  PrimitiveValue,
  ValidationIssue,
} from '../types/public';
import { getValidatedCompiledConfig } from './cache';
import { applyTransforms } from './transforms';
import type { CompiledFieldPlan } from './compile';
import { createInternalError, createInvalidInputError } from './errors';

interface OrderedValue {
  order: number;
  value: unknown;
}

interface ActiveTextCapture {
  order: number;
  value: string;
}

interface FieldRuntimeState {
  selectorMatchCounts: Record<string, number>;
  selectorCandidates: Record<string, OrderedValue[]>;
  activeTextCaptures: Record<string, ActiveTextCapture[]>;
  usedDefault: boolean;
  warnings: string[];
  errors: string[];
  winningSelector?: string;
  valueProduced: boolean;
}

function createInvalidConfigResponse(issues: ValidationIssue[]): ExtractionResult {
  return {
    data: {},
    diagnostics: {},
    ok: false,
    errors: issues.map((issue) => {
      const fieldMatch = issue.path.match(/^fields\.([^.[\]]+)/);
      return {
        code: 'INVALID_CONFIG',
        field: fieldMatch?.[1],
        message: `[${issue.code}] ${issue.path || 'config'}: ${issue.message}`,
      };
    }),
  };
}

function cloneDefaultValue(value: PrimitiveValue | PrimitiveValue[] | null | undefined): PrimitiveValue | PrimitiveValue[] | null {
  if (Array.isArray(value)) {
    return [...value];
  }

  if (value === undefined) {
    return null;
  }

  return value;
}

function initializeRuntimeState(field: CompiledFieldPlan): FieldRuntimeState {
  const selectorMatchCounts: Record<string, number> = {};
  const selectorCandidates: Record<string, OrderedValue[]> = {};
  const activeTextCaptures: Record<string, ActiveTextCapture[]> = {};

  for (const selector of field.selectors) {
    selectorMatchCounts[selector] = 0;
    selectorCandidates[selector] = [];
    activeTextCaptures[selector] = [];
  }

  return {
    selectorMatchCounts,
    selectorCandidates,
    activeTextCaptures,
    usedDefault: false,
    warnings: [],
    errors: [],
    valueProduced: false,
  };
}

function resolveInput(input: unknown): Response {
  if (typeof input === 'string') {
    return new Response(input, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  }

  if (input instanceof Response) {
    return input;
  }

  throw createInvalidInputError(input);
}

function selectWinningSelector(field: CompiledFieldPlan, state: FieldRuntimeState): string | undefined {
  for (const selector of field.selectors) {
    const matchCount = state.selectorMatchCounts[selector] ?? 0;
    const candidateCount = state.selectorCandidates[selector]?.length ?? 0;

    const usable = field.type === 'exists' ? matchCount > 0 : candidateCount > 0;
    if (usable) {
      return selector;
    }
  }

  return undefined;
}

function sortedCandidateValues(state: FieldRuntimeState, selector: string): unknown[] {
  return [...(state.selectorCandidates[selector] ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((candidate) => candidate.value);
}

function emptyValueForCardinality(cardinality: 'one' | 'many'): null | [] {
  return cardinality === 'one' ? null : [];
}

export async function extract(
  input: string | Response,
  config: ExtractorConfig,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const { validation, compiled } = getValidatedCompiledConfig(config);
  if (!validation.ok) {
    return createInvalidConfigResponse(validation.errors);
  }

  if (typeof HTMLRewriter === 'undefined') {
    throw createInternalError('HTMLRewriter is unavailable in this runtime.');
  }

  const response = resolveInput(input);
  if (!compiled) {
    throw createInternalError('Compiled extraction plan was not available for a valid config.');
  }

  const plan = compiled;

  const runtime = new Map<string, FieldRuntimeState>();
  for (const [fieldName, field] of plan.fields.entries()) {
    runtime.set(fieldName, initializeRuntimeState(field));
  }

  const rewriter = new HTMLRewriter();

  for (const [selector, fieldNames] of plan.selectors.entries()) {
    rewriter.on(selector, {
      element(element) {
        const pendingTextCaptures: Array<{ fieldState: FieldRuntimeState; activeCapture: ActiveTextCapture }> = [];

        for (const fieldName of fieldNames) {
          const field = plan.fields.get(fieldName);
          const fieldState = runtime.get(fieldName);

          if (!field || !fieldState) {
            continue;
          }

          fieldState.selectorMatchCounts[selector] += 1;
          const order = fieldState.selectorMatchCounts[selector] - 1;

          if (field.type === 'exists') {
            fieldState.selectorCandidates[selector].push({ order, value: true });
            continue;
          }

          if (field.type === 'attribute') {
            const attributeValue = element.getAttribute(field.attribute as string);
            if (attributeValue !== null) {
              fieldState.selectorCandidates[selector].push({ order, value: attributeValue });
            }
            continue;
          }

          const activeCapture: ActiveTextCapture = { order, value: '' };
          fieldState.activeTextCaptures[selector].push(activeCapture);
          pendingTextCaptures.push({ fieldState, activeCapture });
        }

        if (pendingTextCaptures.length > 0) {
          element.onEndTag(() => {
            for (const pending of pendingTextCaptures) {
              pending.fieldState.selectorCandidates[selector].push({
                order: pending.activeCapture.order,
                value: pending.activeCapture.value,
              });

              const captureStack = pending.fieldState.activeTextCaptures[selector];
              const index = captureStack.lastIndexOf(pending.activeCapture);
              if (index >= 0) {
                captureStack.splice(index, 1);
              }
            }
          });
        }
      },
      text(text) {
        for (const fieldName of fieldNames) {
          const field = plan.fields.get(fieldName);
          const fieldState = runtime.get(fieldName);

          if (!field || !fieldState || field.type !== 'text') {
            continue;
          }

          const captureStack = fieldState.activeTextCaptures[selector];
          if (captureStack.length === 0) {
            continue;
          }

          for (const capture of captureStack) {
            capture.value += text.text;
          }
        }
      },
    });
  }

  try {
    const transformedResponse = rewriter.transform(response);
    await transformedResponse.arrayBuffer();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw createInternalError(`HTML rewriting failed: ${reason}`, error);
  }

  const data: Record<string, unknown> = {};
  const diagnostics: Record<string, FieldDiagnostics> = {};
  const errors: ExtractionError[] = [];
  let ok = true;

  for (const [fieldName, field] of plan.fields.entries()) {
    const state = runtime.get(fieldName);
    if (!state) {
      throw createInternalError(`Missing runtime state for field '${fieldName}'.`);
    }

    const winningSelector = selectWinningSelector(field, state);
    state.winningSelector = winningSelector;

    const matched = Object.values(state.selectorMatchCounts).some((count) => count > 0);
    const matchCount = winningSelector ? state.selectorMatchCounts[winningSelector] : 0;

    let finalValue: unknown;
    let hasRawValue = false;
    let transformFailed = false;

    if (field.type === 'exists') {
      finalValue = winningSelector ? true : false;
      state.valueProduced = true;
    } else {
      const rawValues = winningSelector ? sortedCandidateValues(state, winningSelector) : [];
      hasRawValue = rawValues.length > 0;

      if (hasRawValue) {
        const baseValue = field.cardinality === 'one' ? rawValues[0] : rawValues;
        const transformed = applyTransforms({
          value: baseValue,
          cardinality: field.cardinality,
          trim: field.trim,
          transforms: field.transforms,
          baseUrl: options.baseUrl,
        });

        if (transformed.ok) {
          finalValue = transformed.value;
          state.valueProduced = true;
        } else {
          transformFailed = true;
          ok = false;
          const message = `Field '${fieldName}' transform failure: ${transformed.error ?? 'Unknown transform error.'}`;
          state.errors.push(message);
          errors.push({
            code: 'TRANSFORM_FAILED',
            field: fieldName,
            message,
          });
          finalValue = emptyValueForCardinality(field.cardinality);
          state.valueProduced = false;
        }
      } else if (field.defaultDefined) {
        state.usedDefault = true;
        finalValue = cloneDefaultValue(field.defaultValue);
      } else {
        finalValue = emptyValueForCardinality(field.cardinality);
      }

      if (!hasRawValue && field.required && !field.defaultDefined && !transformFailed) {
        ok = false;
        const message = `Required field '${fieldName}' did not produce a value from selectors [${field.selectors.join(', ')}].`;
        state.errors.push(message);
        errors.push({
          code: 'REQUIRED_FIELD_MISSING',
          field: fieldName,
          message,
        });
      }
    }

    data[fieldName] = finalValue;

    diagnostics[fieldName] = {
      field: fieldName,
      matched,
      selectorTried: [...field.selectors],
      winningSelector,
      matchCount,
      valueProduced: state.valueProduced,
      usedDefault: state.usedDefault,
      required: field.required,
      warnings: [...state.warnings],
      errors: [...state.errors],
    };
  }

  return {
    data,
    diagnostics,
    ok,
    errors,
  };
}
