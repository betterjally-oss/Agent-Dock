const net = require('net');
const path = require('path');
const crypto = require('crypto');

function isPrivateAddress(address) {
  const value = String(address || '').trim().toLowerCase().split('%', 1)[0];
  if (!value) return true;
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
  const version = net.isIP(value);
  if (version === 4) {
    const parts = value.split('.').map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] >= 224
    );
  }
  if (version === 6) {
    return (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/.test(value) ||
      value.startsWith('ff')
    );
  }
  return true;
}


function parseSmartMaterialMetadata(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(source); } catch (error) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const clean = (text, limit) => Array.from(String(text || '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, limit).join('');
  return { title: clean(parsed.title, 48), category: clean(parsed.category, 24) };
}

function selectTranscriptionSettings(current, legacy) {
  const currentSettings = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  if (Object.keys(currentSettings).length) return currentSettings;
  return legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {};
}

function recordingExtension(mimeType) {
  const mime = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'audio/mp4' || mime === 'audio/m4a' || mime === 'audio/x-m4a') return 'm4a';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  return 'webm';
}

function normalizeWindowRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, order) => {
      const pid = Math.max(0, Math.round(Number(row && row.pid) || 0));
      const windowIndex = Math.max(0, Math.round(Number(row && row.windowIndex) || 0));
      const windowNumber = Math.max(0, Math.round(Number(row && row.windowNumber) || 0));
      const appName = String(row && row.appName || '').trim();
      const title = String(row && row.title || '').replace(/\s+/g, ' ').trim();
      const candidatePath = String(row && row.appPath || '').trim();
      const appPath = path.isAbsolute(candidatePath) && candidatePath.endsWith('.app') ? candidatePath : '';
      if (!pid || !appName || !title) return null;
      return {
        id: windowNumber ? `window-${pid}-${windowNumber}` : `window-${pid}-${windowIndex}-${order}`,
        pid,
        windowIndex,
        windowNumber,
        appName,
        appPath,
        title: title.slice(0, 240),
      };
    })
    .filter(Boolean)
    // 同一进程下标题完全相同的窗口只保留最前面那条：CGWindowList 按前后顺序返回，
    // 首条就是最靠前的那个。实测微信只开一个窗口却会返回两条同名记录（窗口号不同），
    // 界面上就成了两个「微信」。而聚焦是按标题匹配的，重复条目永远指向同一个窗口，
    // 留着也点不出第二个结果。标题不同的多窗口（如 VS Code 各工作区）不受影响。
    .filter((item, index, list) => list.findIndex(
      (other) => other.pid === item.pid && other.title === item.title
    ) === index);
}

function taskWindowMatchScore(notification, target) {
  const source = String(notification && notification.source || '').trim().toLocaleLowerCase();
  const project = String(notification && notification.project || '').trim().toLocaleLowerCase();
  const title = String(target && target.title || '').trim().toLocaleLowerCase();
  const appName = String(target && target.appName || '').trim().toLocaleLowerCase();
  if (!title) return 0;
  if (project) {
    if (title === project) return 100;
    if (title.startsWith(`${project} `) || title.startsWith(`${project} —`) || title.startsWith(`${project} -`)) return 90;
    if (title.includes(project)) return 75;
    if (project.includes(appName) && appName) return 25;
  }
  if (source === 'codex' && /^(?:chatgpt|codex)$/.test(appName)) return 10;
  if (source === 'workbuddy' && /^(?:workbuddy|codebuddy|codebuddy code)$/.test(appName)) return 10;
  if (source === 'gemini' && appName === 'gemini') return 10;
  return 0;
}

function todoReminderState(todo, now = Date.now(), leadMs = 60 * 60 * 1000) {
  if (!todo || typeof todo !== 'object') return { state: 'invalid', delayMs: 0 };
  if (todo.done === true) return { state: 'done', delayMs: 0 };
  if (Number(todo.remindedAt) > 0) return { state: 'notified', delayMs: 0 };
  const deadline = Date.parse(String(todo.deadline || ''));
  const current = Number(now);
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) return { state: 'invalid', delayMs: 0 };
  if (current > deadline) return { state: 'expired', delayMs: 0 };
  const triggerAt = deadline - Math.max(0, Number(leadMs) || 0);
  if (current >= triggerAt) return { state: 'due', delayMs: 0 };
  return { state: 'scheduled', delayMs: triggerAt - current };
}

