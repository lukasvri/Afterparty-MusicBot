const elements = {
  activityList: document.querySelector('#activity-list'),
  cancelSleep: document.querySelector('#cancel-sleep'),
  connectionLabel: document.querySelector('#connection-label'),
  connectionPill: document.querySelector('#connection-pill'),
  cover: document.querySelector('#cover'),
  duration: document.querySelector('#duration'),
  elapsed: document.querySelector('#elapsed'),
  guildSelect: document.querySelector('#guild-select'),
  loopQueue: document.querySelector('#loop-queue'),
  playPause: document.querySelector('#play-pause'),
  queueCount: document.querySelector('#queue-count'),
  queueFilterInfo: document.querySelector('#queue-filter-info'),
  queueList: document.querySelector('#queue-list'),
  queueRuntime: document.querySelector('#queue-runtime'),
  queueSearch: document.querySelector('#queue-search'),
  seekSlider: document.querySelector('#seek-slider'),
  settingsForm: document.querySelector('#settings-form'),
  settingsStatus: document.querySelector('#settings-status'),
  settingsUpdated: document.querySelector('#settings-updated'),
  sleepTimerStatus: document.querySelector('#sleep-timer-status'),
  snapshotForm: document.querySelector('#snapshot-form'),
  snapshotList: document.querySelector('#snapshot-list'),
  snapshotName: document.querySelector('#snapshot-name'),
  toast: document.querySelector('#toast'),
  trackArtist: document.querySelector('#track-artist'),
  trackTitle: document.querySelector('#track-title'),
  transport: document.querySelector('#transport-controls'),
  volume: document.querySelector('#live-volume'),
  volumeValue: document.querySelector('#live-volume-value'),
};

let state = null;
let isAuthenticated = false;
let isRefreshing = false;
let pendingActions = 0;
let stateGeneration = 0;
let settingsDirty = false;
let toastTimer = null;
let volumeTimer = null;

