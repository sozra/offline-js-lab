# AGENTS.md

本文件适用于仓库根目录及全部子目录，供后续 AI coding agents 和维护者快速理解项目。修改架构、运行流程、持久化键或开发命令时，应同步更新本文件与 `README.md`。

## 1. 项目定位

Offline JS Lab 是一个使用 Electron 构建的本地 JavaScript / TypeScript Scratchpad，目标是提供接近 RunJS 的轻量体验：

- 左侧使用 Monaco Editor 编写 JS/TS；
- 右侧显示 stdout、stderr、编译信息和 npm 输出；
- 支持手动运行与 500 ms 防抖的实时运行；
- 支持通过标准 npm CLI 安装、卸载和同步工作区依赖；
- macOS 和 Windows 共用一套源码；
- 当前优先服务单人开发和 `npm start` 使用，不优先考虑发布、登录、云同步和自动更新。

主要使用场景：在个人 MacBook 上开发和调试，之后可在具备公司内网 npm Registry 的 Windows 环境中运行。

## 2. 当前非目标

除非用户明确要求，不要主动把项目扩展为以下形态：

- 完整 IDE、项目文件树或多文件工程编辑器；
- 云端执行、账号登录或同步服务；
- 不受信任代码的安全沙箱；
- 基于浏览器页面的远程服务；
- 自动更新、遥测或崩溃上报；
- 重新加入运行超时。

用户代码可访问当前操作系统用户有权限访问的资源。独立子进程只提供进程隔离，不等同于恶意代码沙箱。

## 3. 技术栈与运行要求

- Electron：桌面窗口、菜单、IPC、文件对话框；
- Monaco Editor：代码编辑、语法服务和类型提示；
- esbuild：把 JS/TS 打包为临时 `.mjs`；
- Node.js 子进程：执行编译后的代码；
- npm CLI：管理工作区依赖；
- Node.js 22+；
- Renderer 使用原生 HTML/CSS/JavaScript，不使用 React、Vue 或前端打包器；
- Electron 主进程、Preload 和后端模块使用 CommonJS (`.cjs`)。

## 4. 常用命令

```bash
npm install
npm run check
npm test
npm start
```

可选打包命令：

```bash
npm run dist:mac
npm run dist:win
npm run dist:nsis
npm run dist:portable
```

在提交或交付任何修改前，至少运行：

```bash
npm run check
npm test
```

`npm run check` 会验证必要文件并对 `.js`、`.cjs`、`.mjs` 执行 Node 语法检查。测试使用 Node 内置的 `node:test`，无需额外测试框架。

## 5. 目录与职责

```text
.
├─ electron/
│  ├─ main.cjs                 Electron 主进程、窗口、菜单和 IPC
│  ├─ preload.cjs              contextBridge 白名单 API
│  ├─ runner.cjs               子进程中的运行入口
│  └─ lib/
│     ├─ run-manager.cjs       编译、启动、停止、输出限制和清理
│     ├─ npm-manager.cjs       npm CLI 命令构造与进程管理
│     ├─ runtime.cjs           Node/npm 可执行环境解析
│     └─ workspace.cjs         工作区、package.json、类型定义扫描
├─ renderer/
│  ├─ index.html               页面结构与对话框
│  ├─ styles.css               全部界面样式
│  └─ app.js                   Renderer 状态、Monaco、运行和交互逻辑
├─ scripts/check-source.mjs    源码完整性与语法检查
├─ test/                       Node 内置测试
├─ README.md                   面向使用者的说明
└─ AGENTS.md                   面向维护者和 AI agents 的说明
```

不要编辑或提交以下生成目录：

```text
node_modules/
release/
```

运行时工作区也不属于本源码仓库。

## 6. 启动与 IPC 数据流

启动链路：

```text
Electron app ready
  → WorkspaceService.init()
  → 创建 NpmManager / RunManager
  → 注册受信任 IPC
  → 创建 BrowserWindow
  → Renderer 调用 bootstrap:get
  → 加载 Monaco
  → 恢复本地偏好和草稿
```

安全相关不变量：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- Renderer sandbox 保持启用；
- Renderer 只能访问 `preload.cjs` 暴露的白名单方法；
- 主进程必须校验 IPC sender 来自应用自身页面；
- 不允许外部导航、新窗口和 WebView；
- 不要为了方便把 Node API 直接暴露给 Renderer。

新增 IPC 时：

1. 在 `electron/main.cjs` 注册受信任 handler；
2. 在 `electron/preload.cjs` 暴露最小化、具名的 API；
3. Renderer 只调用 `window.offlineJsLab`；
4. 校验参数类型、长度和路径；
5. 为关键行为补测试。

