'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const WORKSPACE_MANIFEST = 'package.json';
const SETTINGS_FILE = 'settings.json';

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function sortRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function pathIsDirectory(targetPath) {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, content, 'utf8');

  try {
    await fs.rename(tempPath, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath);
  }
}

function isValidPackageName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214) {
    return false;
  }

  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name);
}

class WorkspaceService {
  constructor(app) {
    this.app = app;
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
    this.workspacePath = '';
  }

  async init() {
    const settings = await this.#readSettings();
    const configuredPath =
      typeof settings.workspacePath === 'string' && settings.workspacePath.trim()
        ? settings.workspacePath
        : null;

    if (configuredPath) {
      try {
        await this.setWorkspace(configuredPath, { persist: false });
        return this.workspacePath;
      } catch {
        // Fall through to the default workspace.
      }
    }

    const preferred = path.join(
      this.app.getPath('documents'),
      'OfflineJsLabWorkspace',
    );

    try {
      await this.setWorkspace(preferred, { persist: true });
    } catch {
      const fallback = path.join(this.app.getPath('userData'), 'workspace');
      await this.setWorkspace(fallback, { persist: true });
    }

    return this.workspacePath;
  }

  getPath() {
    if (!this.workspacePath) {
      throw new Error('工作区尚未初始化。');
    }
    return this.workspacePath;
  }

  getManifestPath() {
    return path.join(this.getPath(), WORKSPACE_MANIFEST);
  }

  getNodeModulesPath() {
    return path.join(this.getPath(), 'node_modules');
  }

  getRunsPath() {
    return path.join(this.getPath(), '.offline-js-lab', 'runs');
  }

  async setWorkspace(inputPath, { persist = true } = {}) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
      throw new Error('工作区路径不能为空。');
    }

    const nextPath = path.resolve(inputPath.trim());

    try {
      const stat = await fs.stat(nextPath);
      if (!stat.isDirectory()) {
        throw new Error('所选路径不是文件夹。');
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
      await fs.mkdir(nextPath, { recursive: true });
    }

    this.workspacePath = nextPath;
    await this.#ensureWorkspaceFiles();

    if (persist) {
      const settings = await this.#readSettings();
      await this.#writeSettings({ ...settings, workspacePath: nextPath });
    }

    return nextPath;
  }

  async readManifest() {
    try {
      const parsed = parseJson(await fs.readFile(this.getManifestPath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('工作区 package.json 不是有效的 JSON 对象。');
      }

      parsed.dependencies = parsed.dependencies || {};
      parsed.devDependencies = parsed.devDependencies || {};
      return parsed;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        await this.#ensureWorkspaceFiles();
        return this.readManifest();
      }
      throw error;
    }
  }

  async writeManifest(manifest) {
    const normalized = {
      ...manifest,
      dependencies: sortRecord(manifest.dependencies || {}),
      devDependencies: sortRecord(manifest.devDependencies || {}),
    };
    await writeJsonAtomic(this.getManifestPath(), normalized);
  }

  packageDirectory(packageName) {
    if (!isValidPackageName(packageName)) {
      throw new Error(`无效的 npm 包名：${packageName}`);
    }
    return path.join(this.getNodeModulesPath(), ...packageName.split('/'));
  }

  async listPackages() {
    const manifest = await this.readManifest();
    const dependencies = manifest.dependencies || {};
    const devDependencies = manifest.devDependencies || {};
    const packageNames = [...new Set([
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
    ])].sort((left, right) => left.localeCompare(right));

    const result = [];

    for (const name of packageNames) {
      let packageJson = null;
      const packageJsonPath = path.join(this.packageDirectory(name), 'package.json');

      try {
        packageJson = parseJson(await fs.readFile(packageJsonPath, 'utf8'));
      } catch {
        packageJson = null;
      }

      result.push({
        name,
        declaredVersion: dependencies[name] || devDependencies[name] || '',
        installedVersion:
          packageJson && typeof packageJson.version === 'string'
            ? packageJson.version
            : null,
        license:
          packageJson && typeof packageJson.license === 'string'
            ? packageJson.license
            : null,
        dev: Object.prototype.hasOwnProperty.call(devDependencies, name),
        installed: Boolean(packageJson),
      });
    }

    return result;
  }

  async discoverInstalledPackageDirectories() {
    const nodeModulesPath = this.getNodeModulesPath();
    if (!(await pathIsDirectory(nodeModulesPath))) {
      return [];
    }

    const result = [];
    const entries = await fs.readdir(nodeModulesPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) {
        continue;
      }

      const firstLevelPath = path.join(nodeModulesPath, entry.name);
      if (entry.name.startsWith('@')) {
        const scopedEntries = await fs.readdir(firstLevelPath, { withFileTypes: true });
        for (const scopedEntry of scopedEntries) {
          if (
            scopedEntry.isDirectory() &&
            !scopedEntry.isSymbolicLink() &&
            !scopedEntry.name.startsWith('.')
          ) {
            result.push({
              name: `${entry.name}/${scopedEntry.name}`,
              directory: path.join(firstLevelPath, scopedEntry.name),
            });
          }
        }
      } else {
        result.push({ name: entry.name, directory: firstLevelPath });
      }
    }

    return result.sort((left, right) => left.name.localeCompare(right.name));
  }

  async collectTypeDefinitions({ maxFiles = 800, maxBytes = 8 * 1024 * 1024 } = {}) {
    const packages = await this.discoverInstalledPackageDirectories();
    const files = [];
    const state = { bytes: 0, truncated: false };

    for (const packageInfo of packages) {
      if (state.truncated) {
        break;
      }
      await this.#scanTypeFiles(packageInfo.directory, files, state, {
        maxFiles,
        maxBytes,
      });
    }

    return {
      files,
      truncated: state.truncated,
      totalBytes: state.bytes,
    };
  }

  async #scanTypeFiles(directory, files, state, limits) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (state.truncated) {
        return;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        await this.#scanTypeFiles(fullPath, files, state, limits);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.d.ts')) {
        continue;
      }

      const stat = await fs.stat(fullPath);
      if (files.length >= limits.maxFiles || state.bytes + stat.size > limits.maxBytes) {
        state.truncated = true;
        return;
      }

      const content = await fs.readFile(fullPath, 'utf8');
      const relativePath = path
        .relative(this.getNodeModulesPath(), fullPath)
        .split(path.sep)
        .join('/');

      files.push({
        uri: `file:///workspace/node_modules/${relativePath}`,
        content,
      });
      state.bytes += Buffer.byteLength(content, 'utf8');
    }
  }

  async #ensureWorkspaceFiles() {
    await fs.mkdir(this.getNodeModulesPath(), { recursive: true });
    await fs.mkdir(this.getRunsPath(), { recursive: true });

    try {
      await fs.access(this.getManifestPath());
    } catch {
      await writeJsonAtomic(this.getManifestPath(), {
        name: 'offline-js-lab-workspace',
        version: '1.0.0',
        private: true,
        description: 'Packages used by Offline JS Lab scripts.',
        dependencies: {},
        devDependencies: {},
      });
    }
  }

  async #readSettings() {
    try {
      return parseJson(await fs.readFile(this.settingsPath, 'utf8'), {}) || {};
    } catch {
      return {};
    }
  }

  async #writeSettings(settings) {
    await writeJsonAtomic(this.settingsPath, settings);
  }
}

module.exports = {
  WorkspaceService,
  isValidPackageName,
  parseJson,
  writeJsonAtomic,
};
