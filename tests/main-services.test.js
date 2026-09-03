const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPrivateAddress,
  recordingExtension,
  normalizeWindowRows,
  todoReminderState,
  todoReminderTimerDelay,
  taskNotificationIdentity,
  taskWindowMatchScore,
  parseSmartMaterialMetadata,
  clipboardServicePolicy,
  createClipboardImageFingerprint,
  installLocalWebContentsGuards,
  runOwnedOpenDialog,
  readClipboardObservation,
  screenRecordingProbePolicy,
  taskNotificationWindowPolicy,
  companionPresentation,
  prepareClipboardImagePayload,
  updateFeaturePreference,
  normalizeAgentEvent,
  mergeAgentEvent,
  listAgentRuns,
  pruneAgentRuns,
  mergeLegacyWorkspaceStorage,
  selectTranscriptionSettings,
  createWorkspacePersistenceGate,
  hoverSpacePollingPolicy,
  reduceClipboardObservation,
} = require('../main-services');

test('portable workspace persistence skips unchanged snapshots regardless of key order', () => {
  const gate = createWorkspacePersistenceGate();
  assert.equal(gate.shouldWrite({ todo: 'one', notes: 'two' }), true);
  assert.equal(gate.shouldWrite({ notes: 'two', todo: 'one' }), true, '写入确认前必须允许重试');
  gate.markWritten({ todo: 'one', notes: 'two' });
  assert.equal(gate.shouldWrite({ notes: 'two', todo: 'one' }), false);
  assert.equal(gate.shouldWrite({ notes: 'updated', todo: 'one' }), true);
  gate.markWritten({ notes: 'updated', todo: 'one' });
  assert.equal(gate.shouldWrite({ notes: 'updated', todo: 'one' }), false);
  assert.equal(gate.shouldWrite({ notes: 'updated', todo: 'one' }, '/another/workspace'), true);
});

test('Hover + Space polls only while the collapsed strip is visible', () => {
  assert.deepEqual(hoverSpacePollingPolicy({ shortcut: 'Space', visible: true, mode: 'collapsed' }), {
    enabled: true,
    intervalMs: 60,
  });
  assert.equal(hoverSpacePollingPolicy({ shortcut: 'Space', visible: true, mode: 'expanded' }).enabled, false);
  assert.equal(hoverSpacePollingPolicy({ shortcut: 'Space', visible: false, mode: 'collapsed' }).enabled, false);
  assert.equal(hoverSpacePollingPolicy({ shortcut: 'Command+Shift+P', visible: true, mode: 'collapsed' }).enabled, false);
});

test('desktop companion follows the agreed visibility and state priority', () => {
  const base = { enabled: true, mainVisible: true, mode: 'collapsed' };
  assert.deepEqual(companionPresentation(base), { visible: true, state: 'rest' });
  assert.deepEqual(companionPresentation({ ...base, focusActive: true }), { visible: true, state: 'focus' });
  assert.deepEqual(companionPresentation({ ...base, focusActive: true, waitingActive: true }), {
    visible: true,
    state: 'attention',
  });
  assert.deepEqual(companionPresentation({ ...base, focusActive: true, override: 'celebrate' }), {
    visible: true,
    state: 'celebrate',
  });
  assert.deepEqual(companionPresentation({ ...base, override: 'peek' }), {
    visible: true,
    state: 'peek',
  });
  assert.deepEqual(companionPresentation({ ...base, override: 'zipline' }), { visible: true, state: 'rest' });
  assert.equal(companionPresentation({ ...base, notificationActive: true }).visible, false);
  assert.equal(companionPresentation({ ...base, mode: 'expanded' }).visible, false);
  assert.equal(companionPresentation({ ...base, systemPaused: true }).visible, false);
  assert.equal(companionPresentation({ ...base, enabled: false }).visible, false);
});

