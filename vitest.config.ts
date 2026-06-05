import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@echo-bridge/audio': path.resolve(dirname, 'packages/audio/src/index.ts'),
      '@echo-bridge/captions': path.resolve(dirname, 'packages/captions/src/index.ts'),
      '@echo-bridge/shared': path.resolve(dirname, 'packages/shared/src/index.ts'),
      '@echo-bridge/transcription': path.resolve(dirname, 'packages/transcription/src/index.ts'),
      '@echo-bridge/translation': path.resolve(dirname, 'packages/translation/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
