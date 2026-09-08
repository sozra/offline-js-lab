# Offline JS Lab v0.2.1

一个面向个人开发与调试的本地 JavaScript / TypeScript Scratchpad。当前版本重点服务于以下工作流：

- 在个人 MacBook 上开发，通过 `npm start` 直接使用；
- 在公司 Windows 环境中通过内网 npm 仓库安装依赖；
- 不要求登录账号；
- 代码与输出左右分栏，比例可拖动；
- 支持手动运行和随代码变化实时运行；
- 可设置手动/实时运行前是否自动清空输出；
- 通过标准 `npm install` 安装 Lodash、Day.js 等包；
- 暂不要求构建 DMG、EXE 或安装包。

## v0.2.1 的主要变化

相对于 v0.2.0：

1. 输出区增加“运行前清空”开关，统一控制手动和实时运行。
2. 开关默认开启，并保存在本地；关闭后每次运行会在现有输出后追加。
3. 增加根目录 `AGENTS.md`，记录架构、运行状态机、安全边界、持久化键、测试和后续迭代约定。

## v0.2.0 的主要变化

相对于 v0.1.0：

1. 主界面改为类似 VS Code Split Editor 的左右双栏：左侧代码，右侧输出。
2. 中间分隔条可拖动，双击恢复 50:50，比例会本地保存。
3. 增加“手动 / 实时”运行模式。实时模式使用 500 ms 防抖。
4. 实时模式发现旧脚本仍在运行时，会先停止旧进程，再运行最新代码。
5. 完全移除运行超时选项和超时终止逻辑。
6. 执行器由 Electron Utility Process 改为当前环境中的系统 Node.js 子进程。
7. 内置离线包与 `.tgz` 导入侧栏被移除。
8. 包管理改为调用标准 npm CLI，并收进“包与工作区”弹窗。
9. 增加 macOS 原生应用菜单和 `Cmd` 快捷键显示。
10. 保留 Monaco Editor、TypeScript 转译、顶层 `await`、ESM/CommonJS 兼容和类型定义加载。

## 环境要求

建议：

```text
Node.js 22+
npm 10+
macOS 或 Windows
```

项目本身没有账号或联网登录流程。是否能获取 Electron、Monaco、esbuild 等开发依赖，取决于当前 npm Registry 是否包含这些包及相关二进制资源。

## 在 macOS 上开发和运行

解压源码后，在终端进入项目目录：

```bash
npm install
npm run check
npm test
npm start
```

`npm start` 会启动 Electron 开发版本，不需要先构建 DMG。

Apple Silicon 与 Intel Mac 都可以进行源码开发；`npm install` 会按当前机器架构安装 Electron 和 esbuild 对应资源。

macOS 下常用快捷键：

```text
Cmd + Enter        运行
Cmd + S            保存
Cmd + O            打开
Cmd + N            新建
Cmd + Shift + S    另存为
Cmd + .            停止运行（应用菜单）
```

Monaco 编辑器内部同时使用 `CtrlCmd`，所以 Windows 下会自动对应 `Ctrl`。

## Windows 内网 npm 仓库

新版不再自己解压 npm tarball，而是直接在工作区执行标准 npm 命令，例如：

```bash
npm install lodash dayjs --save --no-audit --no-fund
npm install @types/lodash --save-dev --no-audit --no-fund
```

应用启动时会优先复用 `npm start` 提供的：

```text
npm_node_execpath
npm_execpath
```

若不存在，则从系统 `PATH` 查找：

```text
macOS/Linux: node、npm
Windows:     node.exe、npm.cmd
```

因此，公司电脑只要现有 Node/npm 环境能够正常访问内网仓库，应用中的“npm install”通常不需要单独配置。

npm 会继续读取正常的配置来源，包括：

```text
工作区/.npmrc
用户目录/.npmrc
全局 npmrc
环境变量
```

可以在终端确认当前仓库：

```bash
npm config get registry
```

如果公司要求项目级配置，可以点击“包与工作区 → 打开文件夹”，在工作区根目录创建 `.npmrc`：

```ini
registry=http://your-internal-npm-registry/
```

认证信息仍由公司现有 npm 配置负责，本项目不保存 Registry 密码或 Token。

## 工作区

首次运行默认创建：

```text
macOS:   ~/Documents/OfflineJsLabWorkspace
Windows: %USERPROFILE%\Documents\OfflineJsLabWorkspace
```

目录结构：

```text
OfflineJsLabWorkspace/
├─ package.json
├─ package-lock.json       # npm install 后生成
├─ node_modules/
└─ .offline-js-lab/
   └─ runs/                # 临时编译文件，运行结束后清理
```

可以在“包与工作区”弹窗中更换目录。工作区负责保存 npm 依赖；编辑器中的未保存草稿和界面比例保存在 Electron Renderer 的本地存储中。

## 安装 Lodash 和 Day.js

打开顶部的“包与工作区”，输入：

```text
lodash dayjs
```

点击 `npm install`。

如需 Lodash 的 TypeScript 类型提示，再输入：

```text
@types/lodash
```

勾选“保存为 devDependency”后安装。

也可以直接进入工作区通过终端安装：

```bash
cd ~/Documents/OfflineJsLabWorkspace
npm install lodash dayjs
npm install -D @types/lodash
```

安装完成后点击弹窗里的“刷新”，或重新打开应用。

TypeScript 示例：

