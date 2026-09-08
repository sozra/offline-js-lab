'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { RunManager } = require('../electron/lib/run-manager.cjs');

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('等待异步事件超时。');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createFixture(compiledSource) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-js-lab-run-'));
  const runsPath = path.join(root, '.offline-js-lab', 'runs');
  const nodeModulesPath = path.join(root, 'node_modules');
  await fs.mkdir(runsPath, { recursive: true });
  await fs.mkdir(nodeModulesPath, { recursive: true });

  const manager = new RunManager({
    workspaceService: {
      getPath: () => root,
      getRunsPath: () => runsPath,
      getNodeModulesPath: () => nodeModulesPath,
    },
    getRunnerPath: () => path.resolve(__dirname, '..', 'electron', 'runner.cjs'),
    resolveRuntime: () => ({
      command: process.execPath,
      argsPrefix: [],
      source: 'test',
    }),
    getCompiler: () => ({
      async build(options) {
        await fs.writeFile(options.outfile, compiledSource, 'utf8');
      },
    }),
  });

  return { root, manager };
}

function createWebContents(sent) {
  return {
    isDestroyed: () => false,
    send: (channel, payload) => sent.push({ channel, payload }),
  };
}

test('普通脚本打印后由系统 Node 自然结束，不会保持“运行中”', async (t) => {
  const fixture = await createFixture('console.log("hello from node");\n');
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const sent = [];
  const result = await fixture.manager.start(createWebContents(sent), {
    language: 'typescript',
    code: 'console.log("source");',
  });

  assert.equal(result.ok, true);
  await waitFor(() => sent.some((item) => item.channel === 'run:exit'));

  const output = sent
    .filter((item) => item.channel === 'run:output')
    .map((item) => item.payload.text)
    .join('');
  const exit = sent.find((item) => item.channel === 'run:exit').payload;

  assert.match(output, /hello from node/);
  assert.equal(exit.reason, 'completed');
  assert.equal(exit.code, 0);
  await assert.rejects(
    fs.access(path.join(fixture.root, '.offline-js-lab', 'runs', `${result.runId}.mjs`)),
  );
});

test('长驻脚本不设超时，可由用户手动停止', async (t) => {
  const fixture = await createFixture(
    'console.log("ready"); setInterval(() => {}, 1000);\n',
  );
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const sent = [];
  const result = await fixture.manager.start(createWebContents(sent), {
    language: 'javascript',
    code: 'setInterval(() => {}, 1000);',
  });

  assert.equal(result.ok, true);
  await waitFor(() => sent.some(
    (item) => item.channel === 'run:output' && item.payload.text.includes('ready'),
  ));
  assert.equal(fixture.manager.stop(result.runId), true);
  await waitFor(() => sent.some((item) => item.channel === 'run:exit'));

  const exit = sent.find((item) => item.channel === 'run:exit').payload;
  assert.equal(exit.reason, 'stopped');
});

test('编译错误直接返回，不启动 Node 进程', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-js-lab-compile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  let spawned = false;
  const manager = new RunManager({
    workspaceService: {
      getPath: () => root,
      getRunsPath: () => path.join(root, 'runs'),
      getNodeModulesPath: () => path.join(root, 'node_modules'),
    },
    getRunnerPath: () => path.resolve(__dirname, '..', 'electron', 'runner.cjs'),
    spawnProcess() {
      spawned = true;
      throw new Error('不应执行');
    },
    getCompiler: () => ({
      async build() {
        const error = new Error('Build failed');
        error.errors = [{
          text: 'Expected identifier',
          location: { file: 'scratch.ts', line: 1, column: 13 },
        }];
        throw error;
      },
    }),
  });

  const result = await manager.start(createWebContents([]), {
    language: 'typescript',
    code: 'const value: = 1;',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /scratch\.ts:1:14/);
  assert.equal(spawned, false);
});