## 7. 脚本执行流程

运行链路：

```text
Renderer runCode()
  → IPC run:start
  → RunManager 使用 esbuild bundle
  → 写入 工作区/.offline-js-lab/runs/<runId>.mjs
  → 使用当前系统 Node.js 启动 runner.cjs
  → runner.cjs 加载临时 .mjs
  → stdout/stderr 通过 IPC 流式返回
  → close 事件更新状态并删除临时文件
```

关键行为：

- 支持 TypeScript、JavaScript、ESM、CommonJS 和顶层 `await`；
- 包从工作区 `node_modules` 解析；
- 普通脚本在 Node 事件循环清空后自然退出；
- 带 `setInterval`、监听器等活动句柄的脚本会保持运行，直到用户停止；
- 当前没有时间超时；不要在未被明确要求时重新加入；
- 单次运行输出上限仍为 8 MB，防止无限打印拖垮界面；
- 结束、停止、编译失败和应用退出时都要清理临时文件与子进程。

`RunManager` 可能在 `run:start` IPC 返回前收到极快脚本的退出事件。Renderer 使用 `completedRuns` 处理这一竞态；修改运行生命周期时不要破坏该机制。

## 8. 手动运行、实时运行与输出清理

Renderer 中的运行模式：

- `manual`：仅按钮、快捷键或菜单命令触发；
- `live`：编辑停止约 500 ms 后触发；如果旧进程仍在运行，先停止旧进程，再执行最新代码。

实时运行的关键状态：

```text
runId
runStarting
pendingAutoRun
autoRunTimer
autoStopRequested
completedRuns
```

保持以下不变量：

- 同一时间最多有一个脚本进程；
- 快速连续编辑只执行最新代码；
- npm 操作期间暂停实时运行；
- 切回手动模式时取消待执行的自动运行；
- 旧进程的输出和退出事件不能错误覆盖新进程状态。

输出清理由单一设置 `state.clearOutputOnRun` 控制：

- 开启时，手动和实时运行都在添加本次运行分隔行之前清空输出；
- 关闭时，两种模式都追加到现有输出；
- “清空”按钮始终可手动清空，不改变该设置；
- 默认开启；
- 持久化键为 `offlineJsLab.clearOutputOnRun`。

不要重新写成“手动追加、实时清空”的硬编码分支。

## 9. Renderer 持久化状态

Renderer 使用 `localStorage` 保存个人偏好和草稿：

| Key | 说明 | 默认值 |
|---|---|---|
| `offlineJsLab.code` | 未保存草稿 | 内置示例 |
| `offlineJsLab.language` | `typescript` / `javascript` | `typescript` |
| `offlineJsLab.runMode` | `manual` / `live` | `manual` |
| `offlineJsLab.clearOutputOnRun` | 每次运行前是否清空 | `true` |
| `offlineJsLab.splitRatio` | 左右分栏比例 | `0.5` |

新增持久化设置时：

- 提供安全默认值；
- 对旧版本缺失或异常值做容错；
- UI、`state` 和存储必须保持一致；
- 在 `AGENTS.md` 和必要的 README 章节中登记键名。

工作区路径不存于 Renderer，而存于 Electron `userData/settings.json`，由 `WorkspaceService` 管理。

## 10. 工作区与 npm

默认工作区：

```text
macOS:   ~/Documents/OfflineJsLabWorkspace
Windows: %USERPROFILE%\Documents\OfflineJsLabWorkspace
```

工作区结构：

```text
OfflineJsLabWorkspace/
├─ package.json
├─ package-lock.json
├─ node_modules/
└─ .offline-js-lab/
   └─ runs/
```

应用直接调用当前环境的 Node/npm，并沿用项目、用户、全局 `.npmrc`。这使公司内网 Registry 能按标准 npm 配置工作。

npm 操作原则：

- 不在源码中硬编码 Registry、账号、Token 或证书；
- 不实现第二套自定义包格式；
- 安装参数保持 `--no-audit --no-fund`，避免无关公网请求和输出；
- npm 输出转发到右侧输出区；
- npm 完成后刷新直接依赖和 `.d.ts`；
- npm 运行期间避免同时启动脚本；
- 生命周期脚本由标准 npm 行为决定，当前个人工具不做额外沙箱。

## 11. Monaco 与类型定义

