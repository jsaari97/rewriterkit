import { extract, type ExtractionResult, type ExtractorConfig, type InferExtractedData } from '../src';

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2) ? true : false;

function assertTrue<T extends true>(value: T): void {
  void value;
}

const inferredConfig = {
  version: '1',
  fields: {
    title: {
      selectors: ['h1'],
      type: 'text',
    },
    price: {
      selectors: ['.price'],
      type: 'text',
      transforms: ['parseNumber'],
    },
    inStock: {
      selectors: ['.stock'],
      type: 'text',
      transforms: ['parseBoolean'],
    },
    rank: {
      selectors: ['.rank'],
      type: 'text',
      default: 0,
    },
    tags: {
      selectors: ['.tag'],
      type: 'text',
      cardinality: 'many',
    },
    hasPromo: {
      selectors: ['.promo'],
      type: 'exists',
    },
    products: {
      kind: 'list',
      itemSelector: '.product',
      fields: {
        id: {
          selectors: ['.id'],
          type: 'text',
          transforms: ['parseInteger'],
        },
        label: {
          selectors: ['.label'],
          type: 'text',
        },
        available: {
          selectors: ['.available'],
          type: 'exists',
        },
        scores: {
          selectors: ['.score'],
          type: 'text',
          cardinality: 'many',
          transforms: ['parseNumber'],
        },
      },
    },
  },
} as const satisfies ExtractorConfig;

type InferredData = InferExtractedData<typeof inferredConfig>;

assertTrue<IsEqual<InferredData['title'], string | null>>(true);
assertTrue<IsEqual<InferredData['price'], number | null>>(true);
assertTrue<IsEqual<InferredData['inStock'], boolean | null>>(true);
assertTrue<IsEqual<InferredData['rank'], string | 0 | null>>(true);
assertTrue<IsEqual<InferredData['tags'], string[]>>(true);
assertTrue<IsEqual<InferredData['hasPromo'], boolean>>(true);
assertTrue<IsEqual<InferredData['products'][number]['id'], number | null>>(true);
assertTrue<IsEqual<InferredData['products'][number]['label'], string | null>>(true);
assertTrue<IsEqual<InferredData['products'][number]['available'], boolean>>(true);
assertTrue<IsEqual<InferredData['products'][number]['scores'], number[]>>(true);

const inferredPromise = extract('<main></main>', inferredConfig);
const inferredResultContract: Promise<ExtractionResult<InferredData>> = inferredPromise;
void inferredResultContract;
type InferredResult = Awaited<typeof inferredPromise>;
assertTrue<IsEqual<InferredResult['data']['price'], number | null>>(true);
assertTrue<IsEqual<InferredResult['data']['products'][number]['scores'], number[]>>(true);

interface ExplicitDataShape {
  sku: string;
  flags: string[];
}

const explicitPromise = extract<ExplicitDataShape>('<main></main>', inferredConfig);
const explicitResultContract: Promise<ExtractionResult<ExplicitDataShape>> = explicitPromise;
void explicitResultContract;