const text = (value) => document.createTextNode(String(value));

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const formatRuntime = (seconds) => {
  if (seconds < 60) return `${Math.round(seconds)} sek`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours} t ${minutes} min`;
};

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const showToast = (message, isError = false) => {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 3200);
};

const api = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.method ? 90000 : 15000);
  let response;
  try {
    response = await fetch(url, {...options, signal: controller.signal});
  } finally {
    window.clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if(response.status===401){isAuthenticated=false;document.body.classList.add('needs-login');}
  if (!response.ok) {
    throw new Error(payload.error || `Forespørselen feilet med status ${response.status}.`);
  }
  return payload;
};

const createCover = (sang, className) => {
  const cover = document.createElement('div');
  cover.className = className;
  if (sang?.thumbnailUrl) {
    const image = document.createElement('img');
    image.src = sang.thumbnailUrl;
    image.alt = '';
    image.loading = 'lazy';
    cover.append(image);
  } else {
    cover.append(text('♫'));
  }
  return cover;
};

const renderGuilds = () => {
  const previous = elements.guildSelect.value;
  const signature = state.guilds.map((guild) => `${guild.id}:${guild.name}`).join('|');
  if (elements.guildSelect.dataset.signature !== signature) {
    elements.guildSelect.replaceChildren();
    for (const guild of state.guilds) {
      const option = document.createElement('option');
      option.value = guild.id;
      option.append(text(guild.name));
      elements.guildSelect.append(option);
    }
    elements.guildSelect.dataset.signature = signature;
  }
  elements.guildSelect.value = state.guildId || previous;
  elements.guildSelect.disabled = state.guilds.length < 2;
};

const renderConnection = () => {
  const ready = state.bot.ready;
  elements.connectionPill.classList.toggle('is-loading', !ready);
  elements.connectionPill.classList.toggle('is-offline', !ready);
  elements.connectionLabel.textContent = ready ? `${state.bot.user} er på nett` : 'Discord er frakoblet';
};

const renderPlayer = () => {
  if (!state.player) return;
  const {current, queue, status} = state.player;
  const isPlaying = status === 'playing';
  const hasCurrent = Boolean(current);
  const canSeek = hasCurrent && !current.isLive && state.player.connected;

  elements.trackTitle.textContent = current?.title || 'Ingen sang spiller';
  elements.trackArtist.textContent = current?.artist || 'Legg til musikk fra Discord for å starte.';
  elements.elapsed.textContent = formatDuration(state.player.position);
  elements.duration.textContent = current?.isLive ? 'Direkte' : formatDuration(current?.length || 0);

  if (document.activeElement !== elements.seekSlider) {
    elements.seekSlider.max = Math.max(0, Math.ceil(current?.length || 1) - 1);
    elements.seekSlider.value = Math.min(Number(elements.seekSlider.max), Math.floor(state.player.position));
  }
  elements.seekSlider.disabled = !canSeek;

  elements.cover.replaceChildren();
  if (current?.thumbnailUrl) {
    const image = document.createElement('img');
    image.src = current.thumbnailUrl;
    image.alt = '';
    elements.cover.append(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'cover-placeholder';
    const note = document.createElement('span');
    note.append(text('♫'));
    placeholder.append(note);
    elements.cover.append(placeholder);
  }

  elements.playPause.dataset.playerAction = isPlaying ? 'pause' : 'resume';
  elements.playPause.textContent = isPlaying ? 'Ⅱ' : '▶';
  elements.playPause.title = isPlaying ? 'Pause' : 'Fortsett';
  elements.playPause.setAttribute('aria-label', elements.playPause.title);
  elements.playPause.disabled = !hasCurrent;

  const loopSong = elements.transport.querySelector('[data-player-action="loop-sang"]');
  loopSong.classList.toggle('is-active', state.player.loopCurrentSong);
  loopSong.disabled = !hasCurrent;
  elements.transport.querySelectorAll('[data-player-action="seek-relative"]').forEach((button) => { button.disabled = !canSeek; });
  elements.transport.querySelector('[data-player-action="skip"]').disabled = queue.length < 1;
  elements.transport.querySelector('[data-player-action="shuffle"]').disabled = queue.length < 2;
  elements.transport.querySelector('[data-player-action="stop"]').disabled = !hasCurrent && !state.player.connected;

  if (document.activeElement !== elements.volume) {
    elements.volume.value = state.player.volume;
    elements.volumeValue.textContent = `${state.player.volume}%`;
  }
  elements.loopQueue.checked = state.player.loopCurrentQueue;
  elements.queueCount.textContent = queue.length;
  elements.queueRuntime.textContent = formatRuntime(queue.reduce((sum, sang) => sum + (sang.isLive ? 0 : sang.length), 0));
};

const queueButton = (label, title, action, position, disabled = false) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `mini-button${action === 'remove' ? ' remove' : ''}${action === 'jump' ? ' jump' : ''}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.dataset.queueAction = action;
  button.dataset.position = String(position);
  button.disabled = disabled;
  button.append(text(label));
  return button;
};

