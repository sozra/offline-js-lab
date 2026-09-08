'use strict';

const util = require('node:util');
const { pathToFileURL } = require('node:url');

function formatError(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  return util.inspect(value, {
    colors: false,
    depth: 8,
    maxArrayLength: 200,
    breakLength: 100,
  });
}

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Unhandled rejection: ${formatError(reason)}\n`);
  process.exitCode = 1;
});

process.on('uncaughtException', (error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});

(async () => {
  const entryPath = process.argv[2];
  if (!entryPath) {
    throw new Error('缺少待执行脚本路径。');
  }

  const entryUrl = `${pathToFileURL(entryPath).href}?run=${Date.now()}`;
  await import(entryUrl);
})().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
