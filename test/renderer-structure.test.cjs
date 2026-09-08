'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

test('Renderer 查询的全部元素 ID 都存在于 HTML 中', () => {
  const queriedIds = [...appSource.matchAll(/document\.querySelector\('#([^']+)'\)/g)]
    .map((match) => match[1]);
  const htmlIds = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
  );

  assert.ok(queriedIds.length > 20);
  for (const id of queriedIds) {
    assert.equal(htmlIds.has(id), true, `HTML 缺少 #${id}`);
  }
});

test('界面为左右分栏并且不再包含超时控件', () => {
  assert.match(html, /id="editor-pane"/);
  assert.match(html, /id="splitter"/);
  assert.match(html, /id="output-pane"/);
  assert.doesNotMatch(html, /timeout-select|超时/);
  assert.doesNotMatch(appSource, /timeoutMs|offlineJsLab\.timeout/);
});

test('手动和实时运行共用可持久化的运行前清空设置', () => {
  assert.match(html, /id="clear-output-on-run-checkbox"[^>]*checked/);
  assert.match(appSource, /clearOutputOnRun:\s*true/);
  assert.match(appSource, /offlineJsLab\.clearOutputOnRun/);
  assert.match(appSource, /if \(state\.clearOutputOnRun\) \{\s*clearOutput\(\);/);
  assert.doesNotMatch(appSource, /else \{\s*clearOutput\(\);\s*\}/);
});

test('兼容 Monaco 0.55+ 的顶层 TypeScript API', () => {
  assert.match(appSource, /monaco\.typescript \|\| monaco\.languages\?\.typescript/);
  assert.match(appSource, /state\.monaco\.typescript \|\| state\.monaco\.languages\?\.typescript/);
});

test('Monaco 使用与应用外壳一致的自定义深色主题', () => {
  assert.match(appSource, /defineTheme\(EDITOR_THEME/);
  assert.match(appSource, /theme: EDITOR_THEME/);
});

test('macOS 使用隐藏式标题栏并为红绿灯按钮预留顶栏空间', () => {
  assert.match(mainSource, /titleBarStyle: 'hiddenInset'/);
  assert.match(appSource, /platform-darwin/);
});