const renderQueue = () => {
  if (!state.player) return;
  const queue = state.player.queue;
  const search = elements.queueSearch.value.trim().toLocaleLowerCase('nb-NO');
  const visibleQueue = search ? queue.filter((sang) => (
    `${sang.title} ${sang.artist} ${sang.requestedBy || ''}`.toLocaleLowerCase('nb-NO').includes(search)
  )) : queue;
  elements.queueFilterInfo.textContent = search ? `${visibleQueue.length} av ${queue.length} sanger` : '';
  elements.queueList.replaceChildren();

  if (visibleQueue.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const wrap = document.createElement('div');
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.append(text(search ? '⌕' : '♫'));
    const title = document.createElement('h3');
    title.append(text(search ? 'Ingen treff' : 'Køen er tom'));
    const description = document.createElement('p');
    description.append(text(search ? 'Prøv et annet søk.' : 'Bruk /play i Discord. Nye sanger dukker opp her automatisk.'));
    wrap.append(icon, title, description);
    empty.append(wrap);
    elements.queueList.append(empty);
    return;
  }

  for (const sang of visibleQueue) {
    const row = document.createElement('article');
    row.className = 'queue-row';
    const index = document.createElement('span');
    index.className = 'queue-index';
    index.append(text(String(sang.position).padStart(2, '0')));
    const cover = createCover(sang, 'queue-cover');
    const track = document.createElement('div');
    track.className = 'queue-track';
    const title = sang.url ? document.createElement('a') : document.createElement('strong');
    if (sang.url) {
      title.href = sang.url;
      title.target = '_blank';
      title.rel = 'noopener';
    }
    title.append(text(sang.title));
    const artist = document.createElement('span');
    artist.append(text(sang.artist || 'Ukjent artist'));
    track.append(title, artist);
    const requester = document.createElement('span');
    requester.className = 'queue-request';
    requester.append(text(sang.requestedBy ? `Lagt til av ${sang.requestedBy}` : 'Lagt til i Discord'));
    const duration = document.createElement('span');
    duration.className = 'queue-duration';
    duration.append(text(sang.isLive ? 'Direkte' : formatDuration(sang.length)));
    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    actions.append(
      queueButton('▶', 'Spill denne nå', 'jump', sang.position),
      queueButton('↑', 'Flytt opp', 'up', sang.position, sang.position === 1),
      queueButton('↓', 'Flytt ned', 'down', sang.position, sang.position === queue.length),
      queueButton('×', 'Fjern fra køen', 'remove', sang.position),
    );
    row.append(index, cover, track, requester, duration, actions);
    elements.queueList.append(row);
  }
};

