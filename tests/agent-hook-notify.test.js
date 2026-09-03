const test = require('node:test');
const assert = require('node:assert/strict');

const {
  eventFromWorkBuddyHookPayload,
  eventFromGeminiHookPayload,
} = require('../scripts/agent-hook-notify');

test('WorkBuddy hooks map four states without forwarding prompts or tool inputs', () => {
  const base = { session_id: 'wb-1', cwd: '/tmp/agent-dock' };
  const running = eventFromWorkBuddyHookPayload({
    ...base, hook_event_name: 'UserPromptSubmit', prompt: 'private prompt',
  });
  const waiting = eventFromWorkBuddyHookPayload({
    ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'private command' },
  });
  const resumed = eventFromWorkBuddyHookPayload({ ...base, hook_event_name: 'PostToolUse' });
  const completed = eventFromWorkBuddyHookPayload({ ...base, hook_event_name: 'Stop' }, '已完成修改');
  const failed = eventFromWorkBuddyHookPayload({ ...base, hook_event_name: 'StopFailure', error: 'API error' });

  assert.deepEqual([running.event, waiting.event, resumed.event, completed.event, failed.event], [
    'running', 'waiting', 'running', 'completed', 'failed',
  ]);
  assert.equal(JSON.stringify(running).includes('private prompt'), false);
  assert.equal(JSON.stringify(waiting).includes('private command'), false);
  assert.equal(waiting.summary, '等待批准 Bash');
  assert.equal(completed.summary, '已完成修改');
  assert.equal(eventFromWorkBuddyHookPayload({ ...base, session_id: '', hook_event_name: 'Stop' }), null);
});

test('Gemini hooks map only explicit running, waiting and completed states', () => {
  const base = { session_id: 'gemini-1', cwd: '/tmp/agent-dock', timestamp: '2026-09-01T10:00:00Z' };
  const running = eventFromGeminiHookPayload({
    ...base, hook_event_name: 'BeforeAgent', prompt: 'private prompt',
  });
  const waiting = eventFromGeminiHookPayload({
    ...base, hook_event_name: 'Notification', notification_type: 'ToolPermission', message: '需要批准', details: { command: 'private command' },
  });
  const resumed = eventFromGeminiHookPayload({ ...base, hook_event_name: 'AfterTool', tool_input: { command: 'private command' } });
  const completed = eventFromGeminiHookPayload({
    ...base, hook_event_name: 'AfterAgent', prompt: 'private prompt', prompt_response: '已完成修改',
  });

  assert.deepEqual([running.event, waiting.event, resumed.event, completed.event], [
    'running', 'waiting', 'running', 'completed',
  ]);
  assert.equal(JSON.stringify(running).includes('private prompt'), false);
  assert.equal(JSON.stringify(waiting).includes('private command'), false);
  assert.equal(completed.summary, '已完成修改');
  assert.equal(completed.occurred_at, Date.parse(base.timestamp));
  assert.equal(eventFromGeminiHookPayload({ ...base, hook_event_name: 'Notification', notification_type: 'Other' }), null);
});
