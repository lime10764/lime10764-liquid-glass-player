// ===== CONFIG =====
const MUSIC_REPO = 'lime10764/music';
const MUSIC_BRANCH = 'main';
const CDN_BASE = `https://cdn.jsdelivr.net/gh/${MUSIC_REPO}@${MUSIC_BRANCH}`;
const JSDLIST_URL = `https://cdn.jsdelivr.net/gh/${MUSIC_REPO}@${MUSIC_BRANCH}/`;

const AUDIO_EXTS = [
  'mp3','flac','wav','ogg','oga','m4a','aac',
  'opus','webm','wma','aiff','aif','ape','wv','caf','alac'
];

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
  progressGlow: document.getElementById('progress-glow'),
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

// ===== SCAN MUSIC LIBRARY (PURE AUTO) =====
async function scanMusicLibrary() {
  DOM.statusText.textContent = 'Scanning music library...';
  try {
    const res = await fetch(JSDLIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = await res.json();

    const audioFiles = files.filter(f => {
      if (!f.name) return false;
      const ext = f.name.split('.').pop().toLowerCase();
      return AUDIO_EXTS.includes(ext);
    });

    if (audioFiles.length === 0) {
      DOM.statusText.textContent = 'No audio files found. Upload music to the music repo.';
      return;
    }

    tracks = audioFiles.map((f, i) => {
      const nameWithoutExt = f.name.replace(/\.[^.]+$/, '');
      return {
        title: nameWithoutExt,
        artist: 'Unknown',
        file: f.name,
        src: `${CDN_BASE}/${encodeURIComponent(f.name)}`
      };
    });

    renderLibrary();
    DOM.statusText.textContent = `${tracks.length} tracks loaded`;
    DOM.trackCount.textContent = `${tracks.length} tracks`;

    // Auto-play first track
    if (tracks.length > 0) {
      playTrack(0);
    }
  } catch (e) {
    console.error('Scan failed:', e);
    DOM.statusText.textContent = 'Failed to scan. Check music repo & jsDelivr.';
  }
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

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, c => map[c]);
}

// ===== PLAYBACK =====
function playTrack(index) {
  if (index < 0 || index >= tracks.length) return;
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
  if (audio.currentTime > 3) {
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

// ===== UTILS =====
function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ===== START =====
scanMusicLibrary();