const MAX_NODE_TIMER_DELAY_MS = (2 ** 31) - 1;

function todoReminderTimerDelay(delayMs) {
  const normalizedDelay = Number(delayMs);
  if (!Number.isFinite(normalizedDelay)) return 250;
  // Larger delays are coerced to 1ms by Node. Wake at the longest safe delay
  // and let the reminder scheduler recalculate the remaining time.
  return Math.min(MAX_NODE_TIMER_DELAY_MS, Math.max(250, normalizedDelay));
}

function firstPayloadText(payload, keys) {
  for (const key of keys) {
    const value = payload && payload[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value);
    }
  }
  return '';
}

function cleanTaskLine(value, maxLength) {
  const line = String(value || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean) || '';
  const cleaned = line
    .replace(/^[#>*`_~\-\s]+/, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, maxLength).join('');
}

const TASK_NOTIFICATION_FALLBACK_TITLES = {
  codex: 'Codex 已完成任务',
  claude: 'Claude 已完成任务',
  gpt: 'GPT 已完成任务',
  workbuddy: 'WorkBuddy 已完成任务',
  gemini: 'Gemini 已完成任务',
};

const AGENT_SOURCES = new Set(['codex', 'claude', 'gpt', 'workbuddy', 'gemini']);
const AGENT_STATES = new Set(['running', 'waiting', 'completed', 'failed']);
const AGENT_TERMINAL_STATES = new Set(['completed', 'failed']);
const AGENT_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AGENT_STALE_MS = 2 * 60 * 60 * 1000;

function cleanAgentText(value, limit) {
  return Array.from(String(value || '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, limit).join('');
}

function agentEventTimestamp(value, now) {
  let timestamp = Number(value);
  if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < 1e12) timestamp *= 1000;
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : now;
}

function normalizeAgentEvent(payload, source, options = {}) {
  if (!AGENT_SOURCES.has(source)) return { ok: false, error: 'invalid_source' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'invalid_payload' };
  }
  if (options.legacy !== true && Number(payload.version) !== 1) {
    return { ok: false, error: 'unsupported_version' };
  }

  const state = options.legacy === true ? 'completed' : String(payload.event || '').toLowerCase();
  if (!AGENT_STATES.has(state)) return { ok: false, error: 'invalid_event' };
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const identity = taskNotificationIdentity(payload, source);
  const rawRunId = firstPayloadText(payload, [
    'run_id', 'run-id', 'runId', 'turn_id', 'turn-id', 'turnId', 'thread_id', 'thread-id',
    'threadId', 'session_id', 'session-id', 'sessionId', 'task_id', 'task-id', 'taskId', 'id',
  ]);
  let runId = cleanAgentText(rawRunId, 160);
  if (!runId && !AGENT_TERMINAL_STATES.has(state)) return { ok: false, error: 'run_id_required' };
  const occurredAt = agentEventTimestamp(
    firstPayloadText(payload, ['occurred_at', 'occurred-at', 'occurredAt', 'completed_at', 'completed-at', 'completedAt']),
    now
  );
  const summary = cleanAgentText(firstPayloadText(payload, [
    'summary', 'detail', 'body', 'last_assistant_message', 'last-assistant-message',
    'lastAssistantMessage', 'message',
  ]), 280);
  if (!runId) {
    const legacyMinute = Math.floor(occurredAt / 60_000);
    runId = `legacy-${crypto.createHash('sha256')
      .update(`${source}\0${identity.project}\0${identity.title}\0${legacyMinute}`)
      .digest('hex').slice(0, 24)}`;
  }

  return {
    ok: true,
    event: {
      source,
      runId,
      state,
      project: cleanAgentText(identity.project, 48),
      title: cleanAgentText(identity.title, 120),
      summary,
      occurredAt,
    },
  };
}

function pruneAgentRuns(runs, now = Date.now(), terminalLimit = 200) {
  const current = Number.isFinite(now) ? now : Date.now();
  const list = Array.isArray(runs) ? runs.filter((run) => run && typeof run === 'object') : [];
  const active = list.filter((run) => !AGENT_TERMINAL_STATES.has(run.state));
  const terminal = list
    .filter((run) => AGENT_TERMINAL_STATES.has(run.state))
    .filter((run) => current - Number(run.completedAt || run.updatedAt || 0) <= AGENT_TERMINAL_RETENTION_MS)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, Math.max(0, terminalLimit));
  return [...active, ...terminal]
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

function mergeAgentEvent(runs, event, now = Date.now()) {
  const current = Array.isArray(runs) ? runs.map((run) => ({ ...run })) : [];
  if (!event || !AGENT_SOURCES.has(event.source) || !AGENT_STATES.has(event.state) || !event.runId) {
    return { status: 'invalid', runs: current, run: null };
  }
  const index = current.findIndex((run) => run.source === event.source && run.runId === event.runId);
  const existing = index >= 0 ? current[index] : null;
  if (existing && Number(event.occurredAt) < Number(existing.updatedAt || 0)) {
    return { status: 'out_of_order', runs: current, run: existing };
  }
  if (existing && AGENT_TERMINAL_STATES.has(existing.state)) {
    return { status: 'duplicate', runs: current, run: existing };
  }
  const terminal = AGENT_TERMINAL_STATES.has(event.state);
  const run = {
    ...(existing || {}),
    source: event.source,
    runId: event.runId,
    state: event.state,
    title: event.title || existing?.title || TASK_NOTIFICATION_FALLBACK_TITLES[event.source],
    project: event.project || existing?.project || '',
    summary: event.summary || existing?.summary || '',
    startedAt: existing?.startedAt || event.occurredAt,
    updatedAt: event.occurredAt,
    completedAt: terminal ? event.occurredAt : 0,
  };
  if (existing
    && existing.state === run.state
    && existing.updatedAt === run.updatedAt
    && existing.title === run.title
    && existing.project === run.project
    && existing.summary === run.summary) {
    return { status: 'duplicate', runs: current, run: existing };
  }
  if (index >= 0) current[index] = run;
  else current.push(run);
  return {
    status: index >= 0 ? 'updated' : 'added',
    runs: pruneAgentRuns(current, now),
    run,
  };
}

function listAgentRuns(runs, filter = {}, now = Date.now()) {
  const states = Array.isArray(filter.states)
    ? new Set(filter.states.filter((state) => AGENT_STATES.has(state)))
    : null;
  const limit = Math.max(1, Math.min(200, Math.round(Number(filter.limit) || 50)));
  return pruneAgentRuns(runs, now)
    .filter((run) => !states || states.has(run.state))
    .slice(0, limit)
    .map((run) => ({
      ...run,
      stale: !AGENT_TERMINAL_STATES.has(run.state) && now - Number(run.updatedAt || 0) >= AGENT_STALE_MS,
    }));
}

const LEGACY_STORAGE_KEYS = new Set([
  'notch-todo-data',
  'notch-todo-category-names-v1',
  'notch-home-note',
  'notch-note-archive-v1',
  'notch-recordings',
  'notch-clip-history',
  'notch-clip-favorites',
  'notch-home-order-v3',
  'notch-home-widget-sizes-v2',
  'notch-home-hidden-modules-v1',
]);

function parseStorageJson(storage, key, fallback) {
  try {
    const value = JSON.parse(storage && storage[key]);
    return value == null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function rowIdentity(row) {
  if (row && typeof row === 'object') {
    return String(row.id || row.url || row.audioPath || row.imagePath || JSON.stringify(row));
  }
  return String(row);
}

function mergeRows(current, legacy) {
  const rows = Array.isArray(current) ? [...current] : [];
  const seen = new Set(rows.map(rowIdentity));
  (Array.isArray(legacy) ? legacy : []).forEach((row) => {
    const identity = rowIdentity(row);
    if (!seen.has(identity)) {
      rows.push(row);
      seen.add(identity);
    }
  });
  return rows;
}

function mapLegacyHomeModules(value) {
  const mapId = (id) => id === 'music'
    ? 'agent-status'
    : id === 'mirror' ? 'result-inbox' : id === 'windows' ? 'attention-center' : id;
  if (Array.isArray(value)) return value.map(mapId).filter((id) => id !== 'commands');
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [mapId(key), item])
    .filter(([key]) => key !== 'commands'));
}

function mergeLegacyWorkspaceStorage(currentStorage, legacyStorage) {
  const current = currentStorage && typeof currentStorage === 'object' && !Array.isArray(currentStorage)
    ? { ...currentStorage }
    : {};
  const legacy = legacyStorage && typeof legacyStorage === 'object' && !Array.isArray(legacyStorage)
    ? legacyStorage
    : {};
  let imported = 0;
  const writeJson = (key, value) => {
    current[key] = JSON.stringify(value);
    imported += 1;
  };

  for (const key of LEGACY_STORAGE_KEYS) {
    if (typeof legacy[key] !== 'string') continue;
    if (key === 'notch-home-note') {
      if (!String(current[key] || '').trim() && String(legacy[key]).trim()) {
        current[key] = legacy[key];
        imported += 1;
      }
      continue;
    }
    if (['notch-home-order-v3', 'notch-home-widget-sizes-v2', 'notch-home-hidden-modules-v1'].includes(key)) {
      if (current[key] == null) writeJson(key, mapLegacyHomeModules(parseStorageJson(legacy, key, [])));
      continue;
    }
    if (key === 'notch-todo-data') {
      const currentTodos = parseStorageJson(current, key, {});
      const legacyTodos = parseStorageJson(legacy, key, {});
      const merged = {};
      ['P0', 'P1', 'P2', 'P3'].forEach((priority) => {
        merged[priority] = mergeRows(currentTodos[priority], legacyTodos[priority]);
      });
      writeJson(key, merged);
      continue;
    }
    if (key === 'notch-todo-category-names-v1') {
      writeJson(key, {
        ...parseStorageJson(legacy, key, {}),
        ...parseStorageJson(current, key, {}),
      });
      continue;
    }
    const currentValue = parseStorageJson(current, key, []);
    const legacyValue = parseStorageJson(legacy, key, []);
    writeJson(key, mergeRows(currentValue, legacyValue));
  }
  return { storage: current, imported };
}

function taskNotificationIdentity(payload, source = 'task') {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const cwd = firstPayloadText(data, ['cwd', 'working_directory', 'working-directory']);
  const project = cleanTaskLine(
    firstPayloadText(data, ['project', 'project_name', 'project-name', 'projectName'])
      || (cwd && path.isAbsolute(cwd) ? path.basename(path.normalize(cwd)) : ''),
    48
  );
  const concreteTitle = firstPayloadText(data, [
    'last_assistant_message',
    'last-assistant-message',
    'lastAssistantMessage',
    'task_title',
    'task-title',
    'taskTitle',
    'task_name',
    'task-name',
    'taskName',
    'last_user_message',
    'last-user-message',
    'lastUserMessage',
    'prompt',
    'user_prompt',
    'user-prompt',
    'userPrompt',
    'message',
    'title',
  ]);
  return {
    project,
    title: cleanTaskLine(concreteTitle, 120)
      || TASK_NOTIFICATION_FALLBACK_TITLES[source]
      || '任务已完成',
  };
}


// 剪贴板默认关闭（DEFAULT_FEATURES.clip = false），关着就不该轮询系统剪贴板。
// 原实现收了 features 却完全不用，恒定返回 recordHistory: true，于是无论用户有没有
// 在菜单栏打开这个功能，主进程都在每 500ms 读一次粘贴板——剪贴板里躺着大图时
// （实测一张截图 1.9MB PNG + 6.9MB Photoshop 数据）主进程空转就能吃掉三成 CPU，
// 面板展开和拖拽都会明显卡顿。
// 全局快捷键始终不注册：原 Cmd+Shift+V 已撤销，app:open-clip 仅由菜单栏驱动。
function clipboardServicePolicy(features) {
  const source = features && typeof features === 'object' && !Array.isArray(features) ? features : {};
  return {
    recordHistory: source.clip === true,
    registerGlobalShortcut: false,
  };
}

function createClipboardImageFingerprint(width, height, pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) return null;
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.trunc(height)) : 0;
  const digest = crypto.createHash('sha256').update(pngBuffer).digest('hex');
  return `${safeWidth}x${safeHeight}:${digest}`;
}

