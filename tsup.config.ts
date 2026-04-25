import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  outDir: 'dist',
  external: ['vscode'],
  noExternal: [/^(?!vscode).*/],
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: false,
  esbuildOptions(options) {
    options.define = {
      ...options.define,
      'import.meta.url': '__filename',
    };
  },
});
