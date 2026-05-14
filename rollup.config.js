import typescript from '@rollup/plugin-typescript';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const config = {
  input: 'src/main.ts',
  output: {
    dir: '.',
    sourcemap: 'inline',
    format: 'cjs',
    exports: 'default',
    name: 'QmdAsMdPlugin'
  },
  external: [
    'obsidian',
    'electron',
    'path',
    'child_process',
    'fs',
    'os',
    '@codemirror/state',
    '@codemirror/view',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/search',
    '@codemirror/autocomplete',
    '@codemirror/lint',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
  ],
  plugins: [
    typescript({
      sourceMap: true,
      inlineSources: true,
      target: "ES2021",
      module: "ESNext"
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: true
    }),
    commonjs({
      extensions: ['.js', '.ts']
    })
  ]
};

export default config;