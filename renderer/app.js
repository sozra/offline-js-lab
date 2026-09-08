'use strict';

const api = window.offlineJsLab;
const AUTO_RUN_DELAY_MS = 500;
const MIN_PANE_WIDTH = 260;
const DEFAULT_SPLIT_RATIO = 0.5;
const EDITOR_THEME = 'offline-js-lab-dark';

const DEFAULT_TYPESCRIPT = `type RecordItem = {
  projectName: string;
  indexValue: number;
};

const records: RecordItem[] = [
  { projectName: 'Alpha', indexValue: 12 },
  { projectName: 'Alpha', indexValue: 2 },
  { projectName: 'Beta', indexValue: 20 },
];

const totals = records.reduce<Record<string, number>>((result, item) => {
  result[item.projectName] = (result[item.projectName] ?? 0) + item.indexValue;
  return result;
}, {});

console.log(totals);

// 在“包与工作区”中 npm install lodash dayjs 后可直接使用：
// import _ from 'lodash';
// import dayjs from 'dayjs';
// console.log(_.groupBy(records, 'projectName'));
// console.log(dayjs('20260908').format('YYYY-MM-DD'));
`;

const DEFAULT_JAVASCRIPT = `const records = [
  { projectName: 'Alpha', indexValue: 12 },
  { projectName: 'Alpha', indexValue: 2 },
  { projectName: 'Beta', indexValue: 20 },
];

const totals = records.reduce((result, item) => {
  result[item.projectName] = (result[item.projectName] ?? 0) + item.indexValue;
  return result;
}, {});

console.log(totals);

// 在“包与工作区”中 npm install lodash dayjs 后可直接使用：
// const _ = require('lodash');
// const dayjs = require('dayjs');
// console.log(_.groupBy(records, 'projectName'));
// console.log(dayjs('20260908').format('YYYY-MM-DD'));
`;

const elements = {
  newButton: document.querySelector('#new-button'),
  openButton: document.querySelector('#open-button'),
  saveButton: document.querySelector('#save-button'),
  saveAsButton: document.querySelector('#save-as-button'),
  languageTypeScriptButton: document.querySelector('#language-typescript-button'),
  languageJavaScriptButton: document.querySelector('#language-javascript-button'),
  runModeManualButton: document.querySelector('#run-mode-manual-button'),
  runModeLiveButton: document.querySelector('#run-mode-live-button'),
  runButton: document.querySelector('#run-button'),
  runLabel: document.querySelector('#run-label'),
  runShortcut: document.querySelector('#run-shortcut'),
  stopButton: document.querySelector('#stop-button'),
  stopShortcut: document.querySelector('#stop-shortcut'),
  packagesButton: document.querySelector('#packages-button'),
  fileName: document.querySelector('#file-name'),
  dirtyIndicator: document.querySelector('#dirty-indicator'),
  editorMessage: document.querySelector('#editor-message'),
  editorHost: document.querySelector('#editor'),
  splitView: document.querySelector('#split-view'),
  editorPane: document.querySelector('#editor-pane'),
  splitter: document.querySelector('#splitter'),
  clearOutputOnRunCheckbox: document.querySelector(
    '#clear-output-on-run-checkbox',
  ),
  clearOutputButton: document.querySelector('#clear-output-button'),
  output: document.querySelector('#output'),
  runStatus: document.querySelector('#run-status'),
  statusText: document.querySelector('#status-text'),
  runtimeText: document.querySelector('#runtime-text'),
  versionText: document.querySelector('#version-text'),
  packagesDialog: document.querySelector('#packages-dialog'),
  closeDialogButton: document.querySelector('#close-dialog-button'),
  dialogDoneButton: document.querySelector('#dialog-done-button'),
  workspacePath: document.querySelector('#workspace-path'),
  chooseWorkspaceButton: document.querySelector('#choose-workspace-button'),
  openWorkspaceButton: document.querySelector('#open-workspace-button'),
  npmRuntimeText: document.querySelector('#npm-runtime-text'),
  packageInput: document.querySelector('#package-input'),
  devDependencyCheckbox: document.querySelector('#dev-dependency-checkbox'),
  installPackagesButton: document.querySelector('#install-packages-button'),
  syncPackagesButton: document.querySelector('#sync-packages-button'),
  stopPackageButton: document.querySelector('#stop-package-button'),
  refreshPackagesButton: document.querySelector('#refresh-packages-button'),
  installedPackageList: document.querySelector('#installed-package-list'),
  npmStatusText: document.querySelector('#npm-status-text'),
  confirmDialog: document.querySelector('#confirm-dialog'),
  confirmTitle: document.querySelector('#confirm-title'),
  confirmMessage: document.querySelector('#confirm-message'),
  confirmOkButton: document.querySelector('#confirm-ok-button'),
  confirmCancelButton: document.querySelector('#confirm-cancel-button'),
  toastRegion: document.querySelector('#toast-region'),
};