function prepareClipboardImagePayload(mimeType, sourceBuffer, size = {}) {
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) return null;
  const fingerprint = createClipboardImageFingerprint(size.width, size.height, sourceBuffer);
  if (!fingerprint) return null;
  return {
    fingerprint,
    mimeType: String(mimeType || '').toLowerCase(),
    sourceBuffer,
    // Electron 44 已经从 ClipboardItem 给出了 PNG 原始字节。复用它可以避免每次
    // 轮询都让 nativeImage 再做一次昂贵的 PNG 编码；其他格式只在确认为新图片后转换。
    pngBuffer: String(mimeType || '').toLowerCase() === 'image/png' ? sourceBuffer : null,
  };
}

function installLocalWebContentsGuards(webContents) {
  if (!webContents
    || typeof webContents.setWindowOpenHandler !== 'function'
    || typeof webContents.on !== 'function') return false;
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event) => event.preventDefault());
  return true;
}

async function runOwnedOpenDialog(showOpenDialog, owner, options, updateGuard = () => {}) {
  if (typeof showOpenDialog !== 'function') throw new TypeError('showOpenDialog must be a function');
  updateGuard(1);
  try {
    return owner
      ? await showOpenDialog(owner, options)
      : await showOpenDialog(options);
  } finally {
    updateGuard(-1);
  }
}