const setFormValue = (name, value) => {
  const input = elements.settingsForm.elements.namedItem(name);
  if (!input) return;
  if (input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value;
};

const renderSettings = () => {
  if (!state.settings || settingsDirty || elements.settingsForm.contains(document.activeElement)) return;
  for (const [name, value] of Object.entries(state.settings)) {
    if (name !== 'updatedAt') setFormValue(name, value);
  }
  elements.settingsUpdated.textContent = `Sist lagret ${new Date(state.settings.updatedAt).toLocaleString('nb-NO')}`;
};

const renderSnapshots = () => {
  elements.snapshotList.replaceChildren();
  if (!state.snapshots?.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.append(text('Ingen lagrede snapshots.'));
    elements.snapshotList.append(empty);
    return;
  }

  for (const snapshot of state.snapshots) {
    const row = document.createElement('div');
    row.className = 'snapshot-row';
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.append(text(snapshot.name));
    const meta = document.createElement('small');
    meta.append(text(`${snapshot.songCount} sanger · ${formatRuntime(snapshot.duration)} · ${new Date(snapshot.createdAt).toLocaleDateString('nb-NO')}`));
    copy.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'snapshot-actions';
    for (const [label, action] of [['Legg til', 'append'], ['Erstatt', 'replace'], ['Slett', 'delete']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `button ${action === 'delete' ? 'ghost danger-text' : 'secondary'}`;
      button.dataset.snapshotAction = action;
      button.dataset.snapshotId = snapshot.id;
      button.append(text(label));
      actions.append(button);
    }
    row.append(copy, actions);
    elements.snapshotList.append(row);
  }
};

const renderTools = () => {
  const timerRemaining = state.sleepTimerEndsAt ? Math.max(0, (state.sleepTimerEndsAt - Date.now()) / 1000) : 0;
  elements.sleepTimerStatus.textContent = timerRemaining > 0 ? `${formatRuntime(timerRemaining)} igjen` : 'Ingen aktiv timer';
  elements.cancelSleep.disabled = timerRemaining <= 0;
  renderSnapshots();

  elements.activityList.replaceChildren();
  if (!state.activity?.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.append(text('Ingen handlinger ennå.'));
    elements.activityList.append(empty);
    return;
  }
  for (const entry of state.activity.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    const label = document.createElement('span');
    label.append(text(entry.text));
    const time = document.createElement('time');
    time.dateTime = entry.at;
    time.append(text(new Date(entry.at).toLocaleTimeString('nb-NO', {hour: '2-digit', minute: '2-digit'})));
    row.append(label, time);
    elements.activityList.append(row);
  }
};

const renderPerformance = () => {
  if (!state.performance) return;
  const metric = state.performance;
  document.querySelector('#metric-ping').textContent = `${Math.max(0, Math.round(metric.websocketPingMs))} ms`;
  document.querySelector('#metric-cpu').textContent = `${metric.cpuPercent.toFixed(1)}%`;
  document.querySelector('#metric-load').textContent = `Systemlast ${metric.loadAverage1m.toFixed(2)}`;
  document.querySelector('#metric-memory').textContent = formatBytes(metric.rssBytes);
  document.querySelector('#metric-heap').textContent = `Heap ${formatBytes(metric.heapUsedBytes)}`;
  document.querySelector('#metric-uptime').textContent = formatRuntime(metric.uptimeSeconds);
  document.querySelector('#metric-status').textContent = state.bot.ready ? 'Gutta Krutt kjører normalt' : 'Discord er ikke klar';
  document.querySelector('#metric-event-loop').textContent = `${metric.eventLoopP95Ms.toFixed(1)} ms`;
  document.querySelector('#metric-response').textContent = `${metric.averageResponseMs.toFixed(1)} ms`;
  document.querySelector('#metric-requests').textContent = metric.requestCount.toLocaleString('nb-NO');
  document.querySelector('#health-discord').textContent = state.bot.ready ? 'På nett' : 'Frakoblet';
  document.querySelector('#health-voice').textContent = state.player?.connected ? 'Tilkoblet' : 'Frakoblet';
  document.querySelector('#health-guilds').textContent = state.bot.guildCount;
};

const render = () => {
  renderGuilds();
  renderConnection();
  renderPlayer();
  renderQueue();
  renderSettings();
  renderTools();
  renderPerformance();
};

const refresh = async ({silent = true} = {}) => {
  if(!isAuthenticated)return;
  if (isRefreshing || pendingActions > 0) return;
  const generation = stateGeneration;
  isRefreshing = true;
  try {
    const selected = elements.guildSelect.value || localStorage.getItem('gutta-guild') || '';
    const next = await api(`/api/state${selected ? `?guildId=${encodeURIComponent(selected)}` : ''}`);
    if (generation !== stateGeneration) return;
    state = next;
    if (state.guildId) localStorage.setItem('gutta-guild', state.guildId);
    render();
  } catch (error) {
    elements.connectionPill.classList.add('is-offline');
    elements.connectionLabel.textContent = 'Panelet svarer ikke';
    if (!silent) showToast(error.message, true);
  } finally {
    isRefreshing = false;
  }
};

const playerAction = async (action, extra = {}, successMessage = '') => {
  if (!state?.guildId || pendingActions > 0) return false;
  pendingActions++;
  stateGeneration++;
  try {
    state = await api('/api/player', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action, guildId: state.guildId, queueRevision: state.player?.queueRevision, ...extra}),
    });
    render();
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    showToast(error.message, true);
    return false;
  } finally {
    pendingActions--;
    stateGeneration++;
    void refresh();
  }
};

const activateTab = (name) => {
  document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('is-active', item.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('is-active', panel.id === `panel-${name}`));
};

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-player-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.playerAction;
  if (action === 'loop-sang') playerAction(action, {value: !state.player.loopCurrentSong});
  else if (action === 'seek-relative') playerAction(action, {seconds: Number(button.dataset.seconds)});
  else if (action === 'clear' && state.player.queue.length > 0 && !window.confirm('Vil du tømme resten av køen?')) return;
  else playerAction(action);
});

elements.queueList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-queue-action]');
  if (!button || button.disabled) return;
  const position = Number(button.dataset.position);
  if (button.dataset.queueAction === 'jump') playerAction('jump', {position});
  if (button.dataset.queueAction === 'remove') playerAction('remove', {position});
  if (button.dataset.queueAction === 'up') playerAction('move', {from: position, to: position - 1});
  if (button.dataset.queueAction === 'down') playerAction('move', {from: position, to: position + 1});
});

