// ===== CONFIG =====
const MUSIC_REPO = 'lime10764/music';
const MUSIC_BRANCH = 'main';
const AUDIO_EXT = ['flac','mp3','wav','ogg','oga','m4a','aac','opus','webm','wma','aiff','aif','ape','wv','caf','alac'];
const GITHUB_API = `https://api.github.com/repos/${MUSIC_REPO}/contents/?ref=${MUSIC_BRANCH}`;
const JSDELIVR_DIR = `https://cdn.jsdelivr.net/gh/${MUSIC_REPO}@${MUSIC_BRANCH}/`;

// ===== STATE =====
let tracks = [];
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isLoop = false;
let audio = null;
let audioCtx = null;
let gainNode = null;

// ===== DOM =====
const DOM = {
  statusText: document.getElementById('status-text'),
  trackName: document.getElementById('track-name'),
  trackArtist: document.getElementById('track-artist'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  progressBar: document.getElementById('progress-bar'),
  progressFill: document.getElementById('progress-fill'),
  btnPlay: document.getElementById('btn-play'),
  iconPlay: document.getElementById('icon-play'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnShuffle: document.getElementById('btn-shuffle'),
  btnLoop: document.getElementById('btn-loop'),
  vinyl: document.getElementById('vinyl'),
  playlist: document.getElementById('playlist'),
  trackCount: document.getElementById('track-count'),
  volumeBar: document.getElementById('volume-bar'),
  volumeFill: document.getElementById('volume-fill'),
};

// ===== UTILS =====
function isAudioFile(name) {
  const ext = name.split('.').pop().toLowerCase();
  return AUDIO_EXT.includes(ext);
}
function buildUrl(path) { return `${JSDELIVR_DIR}${encodeURIComponent(path)}`; }
function parseName(file) {
  const base = file.replace(/\.[^.]+$/, '');
  const parts = base.split('-').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0], artist: parts.slice(1).join(' / ') };
  return { title: base, artist: 'Unknown' };
}
function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, c => map[c]);
}

// ===== AUDIO INIT =====
function initAudio() {
  if (audio) return;
  audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'metadata';
  audio.volume = 0.8;

  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    audioCtx = new AC();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = audio.volume;
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  }

  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('loadedmetadata', onLoadedMetadata);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onAudioError);
  audio.addEventListener('play', () => { isPlaying = true; updatePlayBtn(); DOM.vinyl.classList.add('spinning'); });
  audio.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); DOM.vinyl.classList.remove('spinning'); });
}

function unlockAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function onTimeUpdate() {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  DOM.progressFill.style.width = pct + '%';
  DOM.timeCurrent.textContent = formatTime(audio.currentTime);
}
function onLoadedMetadata() { DOM.timeTotal.textContent = formatTime(audio.duration); }
function onEnded() { if (isLoop) { audio.currentTime = 0; audio.play(); } else playNext(); }
function onAudioError(e) {
  console.error('Audio error:', e);
  DOM.statusText.textContent = 'Playback error, skipping...';
  setTimeout(playNext, 1500);
}

// ===== SCAN =====
async function scanMusicLibrary() {
  DOM.statusText.textContent = 'Scanning music library...';

  // Layer 1: GitHub API
  try {
    const res = await fetch(GITHUB_API, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (res.ok) {
      const data = await res.json();
      const files = data.filter(f => f.type === 'file' && isAudioFile(f.name));
      if (files.length > 0) { buildTracks(files.map(f => f.name)); return; }
    }
  } catch (e) { console.warn('Layer 1 failed:', e); }

  // Layer 2: jsDelivr dir
  try {
    const res = await fetch(JSDELIVR_DIR);
    if (res.ok) {
      const html = await res.text();
      const matches = [...html.matchAll(/href="([^"/]+\.[^"/]+)"/g)].map(m => m[1]);
      const files = matches.filter(isAudioFile);
      if (files.length > 0) { buildTracks(files); return; }
    }
  } catch (e) { console.warn('Layer 2 failed:', e); }

  // Layer 3: manifest.json
  try {
    const res = await fetch(buildUrl('manifest.json'));
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        tracks = data.map(item => ({
          file: item.file,
          src: buildUrl(item.file),
          title: item.title || item.file.replace(/\.[^.]+$/, ''),
          artist: item.artist || 'Unknown'
        }));
        finishScan();
        return;
      }
    }
  } catch (e) { console.warn('Layer 3 failed:', e); }

  DOM.statusText.textContent = 'No tracks found. Upload music to the music repo.';
  DOM.trackCount.textContent = '0 tracks';
}

function buildTracks(fileList) {
  tracks = fileList.map(name => ({ file: name, src: buildUrl(name), ...parseName(name) }));
  finishScan();
}

function finishScan() {
  renderLibrary();  // 关键：扫描完立刻渲染【全部】歌单
  DOM.trackCount.textContent = `${tracks.length} tracks`;
  DOM.statusText.textContent = `${tracks.length} tracks — tap ▶ to play`;
  if (tracks.length > 0) {
    currentIndex = 0;
    updateNowPlayingInfo();
  }
}