async function readClipboardObservation(items, options = {}) {
  const rows = Array.isArray(items) ? items.filter((item) => item && Array.isArray(item.types)) : [];
  const concealed = rows.some((item) => item.types.some((type) => (
    String(type || '').toLowerCase().includes('org.nspasteboard.concealedtype')
  )));
  if (concealed) return { concealed: true, text: '', image: null };

  let text = '';
  for (const item of rows) {
    if (!item.types.includes('text/plain') || typeof item.getType !== 'function') continue;
    try {
      const blob = await item.getType('text/plain');
      text = typeof blob?.text === 'function' ? await blob.text() : '';
    } catch (error) {
      text = '';
    }
    if (text) break;
  }

  let image = null;
  if (options.includeImage === true) {
    const preferredTypes = ['image/png', 'image/jpeg', 'image/webp'];
    for (const mimeType of preferredTypes) {
      const item = rows.find((row) => row.types.includes(mimeType));
      if (!item || typeof item.getType !== 'function') continue;
      try {
        const blob = await item.getType(mimeType);
        if (blob && typeof blob.arrayBuffer === 'function') {
          const buffer = Buffer.from(await blob.arrayBuffer());
          if (buffer.length > 0) image = { mimeType, buffer };
        }
      } catch (error) {
        image = null;
      }
      if (image) break;
    }
  }

  return { concealed: false, text, image };
}