const state = {
  monaco: null,
  editor: null,
  filePath: null,
  language: 'typescript',
  dirty: false,
  suppressEditorChange: false,
  runMode: 'manual',
  clearOutputOnRun: true,
  runId: null,
  runStarting: false,
  completedRuns: new Map(),
  pendingAutoRun: false,
  autoRunTimer: null,
  autoStopRequested: false,
  npmBusy: false,
  packageState: null,
  typeDisposables: [],
  splitRatio: DEFAULT_SPLIT_RATIO,
  splitterDragging: false,
};

function storageGet(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Local storage is only a convenience.
  }
}

function fileNameFromPath(filePath) {
  if (!filePath) {
    return state.language === 'typescript' ? '未命名.ts' : '未命名.js';
  }
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function stripAnsi(text) {
  return String(text).replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    '',
  );
}

function removeOutputPlaceholder() {
  elements.output.querySelector('.output-placeholder')?.remove();
}

function appendOutput(text, stream = 'stdout') {
  if (!text) {
    return;
  }

  removeOutputPlaceholder();
  const shouldStickToBottom =
    elements.output.scrollHeight - elements.output.scrollTop - elements.output.clientHeight < 48;
  const chunk = document.createElement('span');
  chunk.className = `output-chunk output-${stream}`;
  chunk.textContent = stripAnsi(text);
  elements.output.appendChild(chunk);

  if (shouldStickToBottom) {
    elements.output.scrollTop = elements.output.scrollHeight;
  }
}

function clearOutput() {
  elements.output.replaceChildren();
}

const TOAST_ICONS = { success: '✓', error: '✕', info: 'ℹ' };
const TOAST_DURATION_MS = { success: 3600, info: 3600, error: 8000 };

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${TOAST_ICONS[type] ? type : 'info'}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = String(message);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'toast-close';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', '关闭通知');
  closeButton.addEventListener('click', () => toast.remove());

  toast.append(icon, text, closeButton);
  elements.toastRegion.appendChild(toast);
  window.setTimeout(
    () => toast.remove(),
    TOAST_DURATION_MS[type] || TOAST_DURATION_MS.info,
  );
}

let editorMessageTimer = null;

function setEditorMessage(message, { transient = false } = {}) {
  if (editorMessageTimer) {
    window.clearTimeout(editorMessageTimer);
    editorMessageTimer = null;
  }
  elements.editorMessage.classList.remove('is-faded');
  elements.editorMessage.textContent = message || '';
  if (transient && message) {
    editorMessageTimer = window.setTimeout(() => {
      editorMessageTimer = null;
      elements.editorMessage.classList.add('is-faded');
    }, 4000);
  }
}

function setRunStatus(label, kind = 'idle') {
  elements.runStatus.textContent = label;
  elements.runStatus.className = `status-pill status-${kind}`;
}

function setDirty(value) {
  state.dirty = Boolean(value);
  elements.dirtyIndicator.hidden = !state.dirty;
  updateFileIdentity();
}

function updateFileIdentity() {
  const fileName = fileNameFromPath(state.filePath);
  elements.fileName.textContent = fileName;
  elements.fileName.title = state.filePath || '尚未保存到文件';
  document.title = `${state.dirty ? '● ' : ''}${fileName} — Offline JS Lab`;
}

function updateStatusText() {
  const workspacePath = state.packageState?.workspacePath || '工作区未就绪';
  const modeText = state.runMode === 'live' ? '实时运行' : '手动运行';
  const workspaceName = state.packageState?.workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop()
    : workspacePath;
  elements.statusText.textContent = `${modeText} · ${workspaceName}`;
  elements.statusText.title = workspacePath;
}

