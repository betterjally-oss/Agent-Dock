const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const isolatedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dock-harness-test-'));
const notificationPort = 45000 + (process.pid % 10000);
process.env.NODE_ENV = 'test';
process.env.AGENT_DOCK_TEST_USER_DATA = isolatedUserData;
process.env.AGENT_DOCK_TEST_PORT = String(notificationPort);
require('../main');

function request(method, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: notificationPort,
      path: pathname,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {},
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      }));
    });
    req.setTimeout(1000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function waitFor(read, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for value: ${String(value)}`);
}

async function main() {
  await app.whenReady();
  await waitFor(async () => {
    try { return (await request('GET', '/health')).body.ok; } catch (error) { return false; }
  });
  const mainWindow = await waitFor(() => BrowserWindow.getAllWindows().find(
    (window) => window.webContents.getURL().endsWith('/renderer/index.html')
  ));
  await waitFor(() => mainWindow.webContents.executeJavaScript("Boolean(document.getElementById('agent-status-title'))"));
  assert.equal(await waitFor(() => mainWindow.webContents.executeJavaScript(
    "document.getElementById('agent-status-title')?.textContent === '已就绪，等待 Agent'"
  )), true);
  assert.equal(await waitFor(() => mainWindow.webContents.executeJavaScript(
    "document.getElementById('attention-list')?.textContent.includes('一切正常，小猫正在替你看着')"
  )), true);
  assert.equal(await waitFor(() => mainWindow.webContents.executeJavaScript(
    "[...document.querySelectorAll('.settings-agent-source-row')].some((row) => row.textContent.includes('Codex') && row.textContent.includes('运行中') && row.textContent.includes('等你处理') && row.textContent.includes('已完成'))"
  )), true);
  assert.equal(await waitFor(() => mainWindow.webContents.executeJavaScript(
    "[...document.querySelectorAll('.settings-agent-source-row')].some((row) => row.textContent.includes('WorkBuddy') && row.textContent.includes('失败'))"
  )), true);
  assert.equal(await waitFor(() => mainWindow.webContents.executeJavaScript(
    "[...document.querySelectorAll('.settings-agent-source-row')].some((row) => row.textContent.includes('Gemini CLI') && row.textContent.includes('已完成') && !row.textContent.includes('失败'))"
  )), true);
  assert.deepEqual(await mainWindow.webContents.executeJavaScript(`
    Promise.all(['workbuddy', 'gemini'].map((source) => window.notchAPI.copyAgentSetup(source)))
      .then((items) => items.map((item) => item.target))
  `), ['~/.codebuddy/settings.json', '~/.gemini/settings.json']);

  for (const source of ['workbuddy', 'gemini']) {
    const result = await request('POST', `/events/${source}`, {
      version: 1,
      event: 'completed',
      run_id: `${source}-integration`,
      title: `${source} 接入完成`,
      occurred_at: Date.now(),
    });
    assert.equal(result.status, 202);
  }

  const startedAt = Date.now();
  const running = await request('POST', '/events/gpt', {
    version: 1,
    event: 'running',
    run_id: 'integration-run',
    project: 'Agent Dock',
    title: '集成测试',
    summary: '正在验证本机事件',
    cwd: '/private/path/must-not-persist',
    occurred_at: startedAt,
  });
  assert.equal(running.status, 202);
  await waitFor(() => mainWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('[data-run-id=\"gpt:integration-run\"]'))"
  ));
  assert.ok(Date.now() - startedAt < 1000, '运行事件应在 1 秒内显示');

  const waiting = await request('POST', '/events/gpt', {
    version: 1,
    event: 'waiting',
    run_id: 'integration-run',
    project: 'Agent Dock',
    title: '需要确认测试结果',
    summary: '等待用户处理',
    occurred_at: Date.now(),
  });
  assert.equal(waiting.status, 202);
  await waitFor(() => mainWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('.attention-row[data-kind=\"agent\"][data-reason=\"waiting\"]'))"
  ));

  const completed = await request('POST', '/events/gpt', {
    version: 1,
    event: 'completed',
    run_id: 'integration-run',
    project: 'Agent Dock',
    title: '集成测试完成',
    summary: '成果已写入本地收件箱',
    occurred_at: Date.now(),
  });
  assert.equal(completed.status, 202);
  await waitFor(() => mainWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('.agent-result-row[data-run-id=\"gpt:integration-run\"]'))"
  ));
  assert.equal(await mainWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('.attention-row[data-kind=\"agent\"]'))"
  ), false);

  mainWindow.webContents.reload();
  await waitFor(() => mainWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('.agent-result-row[data-run-id=\"gpt:integration-run\"]'))"
  ));
  const stored = fs.readFileSync(path.join(isolatedUserData, 'agent-runs.json'), 'utf8');
  assert.equal(stored.includes('/private/path/must-not-persist'), false);
  assert.equal(JSON.parse(stored).runs[0].state, 'completed');
}

main().then(
  () => app.quit(),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);

app.once('will-quit', () => fs.rmSync(isolatedUserData, { recursive: true, force: true }));
