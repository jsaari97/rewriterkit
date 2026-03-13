import type {
  ExtractOptions,
  ExtractionDiagnostics,
  ExtractionError,
  ExtractionResult,
  ExtractorConfig,
  FieldDiagnostics,
  PrimitiveValue,
  ValidationIssue,
} from '../types/public';
import { getValidatedCompiledConfig } from './cache';
import { applyTransforms } from './transforms';
import type { CompiledFieldPlan, CompiledListPlan } from './compile';
import { createInternalError, createInvalidInputError } from './errors';

interface OrderedValue {
  order: number;
  value: unknown;
}

interface ActiveTextCapture {
  order: number;
  value: string;
  closed: boolean;
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

interface ListItemRuntimeState {
  fields: Map<string, FieldRuntimeState>;
}

interface ListRuntimeState {
  activeItems: ListItemRuntimeState[];
  data: Array<Record<string, unknown>>;
  diagnosticsItems: Array<{
    index: number;
    fields: Record<string, FieldDiagnostics>;
  }>;
  warnings: string[];
  errors: string[];
}

interface PendingTextCapture {
  fieldState: FieldRuntimeState;
  selector: string;
  activeCapture: ActiveTextCapture;
}

function createInvalidConfigResponse(issues: ValidationIssue[]): ExtractionResult {
  return {
    data: {},
    diagnostics: {
      fields: {},
      lists: {},
    },
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

function createListItemRuntimeState(listPlan: CompiledListPlan): ListItemRuntimeState {
  const fields = new Map<string, FieldRuntimeState>();

  for (const [fieldName, field] of listPlan.fields.entries()) {
    fields.set(fieldName, initializeRuntimeState(field));
  }

  return { fields };
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

function closeCapture(state: FieldRuntimeState, selector: string, capture: ActiveTextCapture): void {
  if (!capture.closed) {
    state.selectorCandidates[selector].push({
      order: capture.order,
      value: capture.value,
    });
    capture.closed = true;
  }

  const stack = state.activeTextCaptures[selector];
  const index = stack.lastIndexOf(capture);
  if (index >= 0) {
    stack.splice(index, 1);
  }
}

function flushOpenTextCaptures(state: FieldRuntimeState): void {
  for (const [selector, captures] of Object.entries(state.activeTextCaptures)) {
    for (const capture of captures) {
      if (!capture.closed) {
        state.selectorCandidates[selector].push({
          order: capture.order,
          value: capture.value,
        });
        capture.closed = true;
      }
    }
    state.activeTextCaptures[selector] = [];
  }
}

function recordElementMatch(
  field: CompiledFieldPlan,
  fieldState: FieldRuntimeState,
  selector: string,
  element: HTMLRewriterElement,
  pendingTextCaptures: PendingTextCapture[],
): void {
  fieldState.selectorMatchCounts[selector] += 1;
  const order = fieldState.selectorMatchCounts[selector] - 1;

  if (field.type === 'exists') {
    fieldState.selectorCandidates[selector].push({ order, value: true });
    return;
  }

  if (field.type === 'attribute') {
    const attributeValue = element.getAttribute(field.attribute as string);
    if (attributeValue !== null) {
      fieldState.selectorCandidates[selector].push({ order, value: attributeValue });
    }
    return;
  }

  const activeCapture: ActiveTextCapture = { order, value: '', closed: false };
  fieldState.activeTextCaptures[selector].push(activeCapture);
  pendingTextCaptures.push({
    fieldState,
    selector,
    activeCapture,
  });
}

interface FinalizedField {
  value: unknown;
  diagnostics: FieldDiagnostics;
}

function contextLabel(fieldName: string, list?: string, itemIndex?: number): string {
  if (!list || itemIndex === undefined) {
    return `Field '${fieldName}'`;
  }

  return `List '${list}' item ${itemIndex} field '${fieldName}'`;
}

function finalizeField(
  fieldName: string,
  field: CompiledFieldPlan,
  state: FieldRuntimeState,
  options: ExtractOptions,
  errors: ExtractionError[],
  setNotOk: () => void,
  list?: string,
  itemIndex?: number,
): FinalizedField {
  flushOpenTextCaptures(state);

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
        setNotOk();
        const message = `${contextLabel(fieldName, list, itemIndex)} transform failure: ${transformed.error ?? 'Unknown transform error.'}`;
        state.errors.push(message);
        errors.push({
          code: 'TRANSFORM_FAILED',
          field: fieldName,
          list,
          itemIndex,
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
      setNotOk();
      const message = `${contextLabel(fieldName, list, itemIndex)} did not produce a value from selectors [${field.selectors.join(', ')}].`;
      state.errors.push(message);
      errors.push({
        code: 'REQUIRED_FIELD_MISSING',
        field: fieldName,
        list,
        itemIndex,
        message,
      });
    }
  }

  return {
    value: finalValue,
    diagnostics: {
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
    },
  };
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

  const topRuntime = new Map<string, FieldRuntimeState>();
  for (const [fieldName, field] of plan.topFields.entries()) {
    topRuntime.set(fieldName, initializeRuntimeState(field));
  }

  const listRuntime = new Map<string, ListRuntimeState>();
  for (const [listName] of plan.lists.entries()) {
    listRuntime.set(listName, {
      activeItems: [],
      data: [],
      diagnosticsItems: [],
      warnings: [],
      errors: [],
    });
  }

  const errors: ExtractionError[] = [];
  let ok = true;
  const setNotOk = () => {
    ok = false;
  };

  const rewriter = new HTMLRewriter();

  for (const [itemSelector, listNames] of plan.listItemSelectors.entries()) {
    rewriter.on(itemSelector, {
      element(element) {
        for (const listName of listNames) {
          const listPlan = plan.lists.get(listName);
          const runtime = listRuntime.get(listName);
          if (!listPlan || !runtime) {
            continue;
          }

          const itemState = createListItemRuntimeState(listPlan);
          runtime.activeItems.push(itemState);

          element.onEndTag(() => {
            const runtimeOnEnd = listRuntime.get(listName);
            const listPlanOnEnd = plan.lists.get(listName);
            if (!runtimeOnEnd || !listPlanOnEnd) {
              return;
            }

            const stackIndex = runtimeOnEnd.activeItems.lastIndexOf(itemState);
            if (stackIndex >= 0) {
              runtimeOnEnd.activeItems.splice(stackIndex, 1);
            }

            const itemIndex = runtimeOnEnd.data.length;
            const itemData: Record<string, unknown> = {};
            const itemDiagnostics: Record<string, FieldDiagnostics> = {};

            for (const [itemFieldName, itemFieldPlan] of listPlanOnEnd.fields.entries()) {
              const itemFieldState = itemState.fields.get(itemFieldName);
              if (!itemFieldState) {
                throw createInternalError(`Missing runtime state for list field '${listName}.${itemFieldName}'.`);
              }

              const finalized = finalizeField(
                itemFieldName,
                itemFieldPlan,
                itemFieldState,
                options,
                errors,
                setNotOk,
                listName,
                itemIndex,
              );

              itemData[itemFieldName] = finalized.value;
              itemDiagnostics[itemFieldName] = finalized.diagnostics;
            }

            runtimeOnEnd.data.push(itemData);
            runtimeOnEnd.diagnosticsItems.push({
              index: itemIndex,
              fields: itemDiagnostics,
            });
          });
        }
      },
    });
  }

  const selectorSet = new Set<string>([...plan.topSelectors.keys(), ...plan.listFieldSelectors.keys()]);

  for (const selector of selectorSet) {
    rewriter.on(selector, {
      element(element) {
        const pendingTextCaptures: PendingTextCapture[] = [];
        const topFieldNames = plan.topSelectors.get(selector) ?? [];
        const listTargets = plan.listFieldSelectors.get(selector) ?? [];

        for (const fieldName of topFieldNames) {
          const field = plan.topFields.get(fieldName);
          const fieldState = topRuntime.get(fieldName);

          if (!field || !fieldState) {
            continue;
          }

          recordElementMatch(field, fieldState, selector, element, pendingTextCaptures);
        }

        for (const target of listTargets) {
          const listPlan = plan.lists.get(target.list);
          const runtime = listRuntime.get(target.list);
          if (!listPlan || !runtime) {
            continue;
          }

          const activeItem = runtime.activeItems[runtime.activeItems.length - 1];
          if (!activeItem) {
            continue;
          }

          const field = listPlan.fields.get(target.field);
          const fieldState = activeItem.fields.get(target.field);
          if (!field || !fieldState) {
            continue;
          }

          recordElementMatch(field, fieldState, selector, element, pendingTextCaptures);
        }

        if (pendingTextCaptures.length > 0) {
          element.onEndTag(() => {
            for (const pending of pendingTextCaptures) {
              closeCapture(pending.fieldState, pending.selector, pending.activeCapture);
            }
          });
        }
      },
      text(text) {
        const topFieldNames = plan.topSelectors.get(selector) ?? [];
        const listTargets = plan.listFieldSelectors.get(selector) ?? [];

        for (const fieldName of topFieldNames) {
          const field = plan.topFields.get(fieldName);
          const fieldState = topRuntime.get(fieldName);

          if (!field || !fieldState || field.type !== 'text') {
            continue;
          }

          const captures = fieldState.activeTextCaptures[selector];
          if (captures.length === 0) {
            continue;
          }

          for (const capture of captures) {
            if (!capture.closed) {
              capture.value += text.text;
            }
          }
        }

        for (const target of listTargets) {
          const listPlan = plan.lists.get(target.list);
          const runtime = listRuntime.get(target.list);
          if (!listPlan || !runtime) {
            continue;
          }

          const activeItem = runtime.activeItems[runtime.activeItems.length - 1];
          if (!activeItem) {
            continue;
          }

          const field = listPlan.fields.get(target.field);
          const fieldState = activeItem.fields.get(target.field);
          if (!field || !fieldState || field.type !== 'text') {
            continue;
          }

          const captures = fieldState.activeTextCaptures[selector];
          if (captures.length === 0) {
            continue;
          }

          for (const capture of captures) {
            if (!capture.closed) {
              capture.value += text.text;
            }
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
  const diagnostics: ExtractionDiagnostics = {
    fields: {},
    lists: {},
  };

  for (const [fieldName, field] of plan.topFields.entries()) {
    const state = topRuntime.get(fieldName);
    if (!state) {
      throw createInternalError(`Missing runtime state for field '${fieldName}'.`);
    }

    const finalized = finalizeField(fieldName, field, state, options, errors, setNotOk);
    data[fieldName] = finalized.value;
    diagnostics.fields[fieldName] = finalized.diagnostics;
  }

  for (const [listName, listPlan] of plan.lists.entries()) {
    const runtime = listRuntime.get(listName);
    if (!runtime) {
      throw createInternalError(`Missing runtime state for list field '${listName}'.`);
    }

    data[listName] = runtime.data;
    diagnostics.lists[listName] = {
      field: listName,
      itemSelector: listPlan.itemSelector,
      itemCount: runtime.data.length,
      warnings: [...runtime.warnings],
      errors: [...runtime.errors],
      items: runtime.diagnosticsItems.map((item) => ({
        index: item.index,
        fields: item.fields,
      })),
    };
  }

  return {
    data,
    diagnostics,
    ok,
    errors,
  };
}