// ===== RENDER LIBRARY（渲染全部曲目）=====
function renderLibrary() {
  DOM.playlist.innerHTML = '';
  tracks.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'playlist-item';
    if (i === currentIndex) div.classList.add('active');  // 当前播放高亮
    div.innerHTML = `
      <span class="item-num">${String(i + 1).padStart(2, '0')}</span>
      <div class="item-info">
        <div class="item-name">${escapeHtml(t.title)}</div>
        <div class="item-artist">${escapeHtml(t.artist)}</div>
      </div>
      <span class="item-dur">--</span>`;
    div.addEventListener('click', () => { initAudio(); unlockAudio(); playTrack(i); });
    DOM.playlist.appendChild(div);
  });
}

// 只更新当前播放的歌名/歌手 + 列表高亮（不重建整个列表，避免闪烁）
function refreshActive() {
  [...DOM.playlist.children].forEach((el, i) => {
    el.classList.toggle('active', i === currentIndex);
  });
  updateNowPlayingInfo();
}

function updateNowPlayingInfo() {
  if (currentIndex < 0 || currentIndex >= tracks.length) return;
  const t = tracks[currentIndex];
  DOM.trackName.textContent = t.title;
  DOM.trackArtist.textContent = t.artist;
}

// ===== PLAYBACK =====
function playTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  initAudio();
  unlockAudio();

  // 同一首：只继续播，不重新加载
  const track = tracks[index];
  if (currentIndex !== index || !audio.src || audio.src.indexOf(track.file) === -1) {
    currentIndex = index;
    DOM.timeCurrent.textContent = '0:00';
    DOM.timeTotal.textContent = '0:00';
    DOM.progressFill.style.width = '0%';
    audio.src = track.src;
    audio.load();
  }
  const p = audio.play();
  if (p && p.then) {
    p.then(() => { DOM.statusText.textContent = 'Now playing'; })
     .catch(e => { console.error(e); DOM.statusText.textContent = 'Tap ▶ to play'; });
  }
  refreshActive();  // 切换后立即更新歌名 + 列表高亮
}

function playNext() {
  if (tracks.length === 0) return;
  let next = isShuffle ? Math.floor(Math.random() * tracks.length) : (currentIndex + 1) % tracks.length;
  playTrack(next);
}
function playPrev() {
  if (tracks.length === 0) return;
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prev = currentIndex - 1;
  if (prev < 0) prev = tracks.length - 1;
  playTrack(prev);
}

// ===== CONTROLS =====
function updatePlayBtn() {
  DOM.iconPlay.innerHTML = isPlaying
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="5 3 19 12 5 21 5 3"/>';
}

DOM.btnPlay.addEventListener('click', () => {
  initAudio(); unlockAudio();
  if (currentIndex < 0 && tracks.length > 0) { playTrack(0); return; }
  if (isPlaying) audio.pause();
  else if (currentIndex < 0) playTrack(0);
  else audio.play().catch(() => { DOM.statusText.textContent = 'Tap ▶ to play'; });
});
DOM.btnNext.addEventListener('click', () => { initAudio(); playNext(); });
DOM.btnPrev.addEventListener('click', () => { initAudio(); playPrev(); });
DOM.btnShuffle.addEventListener('click', () => { isShuffle = !isShuffle; DOM.btnShuffle.classList.toggle('active', isShuffle); });
DOM.btnLoop.addEventListener('click', () => { isLoop = !isLoop; DOM.btnLoop.classList.toggle('active', isLoop); if (audio) audio.loop = isLoop; });

// ===== 拖动工具（进度条 + 音量条）=====
function makeScrubbable(barEl, fillEl, onChange, onCommit) {
  let dragging = false;
  function pctFromEvent(e) {
    const rect = barEl.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }
  function start(e) {
    dragging = true;
    barEl.classList.add('scrubbing');
    const pct = pctFromEvent(e);
    fillEl.style.width = (pct * 100) + '%';
    if (onChange) onChange(pct);
    e.preventDefault();
  }
  function move(e) {
    if (!dragging) return;
    const pct = pctFromEvent(e);
    fillEl.style.width = (pct * 100) + '%';
    if (onChange) onChange(pct);
    e.preventDefault();
  }
  function end(e) {
    if (!dragging) return;
    dragging = false;
    barEl.classList.remove('scrubbing');
    const rect = barEl.getBoundingClientRect();
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (onCommit) onCommit(pct);
  }
  barEl.addEventListener('mousedown', start);
  barEl.addEventListener('touchstart', start, { passive: false });
  window.addEventListener('mousemove', move);
  barEl.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', end);
  barEl.addEventListener('touchend', end);
  barEl.addEventListener('touchcancel', end);
}

makeScrubbable(
  DOM.progressBar, DOM.progressFill,
  (pct) => { if (audio && audio.duration) DOM.timeCurrent.textContent = formatTime(pct * audio.duration); },
  (pct) => { if (audio && audio.duration) audio.currentTime = pct * audio.duration; }
);

makeScrubbable(
  DOM.volumeBar, DOM.volumeFill,
  (pct) => { if (audio) audio.volume = pct; if (gainNode) gainNode.gain.value = pct; },
  null
);

// ===== 键盘 =====
document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'Space': e.preventDefault(); DOM.btnPlay.click(); break;
    case 'ArrowLeft': initAudio(); playPrev(); break;
    case 'ArrowRight': initAudio(); playNext(); break;
  }
});

document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('page-hidden', document.hidden);
  if (!document.hidden && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});
window.addEventListener('online', () => { DOM.statusText.textContent = 'Back online'; if (isPlaying && audio) audio.play(); });
window.addEventListener('offline', () => { DOM.statusText.textContent = 'Offline'; });

// ===== START =====
scanMusicLibrary();