test('isPrivateAddress blocks loopback, private, link-local and unique-local ranges', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.16.2.3', '192.168.1.9', '169.254.1.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('smart material metadata is normalized safely', () => {
  assert.deepEqual(parseSmartMaterialMetadata('```json\n{"title":" 周会决策与行动项 ","category":"会议"}\n```'), {
    title: '周会决策与行动项',
    category: '会议',
  });
});

test('transcription settings fall back to the legacy app directory only when current settings are absent', () => {
  const legacy = { encryptedApiKey: 'legacy-asr', encryptedLlmApiKey: 'legacy-llm' };
  assert.deepEqual(selectTranscriptionSettings({}, legacy), legacy);
  assert.deepEqual(selectTranscriptionSettings({ region: 'beijing' }, legacy), { region: 'beijing' });
  assert.deepEqual(selectTranscriptionSettings(null, null), {});
});

test('recordingExtension only returns known audio file extensions', () => {
  assert.equal(recordingExtension('audio/webm;codecs=opus'), 'webm');
  assert.equal(recordingExtension('audio/mp4'), 'm4a');
  assert.equal(recordingExtension('audio/ogg'), 'ogg');
  assert.equal(recordingExtension('application/octet-stream'), 'webm');
});

test('normalizeWindowRows preserves separate windows and filters empty titles', () => {
  const rows = normalizeWindowRows([
    { pid: 10, appName: 'Code', title: 'alpha — Visual Studio Code', windowIndex: 0, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: 'beta — Visual Studio Code', windowIndex: 1 },
    { pid: 11, appName: 'Finder', title: '', windowIndex: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].appPath, '/Applications/Visual Studio Code.app');
  assert.equal(rows[1].title, 'beta — Visual Studio Code');
});

test('normalizeWindowRows collapses same-process duplicates of one window title', () => {
  // 实测：微信只开了一个窗口，CGWindowList 却返回两条同名记录（窗口号 53696 与 85），
  // 界面上就成了两个「微信」。聚焦按标题匹配，重复条目指向同一个窗口，必须只留最前那条。
  const rows = normalizeWindowRows([
    { pid: 650, appName: '微信', title: '微信', windowNumber: 53696, appPath: '/Applications/微信.app' },
    { pid: 650, appName: '微信', title: '微信', windowNumber: 85, appPath: '/Applications/微信.app' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'window-650-53696');

  // 同应用的不同窗口（标题不同）必须全部保留，多工作区的 VS Code 不能被误删。
  const editors = normalizeWindowRows([
    { pid: 26497, appName: 'Code', title: '灵动岛', windowNumber: 1, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 26497, appName: 'Code', title: 'Vlog制作工坊', windowNumber: 2, appPath: '/Applications/Visual Studio Code.app' },
  ]);
  assert.equal(editors.length, 2);

  // 同名窗口分属不同进程时是两个真实应用，不能合并。
  const distinct = normalizeWindowRows([
    { pid: 1, appName: '备忘录', title: '备忘录', windowNumber: 10 },
    { pid: 2, appName: '备忘录', title: '备忘录', windowNumber: 11 },
  ]);
  assert.equal(distinct.length, 2);
});

test('normalizeWindowRows keeps all named CGWindow entries with stable window ids', () => {
  const rows = normalizeWindowRows([
    { pid: 10, appName: 'Code', title: '灵动岛', windowNumber: 501, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: 'Lollipop-Test', windowNumber: 502, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: 'AI PM 备课坊', windowNumber: 503, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: '', windowNumber: 504, appPath: '/Applications/Visual Studio Code.app' },
  ]);
  assert.deepEqual(rows.map((row) => row.id), [
    'window-10-501',
    'window-10-502',
    'window-10-503',
  ]);
});

test('todoReminderState fires once within the final hour and expires after the DDL', () => {
  const deadline = Date.parse('2026-08-22T10:00:00.000Z');
  const todo = { id: 't1', text: '发布新版', deadline: new Date(deadline).toISOString(), done: false, remindedAt: 0 };
  assert.deepEqual(todoReminderState(todo, deadline - 2 * 60 * 60 * 1000), {
    state: 'scheduled',
    delayMs: 60 * 60 * 1000,
  });
  assert.deepEqual(todoReminderState(todo, deadline - 30 * 60 * 1000), {
    state: 'due',
    delayMs: 0,
  });
  assert.equal(todoReminderState({ ...todo, remindedAt: deadline - 60 * 60 * 1000 }, deadline - 30 * 60 * 1000).state, 'notified');
  assert.equal(todoReminderState(todo, deadline + 1).state, 'expired');
});

test('todo reminder timers checkpoint far-future deadlines without overflowing Node timers', () => {
  const maximumNodeTimerDelay = (2 ** 31) - 1;
  assert.equal(todoReminderTimerDelay(0), 250);
  assert.equal(todoReminderTimerDelay(60 * 60 * 1000), 60 * 60 * 1000);
  assert.equal(todoReminderTimerDelay(maximumNodeTimerDelay + 1), maximumNodeTimerDelay);
  assert.equal(todoReminderTimerDelay(2672140134), maximumNodeTimerDelay);
});

test('task notification identifies the repository and concrete finished work', () => {
  assert.deepEqual(taskNotificationIdentity({
    title: '新的任务已经完成',
    cwd: '/workspace/orbit-notes',
    'last-assistant-message': '已完成 VS Code 工作区名称识别，并修复拖拽残留。\n测试已通过。',
  }, 'codex'), {
    project: 'orbit-notes',
    title: '已完成 VS Code 工作区名称识别，并修复拖拽残留。',
  });
  assert.deepEqual(taskNotificationIdentity({
    project: 'CourseKit',
    task_title: '生成课程大纲',
  }, 'gpt'), {
    project: 'CourseKit',
    title: '生成课程大纲',
  });
  assert.deepEqual(taskNotificationIdentity({
    cwd: '/workspace/orbit-notes',
    last_assistant_message: '## 已接好 Claude Code 的 Stop 钩子\n测试全部通过。',
  }, 'claude'), {
    project: 'orbit-notes',
    title: '已接好 Claude Code 的 Stop 钩子',
  });
  // 记录文件还没落盘时标题为空，各来源要退回自己的兜底文案。
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'claude').title, 'Claude 已完成任务');
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'codex').title, 'Codex 已完成任务');
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'workbuddy').title, 'WorkBuddy 已完成任务');
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'gemini').title, 'Gemini 已完成任务');
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'todo').title, '任务已完成');
});

