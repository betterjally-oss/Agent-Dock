const test = require('node:test');
const assert = require('node:assert/strict');

const { eventFromHookPayload } = require('../scripts/claude-notify');

test('Claude hooks map to four states without forwarding the user prompt', () => {
  const base = { session_id: 'session-1', cwd: '/tmp/agent-dock' };
  const running = eventFromHookPayload({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'private prompt' });
  const waiting = eventFromHookPayload({
    ...base,
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: '需要批准 Bash',
  });
  const completed = eventFromHookPayload({ ...base, hook_event_name: 'Stop' }, '已完成修复');
  const failed = eventFromHookPayload({ ...base, hook_event_name: 'StopFailure', error: 'API error' });

  assert.deepEqual([running.event, waiting.event, completed.event, failed.event], [
    'running', 'waiting', 'completed', 'failed',
  ]);
  assert.equal(JSON.stringify(running).includes('private prompt'), false);
  assert.equal(waiting.summary, '需要批准 Bash');
  assert.equal(completed.summary, '已完成修复');
  assert.equal(failed.summary, 'API error');
  assert.equal(eventFromHookPayload({ ...base, hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
});
