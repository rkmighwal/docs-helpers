import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __RELEASE_DATE__: JSON.stringify(pkg.releaseDate),
    __LICENSE_ID__: JSON.stringify(pkg.license),
  },
  // the LICENSE file lives in the repository root, one level above this folder
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2020', outDir: 'dist' },
});