function syncSegmentedControls() {
  const languageButtons = {
    typescript: elements.languageTypeScriptButton,
    javascript: elements.languageJavaScriptButton,
  };
  for (const [language, button] of Object.entries(languageButtons)) {
    const active = state.language === language;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  const runModeButtons = {
    manual: elements.runModeManualButton,
    live: elements.runModeLiveButton,
  };
  for (const [mode, button] of Object.entries(runModeButtons)) {
    const active = state.runMode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function syncControls() {
  const running = Boolean(state.runId || state.runStarting);
  const fileBlocked = running || state.npmBusy;
  const packageBlocked = running || state.npmBusy;

  elements.runButton.disabled = !state.editor || running || state.npmBusy;
  elements.runButton.classList.toggle('is-busy', running);
  elements.runLabel.textContent = running ? '运行中' : '运行';
  elements.stopButton.disabled = !state.runId;
  elements.newButton.disabled = fileBlocked;
  elements.openButton.disabled = fileBlocked;
  elements.languageTypeScriptButton.disabled = fileBlocked;
  elements.languageJavaScriptButton.disabled = fileBlocked;
  elements.chooseWorkspaceButton.disabled = packageBlocked;
  elements.packageInput.disabled = state.npmBusy;
  elements.devDependencyCheckbox.disabled = state.npmBusy;
  elements.installPackagesButton.disabled = packageBlocked;
  elements.syncPackagesButton.disabled = packageBlocked;
  elements.refreshPackagesButton.disabled = state.npmBusy;
  elements.stopPackageButton.hidden = !state.npmBusy;

  for (const button of elements.installedPackageList.querySelectorAll('button')) {
    button.disabled = packageBlocked;
  }
}

function setNpmBusy(value, statusText = null) {
  state.npmBusy = Boolean(value);
  elements.npmStatusText.textContent = statusText || (state.npmBusy ? 'npm 执行中…' : 'npm 空闲');
  syncControls();
}

function persistScratch() {
  if (!state.editor) {
    return;
  }
  storageSet('offlineJsLab.code', state.editor.getValue());
  storageSet('offlineJsLab.language', state.language);
  storageSet('offlineJsLab.runMode', state.runMode);
  storageSet('offlineJsLab.clearOutputOnRun', state.clearOutputOnRun);
}

function replaceEditorValue(value) {
  state.suppressEditorChange = true;
  state.editor.setValue(value);
  state.suppressEditorChange = false;
  persistScratch();
}

function setLanguage(language, { replaceDefault = false, scheduleRun = true } = {}) {
  const normalized = language === 'javascript' ? 'javascript' : 'typescript';
  if (state.editor && state.language === normalized) {
    return;
  }
  state.language = normalized;
  syncSegmentedControls();

  if (state.editor && state.monaco) {
    state.monaco.editor.setModelLanguage(state.editor.getModel(), state.language);
    if (replaceDefault) {
      replaceEditorValue(
        state.language === 'typescript' ? DEFAULT_TYPESCRIPT : DEFAULT_JAVASCRIPT,
      );
    }
  }

  updateFileIdentity();
  persistScratch();
  if (scheduleRun) {
    scheduleAutoRun();
  }
}

async function loadMonaco(baseUrl) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/$/, '');
  const vsBaseUrl = `${normalizedBaseUrl}/vs`;
  const workerMainUrl = `${vsBaseUrl}/base/worker/workerMain.js`;

  window.MonacoEnvironment = {
    getWorkerUrl() {
      const workerSource = [
        `self.MonacoEnvironment = { baseUrl: ${JSON.stringify(`${normalizedBaseUrl}/`)} };`,
        `importScripts(${JSON.stringify(workerMainUrl)});`,
      ].join('\n');
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerSource)}`;
    },
  };

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${vsBaseUrl}/loader.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Monaco Editor 加载失败。'));
    document.head.appendChild(script);
  });

  return new Promise((resolve, reject) => {
    window.require.config({ paths: { vs: vsBaseUrl } });
    window.require(
      ['vs/editor/editor.main'],
      () => resolve(window.monaco),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function configureMonaco(monaco) {
  const typescript = monaco.typescript || monaco.languages?.typescript;
  if (!typescript) {
    throw new Error('Monaco TypeScript language service 未加载。');
  }

  // 让编辑器背景与外壳的冷蓝黑 token 保持一致，避免 vs-dark 默认灰蓝的割裂感。
  monaco.editor.defineTheme(EDITOR_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0e141d',
      'editor.lineHighlightBackground': '#16202c',
      'editorLineNumber.foreground': '#44536a',
      'editorLineNumber.activeForeground': '#96a4b8',
      'editorCursor.foreground': '#94bfff',
      'editor.selectionBackground': '#3d75c955',
      'editor.inactiveSelectionBackground': '#3d75c933',
      'editorIndentGuide.background1': '#1d2836',
      'editorIndentGuide.activeBackground1': '#2c3b4f',
      'editorBracketMatch.background': '#3d75c933',
      'editorBracketMatch.border': '#3a4a60',
      'editorWidget.background': '#131b26',
      'editorWidget.border': '#273344',
      'input.background': '#0a1017',
      'scrollbarSlider.background': '#3a4a6055',
      'scrollbarSlider.hoverBackground': '#3a4a6088',
      'scrollbarSlider.activeBackground': '#72a9ff88',
    },
  });

  const moduleResolution =
    typescript.ModuleResolutionKind.NodeJs ||
    typescript.ModuleResolutionKind.Node10 ||
    2;
  const commonOptions = {
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    module: typescript.ModuleKind.ESNext,
    moduleResolution,
    noEmit: true,
    resolveJsonModule: true,
    strict: false,
    target: typescript.ScriptTarget.ES2022,
  };

  typescript.typescriptDefaults.setCompilerOptions(commonOptions);
  typescript.javascriptDefaults.setCompilerOptions({
    ...commonOptions,
    allowJs: true,
    checkJs: true,
  });

  const diagnostics = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [2307, 7016],
  };
  typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics);
  typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics);
  typescript.typescriptDefaults.setEagerModelSync(true);
  typescript.javascriptDefaults.setEagerModelSync(true);
}

function createEditor(monaco) {
  const savedLanguage = storageGet('offlineJsLab.language', 'typescript');
  state.language = savedLanguage === 'javascript' ? 'javascript' : 'typescript';
  state.runMode = storageGet('offlineJsLab.runMode', 'manual') === 'live'
    ? 'live'
    : 'manual';
  state.clearOutputOnRun =
    storageGet('offlineJsLab.clearOutputOnRun', 'true') !== 'false';
  elements.clearOutputOnRunCheckbox.checked = state.clearOutputOnRun;
  syncSegmentedControls();

  const fallbackCode =
    state.language === 'typescript' ? DEFAULT_TYPESCRIPT : DEFAULT_JAVASCRIPT;
  const initialCode = storageGet('offlineJsLab.code', fallbackCode);
  const modelUri = monaco.Uri.parse(
    `file:///workspace/scratch.${state.language === 'typescript' ? 'ts' : 'js'}`,
  );
  const model = monaco.editor.createModel(initialCode, state.language, modelUri);

  state.editor = monaco.editor.create(elements.editorHost, {
    model,
    theme: EDITOR_THEME,
    automaticLayout: true,
    fontFamily: 'SFMono-Regular, Cascadia Code, Consolas, monospace',
    fontLigatures: true,
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    padding: { top: 12, bottom: 20 },
    renderWhitespace: 'selection',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    tabSize: 2,
    wordWrap: 'off',
  });

  state.editor.onDidChangeModelContent(() => {
    if (state.suppressEditorChange) {
      return;
    }
    setDirty(true);
    persistScratch();
    scheduleAutoRun();
  });

  state.editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
    () => runCode({ trigger: 'manual' }),
  );
  state.editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    () => saveFile(false),
  );
  state.editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO,
    () => openFile(),
  );

  updateFileIdentity();
  updateStatusText();
  syncControls();

  if (state.runMode === 'live') {
    scheduleAutoRun(80);
  }
}

