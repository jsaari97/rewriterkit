import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityFlags: [
          'enable_nodejs_tty_module',
          'enable_nodejs_fs_module',
          'enable_nodejs_http_modules',
          'enable_nodejs_perf_hooks_module',
          'enable_nodejs_v8_module',
          'enable_nodejs_process_v2',
        ],
        compatibilityDate: '2026-03-17',
      },
    }),
  ],
  test: {
    coverage: {
      provider: 'istanbul',
    },
  },
});