elements.queueSearch.addEventListener('input', renderQueue);
elements.guildSelect.addEventListener('change', () => {
  localStorage.setItem('gutta-guild', elements.guildSelect.value);
  settingsDirty = false;
  elements.queueSearch.value = '';
  refresh({silent: false});
});

elements.loopQueue.addEventListener('change', () => playerAction('loop-queue', {value: elements.loopQueue.checked}));
elements.seekSlider.addEventListener('input', () => { elements.elapsed.textContent = formatDuration(Number(elements.seekSlider.value)); });
elements.seekSlider.addEventListener('change', () => playerAction('seek', {seconds: Number(elements.seekSlider.value)}));

elements.volume.addEventListener('input', () => {
  elements.volumeValue.textContent = `${elements.volume.value}%`;
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => playerAction('volume', {value: Number(elements.volume.value)}), 180);
});

document.querySelectorAll('[data-sleep-minutes]').forEach((button) => button.addEventListener('click', () => (
  playerAction('sleep-timer', {minutes: Number(button.dataset.sleepMinutes)}, `Stopptimer satt til ${button.dataset.sleepMinutes} minutter.`)
)));
elements.cancelSleep.addEventListener('click', () => playerAction('cancel-sleep-timer', {}, 'Stopptimeren er avbrutt.'));

elements.snapshotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!elements.snapshotForm.reportValidity()) return;
  if (await playerAction('snapshot-save', {name: elements.snapshotName.value}, 'Køen er lagret.')) {
    elements.snapshotName.value = '';
  }
});

elements.snapshotList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-snapshot-action]');
  if (!button) return;
  const id = button.dataset.snapshotId;
  const action = button.dataset.snapshotAction;
  if (action === 'delete') {
    if (window.confirm('Vil du slette dette kø-snapshotet?')) playerAction('snapshot-delete', {id}, 'Snapshotet er slettet.');
  } else if (action === 'replace') {
    if (window.confirm('Vil du erstatte resten av køen med dette snapshotet?')) playerAction('snapshot-restore', {id, replace: true}, 'Køen er gjenopprettet.');
  } else {
    playerAction('snapshot-restore', {id, replace: false}, 'Snapshotet er lagt til i køen.');
  }
});

elements.settingsForm.addEventListener('input', () => {
  settingsDirty = true;
  elements.settingsStatus.textContent = 'Du har endringer som ikke er lagret.';
});

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state?.guildId || pendingActions > 0 || !elements.settingsForm.reportValidity()) return;
  const form = new FormData(elements.settingsForm);
  const payload = {
    guildId: state.guildId,
    playlistLimit: Number(form.get('playlistLimit')),
    defaultQueuePageSize: Number(form.get('defaultQueuePageSize')),
    defaultVolume: Number(form.get('defaultVolume')),
    audioBitrateKbps: Number(form.get('audioBitrateKbps')),
    secondsToWaitAfterQueueEmpties: Number(form.get('secondsToWaitAfterQueueEmpties')),
    turnDownVolumeWhenPeopleSpeakTarget: Number(form.get('turnDownVolumeWhenPeopleSpeakTarget')),
    queueAddResponseEphemeral: form.get('queueAddResponseEphemeral') === 'on',
    autoAnnounceNextSong: form.get('autoAnnounceNextSong') === 'on',
    turnDownVolumeWhenPeopleSpeak: form.get('turnDownVolumeWhenPeopleSpeak') === 'on',
    leaveIfNoListeners: form.get('leaveIfNoListeners') === 'on',
  };

  pendingActions++;
  stateGeneration++;
  try {
    const result = await api('/api/settings', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    state.settings = result.settings;
    settingsDirty = false;
    elements.settingsStatus.textContent = 'Endringene er lagret i Afterparty-databasen.';
    renderSettings();
    showToast('Innstillingene er lagret.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    pendingActions--;
    stateGeneration++;
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
  if (event.key === ' ') {
    event.preventDefault();
    playerAction(state?.player?.status === 'playing' ? 'pause' : 'resume');
  }
  if (event.key.toLowerCase() === 'n') playerAction('skip');
  if (event.key.toLowerCase() === 's') playerAction('shuffle');
  if (event.key === 'ArrowLeft') playerAction('seek-relative', {seconds: -15});
  if (event.key === 'ArrowRight') playerAction('seek-relative', {seconds: 15});
  if (event.key === '/') {
    event.preventDefault();
    activateTab('queue');
    elements.queueSearch.focus();
  }
});

let refreshTimer;
const scheduleRefresh = () => {
  window.clearTimeout(refreshTimer);
  if(!isAuthenticated)return;
  refreshTimer = window.setTimeout(async () => {
    await refresh();
    scheduleRefresh();
  }, document.hidden ? 15000 : 3000);
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
  scheduleRefresh();
});

