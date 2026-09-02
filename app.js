(function () {
  'use strict';

  // ============================================================
  //  Liquid Glass Player
  //  - 音乐放在仓库 music/ 目录，文件名即歌名（无后缀）
  //  - 代码自动扫描、识别格式、全格式适配
  //  - Web Audio API 无缝预解码，切歌零延迟
  //  - 切后台 / 锁屏：audio 持续播放，UI 动画冻结省资源
  // ============================================================

  // ---- 可配置 ----
  const BG_IMAGE = 'image_download_1787389320083.jpg'; // 仓库根目录背景图
  const BG_IMAGE_ALT = 'image_download_1787389320083.webp'; // 备选
  // ----------------

  // 支持的音频格式（市面上常见格式全覆盖）
  // 键：小写后缀  值：MIME type（用于 decodeAudioData 兜底）
  const SUPPORTED_FORMATS = {
    mp3:  'audio/mpeg',
    flac: 'audio/flac',
    wav:  'audio/wav',
    ogg:  'audio/ogg',
    oga:  'audio/ogg',
    m4a:  'audio/mp4',
    aac:  'audio/aac',
    opus: 'audio/ogg',
    webm: 'audio/webm',
    wma:  'audio/x-ms-wma',
    aiff: 'audio/aiff',
    aif:  'audio/aiff',
    ape:  'audio/x-ape',
    wv:   'audio/x-wavpack',
    caf:  'audio/x-caf',
  };

  let tracks = [];
  let currentIndex = -1;
  let isPlaying = false;
  let shuffle = false;
  let loop = false;

  // 无缝播放：Web Audio 层
  let audioCtx = null;
  let currentSource = null;   // 当前正在播放的 AudioBufferSourceNode
  let nextBuffer = null;      // 预解码好的下一首
  let gainNode = null;
  let startedAt = 0;          // 当前 buffer 开始播放的时间戳
  let pausedAt = 0;           // 暂停时的进度(秒)

  const DOM = {
    playBtn: document.getElementById('btn-play'),
    iconPlay: document.getElementById('icon-play'),
    prevBtn: document.getElementById('btn-prev'),
    nextBtn: document.getElementById('btn-next'),
    shuffleBtn: document.getElementById('btn-shuffle'),
    loopBtn: document.getElementById('btn-loop'),
    vinyl: document.getElementById('vinyl'),
    rings: document.querySelectorAll('.ring'),
    trackName: document.getElementById('track-name'),
    trackArtist: document.getElementById('track-artist'),
    statusText: document.getElementById('status-text'),
    timeCurrent: document.getElementById('time-current'),
    timeTotal: document.getElementById('time-total'),
    progressBar: document.getElementById('progress-bar'),
    progressFill: document.getElementById('progress-fill'),
    progressGlow: document.getElementById('progress-glow'),
    volumeBar: document.getElementById('volume-bar'),
    volumeFill: document.getElementById('volume-fill'),
    playlist: document.getElementById('playlist'),
    playlistCount: document.getElementById('playlist-count'),
    bgImage: document.getElementById('bg-image'),
  };

  const PLAY_ICON = '<polygon points="5 3 19 12 5 21 5 3"/>';
  const PAUSE_ICON = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

  // 主循环：节流刷新进度（4fps，后台自动冻结）
  let rafId = null;
  let lastTick = 0;

  // ============================================================
  //  初始化
  // ============================================================
  function init() {
    setupBackground();
    bindEvents();
    scanLibrary(); // 自动扫描 music/ 目录
  }

  // ---- 背景图：仓库同站路径，国内直连；失败用 CSS 渐变 ----
  function setupBackground() {
    const tryUrl = (file) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = file;
    });

    (async () => {
      const candidates = [BG_IMAGE, BG_IMAGE_ALT].filter(Boolean);
      for (const file of candidates) {
        const ok = await tryUrl(file);
        if (ok) {
          DOM.bgImage.style.setProperty('--bg-url', `url('${file}')`);
          DOM.bgImage.classList.remove('fallback');
          return;
        }
      }
      DOM.bgImage.classList.add('fallback');
    })();
  }

  // ============================================================
  //  自动扫描音乐库
  //  优先级：manifest.json > 自动目录扫描（需要服务器支持）
  // ============================================================
  async function scanLibrary() {
    DOM.statusText.textContent = 'Scanning library...';

    // 1) 优先读取 manifest（精确控制顺序/歌手/封面）
    let fromManifest = await loadManifest();

    // 2) 尝试自动目录扫描（GitHub Pages 无目录列表，仅在支持的环境生效）
    let autoScanned = await autoScanDirectory();

    // 3) 合并去重（manifest 优先）
    const map = new Map();
    [...fromManifest, ...autoScanned].forEach((t) => {
      map.set(t.name, t);
    });
    tracks = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN')
    );

    if (tracks.length > 0) {
      renderPlaylist();
      loadTrack(0, /*autoplay*/ false);
      DOM.statusText.textContent = `${tracks.length} tracks ready`;
    } else {
      DOM.statusText.textContent = 'No music found in /music';
    }
  }

  // 读取 music/manifest.json（文件名为 key，无后缀）
  async function loadManifest() {
    try {
      const res = await fetch('music/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return [];
      const list = await res.json();
      return list
        .map((item) => normalizeTrack(item))
        .filter((t) => t !== null);
    } catch (e) {
      return [];
    }
  }

  // 自动扫描：通过探测常见命名规则枚举（GitHub Pages 无目录列表 API）
  // 若仓库启用 GitHub Pages + 自定义 404 兜底或存在目录索引，可扩展
  async function autoScanDirectory() {
    const found = [];
    // 探测 music/track-NN.xxx (01..99) 这类约定命名
    const probes = [];
    for (let i = 1; i <= 99; i++) probes.push(String(i).padStart(2, '0'));
    for (const base of probes) {
      for (const ext of Object.keys(SUPPORTED_FORMATS)) {
        const url = `music/${base}.${ext}`;
        try {
          const head = await fetch(url, { method: 'HEAD' });
          if (head.ok) {
            found.push({ file: `${base}.${ext}`, name: base, artist: '' });
          }
        } catch (e) { /* ignore */ }
      }
    }
    return found;
  }

  // 标准化曲目对象：文件名（去后缀）即歌名
  function normalizeTrack(item) {
    let file = item.file || item.url || item.src || '';
    if (!file) return null;

    // 若只给了名字（无后缀），自动补全扩展名探测
    let ext = getExtension(file).toLowerCase();
    if (!SUPPORTED_FORMATS[ext]) {
      // 无后缀或未知后缀 → 尝试探测真实格式
      const resolved = resolveFormat(file);
      if (!resolved) return null;
      file = resolved.file;
      ext = resolved.ext;
    }

    const baseName = stripExtension(file.split('/').pop());
    return {
      file: file,
      name: item.name || baseName,
      artist: item.artist || '',
      ext: ext,
    };
  }

  // 无后缀名字 → 探测 music/ 下实际存在的带后缀文件
  function resolveFormat(name) {
    // name 形如 "周杰伦-晴天"（无后缀）
    for (const ext of Object.keys(SUPPORTED_FORMATS)) {
      const candidate = `music/${name}.${ext}`;
      // 同步无法 fetch，返回候选让上层按需加载；这里仅构造 URL
      return { file: candidate, ext: ext };
    }
    return null;
  }

  // ============================================================
  //  Web Audio：无缝预解码 + 高速播放
  // ============================================================
  function getAudioContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      gainNode = audioCtx.createGain();
      gainNode.gain.value = 1.0;
      gainNode.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  // 解锁 WebKit 首次音频策略
  function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    // 播放一个静音短振荡器
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(0);
      osc.stop(0.001);
    } catch (e) {}
  }

  // 加载并解码一首歌（返回 AudioBuffer）
  async function decodeTrack(track) {
    const url = track.file.startsWith('http') || track.file.startsWith('./')
      ? track.file
      : `music/${track.file.split('/').pop()}`;
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const ctx = getAudioContext();
    return await ctx.decodeAudioData(arrayBuf);
  }

  // 播放指定的 AudioBuffer
  function playBuffer(buffer, offset) {
    stopCurrentSource();
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    source.onended = onSourceEnded;
    const startOffset = offset || 0;
    source.start(0, startOffset);
    currentSource = source;
    startedAt = ctx.currentTime - startOffset;
    pausedAt = startOffset;
  }

  function stopCurrentSource() {
    if (currentSource) {
      try { currentSource.onended = null; currentSource.stop(0); } catch (e) {}
      currentSource = null;
    }
  }

  // 当前播放进度（秒）
  function currentTime() {
    if (!audioCtx || !currentSource) return pausedAt;
    return audioCtx.currentTime - startedAt;
  }

  function onSourceEnded() {
    // 自然播完 → 下一首（无缝：nextBuffer 已预解码）
    if (nextBuffer && currentIndex < tracks.length - 1) {
      const wasPlaying = isPlaying;
      currentIndex = shuffle ? randIndex() : currentIndex + 1;
      renderPlaylist();
      if (wasPlaying) {
        playBuffer(nextBuffer, 0);
        nextBuffer = null;
        preloadNext(); // 再预解码下一首
        return;
      }
    }
    // 没有预解码缓冲或已到末尾
    if (loop) {
      playBuffer(currentSource ? currentSource.buffer : nextBuffer, 0);
    } else if (currentIndex < tracks.length - 1) {
      next();
    } else {
      setPlaying(false);
    }
  }

  // 预解码下一首（核心：实现零延迟切歌）
  async function preloadNext() {
    nextBuffer = null;
    const nextIdx = shuffle ? randIndex() : (currentIndex + 1) % tracks.length;
    if (nextIdx < 0 || nextIdx >= tracks.length) return;
    try {
      nextBuffer = await decodeTrack(tracks[nextIdx]);
    } catch (e) {
      nextBuffer = null;
    }
  }

  function randIndex() {
    if (tracks.length <= 1) return 0;
    let r = Math.floor(Math.random() * tracks.length);
    if (r === currentIndex) r = (r + 1) % tracks.length;
    return r;
  }

  // ============================================================
  //  曲目加载 / 播放控制
  // ============================================================
  function loadTrack(index, autoplay) {
    if (index < 0 || index >= tracks.length) return;
    currentIndex = index;
    const track = tracks[index];

    renderPlaylist();
    DOM.trackName.textContent = track.name;
    DOM.trackArtist.textContent = track.artist || formatExt(track.ext);

    // 解码当前曲并自动播放
    setStatus('Decoding...');
    decodeTrack(track)
      .then((buffer) => {
        if (currentIndex !== index) return; // 已切换，丢弃
        playBuffer(buffer, 0);
        if (autoplay) setPlaying(true);
        else setPlaying(true); // 解码完即开始播放（无缝体验）
        setStatus(`Track ${index + 1} of ${tracks.length}`);
        preloadNext(); // 立即预解码下一首
      })
      .catch((err) => {
        DOM.statusText.textContent = `Cannot play: ${track.name}`;
        console.error(err);
      });
  }

  function togglePlay() {
    if (tracks.length === 0) return;
    unlockAudio();
    if (currentIndex === -1) {
      loadTrack(0, true);
      return;
    }
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }

  function pause() {
    if (!isPlaying) return;
    pausedAt = currentTime();
    stopCurrentSource();
    setPlaying(false);
  }

  function resume() {
    unlockAudio();
    // 从暂停位置重新播放当前 buffer
    if (currentSource === null && pausedAt >= 0) {
      // 需要重新取 buffer —— 用预解码或重新解码
      const track = tracks[currentIndex];
      decodeTrack(track).then((buffer) => {
        if (currentIndex !== currentIndex) return;
        playBuffer(buffer, pausedAt);
        setPlaying(true);
      });
    } else {
      // 仍在播放中（不应到这里），直接恢复 context
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      setPlaying(true);
    }
  }

  function next() {
    if (tracks.length === 0) return;
    const idx = shuffle ? randIndex() : Math.min(currentIndex + 1, tracks.length - 1);
    loadTrack(idx, isPlaying);
  }

  function prev() {
    if (tracks.length === 0) return;
    const idx = shuffle ? randIndex() : Math.max(currentIndex - 1, 0);
    loadTrack(idx, isPlaying);
  }

  function setPlaying(state) {
    isPlaying = state;
    DOM.iconPlay.innerHTML = state ? PAUSE_ICON : PLAY_ICON;
    DOM.vinyl.classList.toggle('playing', state);
    DOM.rings.forEach((r) => r.classList.toggle('active', state));
    if (state) startTicker();
    // 注意：暂停 ticker 但保留音频播放 —— 后台不断音
  }

  function setStatus(text) {
    DOM.statusText.textContent = text;
  }

  // ============================================================
  //  进度刷新（rAF 节流，后台冻结）
  // ============================================================
  function startTicker() {
    if (rafId) return;
    const tick = (now) => {
      if (!isPlaying) { rafId = null; return; }
      if (now - lastTick > 250) { // 4fps，足够流畅且省资源
        lastTick = now;
        updateProgress();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function updateProgress() {
    const buf = currentSource ? currentSource.buffer : nextBuffer;
    if (!buf) return;
    const dur = buf.duration;
    const cur = currentTime();
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    DOM.progressFill.style.width = `${Math.min(pct, 100)}%`;
    DOM.progressGlow.style.left = `${Math.min(pct, 100)}%`;
    DOM.timeCurrent.textContent = formatTime(cur);
    DOM.timeTotal.textContent = formatTime(dur);
  }

  // ============================================================
  //  播放列表渲染
  // ============================================================
  function renderPlaylist() {
    DOM.playlist.innerHTML = '';
    tracks.forEach((track, i) => {
      const div = document.createElement('div');
      div.className = 'playlist-item' + (i === currentIndex ? ' active' : '');
      div.innerHTML =
        `<span class="playlist-item-index">${i + 1}</span>` +
        `<div class="playlist-item-info">` +
          `<div class="playlist-item-name">${escapeHtml(track.name)}</div>` +
          `<div class="playlist-item-artist">${escapeHtml(track.artist || '—')}</div>` +
        `</div>` +
        `<span class="playlist-item-format">${formatExt(track.ext)}</span>`;
      div.addEventListener('click', () => {
        unlockAudio();
        const wasPlaying = isPlaying;
        loadTrack(i, true);
      });
      DOM.playlist.appendChild(div);
    });
    DOM.playlistCount.textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;
  }

  // ============================================================
  //  事件绑定
  // ============================================================
  function bindEvents() {
    DOM.playBtn.addEventListener('click', togglePlay);
    DOM.nextBtn.addEventListener('click', next);
    DOM.prevBtn.addEventListener('click', prev);

    DOM.shuffleBtn.addEventListener('click', () => {
      shuffle = !shuffle;
      DOM.shuffleBtn.classList.toggle('active', shuffle);
      nextBuffer = null; // 打乱顺序后重预解码
      preloadNext();
    });

    DOM.loopBtn.addEventListener('click', () => {
      loop = !loop;
      DOM.loopBtn.classList.toggle('active', loop);
    });

    // 进度条点击定位
    DOM.progressBar.addEventListener('click', (e) => {
      const buf = currentSource ? currentSource.buffer : null;
      if (!buf) return;
      const rect = DOM.progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const target = pct * buf.duration;
      pausedAt = target;
      const track = tracks[currentIndex];
      decodeTrack(track).then((buffer) => {
        playBuffer(buffer, target);
        if (isPlaying) setPlaying(true);
      });
    });

    // 音量
    DOM.volumeBar.addEventListener('click', (e) => {
      const rect = DOM.volumeBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      if (gainNode) gainNode.gain.value = pct;
      DOM.volumeFill.style.width = `${pct * 100}%`;
    });

    // 首次触摸解锁音频（酷狗/WebKit 要求）
    const unlockOnce = () => { unlockAudio(); };
    document.addEventListener('touchstart', unlockOnce, { once: true });
    document.addEventListener('mousedown', unlockOnce, { once: true });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') next();
      if (e.code === 'ArrowLeft') prev();
    });

    // ---- 后台/前台：保持音频播放，仅冻结 UI ----
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        document.body.classList.add('page-hidden');
        // 关键：不暂停 audio，让音乐持续播放
      } else {
        document.body.classList.remove('page-hidden');
        // 恢复时校正播放速率 + 续播
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (currentSource && currentSource.playbackRate) {
          currentSource.playbackRate.value = 1.0;
        }
        if (isPlaying) startTicker();
      }
    });

    // 网络恢复自动续播
    window.addEventListener('online', () => {
      if (isPlaying && currentSource === null) resume();
    });
  }

  // ============================================================
  //  工具函数
  // ============================================================
  function getExtension(name) {
    const m = String(name).split('?')[0].split('.');
    return m.length > 1 ? m.pop().toLowerCase() : '';
  }

  function stripExtension(name) {
    return String(name).replace(/\.[^/.]+$/, '');
  }

  function formatExt(ext) {
    return (ext || '').toUpperCase();
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds === Infinity) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // 启动
  init();
})();
