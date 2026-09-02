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

function buildUrl(path) {
  return `${JSDELIVR_DIR}${path}`;
}

function parseName(file) {
  const base = file.replace(/\.[^.]+$/, '');
  const parts = base.split('-').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { title: parts[0], artist: parts.slice(1).join(' / ') };
  }
  return { title: base, artist: 'Unknown' };
}

function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
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

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
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

function onTimeUpdate() {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  DOM.progressFill.style.width = pct + '%';
  DOM.timeCurrent.textContent = formatTime(audio.currentTime);
}

function onLoadedMetadata() {
  DOM.timeTotal.textContent = formatTime(audio.duration);
}

function onEnded() {
  if (isLoop) {
    audio.currentTime = 0;
    audio.play();
  } else {
    playNext();
  }
}

function onAudioError(e) {
  console.error('Audio error:', e);
  DOM.statusText.textContent = 'Playback error, skipping...';
  setTimeout(playNext, 1500);
}

// ===== SCAN: 3-LAYER FALLBACK =====
async function scanMusicLibrary() {
  DOM.statusText.textContent = 'Scanning music library...';

  // --- Layer 1: GitHub API ---
  try {
    const res = await fetch(GITHUB_API, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (res.ok) {
      const data = await res.json();
      const files = data.filter(f => f.type === 'file' && isAudioFile(f.name));
      if (files.length > 0) {
        tracks = files.map(f => ({
          file: f.name,
          src: buildUrl(f.name),
          ...parseName(f.name)
        }));
        renderLibrary();
        DOM.statusText.textContent = `${tracks.length} tracks (GitHub API)`;
        DOM.trackCount.textContent = `${tracks.length} tracks`;
        if (tracks.length > 0) playTrack(0);
        return;
      }
    }
  } catch (e) {
    console.warn('Layer 1 (GitHub API) failed:', e);
  }

  // --- Layer 2: jsDelivr directory ---
  try {
    const res = await fetch(JSDELIVR_DIR);
    if (res.ok) {
      const html = await res.text();
      const matches = [...html.matchAll(/href="([^"/]+\.[^"/]+)"/g)].map(m => m[1]);
      const files = matches.filter(isAudioFile);
      if (files.length > 0) {
        tracks = files.map(name => ({
          file: name,
          src: buildUrl(name),
          ...parseName(name)
        }));
        renderLibrary();
        DOM.statusText.textContent = `${tracks.length} tracks (jsDelivr)`;
        DOM.trackCount.textContent = `${tracks.length} tracks`;
        if (tracks.length > 0) playTrack(0);
        return;
      }
    }
  } catch (e) {
    console.warn('Layer 2 (jsDelivr) failed:', e);
  }

  // --- Layer 3: manifest.json ---
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
        renderLibrary();
        DOM.statusText.textContent = `${tracks.length} tracks (manifest)`;
        DOM.trackCount.textContent = `${tracks.length} tracks`;
        if (tracks.length > 0) playTrack(0);
        return;
      }
    }
  } catch (e) {
    console.warn('Layer 3 (manifest) failed:', e);
  }

  // --- All failed ---
  DOM.statusText.textContent = 'No tracks found. Upload music to the music repo.';
  DOM.trackCount.textContent = '0 tracks';
}

// ===== RENDER =====
function renderLibrary() {
  DOM.playlist.innerHTML = '';
  tracks.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'playlist-item';
    if (i === currentIndex) div.classList.add('active');
    div.innerHTML = `
      <span class="item-num">${String(i + 1).padStart(2, '0')}</span>
      <div class="item-info">
        <div class="item-name">${escapeHtml(t.title)}</div>
        <div class="item-artist">${escapeHtml(t.artist)}</div>
      </div>
      <span class="item-dur">--</span>
    `;
    div.addEventListener('click', () => { initAudio(); playTrack(i); });
    DOM.playlist.appendChild(div);
  });
}

// ===== PLAYBACK =====
function playTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  currentIndex = index;
  const track = tracks[currentIndex];

  DOM.trackName.textContent = track.title;
  DOM.trackArtist.textContent = track.artist;
  DOM.timeCurrent.textContent = '0:00';
  DOM.timeTotal.textContent = '0:00';
  DOM.progressFill.style.width = '0%';

  audio.src = track.src;
  audio.load();
  audio.play().catch(e => {
    console.error('Play failed:', e);
    DOM.statusText.textContent = 'Tap to unlock audio';
  });

  renderLibrary();
}

function playNext() {
  if (tracks.length === 0) return;
  let next;
  if (isShuffle) {
    next = Math.floor(Math.random() * tracks.length);
  } else {
    next = (currentIndex + 1) % tracks.length;
  }
  playTrack(next);
}

function playPrev() {
  if (tracks.length === 0) return;
  if (audio && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
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
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (currentIndex < 0 && tracks.length > 0) { playTrack(0); return; }
  if (isPlaying) { audio.pause(); }
  else { audio.play().catch(() => { DOM.statusText.textContent = 'Tap to unlock audio'; }); }
});

DOM.btnNext.addEventListener('click', () => { initAudio(); playNext(); });
DOM.btnPrev.addEventListener('click', () => { initAudio(); playPrev(); });

DOM.btnShuffle.addEventListener('click', () => {
  isShuffle = !isShuffle;
  DOM.btnShuffle.classList.toggle('active', isShuffle);
});

DOM.btnLoop.addEventListener('click', () => {
  isLoop = !isLoop;
  DOM.btnLoop.classList.toggle('active', isLoop);
  if (audio) audio.loop = isLoop;
});

DOM.progressBar.addEventListener('click', (e) => {
  if (!audio || !audio.duration) return;
  const rect = DOM.progressBar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
});

DOM.volumeBar.addEventListener('click', (e) => {
  initAudio();
  const rect = DOM.volumeBar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.volume = pct;
  DOM.volumeFill.style.width = (pct * 100) + '%';
  if (gainNode) gainNode.gain.value = pct;
});

// Keyboard
document.addEventListener('keydown', (e) => {
  switch(e.code) {
    case 'Space': e.preventDefault(); DOM.btnPlay.click(); break;
    case 'ArrowLeft': initAudio(); playPrev(); break;
    case 'ArrowRight': initAudio(); playNext(); break;
  }
});

// Visibility
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('page-hidden', document.hidden);
  if (!document.hidden && audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
});

// Network
window.addEventListener('online', () => {
  DOM.statusText.textContent = 'Back online';
  if (isPlaying && audio) audio.play();
});
window.addEventListener('offline', () => {
  DOM.statusText.textContent = 'Offline';
});

// ===== START =====
scanMusicLibrary();
