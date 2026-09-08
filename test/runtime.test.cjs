'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  resolveNodeRuntime,
  resolveNpmRuntime,
} = require('../electron/lib/runtime.cjs');

test('优先使用 npm start 提供的 Node 与 npm CLI 路径', () => {
  const env = {
    npm_node_execpath: process.execPath,
    npm_execpath: __filename,
  };

  const nodeRuntime = resolveNodeRuntime(env, process.platform);
  const npmRuntime = resolveNpmRuntime(env, process.platform);

  assert.equal(nodeRuntime.command, process.execPath);
  assert.equal(nodeRuntime.source, 'npm_node_execpath');
  assert.equal(npmRuntime.command, process.execPath);
  assert.deepEqual(npmRuntime.argsPrefix, [__filename]);
});

test('Windows 与 macOS/Linux 都有 PATH 回退命令', () => {
  assert.equal(resolveNodeRuntime({}, 'win32').command, 'node.exe');
  assert.equal(resolveNpmRuntime({}, 'win32').command, 'npm.cmd');
  assert.equal(resolveNodeRuntime({}, 'darwin').command, 'node');
  assert.equal(resolveNpmRuntime({}, 'darwin').command, 'npm');
});