- Monaco 从 `node_modules/monaco-editor/min` 加载；
- 打包时复制到 `resources/monaco`；
- 同时兼容 Monaco 0.55+ 顶层 `monaco.typescript` 与旧命名空间；
- 编辑器使用自定义主题 `offline-js-lab-dark`（`renderer/app.js` 中的 `EDITOR_THEME`），基于 `vs-dark` 继承，仅覆盖背景、行号、光标、选区等颜色，与 `styles.css` 的表面色 token 保持一致；修改外壳配色时需同步该主题；
- `WorkspaceService.collectTypeDefinitions()` 扫描工作区包中的 `.d.ts`；
- Renderer 使用 `addExtraLib()` 注入 TypeScript/JavaScript language service；
- 当前有文件数与总字节限制，避免大型 `node_modules` 让编辑器失去响应。

改变 Monaco 版本或加载方式时，需要同时验证：

- 编辑器能显示；
- TS/JS 诊断可用；
- Lodash 类型提示可用；
- Worker CSP 和路径在 `npm start` 与打包后都正确。

## 12. UI 约定

- 主界面保持左右双栏，左侧代码、右侧输出；
- macOS 使用 `titleBarStyle: 'hiddenInset'`，顶栏整体为 `-webkit-app-region: drag`，交互控件需声明 `no-drag`，并通过 `body.platform-darwin` 为红绿灯按钮预留左侧 88px；Windows 保持系统默认标题栏；
- 分隔条可拖动、双击恢复 50:50，并支持键盘调整；
- 高频运行控制放在顶部或输出头部；
- 低频工作区和 npm 操作放在“包与工作区”对话框；
- UI 文案以简体中文为主，代码标识符使用英文；
- 保持深色、紧凑、桌面工具风格；
- 表面颜色使用 `styles.css` 顶部的 token（`--surface`、`--surface-inset`、`--surface-raised` 等），不在组件里散落一次性色值；正文字号不低于 11px，对话框与标签正文使用 12px；
- 不引入重量级 UI 框架来完成简单控件；
- 新控件必须有可访问的 label/title，并兼顾窄窗口布局。

## 13. 编码约定

- 使用严格模式；
- 优先使用小函数和明确状态，不增加隐式全局变量；
- 异步函数必须处理错误并向输出区或 toast 提供可理解信息；
- 文件和路径操作使用 Node `path`，兼容 macOS 与 Windows；
- 不拼接依赖于 `/` 的操作系统路径；
- 运行进程和 npm 进程必须可停止，并在窗口/应用退出时清理；
- 不吞掉会影响用户判断的错误；
- 不将 Renderer 输入直接插入 `innerHTML`，使用 `textContent`；
- 依赖升级必须核对 Electron、Node、Monaco 与 esbuild 的兼容性。

## 14. 测试策略

现有测试重点：

- 工作区初始化与 manifest；
- 类型定义发现；
- Node/npm runtime 解析；
- npm 参数、输出和停止；
- 编译、执行、自然退出、长驻进程停止和输出限制；
- Renderer 的关键结构和静态不变量。

纯逻辑优先提取为可单测模块。Renderer 暂未引入 DOM 测试框架，因此简单 UI 结构使用源码级断言；涉及复杂交互时，可考虑在不显著增加维护成本的前提下补充 Playwright Electron smoke test。

建议的人工冒烟检查：

1. `npm start` 后 Monaco 正常显示；
2. 运行 `console.log('hello')`，状态从编译中到运行中再到完成；
3. 开启“运行前清空”，连续手动运行后只保留最后一次；
4. 关闭该设置，手动和实时运行都追加结果；
5. 切换实时模式，快速输入只执行最新代码；
6. 运行 `setInterval` 后点击停止；
7. 安装 `lodash dayjs`，随后 import 并执行；
8. 拖动分隔条、重启应用，比例和设置仍保留；
9. 打开、保存和另存为脚本；
10. 关闭窗口/退出应用后确认无残留 Node/npm 子进程。

## 15. 修改交付清单

每次功能迭代建议按以下顺序完成：

1. 阅读 `README.md`、`AGENTS.md` 和相关实现；
2. 明确是否影响 Renderer、IPC、工作区或运行状态机；
3. 先保持现有安全边界和跨平台行为；
4. 实现最小必要改动；
5. 补充或更新测试；
6. 运行 `npm run check` 与 `npm test`；
7. 完成人工冒烟检查，无法执行的项目需在交付说明中明确；
8. 更新版本号、README 和本文件中受影响内容；
9. 不把 `node_modules`、`release`、用户工作区或密钥打入源码包。

## 16. 已知限制

- 单编辑器、单脚本、单运行进程；
- 没有断点调试和变量检查器；
- 没有终端仿真，npm 输出只是文本流；
- 没有多标签、历史记录或运行结果结构化展示；
- 大型依赖树的全部类型定义可能触发扫描上限；
- 运行代码不是安全沙箱；
- 当前版本主要通过 `npm start` 使用，打包流程保留但不是首要验证目标。
