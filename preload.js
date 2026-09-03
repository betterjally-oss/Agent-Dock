const { contextBridge, ipcRenderer } = require('electron');

// 所有 on* 订阅统一经此注册，并回传退订函数：渲染层若重新初始化，
// 不退订就会叠加监听器，同一条通知被回调多次。
function subscribe(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('notchAPI', {
  setMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  beginCollapse: () => ipcRenderer.invoke('window:begin-collapse'),
  setTab: (tab) => ipcRenderer.invoke('window:set-tab', tab),
  ensureMicrophone: () => ipcRenderer.invoke('media:microphone'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openPrivacySettings: (pane) => ipcRenderer.invoke('shell:open-privacy-settings', pane),
  quitApp: () => ipcRenderer.send('app:quit'),
  saveRecording: (payload) => ipcRenderer.invoke('recordings:save', payload),
  readRecording: (audioPath) => ipcRenderer.invoke('recordings:read', audioPath),
  deleteRecording: (audioPath) => ipcRenderer.invoke('recordings:delete', audioPath),
  revealRecording: (audioPath) => ipcRenderer.invoke('recordings:reveal', audioPath),
  organizeMaterial: (payload) => ipcRenderer.invoke('smart:organize-material', payload),
  getTranscriptionConfig: () => ipcRenderer.invoke('transcription:get-config'),
  setTranscriptionConfig: (config) => ipcRenderer.invoke('transcription:set-config', config),
  startTranscription: () => ipcRenderer.invoke('transcription:start'),
  sendTranscriptionAudio: (bytes) => ipcRenderer.send('transcription:audio', bytes),
  finishTranscription: () => ipcRenderer.invoke('transcription:finish'),
  onTranscriptionEvent: (cb) => subscribe('transcription:event', (event, payload) => cb(payload)),
  listAgentRuns: (filter) => ipcRenderer.invoke('agent:list', filter),
  activateRunWindow: (id) => ipcRenderer.invoke('agent:activate-window', id),
  openAgentApp: (source) => ipcRenderer.invoke('agent:open-app', source),
  copyResultSummary: (id) => ipcRenderer.invoke('agent:copy-summary', id),
  convertResultToTodo: (id, category) => ipcRenderer.invoke('agent:convert-to-todo', { id, category }),
  importLegacyWorkspace: (storage) => ipcRenderer.invoke('agent:import-legacy', storage),
  copyAgentSetup: (source) => ipcRenderer.invoke('agent:copy-setup', source),
  onAgentRunsChanged: (cb) => subscribe('agent-runs:changed', (event, payload) => cb(payload)),
  scheduleTodoReminders: (items) => ipcRenderer.invoke('todos:schedule-reminders', items),
  notifyPomodoro: (minutes) => ipcRenderer.invoke('pomodoro:notify', minutes),
  setCompanionFocus: (active) => ipcRenderer.invoke('companion:set-focus', active === true),
  celebrateCompanion: (kind) => ipcRenderer.invoke('companion:celebrate', kind),
  interactCompanion: () => ipcRenderer.invoke('companion:interact'),
  onCompanionState: (cb) => subscribe('companion:state', (event, state) => cb(state)),
  onCompanionInteract: (cb) => subscribe('companion:interact', () => cb()),
  onTodoReminder: (cb) => subscribe('todo:reminded', (event, payload) => cb(payload)),
  onEscape: (cb) => subscribe('key:escape', () => cb()),
  onToggleShortcut: (cb) => subscribe('shortcut:toggle-panel', () => cb()),
  getHoverSpaceStatus: () => ipcRenderer.invoke('shortcut:hover-space-status'),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  setFeature: (featureId, enabled) => ipcRenderer.invoke('settings:set-feature', { featureId, enabled }),
  setCompanionEnabled: (enabled) => ipcRenderer.invoke('settings:set-companion', enabled === true),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('settings:set-auto-launch', enabled === true),
  setPanelShortcut: (accelerator) => ipcRenderer.invoke('settings:set-shortcut', accelerator),
  onAppSettingsChanged: (cb) => subscribe('settings:changed', (event, settings) => cb(settings)),
  onRecordShortcut: (cb) => subscribe('app:record-shortcut', () => cb()),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  loadWorkspaceData: () => ipcRenderer.invoke('workspace:load-data'),
  saveWorkspaceData: (storage) => ipcRenderer.invoke('workspace:save-data', storage),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  onWorkspaceChanged: (cb) => subscribe('workspace:changed', (event, info) => cb(info)),
  onCollapseRequest: (cb) => subscribe('window:request-collapse', () => cb()),
  getMetrics: () => ipcRenderer.invoke('window:metrics'),
  onMetricsChanged: (cb) =>
    subscribe('window:metrics-changed', (event, metrics) => cb(metrics)),
  writeClipboard: (entry) => ipcRenderer.invoke('clipboard:write', entry),
  pasteClipboard: (entry) => ipcRenderer.invoke('clipboard:paste', entry),
  readClipImage: (imagePath) => ipcRenderer.invoke('clipboard:readImage', imagePath),
  deleteClipImages: (paths) => ipcRenderer.invoke('clipboard:deleteImages', paths),
  onNewClipEntry: (cb) => subscribe('clipboard:new-entry', (evt, entry) => cb(entry)),
  onOpenClip: (cb) => subscribe('app:open-clip', () => cb()),
  onOpenApiSettings: (cb) => subscribe('app:open-api-settings', () => cb()),
  onTaskNotification: (cb) =>
    subscribe('task-notification:show', (event, notification) => cb(notification)),
  onTaskNotificationQueue: (cb) =>
    subscribe('task-notification:queue', (event, count) => cb(count)),
  onTaskNotificationHide: (cb) =>
    subscribe('task-notification:hide', (event, eventId) => cb(eventId)),
  taskNotificationDismissed: (eventId) =>
    ipcRenderer.send('task-notification:dismissed', eventId),
  activateTaskNotification: (eventId) =>
    ipcRenderer.invoke('task-notification:activate', eventId),
  taskNotificationHover: (paused) =>
    ipcRenderer.send('task-notification:hover', paused === true),
});
