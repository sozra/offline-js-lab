'use strict';

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  createChildEnvironment,
  describeRuntime,
  resolveNodeRuntime,
} = require('./runtime.cjs');

const MAX_CODE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const ESM_COMPATIBILITY_BANNER = `
import { createRequire as __offlineCreateRequire } from 'node:module';
import { fileURLToPath as __offlineFileURLToPath } from 'node:url';
import { dirname as __offlineDirname } from 'node:path';
const require = __offlineCreateRequire(import.meta.url);
const __filename = __offlineFileURLToPath(import.meta.url);
const __dirname = __offlineDirname(__filename);
`;

function formatBuildError(error) {
  if (!error || !Array.isArray(error.errors) || error.errors.length === 0) {
    return error && error.message ? error.message : String(error);
  }

  return error.errors
    .map((item) => {
      const location = item.location;
      if (!location) {
        return item.text;
      }
      const file = location.file || 'scratch';
      return `${file}:${location.line}:${location.column + 1} ${item.text}`;
    })
    .join('\n');
}

async function removeQuietly(filePath) {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // A stale temporary file is preferable to losing the process close event.
  }
}

function send(webContents, channel, payload) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(channel, payload);
  }
}

class RunManager {
  constructor({
    workspaceService,
    getRunnerPath,
    spawnProcess = spawn,
    resolveRuntime = resolveNodeRuntime,
    getCompiler = () => require('esbuild'),
  }) {
    this.workspace = workspaceService;
    this.getRunnerPath = getRunnerPath;
    this.spawnProcess = spawnProcess;
    this.resolveRuntime = resolveRuntime;
    this.getCompiler = getCompiler;
    this.runs = new Map();
  }

  getRuntimeInfo() {
    const runtime = this.resolveRuntime();
    return {
      command: describeRuntime(runtime),
      source: runtime.source,
    };
  }

  async start(webContents, payload) {
    const code = payload && typeof payload.code === 'string' ? payload.code : '';
    const language = payload && payload.language === 'javascript'
      ? 'javascript'
      : 'typescript';
    const sourceFilePath =
      payload && typeof payload.sourceFilePath === 'string' && payload.sourceFilePath
        ? path.resolve(payload.sourceFilePath)
        : null;

    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
      return {
        ok: false,
        error: `脚本超过 ${MAX_CODE_BYTES / 1024 / 1024} MB 的 MVP 限制。`,
      };
    }

    const runId = crypto.randomUUID();
    const outputPath = path.join(this.workspace.getRunsPath(), `${runId}.mjs`);
    const resolveDir = sourceFilePath
      ? path.dirname(sourceFilePath)
      : this.workspace.getPath();
    const sourceFile = sourceFilePath
      ? path.basename(sourceFilePath)
      : language === 'typescript'
        ? 'scratch.ts'
        : 'scratch.js';

    await fs.mkdir(this.workspace.getRunsPath(), { recursive: true });

    try {
      const compiler = this.getCompiler();
      const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

      await compiler.build({
        stdin: {
          contents: code,
          loader: language === 'typescript' ? 'ts' : 'js',
          resolveDir,
          sourcefile: sourceFile,
        },
        absWorkingDir: this.workspace.getPath(),
        banner: { js: ESM_COMPATIBILITY_BANNER },
        bundle: true,
        charset: 'utf8',
        format: 'esm',
        legalComments: 'none',
        logLevel: 'silent',
        nodePaths: [this.workspace.getNodeModulesPath()],
        outfile: outputPath,
        platform: 'node',
        sourcemap: 'inline',
        target: [`node${Number.isFinite(nodeMajor) ? nodeMajor : 22}`],
      });
    } catch (error) {
      await removeQuietly(outputPath);
      return {
        ok: false,
        error: formatBuildError(error),
      };
    }

    const runtime = this.resolveRuntime();
    const args = [...runtime.argsPrefix, this.getRunnerPath(), outputPath];
    let child;

    try {
      child = this.spawnProcess(runtime.command, args, {
        cwd: this.workspace.getPath(),
        env: createChildEnvironment({ OFFLINE_JS_LAB: '1' }),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      await removeQuietly(outputPath);
      return {
        ok: false,
        error: `无法启动 Node.js 执行进程：${error.message}`,
      };
    }

    const record = {
      child,
      outputPath,
      reason: 'completed',
      startedAt: Date.now(),
      outputBytes: 0,
      outputLimited: false,
    };
    this.runs.set(runId, record);

    const forwardOutput = (stream, chunk) => {
      const currentRecord = this.runs.get(runId);
      if (!currentRecord || currentRecord.outputLimited) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - currentRecord.outputBytes);
      const accepted = buffer.subarray(0, remaining);

      if (accepted.length > 0) {
        send(webContents, 'run:output', {
          runId,
          stream,
          text: accepted.toString('utf8'),
        });
      }

      currentRecord.outputBytes += buffer.length;
      if (buffer.length > remaining) {
        currentRecord.outputLimited = true;
        currentRecord.reason = 'output-limit';
        send(webContents, 'run:output', {
          runId,
          stream: 'system',
          text: `\n输出超过 ${MAX_OUTPUT_BYTES / 1024 / 1024} MB，已终止执行进程。\n`,
        });
        currentRecord.child.kill();
      }
    };

    if (child.stdout) {
      child.stdout.on('data', (chunk) => forwardOutput('stdout', chunk));
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => forwardOutput('stderr', chunk));
    }

    child.once('error', (error) => {
      const currentRecord = this.runs.get(runId);
      if (currentRecord) {
        currentRecord.reason = 'failed';
      }
      send(webContents, 'run:output', {
        runId,
        stream: 'stderr',
        text:
          `无法启动 Node.js：${error.message}\n` +
          '请确认 Node.js 位于 PATH 中，或使用 npm start 启动应用。\n',
      });
    });

    child.once('close', async (code, signal) => {
      const latestRecord = this.runs.get(runId) || record;
      this.runs.delete(runId);
      await removeQuietly(outputPath);

      if (
        latestRecord.reason === 'completed' &&
        Number.isInteger(code) &&
        code !== 0
      ) {
        latestRecord.reason = 'failed';
      }

      send(webContents, 'run:exit', {
        runId,
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
        reason: latestRecord.reason,
        durationMs: Date.now() - latestRecord.startedAt,
      });
    });

    return {
      ok: true,
      runId,
      runtime: describeRuntime(runtime),
    };
  }

  stop(runId) {
    const record = this.runs.get(runId);
    if (!record) {
      return false;
    }

    record.reason = 'stopped';
    return record.child.kill();
  }

  stopAll() {
    for (const record of this.runs.values()) {
      record.reason = 'app-closed';
      record.child.kill();
    }
  }
}

module.exports = {
  RunManager,
  formatBuildError,
};