function renderPackageState(packageState) {
  state.packageState = packageState;
  elements.workspacePath.textContent = packageState.workspacePath || '—';
  elements.workspacePath.title = packageState.workspacePath || '';

  const npmRuntime = packageState.npmRuntime;
  if (npmRuntime) {
    elements.npmRuntimeText.textContent =
      `npm：${npmRuntime.command}（${npmRuntime.source}），沿用当前 .npmrc 配置。`;
    elements.npmRuntimeText.title = npmRuntime.command;
  }

  elements.installedPackageList.replaceChildren();
  const installedPackages = packageState.installed || [];

  if (installedPackages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '尚未声明直接依赖';
    elements.installedPackageList.appendChild(empty);
  } else {
    for (const packageInfo of installedPackages) {
      const row = document.createElement('div');
      row.className = 'installed-package';

      const meta = document.createElement('div');
      meta.className = 'installed-package-meta';

      const name = document.createElement('strong');
      name.className = 'installed-package-name';
      name.textContent = packageInfo.name;
      name.title = packageInfo.name;

      const detail = document.createElement('span');
      detail.className = 'installed-package-detail';
      const version = packageInfo.installedVersion || packageInfo.declaredVersion || '未知版本';
      detail.textContent =
        `${version}${packageInfo.dev ? ' · devDependency' : ' · dependency'}` +
        `${packageInfo.license ? ` · ${packageInfo.license}` : ''}`;

      meta.append(name, detail);

      const actions = document.createElement('div');
      actions.className = 'package-row-actions';

      const dot = document.createElement('span');
      dot.className = `package-state-dot${packageInfo.installed ? '' : ' missing'}`;
      dot.title = packageInfo.installed ? '已安装' : '目录缺失，请同步 package.json';

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'button button-ghost button-small';
      removeButton.textContent = '卸载';
      removeButton.addEventListener('click', () => uninstallPackage(packageInfo.name));

      actions.append(dot, removeButton);
      row.append(meta, actions);
      elements.installedPackageList.appendChild(row);
    }
  }

  updateStatusText();
  syncControls();
}

async function refreshPackageState() {
  try {
    renderPackageState(await api.listPackages());
  } catch (error) {
    showToast(`读取包状态失败：${error.message}`, 'error');
  }
}

