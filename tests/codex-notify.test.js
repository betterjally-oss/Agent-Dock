const test = require('node:test');
const assert = require('node:assert/strict');

const { eventFromHookPayload, eventFromLegacyPayload } = require('../scripts/codex-notify');

test('Codex hooks map lifecycle states without forwarding prompts or tool inputs', () => {
  const base = { turn_id: 'turn-1', session_id: 'session-1', cwd: '/tmp/agent-dock' };
  const running = eventFromHookPayload({
    ...base,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'private prompt',
  });
  const waiting = eventFromHookPayload({
    ...base,
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'private command' },
  });
  const resumed = eventFromHookPayload({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_input: { command: 'private command' },
  });
  const completed = eventFromHookPayload({
    ...base,
    hook_event_name: 'Stop',
    last_assistant_message: '已完成修复',
  });

  assert.deepEqual([running.event, waiting.event, resumed.event, completed.event], [
    'running', 'waiting', 'running', 'completed',
  ]);
  assert.equal(JSON.stringify(running).includes('private prompt'), false);
  assert.equal(JSON.stringify(waiting).includes('private command'), false);
  assert.equal(waiting.summary, '等待批准 Bash');
  assert.equal(completed.summary, '已完成修复');
  assert.equal(completed.run_id, 'turn-1');
  assert.equal(eventFromHookPayload({ ...base, turn_id: '', hook_event_name: 'UserPromptSubmit' }), null);
});

test('legacy Codex notify payload keeps the same turn id for completion deduplication', () => {
  const event = eventFromLegacyPayload({
    'turn-id': 'turn-1',
    cwd: '/tmp/agent-dock',
    'last-assistant-message': '旧 notify 完成摘要',
  });
  assert.equal(event.event, 'completed');
  assert.equal(event.run_id, 'turn-1');
  assert.equal(event.summary, '旧 notify 完成摘要');
  assert.equal(eventFromLegacyPayload({ cwd: '/tmp/agent-dock' }), null);
});
