const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const domainJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'domain.js'), 'utf8');
const agentDockJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'agent-dock.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const mainServicesJs = fs.readFileSync(path.join(__dirname, '..', 'main-services.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
});

test('retired link and credential modules are absent without deleting existing user data', () => {
  assert.doesNotMatch(html, /tab-button-(?:links|credentials)|id="tab-(?:links|credentials)"/);
  assert.doesNotMatch(html, /data-settings-feature="(?:links|credentials)"/);
  assert.doesNotMatch(preloadJs, /inspectLink|listCredentials|getCredential|saveCredential|deleteCredentials|copyCredential/);
  assert.doesNotMatch(workspaceJs, /linkGroups|credentialService|renderCredentials/);
  assert.doesNotMatch(domainJs, /normalizeHttpUrl|classifyLink|filterCredentials|credentialRowAction/);
  assert.doesNotMatch(styles, /\.link-group|\.link-item|\.credentials-page|\.credential-item/);
  assert.doesNotMatch(mainJs, /inspectLink|ipcMain\.handle\('(?:links:inspect|credentials:)/);
  assert.doesNotMatch(mainServicesJs, /parseSmartLinkMetadata|normalizeCredentialInput/);
});

test('home session note keeps save and optional Agent context', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.match(homeNote, /id="note-context"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.match(appJs, /notch-home-hidden-modules-v1/);
  assert.match(appJs, /validateHomeWidgetLayout/);
  assert.match(appJs, /window\.NotchHome\s*=/);
  assert.match(appJs, /notch:home-modules-changed/);
  assert.match(appJs, /notch:home-layout-error/);
  assert.doesNotMatch(appJs, /stopMirror\(\)/);
  assert.match(appJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
});

test('settings exposes exactly one switch for every homepage widget', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note',
  ]);
  assert.match(workspaceJs, /at_least_one_required/);
});

test('Agent Dock replaces retired homepage modules with local action widgets', () => {
  assert.match(html, /data-home-module="agent-status"/);
  assert.match(html, /data-home-module="attention-center"/);
  assert.match(html, /data-home-module="result-inbox"/);
  assert.doesNotMatch(html, /data-home-module="(?:music|mirror|windows)"/);
  assert.match(agentDockJs, /activateRunWindow/);
  assert.match(agentDockJs, /buildAttentionItems/);
  assert.match(agentDockJs, /convertResultToTodo/);
  assert.match(html, /id="quick-brief-text"/);
  assert.match(html, /placeholder="输入要交代给 AI 的内容…"/);
  assert.doesNotMatch(html, /id="(?:record-start|record-pause|record-stop|home-recording-time)"/);
  assert.doesNotMatch(workspaceJs, /startRecording\('brief'\)/);
  assert.match(preloadJs, /openAgentApp/);
  assert.doesNotMatch(html, /data-home-module="commands"/);
  assert.doesNotMatch(preloadJs, /windows:(?:list|focus)/);
});

test('attention items route by source and local todos keep their exact identity', () => {
  assert.match(agentDockJs, /item\.kind === 'agent'\) openRun\(item\.id\)/);
  assert.match(agentDockJs, /NotchTodos\?\.open\?\.\(item\.id, item\.priority\)/);
  assert.match(appJs, /attention-focus/);
});

test('homepage ships the approved obsidian status hierarchy and state-driven motion', () => {
  assert.match(html, /data-agent-visual-state="idle"/);
  assert.match(html, /NEEDS YOU/);
  assert.match(html, /COMPLETED/);
  assert.match(html, /<span class="tile-label">已完成<\/span>/);
  assert.doesNotMatch(html, /成果收件箱/);
  assert.match(agentDockJs, /function applyVisualState\(\)/);
  assert.match(agentDockJs, /prefers-reduced-motion: reduce/);
  assert.match(appJs, /const HOME_LAYOUT_MOTION_MS = 220/);
  assert.match(appJs, /aria-keyshortcuts/);
  assert.match(appJs, /moveHomeModuleByKeyboard/);
});

test('workbench cat follows real widget edges instead of floating above the panel', () => {
  assert.match(html, /id="workbench-cat"/);
  assert.match(html, /class="workbench-cat-sprite"/);
  assert.match(appJs, /function currentWorkbenchCatEdges\(\)/);
  assert.match(appJs, /leftModuleId/);
  assert.match(appJs, /rightModuleId/);
  assert.match(appJs, /rows\[rows\.length - 1\]/);
  assert.match(appJs, /edge\.top - catHeight/);
  assert.match(appJs, /workbenchCat\.animate\(\[/);
  assert.match(appJs, /duration: Math\.max\(6400, Math\.min\(18000, distance \* 48\)\)/);
  assert.match(appJs, /easing: 'linear'/);
  assert.match(styles, /cat-walk-12\.png/);
  assert.match(styles, /animation: workbench-cat-walk 2\.16s linear infinite/);
  assert.match(styles, /background-position:\s*100% 100%/);
  assert.match(styles, /@keyframes workbench-cat-walk/);
});

test('WorkBuddy and Gemini are visible Agent sources and ship their hook bridge', () => {
  assert.match(agentDockJs, /workbuddy:\s*'WorkBuddy'/);
  assert.match(agentDockJs, /gemini:\s*'Gemini CLI'/);
  assert.match(html, /<option value="workbuddy">WorkBuddy<\/option>/);
  assert.match(html, /<option value="gemini">Gemini CLI<\/option>/);
  assert.ok(packageJson.build.files.includes('scripts/agent-hook-notify.js'));
});