test('Agent window matching uses only source-specific app fallbacks', () => {
  const run = { source: 'codex', project: 'Orbit Notes' };
  assert.equal(taskWindowMatchScore(run, {
    appName: 'Visual Studio Code',
    title: 'Orbit Notes — main.js — Visual Studio Code',
  }), 90);
  assert.equal(taskWindowMatchScore(run, { appName: 'ChatGPT', title: 'ChatGPT' }), 10);
  assert.equal(taskWindowMatchScore(run, {
    appName: 'ChatGPT Computer Use',
    title: 'Enable ChatGPT with Messages Permissions',
  }), 0);
  assert.equal(taskWindowMatchScore({ source: 'workbuddy' }, {
    appName: 'CodeBuddy Code',
    title: 'CodeBuddy',
  }), 10);
  assert.equal(taskWindowMatchScore({ source: 'gemini' }, {
    appName: 'Gemini',
    title: 'Gemini',
  }), 10);
  assert.equal(taskWindowMatchScore({ source: 'gemini' }, {
    appName: 'Terminal',
    title: 'zsh',
  }), 0);
});

test('clipboard polling follows the feature switch and never reserves a global shortcut', () => {
  // 剪贴板默认关闭，关着就不能轮询系统剪贴板：原实现恒返回 recordHistory: true，
  // 于是主进程无论开关状态都在每 500ms 读一次粘贴板，粘贴板里有大图时空转吃掉三成 CPU。
  assert.deepEqual(clipboardServicePolicy({ clip: true }), {
    recordHistory: true,
    registerGlobalShortcut: false,
  });
  assert.deepEqual(clipboardServicePolicy({ clip: false }), {
    recordHistory: false,
    registerGlobalShortcut: false,
  });
  // 缺字段或传入非对象时一律按「关闭」处理，不能默默恢复轮询。
  assert.equal(clipboardServicePolicy({}).recordHistory, false);
  assert.equal(clipboardServicePolicy(undefined).recordHistory, false);
  assert.equal(clipboardServicePolicy(true).recordHistory, false);
  // 全局快捷键在任何情况下都不注册（原 Cmd+Shift+V 已撤销）。
  for (const input of [{ clip: true }, { clip: false }, {}, undefined]) {
    assert.equal(clipboardServicePolicy(input).registerGlobalShortcut, false);
  }
});