```ts
import _ from 'lodash';
import dayjs from 'dayjs';

const rows = [
  { projectName: 'A', value: 1 },
  { projectName: 'A', value: 2 },
  { projectName: 'B', value: 3 },
];

console.log(_.groupBy(rows, 'projectName'));
console.log(dayjs('20260908').format('YYYY-MM-DD'));
```

CommonJS 也可使用：

```js
const _ = require('lodash');
const dayjs = require('dayjs');

console.log(_.uniq([1, 1, 2, 3]));
console.log(dayjs().format('YYYY-MM-DD HH:mm:ss'));
```

Day.js 插件子路径同样可解析：

```ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
console.log(dayjs.utc().format());
```

## 手动运行与实时运行

### 输出清理设置

输出区标题栏提供“运行前清空”复选框：

- 默认开启；
- 开启时，手动和实时运行都会在开始前清空旧输出；
- 关闭时，两种运行模式都会追加输出，并以运行时间分隔；
- 设置会保存在本地，重新启动应用后继续生效；
- 右侧“清空”按钮仍可随时手动清空，不会改变该设置。

### 手动模式

代码只在点击“运行”或按下 `Cmd/Ctrl + Enter` 时执行。是否保留之前的结果由“运行前清空”设置决定。

### 实时模式

编辑停止约 500 ms 后自动运行：

- 每次运行前是否清空旧输出由“运行前清空”设置决定；
- 快速连续输入只触发最后一次；
- 若旧代码仍在运行，会先终止旧 Node 进程；
- 编译错误直接显示在右侧；
- npm 安装期间暂停自动运行，安装完成后重新执行。

实时运行同样遵循“运行前清空”设置；关闭后不会强制清空旧结果。

对于会长期保持事件循环的代码，例如：

```js
setInterval(() => console.log(Date.now()), 1000);
```

应用不会再强制超时。可以点击“停止”；实时模式下修改代码也会停止旧进程并启动新进程。

## 原超时问题的修复

v0.1.0 依赖 Electron Utility Process 自然退出，并在主进程设置超时计时器。收到 stdout 只代表脚本已经产生输出，并不代表执行进程已经结束；原计时器只有在 Utility Process 发出退出事件后才会清除。在你遇到的场景中，退出事件没有在计时器触发前到达，因此出现了“已经打印成功，稍后仍显示已超时”。

v0.2.0 改为使用当前系统 Node.js 执行编译后的 `.mjs`：

```text
Monaco
  ↓
esbuild 编译/打包
  ↓
工作区临时 .mjs
  ↓
系统 Node.js 子进程
  ↓
stdout / stderr
```

普通脚本在 Node 事件循环清空后自然退出；带定时器、服务监听或其他活动句柄的脚本会继续运行，直到代码自行结束或用户停止。

## 双栏布局

- 拖动中间分隔条调整代码区与输出区比例；
- 双击分隔条恢复 50:50；
- 键盘聚焦分隔条后可用左右方向键微调；
- 调整结果自动保存在本地；
- Monaco 会在尺寸变化后重新布局。

## npm 包管理弹窗

弹窗支持：

- 查看和切换工作区；
- 打开工作区文件夹；
- `npm install <package...>`；
- 安装为 dependency 或 devDependency；
- 执行无参数 `npm install`，同步 package.json；
- 查看直接依赖；
- `npm uninstall <package>`；
- 停止正在执行的 npm 命令；
- 安装后重新读取 `.d.ts` 类型定义。

npm stdout/stderr 会显示在主界面的右侧输出区。

## 源码检查和测试

```bash
npm run check
npm test
```

测试覆盖：

- 工作区初始化与 package.json；
- `.d.ts` 类型文件发现；
- macOS/Windows Node/npm 命令解析；
- npm 参数生成和输出转发；
- 普通脚本打印后自然退出；
- 长驻脚本无超时并可手动停止；
- 编译错误不启动执行进程。
- 手动和实时运行共用可持久化的输出清理设置。

## 面向 AI agents 的维护说明

根目录的 [`AGENTS.md`](./AGENTS.md) 记录了：

- 项目架构与各文件职责；
- 脚本执行和实时运行状态机；
- Renderer 持久化键；
- IPC 与安全边界；
- npm/工作区设计；
- 编码约定、测试策略和人工冒烟清单。

后续让 AI coding agent 增加功能时，应先让其阅读该文件，并在架构或行为变化后同步更新。

## 未来需要打包时

当前阶段不需要打包。后续可在 Mac 上运行：

```bash
npm run dist:mac
```

在 Windows 上运行：

```powershell
npm run dist:win
```

构建脚本已保留，但 v0.2.1 的首要目标是源码开发与 `npm start` 使用。

## 安全边界

用户代码运行在独立 Node.js 子进程中，不会直接运行在 Electron Renderer 或主进程里；但它不是安全沙箱。

运行的代码和安装的 npm 包拥有当前用户权限，能够：

- 读取或修改当前用户可访问的文件；
- 发起网络请求；
- 启动其他进程；
- 执行 npm 生命周期脚本。

当前定位是个人开发工具，应只安装和运行自己信任的包与代码。

## 尚未包含

- 多标签页；
- 断点调试；
- 变量内联展示；
- 项目文件树；
- 多文件工程编辑；
- npm Registry 图形化配置；
- 恶意代码沙箱；
- 正式代码签名和自动更新。
