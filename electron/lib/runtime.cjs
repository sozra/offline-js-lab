'use strict';

const fs = require('node:fs');

function existingPath(value) {
  return typeof value === 'string' && value.length > 0 && fs.existsSync(value)
    ? value
    : null;
}

function resolveNodeRuntime(env = process.env, platform = process.platform) {
  const npmNode = existingPath(env.npm_node_execpath);
  if (npmNode) {
    return {
      command: npmNode,
      argsPrefix: [],
      source: 'npm_node_execpath',
    };
  }

  const explicitNode = existingPath(env.OFFLINE_JS_LAB_NODE);
  if (explicitNode) {
    return {
      command: explicitNode,
      argsPrefix: [],
      source: 'OFFLINE_JS_LAB_NODE',
    };
  }

  return {
    command: platform === 'win32' ? 'node.exe' : 'node',
    argsPrefix: [],
    source: 'PATH',
  };
}

function resolveNpmRuntime(env = process.env, platform = process.platform) {
  const npmCli = existingPath(env.npm_execpath);
  if (npmCli) {
    const nodeRuntime = resolveNodeRuntime(env, platform);
    return {
      command: nodeRuntime.command,
      argsPrefix: [...nodeRuntime.argsPrefix, npmCli],
      source: `npm CLI via ${nodeRuntime.source}`,
    };
  }

  const explicitNpm = existingPath(env.OFFLINE_JS_LAB_NPM);
  if (explicitNpm) {
    return {
      command: explicitNpm,
      argsPrefix: [],
      source: 'OFFLINE_JS_LAB_NPM',
    };
  }

  return {
    command: platform === 'win32' ? 'npm.cmd' : 'npm',
    argsPrefix: [],
    source: 'PATH',
  };
}

function createChildEnvironment(extra = {}, { preserveNodeOptions = false } = {}) {
  const environment = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    ...extra,
  };

  if (!preserveNodeOptions) {
    delete environment.NODE_OPTIONS;
  }
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function describeRuntime(runtime) {
  const prefix = runtime.argsPrefix.length > 0
    ? ` ${runtime.argsPrefix.join(' ')}`
    : '';
  return `${runtime.command}${prefix}`;
}

module.exports = {
  createChildEnvironment,
  describeRuntime,
  resolveNodeRuntime,
  resolveNpmRuntime,
};