test('enabling clipboard history baselines existing text and image without recording either', () => {
  const result = reduceClipboardObservation(
    {},
    { text: '开启前已复制的文字', imageFingerprint: 'image-before-enable' },
    { baseline: true }
  );

  assert.deepEqual(result, {
    state: {
      textFingerprint: '开启前已复制的文字',
      imageFingerprint: 'image-before-enable',
    },
    record: null,
  });
});

test('text observations do not forget the last image fingerprint', () => {
  const firstImage = reduceClipboardObservation(
    {},
    { text: '', imageFingerprint: 'same-image' }
  );
  const text = reduceClipboardObservation(
    firstImage.state,
    { text: '中间的文字', imageFingerprint: null }
  );
  const repeatedImage = reduceClipboardObservation(
    text.state,
    { text: '', imageFingerprint: 'same-image' }
  );

  assert.equal(firstImage.record.type, 'image');
  assert.equal(text.record.type, 'text');
  assert.equal(text.state.imageFingerprint, 'same-image');
  assert.equal(repeatedImage.record, null);
});

test('clipboard image fingerprints distinguish different PNG bytes of the same size', () => {
  const first = createClipboardImageFingerprint(64, 64, Buffer.from([1, 2, 3, 4]));
  const second = createClipboardImageFingerprint(64, 64, Buffer.from([4, 3, 2, 1]));

  assert.notEqual(first, second);
  assert.equal(first, createClipboardImageFingerprint(64, 64, Buffer.from([1, 2, 3, 4])));
});

test('local Electron windows deny renderer navigation and child windows', () => {
  let windowOpenHandler = null;
  let navigationHandler = null;
  const webContents = {
    setWindowOpenHandler(handler) { windowOpenHandler = handler; },
    on(eventName, handler) {
      if (eventName === 'will-navigate') navigationHandler = handler;
    },
  };

  assert.equal(installLocalWebContentsGuards(webContents), true);
  assert.deepEqual(windowOpenHandler({ url: 'https://example.com' }), { action: 'deny' });
  let prevented = false;
  navigationHandler({ preventDefault() { prevented = true; } }, 'https://example.com');
  assert.equal(prevented, true);
});

test('native file pickers stay attached to the panel and always release the transient guard', async () => {
  const owner = { id: 'main-window' };
  const options = { properties: ['openFile'] };
  const guardDeltas = [];
  let receivedArgs = null;
  const result = await runOwnedOpenDialog(
    async (...args) => {
      receivedArgs = args;
      return { canceled: false, filePaths: ['/tmp/example.png'] };
    },
    owner,
    options,
    (delta) => guardDeltas.push(delta)
  );

  assert.deepEqual(receivedArgs, [owner, options]);
  assert.deepEqual(guardDeltas, [1, -1]);
  assert.equal(result.canceled, false);

  const failureDeltas = [];
  await assert.rejects(() => runOwnedOpenDialog(
    async () => { throw new Error('dialog failed'); },
    owner,
    options,
    (delta) => failureDeltas.push(delta)
  ));
  assert.deepEqual(failureDeltas, [1, -1]);
});

test('Electron 44 clipboard items preserve concealed content and lazily decode images', async () => {
  let imageReads = 0;
  const items = [{
    types: [
      'text/plain',
      'image/png',
      'electron application/osclipboard;format="org.nspasteboard.ConcealedType"',
    ],
    async getType(type) {
      if (type === 'image/png') imageReads += 1;
      if (type === 'text/plain') return new Blob(['secret']);
      return new Blob([Buffer.from([1, 2, 3])], { type });
    },
  }];

  assert.deepEqual(await readClipboardObservation(items, { includeImage: true }), {
    concealed: true,
    text: '',
    image: null,
  });
  assert.equal(imageReads, 0, '敏感剪贴板不得解码图片内容');
});

