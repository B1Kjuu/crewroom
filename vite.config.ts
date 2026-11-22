import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/office',
  base: './',
  build: {
    outDir: '../../dist/office',
    emptyOutDir: true,
  },
});
