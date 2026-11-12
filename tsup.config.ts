import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', express: 'src/adapters/express.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  splitting: false,
  external: ['express'],
});
