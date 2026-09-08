#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['node_modules', 'release', '.git']);
const scriptExtensions = new Set(['.js', '.cjs', '.mjs']);
const requiredFiles = [
  'package.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/runner.cjs',
  'electron/lib/runtime.cjs',
  'electron/lib/run-manager.cjs',
  'electron/lib/npm-manager.cjs',
  'electron/lib/workspace.cjs',
  'renderer/index.html',
  'renderer/app.js',
  'renderer/styles.css',
  'README.md',
  'AGENTS.md',
];

function collectScripts(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectScripts(fullPath, output);
    } else if (entry.isFile() && scriptExtensions.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
}

for (const relativePath of requiredFiles) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`缺少必要文件：${relativePath}`);
    process.exit(1);
  }
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

for (const dependency of ['electron', 'electron-builder', 'monaco-editor']) {
  if (!packageJson.devDependencies?.[dependency]) {
    console.error(`package.json 缺少开发依赖：${dependency}`);
    process.exit(1);
  }
}

if (!packageJson.dependencies?.esbuild) {
  console.error('package.json 缺少运行依赖：esbuild');
  process.exit(1);
}

for (const scriptName of ['start', 'test', 'check', 'dist:mac', 'dist:win']) {
  if (!packageJson.scripts?.[scriptName]) {
    console.error(`package.json 缺少脚本：${scriptName}`);
    process.exit(1);
  }
}

const scripts = collectScripts(root).sort();
for (const scriptPath of scripts) {
  const result = spawnSync(process.execPath, ['--check', scriptPath], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }

  console.log(`OK  ${path.relative(root, scriptPath)}`);
}

console.log(`\n源码检查通过：${scripts.length} 个脚本，${requiredFiles.length} 个必要文件。`);