test('Electron 44 clipboard items decode text first and only read image bytes when requested', async () => {
  let imageReads = 0;
  const items = [{
    types: ['text/plain', 'image/png'],
    async getType(type) {
      if (type === 'text/plain') return new Blob(['hello']);
      imageReads += 1;
      return new Blob([Buffer.from([4, 5, 6])], { type: 'image/png' });
    },
  }];

  const textOnly = await readClipboardObservation(items, { includeImage: false });
  assert.deepEqual(textOnly, { concealed: false, text: 'hello', image: null });
  assert.equal(imageReads, 0);

  const withImage = await readClipboardObservation(items, { includeImage: true });
  assert.equal(withImage.text, 'hello');
  assert.equal(withImage.image.mimeType, 'image/png');
  assert.deepEqual(withImage.image.buffer, Buffer.from([4, 5, 6]));
  assert.equal(imageReads, 1);
});

test('screen-recording startup checks never touch capture APIs before user consent', () => {
  assert.deepEqual(screenRecordingProbePolicy('not-determined'), {
    hasAccess: false,
    inspectWindowTitles: false,
  });
  assert.deepEqual(screenRecordingProbePolicy('denied'), {
    hasAccess: false,
    inspectWindowTitles: false,
  });
  assert.deepEqual(screenRecordingProbePolicy('granted'), {
    hasAccess: true,
    inspectWindowTitles: true,
  });
  assert.deepEqual(screenRecordingProbePolicy('unknown'), {
    hasAccess: true,
    inspectWindowTitles: false,
  });
});

test('hidden task notification renderer is disposed after its queue drains', () => {
  assert.equal(taskNotificationWindowPolicy({ active: true, queueLength: 0 }), 'retain');
  assert.equal(taskNotificationWindowPolicy({ active: false, queueLength: 1 }), 'retain');
  assert.equal(taskNotificationWindowPolicy({ active: false, queueLength: 0 }), 'dispose');
});

test('unchanged PNG clipboard probes reuse source bytes without re-encoding', () => {
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const prepared = prepareClipboardImagePayload('image/png', png, { width: 4096, height: 4096 });

  assert.equal(prepared.pngBuffer, png);
  assert.equal(prepared.sourceBuffer, png);
  assert.match(prepared.fingerprint, /^4096x4096:[a-f0-9]{64}$/);

  const jpeg = Buffer.from([255, 216, 255, 1, 2, 3]);
  assert.equal(
    prepareClipboardImagePayload('image/jpeg', jpeg, { width: 100, height: 100 }).pngBuffer,
    null
  );
});

test('feature preferences only update configurable tabs and keep permanent tabs enabled', () => {
  assert.equal(typeof updateFeaturePreference, 'function', 'updateFeaturePreference must exist');
  assert.deepEqual(updateFeaturePreference({ todo: true, clip: false }, 'clip', true), {
    todo: true,
    clip: true,
    home: true,
  });
  assert.equal(updateFeaturePreference({ todo: true }, 'home', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'settings', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'links', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'credentials', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'unknown', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'todo', 'false'), null);
});

test('Agent event schema accepts four states and rejects unsafe identities', () => {
  const normalized = normalizeAgentEvent({
    version: 1,
    event: 'running',
    run_id: 'run-1',
    cwd: '/workspace/agent-dock',
    title: '整理首页',
    summary: 'a'.repeat(300),
    occurred_at: 1_700_000_000_000,
  }, 'claude', { now: 1_700_000_000_100 });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.event.project, 'agent-dock');
  assert.equal(Array.from(normalized.event.summary).length, 280);
  assert.equal(Object.hasOwn(normalized.event, 'cwd'), false);
  assert.equal(normalizeAgentEvent({ version: 1, event: 'running' }, 'claude').error, 'run_id_required');
  assert.equal(normalizeAgentEvent({ version: 2, event: 'completed' }, 'codex').error, 'unsupported_version');
  assert.equal(normalizeAgentEvent({ version: 1, event: 'running', run_id: 'wb-1' }, 'workbuddy').ok, true);
  assert.equal(normalizeAgentEvent({ version: 1, event: 'completed', run_id: 'gemini-1' }, 'gemini').ok, true);
  assert.equal(normalizeAgentEvent({ version: 1, event: 'completed' }, 'other').error, 'invalid_source');
});

