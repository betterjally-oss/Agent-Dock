(function initAgentDock() {
  'use strict';

  const api = window.notchAPI;
  const statusTitle = document.getElementById('agent-status-title');
  const stateSummary = document.getElementById('agent-state-summary');
  const activeList = document.getElementById('agent-active-list');
  const sourceStrip = document.getElementById('agent-source-strip');
  const serverDot = document.getElementById('agent-server-dot');
  const resultCount = document.getElementById('agent-result-count');
  const resultList = document.getElementById('agent-result-list');
  const attentionCount = document.getElementById('attention-count');
  const attentionList = document.getElementById('attention-list');
  const actionStatus = document.getElementById('agent-action-status');
  const settingsSourceList = document.getElementById('settings-agent-source-list');
  const settingsServerStatus = document.getElementById('settings-agent-server-status');
  const importButton = document.getElementById('settings-import-legacy');
  if (!api || !statusTitle || !stateSummary || !activeList || !resultList) return;
  let visualState = document.body.dataset.agentVisualState || 'idle';
  let visualStateAnimation = null;

  const STATE_LABELS = {
    running: '运行中',
    waiting: '等你处理',
    completed: '已完成',
    failed: '失败',
  };
  const SOURCE_LABELS = {
    codex: 'Codex',
    claude: 'Claude',
    gpt: 'GPT',
    workbuddy: 'WorkBuddy',
    gemini: 'Gemini CLI',
  };
  const ATTENTION_LABELS = {
    waiting: '等待处理',
    overdue: '已逾期',
    stale: '状态可能已过期',
    failed: '运行失败',
    'due-today': '今日截止',
  };
  let payload = { items: [], sources: [], server: {} };

  function notify(message, error = false) {
    if (actionStatus) {
      actionStatus.textContent = message;
      actionStatus.dataset.state = error ? 'error' : 'ok';
    }
    document.dispatchEvent(new CustomEvent('notch:toast', { detail: { message } }));
  }

  function formatTime(timestamp) {
    const age = Math.max(0, Date.now() - Number(timestamp || 0));
    if (age < 60_000) return '刚刚';
    if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
    if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(timestamp));
  }

  function addText(parent, tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  async function openRun(id) {
    const result = await api.activateRunWindow(id).catch(() => ({ ok: false }));
    notify(result?.ok
      ? result.approximate ? '已打开 Codex，但无法精确定位具体对话' : '已打开匹配窗口'
      : '未找到匹配窗口，请手动打开对应 Agent', !result?.ok);
  }

  function renderStatus() {
    const active = payload.items.filter((run) => ['running', 'waiting'].includes(run.state));
    const waiting = active.filter((run) => run.state === 'waiting').length;
    const running = active.filter((run) => run.state === 'running').length;
    const online = payload.server?.available === true;
    const latestSource = payload.sources
      .filter((source) => source.lastEventAt > 0)
      .sort((left, right) => right.lastEventAt - left.lastEventAt)[0];
    statusTitle.textContent = waiting
      ? `${waiting} 项需要处理`
      : running
        ? `${running} 项正在运行`
        : !online
          ? '事件服务不可用'
          : latestSource
            ? `已连接 · ${latestSource.label || SOURCE_LABELS[latestSource.source]}`
            : '已就绪，等待 Agent';
    stateSummary.replaceChildren();
    [['running', running], ['waiting', waiting]].forEach(([state, count]) => {
      const chip = addText(stateSummary, 'span', 'agent-state-chip', `${STATE_LABELS[state]} ${count}`);
      chip.dataset.state = state;
    });
    activeList.replaceChildren();
    if (!active.length) {
      const emptyText = !online
        ? '请检查本机 43822 端口是否被占用'
        : latestSource
          ? `最近活动：${formatTime(latestSource.lastEventAt)}；下一次任务开始会显示在这里`
          : '在设置中复制 Agent Hook 配置后，运行状态会显示在这里';
      addText(activeList, 'p', 'agent-empty', emptyText);
    }
    active.slice(0, 3).forEach((run) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'agent-run-row';
      button.dataset.runId = run.id;
      button.dataset.state = run.state;
      button.title = run.title || '未命名任务';
      button.addEventListener('click', () => openRun(run.id));
      addText(button, 'i', 'agent-run-dot', '');
      const copy = document.createElement('span');
      addText(copy, 'strong', '', run.title || '未命名任务');
      addText(copy, 'small', '', `${SOURCE_LABELS[run.source] || run.source}${run.project ? ` · ${run.project}` : ''}${run.stale ? ' · 状态可能已过期' : ''}`);
      button.appendChild(copy);
      activeList.appendChild(button);
    });

    sourceStrip.replaceChildren();
    payload.sources.forEach((source) => {
      const badge = addText(sourceStrip, 'span', 'agent-source-badge', source.label || SOURCE_LABELS[source.source]);
      badge.dataset.active = String(source.lastEventAt > 0);
      badge.title = source.lastEventAt ? `最后事件：${formatTime(source.lastEventAt)}` : source.note;
    });
    serverDot.dataset.online = String(online);
    serverDot.title = online ? `本机事件服务已监听 ${payload.server.port}` : '本机事件服务暂不可用';
  }

  function resultActions(run) {
    const actions = document.createElement('div');
    actions.className = 'agent-result-actions';
    const open = addText(actions, 'button', '', '打开');
    open.type = 'button';
    open.dataset.action = 'open';
    const copy = addText(actions, 'button', '', '复制');
    copy.type = 'button';
    copy.dataset.action = 'copy';
    const category = document.createElement('select');
    category.setAttribute('aria-label', '选择任务分类');
    (window.NotchTodos?.categories?.() || []).forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      category.appendChild(option);
    });
    category.value = run.convertedToTodo?.category || 'P2';
    const todo = addText(actions, 'button', '', run.convertedToTodo ? '已转任务' : '转任务');
    todo.type = 'button';
    todo.dataset.action = 'todo';
    todo.disabled = Boolean(run.convertedToTodo);
    actions.append(category);
    actions.append(todo);
    return actions;
  }

  function renderResults() {
    const results = payload.items.filter((run) => ['completed', 'failed'].includes(run.state));
    resultCount.textContent = `${results.length} 项`;
    resultList.replaceChildren();
    if (!results.length) {
      addText(resultList, 'p', 'agent-empty', '还没有成果，先接入一个本机 Agent');
      return;
    }
    results.slice(0, 5).forEach((run) => {
      const row = document.createElement('article');
      row.className = 'agent-result-row';
      row.dataset.runId = run.id;
      row.dataset.state = run.state;
      const copy = document.createElement('div');
      addText(copy, 'strong', '', run.title || '未命名成果');
      addText(copy, 'small', '', `${SOURCE_LABELS[run.source] || run.source} · ${STATE_LABELS[run.state]} · ${formatTime(run.updatedAt)}`);
      if (run.summary && run.summary !== run.title) addText(copy, 'p', '', run.summary);
      row.append(copy, resultActions(run));
      resultList.appendChild(row);
    });
  }

  function renderAttention() {
    if (!attentionCount || !attentionList) return;
    const items = window.NotchDomain?.buildAttentionItems(
      payload.items,
      window.NotchTodos?.items?.() || [],
      Date.now()
    ) || [];
    attentionCount.textContent = `${items.length} 项`;
    attentionList.replaceChildren();
    if (!items.length) {
      addText(attentionList, 'p', 'agent-empty', '一切正常，小猫正在替你看着');
      return;
    }
    items.slice(0, 6).forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'attention-row';
      button.dataset.kind = item.kind;
      button.dataset.reason = item.reason;
      button.addEventListener('click', () => {
        if (item.kind === 'agent') openRun(item.id);
        else window.NotchTodos?.open?.(item.id, item.priority);
      });
      addText(button, 'i', 'attention-dot', '');
      const copy = document.createElement('span');
      addText(copy, 'strong', '', item.title);
      const source = item.kind === 'agent'
        ? SOURCE_LABELS[item.source] || item.source
        : item.category || item.priority || '待办';
      const clock = item.reason === 'due-today'
        ? ` · ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.timestamp))}`
        : '';
      addText(copy, 'small', '', `${source} · ${ATTENTION_LABELS[item.reason]}${clock}`);
      button.appendChild(copy);
      attentionList.appendChild(button);
    });
  }

  function renderSettingsSources() {
    if (!settingsSourceList || !settingsServerStatus) return;
    settingsServerStatus.textContent = payload.server?.available
      ? `127.0.0.1:${payload.server.port}`
      : '端口不可用';
    settingsServerStatus.dataset.state = payload.server?.available ? 'ok' : 'error';
    settingsSourceList.replaceChildren();
    payload.sources.forEach((source) => {
      const row = document.createElement('div');
      row.className = 'settings-agent-source-row';
      const copy = document.createElement('span');
      addText(copy, 'b', '', source.label || SOURCE_LABELS[source.source]);
      addText(copy, 'small', '', `${source.states.map((state) => STATE_LABELS[state]).join(' / ') || '等待发送端声明'} · ${source.lastEventAt ? formatTime(source.lastEventAt) : '尚无事件'}`);
      const button = addText(row, 'button', '', '复制配置');
      button.type = 'button';
      button.dataset.agentSetup = source.source;
      row.prepend(copy);
      settingsSourceList.appendChild(row);
    });
  }

  function applyVisualState() {
    const waiting = payload.items.some((run) => run.state === 'waiting');
    const running = payload.items.some((run) => run.state === 'running');
    const completed = payload.items.some((run) => run.state === 'completed');
    const nextState = waiting ? 'waiting' : running ? 'running' : completed ? 'completed' : 'idle';
    document.body.dataset.agentVisualState = nextState;
    if (nextState === visualState) return;

    visualStateAnimation?.cancel();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = nextState === 'waiting'
      ? document.querySelector('.home-attention-center .agent-widget-head')
      : nextState === 'completed'
        ? document.querySelector('.home-result-inbox .agent-widget-head')
        : document.querySelector('.home-agent-status .agent-widget-head');
    visualStateAnimation = target?.animate(
      reducedMotion
        ? [{ opacity: 0.7 }, { opacity: 1 }]
        : [{ opacity: 0.55, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: reducedMotion ? 80 : 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
    ) || null;
    visualState = nextState;
  }

  function render(nextPayload) {
    if (nextPayload?.items) payload = nextPayload;
    renderStatus();
    renderAttention();
    renderResults();
    renderSettingsSources();
    applyVisualState();
  }

  resultList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    const row = event.target.closest('.agent-result-row[data-run-id]');
    if (!button || !row) return;
    const id = row.dataset.runId;
    if (button.dataset.action === 'open') {
      await openRun(id);
      return;
    }
    if (button.dataset.action === 'copy') {
      const result = await api.copyResultSummary(id).catch(() => ({ ok: false }));
      notify(result?.ok ? '成果摘要已复制' : '复制失败', !result?.ok);
      return;
    }
    const category = row.querySelector('select')?.value || 'P2';
    button.disabled = true;
    const result = await api.convertResultToTodo(id, category).catch(() => ({ ok: false }));
    if (!result?.ok || !window.NotchTodos?.addAgentResult(result.todo.text, result.todo.category)) {
      button.disabled = false;
      notify('转为任务失败', true);
      return;
    }
    notify('已转为本地任务');
    await refresh();
  });

  settingsSourceList?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-agent-setup]');
    if (!button) return;
    const result = await api.copyAgentSetup(button.dataset.agentSetup).catch(() => ({ ok: false }));
    notify(result?.ok ? `已复制，请保存或合并到 ${result.target}` : '复制配置失败', !result?.ok);
  });

  importButton?.addEventListener('click', async () => {
    importButton.disabled = true;
    const storage = window.NotchWorkspaceSnapshot?.() || {};
    const result = await api.importLegacyWorkspace(storage).catch(() => ({ ok: false }));
    importButton.disabled = false;
    if (result?.canceled) return;
    if (!result?.ok) {
      notify(result?.error === 'workspace_not_found' ? '所选文件夹不是 TO-DO Panel 数据目录' : '旧数据导入失败', true);
      return;
    }
    Object.entries(result.storage || {}).forEach(([key, value]) => {
      if (typeof value === 'string') localStorage.setItem(key, value);
    });
    await api.saveWorkspaceData(result.storage).catch(() => false);
    location.reload();
  });

  async function refresh() {
    const next = await api.listAgentRuns({ limit: 50 }).catch(() => null);
    if (next) render(next);
  }

  api.onAgentRunsChanged?.(render);
  document.addEventListener('notch:todos-changed', renderAttention);
  refresh();
  setInterval(refresh, 60_000);
})();
