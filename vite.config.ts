import fs from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function resolveBuildBase(): string {
  if (process.env.VITE_BASE_PATH) {
    const custom = process.env.VITE_BASE_PATH.trim();
    return custom.endsWith('/') ? custom : `${custom}/`;
  }
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY) {
    const repoFromCi = process.env.GITHUB_REPOSITORY.split('/')[1];
    if (repoFromCi) {
      return `/${repoFromCi}/`;
    }
  }
  return '/';
}

function githubPagesSpaFallbackPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'github-pages-spa-fallback',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const indexFile = path.resolve(__dirname, outDir, 'index.html');
      const notFoundFile = path.resolve(__dirname, outDir, '404.html');
      if (fs.existsSync(indexFile)) {
        fs.copyFileSync(indexFile, notFoundFile);
      }
    },
  };
}

export default defineConfig(({ command }) => {
  const base = command === 'build' ? resolveBuildBase() : '/';

  return {
    base,
    plugins: [react(), tailwindcss(), githubPagesSpaFallbackPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

