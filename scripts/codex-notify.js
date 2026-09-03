#!/usr/bin/env node
'use strict';

// Codex 生命周期 Hook：把运行、等待与完成状态转发给 Agent Dock。
// 兼容旧 notify 参数模式，并继续转发 Codex Computer Use 的回合结束通知。
// 任何异常都静默结束，不能阻塞 Codex 回合或用户审批。

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const NOTCH_HOST = '127.0.0.1';
const NOTCH_PORT = 43822;
const REQUEST_TIMEOUT_MS = 900;
const STDIN_TIMEOUT_MS = 1500;
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const SKY_CLIENT = process.env.CODEX_COMPUTER_USE_CLIENT || path.join(
  CODEX_HOME,
  'computer-use',
  'Codex Computer Use.app',
  'Contents',
  'SharedSupport',
  'SkyComputerUseClient.app',
  'Contents',
  'MacOS',
  'SkyComputerUseClient'
);

function exitQuietly() {
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    timer.unref();
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

function parsePayload(rawPayload) {
  try {
    const payload = JSON.parse(rawPayload);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch (error) {
    return {};
  }
}

function eventFromHookPayload(payload) {
  const hook = String(payload.hook_event_name || '');
  const turnId = typeof payload.turn_id === 'string' ? payload.turn_id.trim() : '';
  if (!turnId) return null;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
  const project = cwd && path.isAbsolute(cwd) ? path.basename(path.normalize(cwd)) : '';
  const base = {
    version: 1,
    run_id: turnId,
    project,
    cwd,
    occurred_at: Date.now(),
  };
  if (hook === 'UserPromptSubmit') {
    return { ...base, event: 'running', title: project ? `${project} · Codex` : 'Codex 正在处理' };
  }
  if (hook === 'PermissionRequest') {
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.trim() : '';
    return {
      ...base,
      event: 'waiting',
      title: project ? `${project} · 等待处理` : 'Codex 等待处理',
      summary: toolName ? `等待批准 ${toolName}` : '等待你批准一项操作',
    };
  }
  if (hook === 'PostToolUse') {
    return { ...base, event: 'running', title: project ? `${project} · Codex` : 'Codex 继续运行' };
  }
  if (hook === 'Stop') {
    return {
      ...base,
      event: 'completed',
      title: project ? `${project} · 已完成` : 'Codex 已完成任务',
      summary: typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '',
    };
  }
  return null;
}

function eventFromLegacyPayload(payload) {
  const turnId = String(payload['turn-id'] || payload.turn_id || '').trim();
  if (!turnId) return null;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
  const project = cwd && path.isAbsolute(cwd) ? path.basename(path.normalize(cwd)) : '';
  return {
    version: 1,
    event: 'completed',
    run_id: turnId,
    project,
    title: project ? `${project} · 已完成` : 'Codex 已完成任务',
    summary: typeof payload['last-assistant-message'] === 'string'
      ? payload['last-assistant-message']
      : typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '',
    cwd,
    occurred_at: Date.now(),
  };
}

function post(pathname, payload) {
  return new Promise((resolve) => {
    let body;
    try {
      body = Buffer.from(JSON.stringify(payload));
    } catch (error) {
      resolve();
      return;
    }
    const request = http.request({
      hostname: NOTCH_HOST,
      port: NOTCH_PORT,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    }, (response) => {
      response.resume();
      response.on('end', resolve);
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy());
    request.on('error', resolve);
    request.on('close', resolve);
    request.end(body);
  });
}

function forwardComputerUse(rawPayload) {
  try {
    const child = spawn(SKY_CLIENT, ['turn-ended', rawPayload], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch (error) {}
}

async function main() {
  if (process.argv.length > 2) {
    const rawPayload = process.argv[process.argv.length - 1];
    forwardComputerUse(rawPayload);
    const payload = parsePayload(rawPayload);
    const event = eventFromLegacyPayload(payload);
    await post(event ? '/events/codex' : '/notify/codex', event || payload);
    return;
  }

  const payload = parsePayload(await readStdin());
  if (payload.agent_id) return;
  const event = eventFromHookPayload(payload);
  if (event) await post('/events/codex', event);
}

if (require.main === module) main().then(exitQuietly, exitQuietly);

module.exports = { eventFromHookPayload, eventFromLegacyPayload };
