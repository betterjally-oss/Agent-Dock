#!/usr/bin/env node
'use strict';

// WorkBuddy / Gemini CLI 生命周期 Hook：只转发状态和短摘要，不转发 Prompt、工具参数或完整对话。
// Hook 必须静默失败，不能阻塞 Agent 回合或用户审批。

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const NOTCH_HOST = '127.0.0.1';
const NOTCH_PORT = 43822;
const REQUEST_TIMEOUT_MS = 900;
const STDIN_TIMEOUT_MS = 1500;
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const SOURCES = new Set(['workbuddy', 'gemini']);

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
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

function parsePayload(raw) {
  try {
    const payload = JSON.parse(raw);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch (error) {
    return {};
  }
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function lastAssistantMessage(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath.trim()) return '';
  let handle;
  try {
    handle = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(handle).size;
    if (!size) return '';
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.allocUnsafe(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let entry;
      try { entry = JSON.parse(lines[index]); } catch (error) { continue; }
      if (!entry || entry.type !== 'assistant' || entry.isSidechain === true || entry.isMeta === true) continue;
      const text = textFromContent(entry.message?.content);
      if (text) return text;
    }
  } catch (error) {
    return '';
  } finally {
    try { if (handle !== undefined) fs.closeSync(handle); } catch (error) {}
  }
  return '';
}

function baseEvent(payload) {
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
  const timestamp = Date.parse(String(payload.timestamp || ''));
  return {
    version: 1,
    run_id: typeof payload.session_id === 'string' ? payload.session_id.trim() : '',
    project: cwd && path.isAbsolute(cwd) ? path.basename(path.normalize(cwd)) : '',
    cwd,
    occurred_at: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

function eventFromWorkBuddyHookPayload(payload, completedSummary = '') {
  const hook = String(payload.hook_event_name || '');
  const base = baseEvent(payload);
  if (!base.run_id) return null;
  const project = base.project;
  if (hook === 'UserPromptSubmit' || hook === 'PostToolUse') {
    return { ...base, event: 'running', title: project ? `${project} · WorkBuddy` : 'WorkBuddy 正在处理' };
  }
  if (hook === 'PermissionRequest'
    || (hook === 'Notification' && ['permission_prompt', 'idle_prompt', 'elicitation_dialog'].includes(String(payload.notification_type || '')))) {
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.trim() : '';
    return {
      ...base,
      event: 'waiting',
      title: project ? `${project} · 等待处理` : 'WorkBuddy 等待处理',
      summary: typeof payload.message === 'string' ? payload.message : toolName ? `等待批准 ${toolName}` : '等待你处理',
    };
  }
  if (hook === 'Stop') {
    return {
      ...base,
      event: 'completed',
      title: project ? `${project} · 已完成` : 'WorkBuddy 已完成任务',
      summary: completedSummary,
    };
  }
  if (hook === 'StopFailure') {
    return {
      ...base,
      event: 'failed',
      title: project ? `${project} · 运行失败` : 'WorkBuddy 运行失败',
      summary: typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string' ? payload.message : '回合异常结束，请返回原窗口查看。',
    };
  }
  return null;
}

function eventFromGeminiHookPayload(payload) {
  const hook = String(payload.hook_event_name || '');
  const base = baseEvent(payload);
  if (!base.run_id) return null;
  const project = base.project;
  if (hook === 'BeforeAgent' || hook === 'AfterTool') {
    return { ...base, event: 'running', title: project ? `${project} · Gemini` : 'Gemini 正在处理' };
  }
  if (hook === 'Notification' && payload.notification_type === 'ToolPermission') {
    return {
      ...base,
      event: 'waiting',
      title: project ? `${project} · 等待处理` : 'Gemini 等待处理',
      summary: typeof payload.message === 'string' ? payload.message : '等待你批准一项操作',
    };
  }
  if (hook === 'AfterAgent') {
    return {
      ...base,
      event: 'completed',
      title: project ? `${project} · 已完成` : 'Gemini 已完成任务',
      summary: typeof payload.prompt_response === 'string' ? payload.prompt_response : '',
    };
  }
  return null;
}

function post(source, payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    const request = http.request({
      hostname: NOTCH_HOST,
      port: NOTCH_PORT,
      path: `/events/${source}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
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

async function main(source = process.argv[2]) {
  if (!SOURCES.has(source)) return;
  const payload = parsePayload(await readStdin());
  if (payload.agent_id || payload.subagent_id) return;
  const summary = source === 'workbuddy' && payload.hook_event_name === 'Stop'
    ? lastAssistantMessage(payload.transcript_path)
    : '';
  const event = source === 'workbuddy'
    ? eventFromWorkBuddyHookPayload(payload, summary)
    : eventFromGeminiHookPayload(payload);
  if (event) await post(source, event);
}

if (require.main === module) main().then(() => process.exit(0), () => process.exit(0));

module.exports = { eventFromWorkBuddyHookPayload, eventFromGeminiHookPayload, lastAssistantMessage };
