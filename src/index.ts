export { extract } from './core/extract';
export { validateConfig } from './config/validate';
export { ExtractionRuntimeError } from './core/errors';
export type {
  ExtractOptions,
  ExtractionDiagnostics,
  ExtractionError,
  ExtractionResult,
  ExtractorConfig,
  FieldDiagnostics,
  FieldRule,
  ListDiagnostics,
  ListRule,
  OutputRule,
  PrimitiveValue,
  TransformSpec,
  ValidationIssue,
  ValidationResult,
} from './types/public';

export default {
  async fetch(): Promise<Response> {
    return new Response('RewriterKit is a library module. Import and use extract()/validateConfig().', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  },
};