function screenRecordingProbePolicy(status) {
  if (status === 'granted') return { hasAccess: true, inspectWindowTitles: true };
  if (['not-determined', 'denied', 'restricted'].includes(status)) {
    return { hasAccess: false, inspectWindowTitles: false };
  }
  // 未知状态下不主动触碰捕获 API，避免在启动阶段制造不可预测的系统弹窗。
  return { hasAccess: true, inspectWindowTitles: false };
}

function taskNotificationWindowPolicy(state) {
  const active = Boolean(state && state.active);
  const queueLength = Math.max(0, Number(state && state.queueLength) || 0);
  return !active && queueLength === 0 ? 'dispose' : 'retain';
}

function companionPresentation(state = {}) {
  if (
    state.enabled !== true
    || state.mainVisible !== true
    || state.systemPaused === true
    || state.notificationActive === true
    || state.mode !== 'collapsed'
  ) return { visible: false, state: 'hidden' };
  if (['celebrate', 'peek'].includes(state.override)) {
    return { visible: true, state: state.override };
  }
  if (state.waitingActive === true) return { visible: true, state: 'attention' };
  return { visible: true, state: state.focusActive === true ? 'focus' : 'rest' };
}

function reduceClipboardObservation(state, observation, options = {}) {
  const previous = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const current = observation && typeof observation === 'object' && !Array.isArray(observation)
    ? observation
    : {};
  const normalizedState = {
    textFingerprint: typeof previous.textFingerprint === 'string'
      ? previous.textFingerprint
      : null,
    imageFingerprint: typeof previous.imageFingerprint === 'string'
      ? previous.imageFingerprint
      : null,
  };
  if (current.concealed === true) return { state: normalizedState, record: null };

  const text = typeof current.text === 'string' && current.text ? current.text : null;
  const imageFingerprint = typeof current.imageFingerprint === 'string' && current.imageFingerprint
    ? current.imageFingerprint
    : null;
  const nextState = { ...normalizedState };
  if (text) nextState.textFingerprint = text;
  if (imageFingerprint) nextState.imageFingerprint = imageFingerprint;

  let record = null;
  if (options.baseline !== true) {
    if (text && text !== normalizedState.textFingerprint) {
      record = { type: 'text', text };
    } else if (!text && imageFingerprint && imageFingerprint !== normalizedState.imageFingerprint) {
      record = { type: 'image', imageFingerprint };
    }
  }
  return { state: nextState, record };
}

