import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const watch = process.argv.includes('--watch');
await mkdir(resolve(root, 'public/build'), { recursive: true });
const options = {
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  outfile: 'public/build/app.js',
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};
let bundler;
if (watch) { bundler = await context(options); await bundler.watch(); }
else await build(options);
const css = spawn(process.execPath, [resolve(root, 'node_modules/@tailwindcss/cli/dist/index.mjs'), '-i', 'src/styles.css', '-o', 'public/build/app.css', '--minify', ...(watch ? ['--watch=always'] : [])], { cwd: root, stdio: 'inherit' });
css.on('error', error => { console.error(error.message); process.exitCode = 1; });
css.on('exit', code => { if (!watch) process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { css.kill('SIGTERM'); await bundler?.dispose(); process.exit(0); });