function setRunMode(mode) {
  const normalized = mode === 'live' ? 'live' : 'manual';
  if (state.runMode === normalized) {
    return;
  }
  state.runMode = normalized;
  syncSegmentedControls();
  persistScratch();
  updateStatusText();
  if (state.runMode === 'live') {
    scheduleAutoRun(80);
  } else {
    cancelAutoRun();
  }
}

function confirmAction({ title, message, confirmLabel = '确定', danger = false }) {
  const dialog = elements.confirmDialog;
  if (dialog.open) {
    return Promise.resolve(false);
  }

  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmOkButton.textContent = confirmLabel;
  elements.confirmOkButton.classList.toggle('button-danger', danger);
  elements.confirmOkButton.classList.toggle('button-primary', !danger);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) {
        dialog.close();
      }
      resolve(result);
    };
    const onCancel = () => finish(false);

    elements.confirmOkButton.onclick = () => finish(true);
    elements.confirmCancelButton.onclick = () => finish(false);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}

async function refreshTypeDefinitions() {
  if (!state.monaco) {
    return;
  }

  setEditorMessage('正在加载 npm 包类型定义…');
  for (const disposable of state.typeDisposables) {
    disposable.dispose();
  }
  state.typeDisposables = [];

  try {
    const result = await api.getTypeDefinitions();
    const typescript =
      state.monaco.typescript || state.monaco.languages?.typescript;
    if (!typescript) {
      throw new Error('Monaco TypeScript language service 未加载。');
    }

    for (const file of result.files || []) {
      state.typeDisposables.push(
        typescript.typescriptDefaults.addExtraLib(file.content, file.uri),
      );
      state.typeDisposables.push(
        typescript.javascriptDefaults.addExtraLib(file.content, file.uri),
      );
    }

    const suffix = result.truncated ? '，已达到读取上限' : '';
    setEditorMessage(`已加载 ${(result.files || []).length} 个类型文件${suffix}`, {
      transient: true,
    });
  } catch (error) {
    setEditorMessage('类型定义加载失败');
    appendOutput(`类型定义加载失败：${error.message}\n`, 'stderr');
  }
}

function cancelAutoRun() {
  if (state.autoRunTimer) {
    window.clearTimeout(state.autoRunTimer);
    state.autoRunTimer = null;
  }
  state.pendingAutoRun = false;
  state.autoStopRequested = false;
}

function scheduleAutoRun(delayMs = AUTO_RUN_DELAY_MS) {
  if (state.runMode !== 'live' || !state.editor) {
    return;
  }

  if (state.autoRunTimer) {
    window.clearTimeout(state.autoRunTimer);
  }

  state.autoRunTimer = window.setTimeout(() => {
    state.autoRunTimer = null;
    state.pendingAutoRun = true;
    flushAutoRun();
  }, delayMs);
}

function flushAutoRun() {
  if (
    state.runMode !== 'live' ||
    !state.pendingAutoRun ||
    !state.editor ||
    state.npmBusy
  ) {
    return;
  }

  if (state.runStarting) {
    return;
  }

  if (state.runId) {
    if (!state.autoStopRequested) {
      state.autoStopRequested = true;
      api.stopRun(state.runId).catch((error) => {
        state.autoStopRequested = false;
        appendOutput(`自动停止旧进程失败：${error.message}\n`, 'stderr');
      });
    }
    return;
  }

  state.autoStopRequested = false;
  state.pendingAutoRun = false;
  void runCode({ trigger: 'auto' });
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return '';
  }
  return durationMs < 1000
    ? `${Math.max(0, Math.round(durationMs))} ms`
    : `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)} s`;
}

function applyRunExit(payload) {
  const duration = formatDuration(payload.durationMs);

  if (payload.reason === 'completed' && payload.code === 0) {
    setRunStatus(duration ? `完成 · ${duration}` : '完成', 'success');
  } else if (payload.reason === 'stopped') {
    setRunStatus('已停止', 'stopped');
  } else if (payload.reason === 'output-limit') {
    setRunStatus('输出超限', 'error');
  } else {
    const codeText = payload.code === null ? '' : ` · code ${payload.code}`;
    setRunStatus(`运行失败${codeText}`, 'error');
  }
}

