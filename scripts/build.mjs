// Build both faces of the plugin package.
//
// lib/index.js  - Host Loader entry (ESM, Node); package dependencies stay external.
// lib/client.js - Web Client entry in the dsh client-module format: a CJS body wrapped in
//                 `window.__ModuleLoader__.load({ id, factory })`, whose `require` is answered by the
//                 shell's module table. Only PLATFORM_MODULES may stay external; everything else is inlined.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = new URL('..', import.meta.url)
const rootDir = fileURLToPath(root)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

// Mirrors PLATFORM_MODULES in deepseek-harness packages/client/web/src/platform.ts (dsh 0.2.x).
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const production = process.env.NODE_ENV !== 'development'

await build({
  absWorkingDir: rootDir,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: 'linked',
  logLevel: 'warning',
})

const client = await build({
  absWorkingDir: rootDir,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
  minify: production,
  metafile: true,
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'warning',
})

// Purity gate: a cross-plugin value import would inline a second runtime instance or ask the
// module table for a specifier it cannot answer.
const external = new Set()
for (const output of Object.values(client.metafile.outputs)) {
  for (const entry of output.imports) if (entry.external) external.add(entry.path)
}
const illegal = [...external].filter(path => !PLATFORM_MODULES.includes(path))
if (illegal.length > 0) throw new Error(`client bundle requires modules outside PLATFORM_MODULES: ${illegal.join(', ')}`)
const inlinedDsh = Object.keys(client.metafile.inputs).filter(path => /node_modules[\\/]@deepseek-ai[\\/]/.test(path))
if (inlinedDsh.length > 0) throw new Error(`client bundle inlines dsh runtime code: ${inlinedDsh.join(', ')}`)
