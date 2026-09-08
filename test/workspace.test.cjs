'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WorkspaceService, isValidPackageName } = require('../electron/lib/workspace.cjs');

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-js-lab-workspace-'));
  const app = {
    getPath(name) {
      if (name === 'userData') return path.join(root, 'userData');
      if (name === 'documents') return path.join(root, 'documents');
      throw new Error(`未知 app 路径：${name}`);
    },
  };
  const workspace = new WorkspaceService(app);
  await workspace.init();
  return { root, workspace };
}

test('初始化跨平台工作区并维护 package.json', async (t) => {
  const { root, workspace } = await createFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const manifest = await workspace.readManifest();
  assert.equal(manifest.private, true);
  assert.deepEqual(await workspace.listPackages(), []);

  manifest.dependencies.lodash = '^4.17.21';
  await workspace.writeManifest(manifest);
  const packages = await workspace.listPackages();
  assert.equal(packages[0].name, 'lodash');
  assert.equal(packages[0].installed, false);
});

test('发现 node_modules 中的 .d.ts 类型文件', async (t) => {
  const { root, workspace } = await createFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const packageDirectory = path.join(workspace.getNodeModulesPath(), 'demo');
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0' }),
  );
  await fs.writeFile(
    path.join(packageDirectory, 'index.d.ts'),
    'export declare const value: number;',
  );

  const result = await workspace.collectTypeDefinitions();
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].uri, /node_modules\/demo\/index\.d\.ts$/);
});

test('只接受安全的 npm 包名', () => {
  assert.equal(isValidPackageName('lodash'), true);
  assert.equal(isValidPackageName('@types/lodash'), true);
  assert.equal(isValidPackageName('../escape'), false);
  assert.equal(isValidPackageName('@scope/../../escape'), false);
});