async function runCode({ trigger = 'manual' } = {}) {
  if (!state.editor || state.runId || state.runStarting || state.npmBusy) {
    return;
  }

  if (trigger === 'manual') {
    if (state.autoRunTimer) {
      window.clearTimeout(state.autoRunTimer);
      state.autoRunTimer = null;
    }
    state.pendingAutoRun = false;
  }

  if (state.clearOutputOnRun) {
    clearOutput();
  }

  state.runStarting = true;
  syncControls();
  setRunStatus('编译中', 'running');
  appendOutput(
    `──────── ${trigger === 'auto' ? '实时运行' : '运行'} ${new Date().toLocaleTimeString()} ────────\n`,
    'system',
  );

  try {
    const result = await api.runCode({
      code: state.editor.getValue(),
      language: state.language,
      sourceFilePath: state.filePath,
    });

    state.runStarting = false;

    if (!result.ok) {
      appendOutput(`${result.error}\n`, 'stderr');
      setRunStatus('编译失败', 'error');
      syncControls();
      flushAutoRun();
      return;
    }

    const earlyExit = state.completedRuns.get(result.runId);
    if (earlyExit) {
      state.completedRuns.delete(result.runId);
      state.runId = null;
      applyRunExit(earlyExit);
    } else {
      state.runId = result.runId;
      setRunStatus('运行中', 'running');
    }

    syncControls();
    flushAutoRun();
  } catch (error) {
    state.runStarting = false;
    appendOutput(`启动失败：${error.message}\n`, 'stderr');
    setRunStatus('启动失败', 'error');
    syncControls();
    flushAutoRun();
  }
}

async function stopRun({ preserveAutoRun = false } = {}) {
  if (!state.runId) {
    return;
  }

  if (!preserveAutoRun) {
    cancelAutoRun();
  }

  const runId = state.runId;
  try {
    const stopped = await api.stopRun(runId);
    if (!stopped) {
      appendOutput('执行进程已经结束。\n', 'muted');
    }
  } catch (error) {
    appendOutput(`停止失败：${error.message}\n`, 'stderr');
  }
}

function confirmDiscardChanges() {
  if (!state.dirty) {
    return Promise.resolve(true);
  }
  return confirmAction({
    title: '放弃未保存的修改？',
    message: '当前脚本尚未保存，继续操作将丢失这些修改。',
    confirmLabel: '放弃修改',
    danger: true,
  });
}

async function newFile() {
  if (!(await confirmDiscardChanges())) {
    return;
  }

  state.filePath = null;
  replaceEditorValue(
    state.language === 'typescript' ? DEFAULT_TYPESCRIPT : DEFAULT_JAVASCRIPT,
  );
  setDirty(false);
  state.editor.focus();
  scheduleAutoRun(80);
}

async function openFile() {
  if (!(await confirmDiscardChanges())) {
    return;
  }

  try {
    const result = await api.openFile();
    if (!result) {
      return;
    }

    state.filePath = result.filePath;
    setLanguage(result.language, { scheduleRun: false });
    replaceEditorValue(result.content);
    setDirty(false);
    state.editor.focus();
    scheduleAutoRun(80);
  } catch (error) {
    showToast(`打开失败：${error.message}`, 'error');
  }
}

async function saveFile(saveAs) {
  if (!state.editor) {
    return;
  }

  try {
    const result = await api.saveFile({
      filePath: state.filePath,
      content: state.editor.getValue(),
      language: state.language,
      saveAs: Boolean(saveAs),
    });

    if (!result) {
      return;
    }

    state.filePath = result.filePath;
    setLanguage(result.language, { scheduleRun: false });
    setDirty(false);
    showToast('已保存', 'success');
  } catch (error) {
    showToast(`保存失败：${error.message}`, 'error');
  }
}

async function chooseWorkspace() {
  if (state.runId || state.runStarting || state.npmBusy) {
    return;
  }

  try {
    const packageState = await api.chooseWorkspace();
    if (!packageState) {
      return;
    }
    renderPackageState(packageState);
    await refreshTypeDefinitions();
    appendOutput(`\n[工作区] 已切换到 ${packageState.workspacePath}\n`, 'system');
    showToast('工作区已切换', 'success');
    scheduleAutoRun(80);
  } catch (error) {
    showToast(`切换工作区失败：${error.message}`, 'error');
  }
}

async function openWorkspace() {
  try {
    const errorMessage = await api.openWorkspace();
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  } catch (error) {
    showToast(`打开工作区失败：${error.message}`, 'error');
  }
}