test('Agent runs merge by source and run id while ignoring old and duplicate terminal events', () => {
  const running = normalizeAgentEvent({ version: 1, event: 'running', run_id: 'r1', title: '任务' }, 'claude', { now: 1000 }).event;
  const waiting = normalizeAgentEvent({ version: 1, event: 'waiting', run_id: 'r1', summary: '需要确认' }, 'claude', { now: 2000 }).event;
  const completed = normalizeAgentEvent({ version: 1, event: 'completed', run_id: 'r1', summary: '完成' }, 'claude', { now: 3000 }).event;
  const first = mergeAgentEvent([], running, 1000);
  const second = mergeAgentEvent(first.runs, waiting, 2000);
  assert.equal(second.run.state, 'waiting');
  assert.equal(mergeAgentEvent(second.runs, { ...running, occurredAt: 1500 }, 2000).status, 'out_of_order');
  const terminal = mergeAgentEvent(second.runs, completed, 3000);
  assert.equal(terminal.run.state, 'completed');
  assert.equal(mergeAgentEvent(terminal.runs, { ...completed, occurredAt: 4000 }, 4000).status, 'duplicate');
});

test('Agent run listing keeps active work and marks two-hour silence as stale', () => {
  const now = 10 * 60 * 60 * 1000;
  const rows = pruneAgentRuns([
    { source: 'codex', runId: 'active', state: 'running', updatedAt: now - 3 * 60 * 60 * 1000 },
    { source: 'gpt', runId: 'old', state: 'completed', updatedAt: now - 31 * 24 * 60 * 60 * 1000, completedAt: now - 31 * 24 * 60 * 60 * 1000 },
  ], now);
  assert.equal(rows.length, 1);
  assert.equal(listAgentRuns(rows, {}, now)[0].stale, true);
});

test('legacy import maps retired modules, merges ids, and excludes sensitive settings', () => {
  const legacy = {
    'notch-todo-data': JSON.stringify({ P0: [{ id: 'old', text: '旧任务' }], P1: [], P2: [], P3: [] }),
    'notch-home-order-v3': JSON.stringify(['music', 'pomodoro', 'windows', 'recorder', 'mirror', 'note', 'commands']),
    'notch-home-hidden-modules-v1': JSON.stringify(['mirror']),
    'notch-home-commands': JSON.stringify([{ id: 'legacy-command', text: '旧指令' }]),
    'notch-link-groups': JSON.stringify([{ id: 'legacy-links', name: '旧链接', links: [] }]),
    'credentials.vault.json': 'secret',
  };
  const first = mergeLegacyWorkspaceStorage({
    'notch-todo-data': JSON.stringify({ P0: [{ id: 'new', text: '新任务' }], P1: [], P2: [], P3: [] }),
  }, legacy);
  const todos = JSON.parse(first.storage['notch-todo-data']);
  assert.deepEqual(todos.P0.map((item) => item.id), ['new', 'old']);
  assert.deepEqual(JSON.parse(first.storage['notch-home-order-v3']), [
    'agent-status', 'pomodoro', 'attention-center', 'recorder', 'result-inbox', 'note',
  ]);
  assert.deepEqual(JSON.parse(first.storage['notch-home-hidden-modules-v1']), ['result-inbox']);
  assert.equal(first.storage['credentials.vault.json'], undefined);
  assert.equal(first.storage['notch-link-groups'], undefined);
  assert.equal(first.storage['notch-home-commands'], undefined);
  assert.deepEqual(mergeLegacyWorkspaceStorage(first.storage, legacy).storage, first.storage);
});
