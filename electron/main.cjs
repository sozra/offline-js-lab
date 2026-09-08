'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} = require('electron');
const { WorkspaceService } = require('./lib/workspace.cjs');
const { NpmManager } = require('./lib/npm-manager.cjs');
const { RunManager } = require('./lib/run-manager.cjs');

const MAX_FILE_BYTES = 10 * 1024 * 1024;

app.setName('Offline JS Lab');

let mainWindow = null;
let workspaceService = null;
let npmManager = null;
let runManager = null;

function resolveUnpackedPath(inputPath) {
  const marker = `${path.sep}app.asar${path.sep}`;
  if (!inputPath.includes(marker)) {
    return inputPath;
  }

  const unpackedPath = inputPath.replace(
    marker,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  return fsSync.existsSync(unpackedPath) ? unpackedPath : inputPath;
}

function configureEsbuildBinary() {
  if (!app.isPackaged) {
    return;
  }

  const platformPackage = `${process.platform}-${process.arch}`;
  const binaryRelativePath =
    process.platform === 'win32' ? 'esbuild.exe' : path.join('bin', 'esbuild');
  const candidate = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@esbuild',
    platformPackage,
    binaryRelativePath,
  );

  if (fsSync.existsSync(candidate)) {
    process.env.ESBUILD_BINARY_PATH = candidate;
  }
}

function getRunnerPath() {
  return resolveUnpackedPath(path.join(__dirname, 'runner.cjs'));
}

function getRendererUrl() {
  return pathToFileURL(path.join(app.getAppPath(), 'renderer', 'index.html')).href;
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (senderUrl !== getRendererUrl()) {
    throw new Error('拒绝来自非应用页面的 IPC 请求。');
  }
}

function registerTrustedHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

function getMonacoPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'monaco');
  }
  return path.join(app.getAppPath(), 'node_modules', 'monaco-editor', 'min');
}

function getOwnerWindow(webContents) {
  return BrowserWindow.fromWebContents(webContents) || mainWindow;
}

function send(webContents, channel, payload) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(channel, payload);
  }
}

function sendAppCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    send(mainWindow.webContents, 'app:command', command);
  }
}

function guessLanguage(filePath) {
  return /\.(?:ts|mts|cts)$/i.test(filePath) ? 'typescript' : 'javascript';
}

async function getPackageState() {
  return {
    workspacePath: workspaceService.getPath(),
    installed: await workspaceService.listPackages(),
    npmRuntime: npmManager.getRuntimeInfo(),
  };
}

async function getBootstrapState() {
  const monacoBaseUrl = pathToFileURL(`${getMonacoPath()}${path.sep}`)
    .href
    .replace(/\/$/, '');

  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    monacoBaseUrl,
    packages: await getPackageState(),
    nodeRuntime: runManager.getRuntimeInfo(),
  };
}

async function runNpmOperation(event, action, payload = {}) {
  const progress = ({ stream, text }) => {
    send(event.sender, 'packages:output', { stream, text });
  };

  const result = await npmManager.run(action, payload, progress);
  return {
    ...result,
    packages: await getPackageState(),
  };
}

function registerIpcHandlers() {
  registerTrustedHandler('bootstrap:get', async () => getBootstrapState());

  registerTrustedHandler('workspace:choose', async (event) => {
    const result = await dialog.showOpenDialog(getOwnerWindow(event.sender), {
      title: '选择 Offline JS Lab 工作区',
      defaultPath: workspaceService.getPath(),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    runManager.stopAll();
    npmManager.stopAll();
    await workspaceService.setWorkspace(result.filePaths[0]);
    return getPackageState();
  });

  registerTrustedHandler('workspace:open', async () => {
    const errorMessage = await shell.openPath(workspaceService.getPath());
    return errorMessage || null;
  });

  registerTrustedHandler('file:open', async (event) => {
    const result = await dialog.showOpenDialog(getOwnerWindow(event.sender), {
      title: '打开 JS/TS 脚本',
      defaultPath: workspaceService.getPath(),
      properties: ['openFile'],
      filters: [
        {
          name: 'JavaScript / TypeScript',
          extensions: ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'],
        },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 的 MVP 限制。`);
    }

    return {
      filePath,
      content: await fs.readFile(filePath, 'utf8'),
      language: guessLanguage(filePath),
    };
  });

  registerTrustedHandler('file:save', async (event, payload) => {
    const content = payload && typeof payload.content === 'string'
      ? payload.content
      : '';
    const language = payload && payload.language === 'javascript'
      ? 'javascript'
      : 'typescript';
    const forceSaveAs = Boolean(payload && payload.saveAs);
    let filePath =
      payload && typeof payload.filePath === 'string' && payload.filePath
        ? path.resolve(payload.filePath)
        : null;

    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      throw new Error(`文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 的 MVP 限制。`);
    }

    if (!filePath || forceSaveAs) {
      const defaultName = language === 'typescript' ? 'scratch.ts' : 'scratch.js';
      const result = await dialog.showSaveDialog(getOwnerWindow(event.sender), {
        title: '保存脚本',
        defaultPath: filePath || path.join(workspaceService.getPath(), defaultName),
        filters: [
          {
            name: language === 'typescript' ? 'TypeScript' : 'JavaScript',
            extensions: language === 'typescript' ? ['ts'] : ['js'],
          },
          { name: '所有文件', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return null;
      }
      filePath = result.filePath;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');

    return {
      filePath,
      language: guessLanguage(filePath),
    };
  });

  registerTrustedHandler('run:start', async (event, payload) => {
    return runManager.start(event.sender, payload);
  });

  registerTrustedHandler('run:stop', async (_event, runId) => {
    return runManager.stop(runId);
  });

  registerTrustedHandler('packages:list', async () => getPackageState());
  registerTrustedHandler('packages:types', async () => {
    return workspaceService.collectTypeDefinitions();
  });
  registerTrustedHandler('packages:install', async (event, payload) => {
    return runNpmOperation(event, 'install', payload);
  });
  registerTrustedHandler('packages:sync', async (event) => {
    return runNpmOperation(event, 'sync');
  });
  registerTrustedHandler('packages:uninstall', async (event, payload) => {
    return runNpmOperation(event, 'uninstall', payload);
  });
  registerTrustedHandler('packages:stop', async () => npmManager.stop());
}

function createApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [
        {
          label: '新建',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendAppCommand('new'),
        },
        {
          label: '打开…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendAppCommand('open'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendAppCommand('save'),
        },
        {
          label: '另存为…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendAppCommand('save-as'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '运行',
      submenu: [
        {
          label: '运行代码',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => sendAppCommand('run'),
        },
        {
          label: '停止运行',
          accelerator: 'CmdOrCtrl+.',
          click: () => sendAppCommand('stop'),
        },
      ],
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0f15',
    title: 'Offline JS Lab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== getRendererUrl()) {
      event.preventDefault();
    }
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    runManager?.stopAll();
    npmManager?.stopAll();
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
  mainWindow = window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.offlinejslab.desktop');
    }

    configureEsbuildBinary();
    workspaceService = new WorkspaceService(app);
    await workspaceService.init();
    npmManager = new NpmManager({ workspaceService });
    runManager = new RunManager({ workspaceService, getRunnerPath });

    registerIpcHandlers();
    createApplicationMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch((error) => {
    dialog.showErrorBox('Offline JS Lab 启动失败', error.stack || error.message);
    app.quit();
  });
}

app.on('before-quit', () => {
  runManager?.stopAll();
  npmManager?.stopAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
