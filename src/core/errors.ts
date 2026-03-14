export type FatalErrorCode = 'INVALID_INPUT' | 'INTERNAL_ERROR';

export class ExtractionRuntimeError extends Error {
  readonly code: FatalErrorCode;

  constructor(code: FatalErrorCode, message: string, options?: { cause?: unknown }) {
    super(`[${code}] ${message}`);
    this.name = 'ExtractionRuntimeError';
    this.code = code;

    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function getInputType(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

export function createInvalidInputError(input: unknown): ExtractionRuntimeError {
  const inputType = getInputType(input);
  return new ExtractionRuntimeError(
    'INVALID_INPUT',
    `extract() expected input to be an HTML string or a Response, but received ${inputType}.`,
  );
}

export function createInternalError(message: string, cause?: unknown): ExtractionRuntimeError {
  return new ExtractionRuntimeError('INTERNAL_ERROR', message, { cause });
}
