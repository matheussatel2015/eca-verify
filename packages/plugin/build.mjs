import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'EcaVerify',
  outfile: 'dist/eca-verify.js',
  minify: true,
  target: ['es2019'],
});
console.log('plugin bundled -> dist/eca-verify.js');