const sessionReady = api('/api/session').then(data=>{isAuthenticated=data.authenticated;document.body.classList.toggle('needs-login',!isAuthenticated);if(isAuthenticated){void refresh({silent:false});scheduleRefresh();}}).catch(error=>{document.querySelector('#login-error').textContent=error.message;});
 document.querySelector('#login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;document.querySelector('#login-error').textContent='';try{await api('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.querySelector('#login-password').value})});document.querySelector('#login-password').value='';isAuthenticated=true;document.body.classList.remove('needs-login');await refresh({silent:false});scheduleRefresh();}catch(error){document.querySelector('#login-error').textContent=error.message;}finally{button.disabled=false;}});
 document.querySelector('#logout').addEventListener('click',async()=>{try{await api('/api/session',{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});location.reload();}catch(error){showToast(error.message,true);}});

let publicLoading = false;
const refreshPublicRooms = async () => {
  if (publicLoading) return;
  publicLoading = true;
  const status = document.querySelector('#public-status');
  const list = document.querySelector('#public-rooms');
  status.textContent = 'Henter aktive rom ...';
  try {
    const data = await api('/api/public-rooms');
    list.replaceChildren();
    status.textContent = data.rooms.length ? `${data.rooms.length} aktive rom` : 'Ingen aktive publikumsrom akkurat nå.';
    for (const room of data.rooms) {
      const article = document.createElement('article'); article.className = 'public-room';
      const copy = document.createElement('div');
      const code = document.createElement('small'); code.textContent = `${room.code} · ${room.viewers} nettlesere`;
      const title = document.createElement('h3'); title.textContent = room.name;
      const sang = document.createElement('p'); sang.textContent = `${room.current?.title || 'Ingen video valgt'} · ${room.queue.length} i kø`;
      copy.append(code,title,sang);
      const actions = document.createElement('div'); actions.className = 'public-room-actions';
      const visit = document.createElement('a'); visit.className = 'button secondary'; visit.textContent = 'Se rommet ↗'; visit.href = `${data.publicUrl}/?room=${encodeURIComponent(room.code)}`; visit.target = '_blank'; visit.rel = 'noopener noreferrer';
      const close = document.createElement('button'); close.className = 'button ghost danger-text'; close.textContent = 'Avslutt rom';
      close.addEventListener('click', async () => {
        if (!window.confirm('Avslutt dette rommet for alle som er inne?')) return;
        close.disabled = true;
        try {await api('/api/public-rooms',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:room.code})}); await refreshPublicRooms();} catch(error) {showToast(error.message,true);} finally {close.disabled=false;}
      });
      if(room.mode==='discord')actions.append(visit);else actions.append(visit,close); article.append(copy,actions); list.append(article);
    }
  } catch (error) {status.textContent = error.message;} finally {publicLoading=false;}
};
document.querySelector('[data-tab="public"]').addEventListener('click',()=>void refreshPublicRooms());
document.querySelector('#public-refresh').addEventListener('click',()=>void refreshPublicRooms());