async function performNpmOperation(action, payload, label) {
  if (state.npmBusy || state.runId || state.runStarting) {
    return;
  }

  setNpmBusy(true, `${label}…`);
  appendOutput(`\n──────── ${label} ────────\n`, 'package');

  try {
    let result;
    if (action === 'install') {
      result = await api.installPackages(payload);
    } else if (action === 'sync') {
      result = await api.syncPackages();
    } else if (action === 'uninstall') {
      result = await api.uninstallPackages(payload);
    } else {
      throw new Error(`未知 npm 操作：${action}`);
    }

    renderPackageState(result.packages);
    await refreshTypeDefinitions();

    if (!result.ok) {
      throw new Error(`npm 退出码 ${result.code ?? '未知'}`);
    }

    elements.npmStatusText.textContent = `${label}完成`;
    showToast(`${label}完成`, 'success');
    if (action === 'install') {
      elements.packageInput.value = '';
    }
    scheduleAutoRun(80);
  } catch (error) {
    elements.npmStatusText.textContent = `${label}失败`;
    appendOutput(`[npm 失败] ${error.message}\n`, 'stderr');
    showToast(`${label}失败：${error.message}`, 'error');
    await refreshPackageState();
  } finally {
    setNpmBusy(false, elements.npmStatusText.textContent);
  }
}

async function installPackages() {
  const specs = elements.packageInput.value.trim();
  if (!specs) {
    showToast('请输入包名，例如 lodash dayjs', 'error');
    elements.packageInput.focus();
    return;
  }

  await performNpmOperation(
    'install',
    { specs, dev: elements.devDependencyCheckbox.checked },
    '安装 npm 包',
  );
}

async function uninstallPackage(packageName) {
  const confirmed = await confirmAction({
    title: `卸载 ${packageName}？`,
    message: `将在工作区执行 npm uninstall ${packageName}，相关类型提示会同步移除。`,
    confirmLabel: '卸载',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await performNpmOperation('uninstall', { names: [packageName] }, `卸载 ${packageName}`);
}

async function stopPackageOperation() {
  try {
    const stopped = await api.stopPackageOperation();
    if (stopped) {
      elements.npmStatusText.textContent = '正在停止 npm…';
    }
  } catch (error) {
    showToast(`停止 npm 失败：${error.message}`, 'error');
  }
}

function openPackagesDialog() {
  if (!elements.packagesDialog.open) {
    elements.packagesDialog.showModal();
  }
  void refreshPackageState();
}

function closePackagesDialog() {
  if (elements.packagesDialog.open) {
    elements.packagesDialog.close();
  }
}

function clampSplitRatio(ratio) {
  const rect = elements.splitView.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - elements.splitter.offsetWidth);
  const minimumRatio = Math.min(0.45, MIN_PANE_WIDTH / usableWidth);
  const maximumRatio = Math.max(0.55, 1 - minimumRatio);
  return Math.min(maximumRatio, Math.max(minimumRatio, ratio));
}

function applySplitRatio(inputRatio, { persist = false } = {}) {
  const ratio = clampSplitRatio(Number(inputRatio) || DEFAULT_SPLIT_RATIO);
  const rect = elements.splitView.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - elements.splitter.offsetWidth);
  state.splitRatio = ratio;
  elements.editorPane.style.flexBasis = `${Math.round(usableWidth * ratio)}px`;
  elements.splitter.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));

  if (persist) {
    storageSet('offlineJsLab.splitRatio', ratio);
  }
  state.editor?.layout();
}

function finishSplitterDrag(event) {
  if (!state.splitterDragging) {
    return;
  }
  state.splitterDragging = false;
  elements.splitter.classList.remove('is-dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  if (event && elements.splitter.hasPointerCapture?.(event.pointerId)) {
    elements.splitter.releasePointerCapture(event.pointerId);
  }
  applySplitRatio(state.splitRatio, { persist: true });
}

function setupSplitter() {
  const savedRatio = Number(storageGet('offlineJsLab.splitRatio', DEFAULT_SPLIT_RATIO));
  state.splitRatio = Number.isFinite(savedRatio) ? savedRatio : DEFAULT_SPLIT_RATIO;

  elements.splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    state.splitterDragging = true;
    elements.splitter.classList.add('is-dragging');
    elements.splitter.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });

  elements.splitter.addEventListener('pointermove', (event) => {
    if (!state.splitterDragging) {
      return;
    }
    const rect = elements.splitView.getBoundingClientRect();
    const usableWidth = Math.max(1, rect.width - elements.splitter.offsetWidth);
    applySplitRatio((event.clientX - rect.left) / usableWidth);
  });

  elements.splitter.addEventListener('pointerup', finishSplitterDrag);
  elements.splitter.addEventListener('pointercancel', finishSplitterDrag);
  elements.splitter.addEventListener('dblclick', () => {
    applySplitRatio(DEFAULT_SPLIT_RATIO, { persist: true });
  });
  elements.splitter.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      applySplitRatio(state.splitRatio + direction * 0.02, { persist: true });
      event.preventDefault();
    } else if (event.key === 'Home') {
      applySplitRatio(DEFAULT_SPLIT_RATIO, { persist: true });
      event.preventDefault();
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    applySplitRatio(state.splitRatio);
  });
  resizeObserver.observe(elements.splitView);
  window.requestAnimationFrame(() => applySplitRatio(state.splitRatio));
}