function createWorkspacePersistenceGate() {
  let lastSignature = null;
  const signatureFor = (storage, destination = '') => {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return null;
    return JSON.stringify([
      String(destination || ''),
      Object.keys(storage).sort().map((key) => [key, storage[key]]),
    ]);
  };
  return {
    shouldWrite(storage, destination = '') {
      const signature = signatureFor(storage, destination);
      return signature !== null && signature !== lastSignature;
    },
    markWritten(storage, destination = '') {
      const signature = signatureFor(storage, destination);
      if (signature !== null) lastSignature = signature;
    },
  };
}

function hoverSpacePollingPolicy({ shortcut, visible, mode } = {}) {
  return {
    enabled: shortcut === 'Space' && visible === true && mode === 'collapsed',
    intervalMs: 60,
  };
}

const CONFIGURABLE_FEATURES = new Set(['todo', 'notes', 'recordings', 'clip']);

function updateFeaturePreference(features, featureId, enabled) {
  if (!CONFIGURABLE_FEATURES.has(featureId) || typeof enabled !== 'boolean') return null;
  const source = features && typeof features === 'object' && !Array.isArray(features) ? features : {};
  return { ...source, [featureId]: enabled, home: true };
}

module.exports = {
  isPrivateAddress,
  recordingExtension,
  normalizeWindowRows,
  taskWindowMatchScore,
  todoReminderState,
  todoReminderTimerDelay,
  taskNotificationIdentity,
  normalizeAgentEvent,
  mergeAgentEvent,
  listAgentRuns,
  pruneAgentRuns,
  mergeLegacyWorkspaceStorage,
  parseSmartMaterialMetadata,
  selectTranscriptionSettings,
  clipboardServicePolicy,
  createClipboardImageFingerprint,
  prepareClipboardImagePayload,
  installLocalWebContentsGuards,
  runOwnedOpenDialog,
  readClipboardObservation,
  screenRecordingProbePolicy,
  taskNotificationWindowPolicy,
  companionPresentation,
  reduceClipboardObservation,
  createWorkspacePersistenceGate,
  hoverSpacePollingPolicy,
  updateFeaturePreference,
};
