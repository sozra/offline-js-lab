'use strict';

const { spawn } = require('node:child_process');
const { isValidPackageName } = require('./workspace.cjs');
const {
  createChildEnvironment,
  describeRuntime,
  resolveNpmRuntime,
} = require('./runtime.cjs');

const MAX_PACKAGE_SPECS = 50;

function packageNameFromSpec(spec) {
  if (spec.startsWith('@')) {
    const slashIndex = spec.indexOf('/');
    if (slashIndex < 2) {
      return spec;
    }
    const versionIndex = spec.indexOf('@', slashIndex + 1);
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
  }

  const versionIndex = spec.lastIndexOf('@');
  return versionIndex > 0 ? spec.slice(0, versionIndex) : spec;
}

function parsePackageSpecs(input) {
  const values = Array.isArray(input)
    ? input
    : String(input || '').split(/[\s,]+/);
  const specs = values.map((value) => String(value).trim()).filter(Boolean);

  if (specs.length === 0) {
    throw new Error('请输入至少一个 npm 包名，例如 lodash dayjs。');
  }
  if (specs.length > MAX_PACKAGE_SPECS) {
    throw new Error(`一次最多安装 ${MAX_PACKAGE_SPECS} 个包。`);
  }

  for (const spec of specs) {
    if (
      spec.length > 300 ||
      spec.startsWith('-') ||
      /[\u0000-\u001f\u007f\s]/.test(spec)
    ) {
      throw new Error(`不支持的 npm 包参数：${spec}`);
    }

    const packageName = packageNameFromSpec(spec);
    if (!isValidPackageName(packageName)) {
      throw new Error(`无效的 npm 包名：${spec}`);
    }
  }

  return [...new Set(specs)];
}

function parsePackageNames(input) {
  const names = Array.isArray(input)
    ? input.map((value) => String(value).trim()).filter(Boolean)
    : String(input || '').split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);

  if (names.length === 0) {
    throw new Error('缺少要卸载的 npm 包名。');
  }

  for (const name of names) {
    if (!isValidPackageName(name)) {
      throw new Error(`无效的 npm 包名：${name}`);
    }
  }

  return [...new Set(names)];
}

function buildNpmArguments(action, payload = {}) {
  const common = ['--no-audit', '--no-fund', '--color=false'];

  if (action === 'install') {
    const specs = parsePackageSpecs(payload.specs);
    return [
      'install',
      ...specs,
      payload.dev ? '--save-dev' : '--save',
      ...common,
    ];
  }

  if (action === 'sync') {
    return ['install', ...common];
  }

  if (action === 'uninstall') {
    return ['uninstall', ...parsePackageNames(payload.names), ...common];
  }

  throw new Error(`不支持的 npm 操作：${action}`);
}

function emitOutput(callback, stream, text) {
  if (typeof callback === 'function' && text) {
    callback({ stream, text: String(text) });
  }
}

class NpmManager {
  constructor({
    workspaceService,
    spawnProcess = spawn,
    resolveRuntime = resolveNpmRuntime,
  }) {
    this.workspace = workspaceService;
    this.spawnProcess = spawnProcess;
    this.resolveRuntime = resolveRuntime;
    this.active = null;
  }

  getRuntimeInfo() {
    const runtime = this.resolveRuntime();
    return {
      command: describeRuntime(runtime),
      source: runtime.source,
    };
  }

  async run(action, payload = {}, onOutput) {
    if (this.active) {
      throw new Error('已有 npm 操作正在执行。');
    }

    const npmArguments = buildNpmArguments(action, payload);
    const runtime = this.resolveRuntime();
    const args = [...runtime.argsPrefix, ...npmArguments];
    const cwd = this.workspace.getPath();

    emitOutput(
      onOutput,
      'system',
      `$ npm ${npmArguments.join(' ')}\n`,
    );

    return new Promise((resolve, reject) => {
      let child;
      let settled = false;

      const clearActive = () => {
        if (this.active && this.active.child === child) {
          this.active = null;
        }
      };

      try {
        child = this.spawnProcess(runtime.command, args, {
          cwd,
          env: createChildEnvironment(
            { OFFLINE_JS_LAB: '1' },
            { preserveNodeOptions: true },
          ),
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        reject(new Error(`无法启动 npm：${error.message}`));
        return;
      }

      this.active = { child, action };

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          emitOutput(onOutput, 'stdout', chunk.toString('utf8'));
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          emitOutput(onOutput, 'stderr', chunk.toString('utf8'));
        });
      }

      child.once('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearActive();
        reject(
          new Error(
            `npm 启动失败：${error.message}。请确认 Node.js/npm 已安装，或通过 npm start 启动应用。`,
          ),
        );
      });

      child.once('close', (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearActive();

        const normalizedCode = Number.isInteger(code) ? code : null;
        resolve({
          ok: normalizedCode === 0,
          code: normalizedCode,
          signal: signal || null,
          action,
        });
      });
    });
  }

  stop() {
    if (!this.active) {
      return false;
    }
    return this.active.child.kill();
  }

  stopAll() {
    this.stop();
  }
}

module.exports = {
  NpmManager,
  buildNpmArguments,
  packageNameFromSpec,
  parsePackageNames,
  parsePackageSpecs,
};