function handleRunExit(payload) {
  if (payload.runId === state.runId) {
    state.runId = null;
    state.autoStopRequested = false;
    applyRunExit(payload);
    syncControls();
    window.setTimeout(flushAutoRun, 0);
    return;
  }

  if (state.runStarting) {
    state.completedRuns.set(payload.runId, payload);
  }
}

function handleAppCommand(command) {
  if (command === 'new') void newFile();
  if (command === 'open') void openFile();
  if (command === 'save') void saveFile(false);
  if (command === 'save-as') void saveFile(true);
  if (command === 'run') void runCode({ trigger: 'manual' });
  if (command === 'stop') void stopRun();
}

function bindEvents() {
  elements.newButton.addEventListener('click', () => void newFile());
  elements.openButton.addEventListener('click', () => void openFile());
  elements.saveButton.addEventListener('click', () => void saveFile(false));
  elements.saveAsButton.addEventListener('click', () => void saveFile(true));
  elements.languageTypeScriptButton.addEventListener('click', () => setLanguage('typescript'));
  elements.languageJavaScriptButton.addEventListener('click', () => setLanguage('javascript'));
  elements.runModeManualButton.addEventListener('click', () => setRunMode('manual'));
  elements.runModeLiveButton.addEventListener('click', () => setRunMode('live'));
  elements.clearOutputOnRunCheckbox.addEventListener('change', () => {
    state.clearOutputOnRun = elements.clearOutputOnRunCheckbox.checked;
    storageSet('offlineJsLab.clearOutputOnRun', state.clearOutputOnRun);
  });
  elements.runButton.addEventListener('click', () => void runCode({ trigger: 'manual' }));
  elements.stopButton.addEventListener('click', () => void stopRun());
  elements.clearOutputButton.addEventListener('click', clearOutput);
  elements.packagesButton.addEventListener('click', openPackagesDialog);
  elements.closeDialogButton.addEventListener('click', closePackagesDialog);
  elements.dialogDoneButton.addEventListener('click', closePackagesDialog);
  elements.chooseWorkspaceButton.addEventListener('click', () => void chooseWorkspace());
  elements.openWorkspaceButton.addEventListener('click', () => void openWorkspace());
  elements.installPackagesButton.addEventListener('click', () => void installPackages());
  elements.syncPackagesButton.addEventListener('click', () => {
    void performNpmOperation('sync', {}, '同步 npm 依赖');
  });
  elements.stopPackageButton.addEventListener('click', () => void stopPackageOperation());
  elements.refreshPackagesButton.addEventListener('click', () => void refreshPackageState());
  elements.packageInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void installPackages();
    }
  });

  api.onRunOutput(({ text, stream }) => appendOutput(text, stream));
  api.onRunExit(handleRunExit);
  api.onPackageOutput(({ text, stream }) => {
    appendOutput(text, stream === 'stderr' ? 'stderr' : stream === 'system' ? 'package' : 'package');
  });
  api.onAppCommand(handleAppCommand);

  window.addEventListener('beforeunload', persistScratch);
}

async function initialize() {
  bindEvents();
  setupSplitter();

  try {
    const bootstrap = await api.getBootstrap();
    document.body.classList.toggle('platform-darwin', bootstrap.platform === 'darwin');
    elements.versionText.textContent = `v${bootstrap.appVersion}`;
    const isMac = bootstrap.platform === 'darwin';
    const runShortcutText = isMac ? '⌘↵' : 'Ctrl+Enter';
    elements.runShortcut.textContent = runShortcutText;
    elements.stopShortcut.textContent = isMac ? '⌘.' : 'Ctrl+.';
    const placeholder = elements.output.querySelector('.output-placeholder');
    if (placeholder) {
      placeholder.textContent = `按 ${runShortcutText} 运行当前脚本，输出会显示在这里。`;
    }
    elements.runtimeText.textContent = bootstrap.nodeVersion
      ? `Node ${bootstrap.nodeVersion}`
      : 'Node';
    elements.runtimeText.title = `${bootstrap.nodeRuntime.command}（${bootstrap.nodeRuntime.source}）`;
    renderPackageState(bootstrap.packages);

    state.monaco = await loadMonaco(bootstrap.monacoBaseUrl);
    configureMonaco(state.monaco);
    createEditor(state.monaco);
    await refreshTypeDefinitions();
    setRunStatus('空闲', 'idle');
    state.editor.focus();
  } catch (error) {
    setEditorMessage('初始化失败');
    setRunStatus('初始化失败', 'error');
    appendOutput(`初始化失败：${error.stack || error.message}\n`, 'stderr');
    showToast('应用初始化失败，请查看输出区域', 'error');
  }
}

void initialize();
