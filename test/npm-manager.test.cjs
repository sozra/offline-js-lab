'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const {
  NpmManager,
  buildNpmArguments,
  parsePackageSpecs,
} = require('../electron/lib/npm-manager.cjs');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
  }

  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
    return true;
  }
}

test('解析普通包、带版本包和 scoped 包', () => {
  assert.deepEqual(
    parsePackageSpecs('lodash dayjs\n@types/lodash lodash@4.17.21'),
    ['lodash', 'dayjs', '@types/lodash', 'lodash@4.17.21'],
  );
  assert.throws(() => parsePackageSpecs('--registry=https://bad.example'), /不支持/);
});

test('生成标准 npm install 参数', () => {
  assert.deepEqual(
    buildNpmArguments('install', { specs: 'lodash dayjs', dev: false }),
    ['install', 'lodash', 'dayjs', '--save', '--no-audit', '--no-fund', '--color=false'],
  );
  assert.deepEqual(
    buildNpmArguments('install', { specs: '@types/lodash', dev: true }),
    ['install', '@types/lodash', '--save-dev', '--no-audit', '--no-fund', '--color=false'],
  );
});

test('在工作区调用当前 npm CLI 并转发输出', async () => {
  const calls = [];
  const outputs = [];
  let child;
  const manager = new NpmManager({
    workspaceService: { getPath: () => '/tmp/offline-js-lab-test' },
    resolveRuntime: () => ({
      command: '/fake/node',
      argsPrefix: ['/fake/npm-cli.js'],
      source: 'test',
    }),
    spawnProcess(command, args, options) {
      child = new FakeChild();
      calls.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.write('added 2 packages\n');
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0, null);
      });
      return child;
    },
  });

  const result = await manager.run(
    'install',
    { specs: 'lodash dayjs', dev: false },
    (output) => outputs.push(output),
  );

  assert.equal(result.ok, true);
  assert.equal(calls[0].command, '/fake/node');
  assert.deepEqual(calls[0].args.slice(0, 4), [
    '/fake/npm-cli.js',
    'install',
    'lodash',
    'dayjs',
  ]);
  assert.equal(calls[0].options.cwd, '/tmp/offline-js-lab-test');
  assert.match(outputs.map((item) => item.text).join(''), /added 2 packages/);
});
