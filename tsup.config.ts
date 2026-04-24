import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  outDir: 'dist',
  external: ['vscode', 'fdir'],
  noExternal: [/^(?!vscode|fdir).*/],
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: false,
  define: {
    'import.meta.url': 'undefined',
  },
  esbuildOptions(options) {
    options.define = {
      ...options.define,
      'import.meta.url': JSON.stringify(''),
    };
  },
});
