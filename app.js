/* ============================================================
 * Liquid Glass Player - app.js
 * 音乐库独立于另一个仓库：https://github.com/lime10764/music
 * 本文件负责：自动扫描音乐库 + 全格式适配 + Web Audio 预解码（无延迟切歌）+ 后台不断音
 * ============================================================ */
(function () {
  'use strict';

  // ===== 配置：你的两个仓库 =====
  // 音乐库仓库（存放歌曲文件，文件名=歌名，无后缀）
  var MUSIC_USER = 'lime10764';
  var MUSIC_REPO = 'music';
  var MUSIC_BRANCH = 'main';
  // 背景图：优先从音乐仓库取（同站，国内直连）；失败降级为纯 CSS 渐变
  var BG_IMAGE = 'image_download_1787389320083.jpg';

  // 支持的音频格式（市面上常见格式全覆盖）
  var SUPPORTED_FORMATS = [
    'mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'opus',
    'webm', 'wma', 'aiff', 'aif', 'ape', 'wv', 'caf', 'alac'
  ];

  // 国内直连的 jsDelivr 镜像（jsdelivr 主域偶发抽风时切换）
  // 可用值：'cdn.jsdelivr.net'（官方）| 'jsd.cdn.zzko.cn'（国内镜像）
  var JSD_CDN = 'cdn.jsdelivr.net';

  // ===== 状态 =====
  var tracks = [];
  var currentIndex = -1;
  var isPlaying = false;
  var shuffle = false;
  var loop = false;

  // Web Audio 无缝播放
  var AC = window.AudioContext || window.webkitAudioContext;
  var audioCtx = null;
  var currentSource = null;       // 当前正在播的 AudioBufferSourceNode
  var nextBuffer = null;          // 预解码好的下一首
  var isWebAudioMode = false;     // 当前是否用 Web Audio 在播
  var startTime = 0;              // Web Audio 播放起始时间
  var pauseOffset = 0;            // 暂停时的进度
  var isPaused = false;
  var preloadIndex = -1;

  // 兼容模式（Web Audio 失败时用原生 <audio>）
  var htmlAudio = new Audio();
  htmlAudio.preload = 'auto';
  htmlAudio.crossOrigin = 'anonymous';

  // ===== DOM =====
  var DOM = {
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
    trackCount: document.getElementById('track-count'),
    bgLayer: document.getElementById('bg-layer'),
  };

  var PLAY_ICON = '<polygon points="5 3 19 12 5 21 5 3"/>';
  var PAUSE_ICON = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

  // ===== 工具函数 =====
  function setStatus(msg) { DOM.statusText.textContent = msg; }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds === Infinity) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // 生成某首歌在各 CDN 上的播放 URL（同名后缀探测，由 app.js 在运行时确定真实后缀）
  function trackPlayURL(track, ext) {
    ext = ext || track.ext || 'mp3';
    return 'https://' + JSD_CDN + '/gh/' + MUSIC_USER + '/' + MUSIC_REPO + '@' + MUSIC_BRANCH + '/' + encodeURI(track.file) + '.' + ext;
  }

  // ===== 背景图：同站/镜像直连，国内无需 VPN =====
  function loadBackground() {
    var url = 'https://' + JSD_CDN + '/gh/' + MUSIC_USER + '/' + MUSIC_REPO + '@' + MUSIC_BRANCH + '/' + BG_IMAGE;
    var img = new Image();
    img.onload = function () {
      DOM.bgLayer.classList.add('has-image');
      DOM.bgLayer.style.backgroundImage = 'url("' + url + '")';
    };
    img.onerror = function () {
      // 降级为纯 CSS 渐变（已在 CSS 中定义），页面依然美观
      console.warn('[Player] background image not found, using CSS gradient');
    };
    img.src = url;
  }

  // ===== 扫描音乐库 =====
  // 策略：先尝试 jsDelivr 目录列表接口，失败则尝试 manifest.json，最后用 fallback 探测
  function scanLibrary() {
    setStatus('Connecting to music library...');

    // 方法1：jsDelivr 目录列表（返回该仓库根目录文件数组）
    var apiUrl = 'https://' + JSD_CDN + '/gh/' + MUSIC_USER + '/' + MUSIC_REPO + '@' + MUSIC_BRANCH + '/';
    fetch(apiUrl, { method: 'GET' })
      .then(function (res) {
        if (!res.ok) throw new Error('jsDelivr list failed: ' + res.status);
        return res.json();
      })
      .then(function (list) {
        // list: [{name, hash, size, ...}]
        var found = [];
        list.forEach(function (item) {
          if (!item || !item.name) return;
          var lower = item.name.toLowerCase();
          var dotIdx = lower.lastIndexOf('.');
          if (dotIdx === -1) return;
          var ext = lower.slice(dotIdx + 1);
          if (SUPPORTED_FORMATS.indexOf(ext) === -1) return;
          // 排除封面/图片
          if (item.name === BG_IMAGE) return;
          var name = item.name.slice(0, dotIdx); // 无后缀 = 歌名
          found.push({ file: name, ext: ext, artist: 'Unknown', size: item.size });
        });
        if (found.length > 0) {
          finalizeTracks(found);
        } else {
          tryManifest();
        }
      })
      .catch(function (e) {
        console.warn('[Player] jsDelivr directory listing failed, trying manifest...', e);
        tryManifest();
      });
  }

  // 方法2：读取 music 仓库的 manifest.json
  function tryManifest() {
    var manifestUrl = 'https://' + JSD_CDN + '/gh/' + MUSIC_USER + '/' + MUSIC_REPO + '@' + MUSIC_BRANCH + '/manifest.json';
    fetch(manifestUrl)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (manifest) {
        if (manifest && Array.isArray(manifest) && manifest.length > 0) {
          // 探测每首歌的真实后缀
          return Promise.all(manifest.map(function (item) {
            return probeExt(item.file).then(function (ext) {
              return { file: item.file, ext: ext, artist: item.artist || 'Unknown' };
            });
          })).then(finalizeTracks);
        } else {
          fallbackProbe();
        }
      })
      .catch(fallbackProbe);
  }

  // 方法3：兜底探测 track01..track99
  function fallbackProbe() {
    setStatus('Scanning common tracks...');
    var candidates = [];
    for (var i = 1; i <= 99; i++) {
      var num = String(i);
      while (num.length < 2) num = '0' + num;
      candidates.push('track' + num);
    }
    // 批量探测，找到多少算多少
    var results = [];
    var seq = 0;
    function nextOne() {
      if (seq >= candidates.length) {
        if (results.length > 0) finalizeTracks(results);
        else setStatus('Library is empty — upload music to the music repo');
        return;
      }
      var name = candidates[seq++];
      probeExt(name).then(function (ext) {
        if (ext) results.push({ file: name, ext: ext, artist: 'Unknown' });
        nextOne();
      });
    }
    nextOne();
  }

  // 探测某个"无后缀名字"对应的真实后缀
  function probeExt(name) {
    return new Promise(function (resolve) {
      var seq = 0;
      function tryNext() {
        if (seq >= SUPPORTED_FORMATS.length) return resolve(null);
        var ext = SUPPORTED_FORMATS[seq++];
        var url = trackPlayURL({ file: name }, ext);
        fetch(url, { method: 'HEAD' })
          .then(function (res) {
            if (res.ok) {
              // 确认是音频内容
              var ct = res.headers.get('content-type') || '';
              if (ct.indexOf('audio') !== -1 || ct.indexOf('octet') !== -1 || ct.indexOf('video') !== -1) {
                return resolve(ext);
              }
            }
            tryNext();
          })
          .catch(tryNext);
      }
      tryNext();
    });
  }

  function finalizeTracks(list) {
    tracks = list.sort(function (a, b) {
      return (a.file || '').localeCompare(b.file || '', 'zh');
    });
    renderPlaylist();
    if (tracks.length > 0) {
      loadTrack(0, true);
      setStatus(tracks.length + ' tracks loaded');
      DOM.trackCount.textContent = tracks.length + (tracks.length > 1 ? ' tracks' : ' track');
    } else {
      setStatus('No audio files found in music repo');
    }
  }

  // ===== 渲染列表 =====
  function renderPlaylist() {
    DOM.playlist.innerHTML = '';
    tracks.forEach(function (track, i) {
      var div = document.createElement('div');
      div.className = 'playlist-item' + (i === currentIndex ? ' active' : '');
      div.innerHTML =
        '<span class="playlist-item-index">' + (i + 1) + '</span>' +
        '<div class="playlist-item-info">' +
        '<div class="playlist-item-name">' + escapeHtml(track.file) + '</div>' +
        '<div class="playlist-item-artist">' + escapeHtml(track.artist) + '</div>' +
        '</div>';
      div.addEventListener('click', function () { loadTrack(i); play(); });
      DOM.playlist.appendChild(div);
    });
  }

  // ===== Web Audio 上下文（首次用户交互时解锁，解决酷狗/WebKit 首次卡顿）=====
  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new AC(); } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function unlockAudio() {
    var ctx = getAudioCtx();
    if (ctx) {
      // 静音振荡器，触发解锁
      try {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
        osc.stop(0.05);
      } catch (e) {}
    }
  }

  // 抓取并解码整首歌（用于预解码 + 播放）
  function fetchAndDecode(track, ext) {
    var url = trackPlayURL(track, ext);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      var ctx = getAudioCtx();
      if (!ctx) throw new Error('No AudioContext');
      return ctx.decodeAudioData(buf);
    });
  }

  // ===== 加载 & 播放 =====
  function loadTrack(index, silent) {
    if (index < 0 || index >= tracks.length) return;
    currentIndex = index;
    var track = tracks[index];

    stopCurrent();
    isWebAudioMode = false;
    pauseOffset = 0;
    isPaused = false;

    DOM.trackName.textContent = track.file;
    DOM.trackArtist.textContent = track.artist;
    DOM.progressFill.style.width = '0%';
    DOM.progressGlow.style.left = '0%';
    DOM.timeCurrent.textContent = '0:00';
    DOM.timeTotal.textContent = '0:00';

    renderPlaylist();
    setStatus('Loading: ' + track.file);

    // 优先 Web Audio：先探测到真实后缀（已在 finalizeTracks 里确定）
    var ext = track.ext || 'mp3';
    var ctx = getAudioCtx();
    if (ctx) {
      fetchAndDecode(track, ext)
        .then(function (buffer) {
          track.buffer = buffer;
          track.duration = buffer.duration;
          DOM.timeTotal.textContent = formatTime(buffer.duration);
          setStatus(track.file);
          if (!silent) playBuffer(buffer);
          // 预解码下一首
          preloadNextTrack();
        })
        .catch(function (err) {
          console.warn('[Player] Web Audio decode failed, fallback to <audio>:', err);
          useHtmlAudio(track, ext);
        });
    } else {
      useHtmlAudio(track, ext);
    }
  }

  // 兼容模式：原生 <audio>（部分格式浏览器可解但 Web Audio 不行时用）
  function useHtmlAudio(track, ext) {
    var url = trackPlayURL(track, ext);
    htmlAudio.src = url;
    htmlAudio.load();
    bindHtmlAudioEvents();
    if (isPlaying) {
      htmlAudio.play().catch(function (e) { setStatus('Playback failed: ' + e.message); });
    }
    setStatus(track.file);
    // 预加载下一首（仅 metadata）
    preloadHtmlAudioNext();
  }

  var htmlAudioEventsBound = false;
  function bindHtmlAudioEvents() {
    if (htmlAudioEventsBound) return;
    htmlAudioEventsBound = true;
    htmlAudio.addEventListener('loadedmetadata', function () {
      DOM.timeTotal.textContent = formatTime(htmlAudio.duration);
    });
    htmlAudio.addEventListener('timeupdate', function () {
      if (!htmlAudio.duration) return;
      var pct = (htmlAudio.currentTime / htmlAudio.duration) * 100;
      DOM.progressFill.style.width = pct + '%';
      DOM.progressGlow.style.left = pct + '%';
      DOM.timeCurrent.textContent = formatTime(htmlAudio.currentTime);
    });
    htmlAudio.addEventListener('ended', onTrackEnded);
  }

  function preloadHtmlAudioNext() {
    if (currentIndex < 0 || currentIndex >= tracks.length - 1) return;
    var next = tracks[currentIndex + 1];
    var tmp = new Audio();
    tmp.preload = 'metadata';
    tmp.src = trackPlayURL(next, next.ext || 'mp3');
  }

  // ===== 播放控制 =====
  function play() {
    unlockAudio();
    if (currentIndex === -1 && tracks.length > 0) { loadTrack(0); return; }

    if (isWebAudioMode && pauseOffset > 0) {
      // 从暂停处恢复
      var ctx = getAudioCtx();
      if (ctx && tracks[currentIndex].buffer) {
        playBuffer(tracks[currentIndex].buffer, pauseOffset);
        return;
      }
    }

    if (isWebAudioMode) {
      // 已经 start 过了，无法再 start，重新播整首
      if (tracks[currentIndex] && tracks[currentIndex].buffer) {
        playBuffer(tracks[currentIndex].buffer);
      }
    } else {
      htmlAudio.play().catch(function (e) { setStatus('Playback failed: ' + e.message); });
    }
    setPlaying(true);
  }

  function playBuffer(buffer, offset) {
    var ctx = getAudioCtx();
    if (!ctx) { useHtmlAudio(tracks[currentIndex], tracks[currentIndex].ext || 'mp3'); return; }
    stopCurrentSource();
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    var startAt = ctx.currentTime + 0.02;
    src.start(startAt, offset || 0);
    currentSource = src;
    isWebAudioMode = true;
    startTime = startAt;
    pauseOffset = offset || 0;
    isPaused = false;

    src.onended = function () {
      if (!isPaused && currentSource === src) {
        onTrackEnded();
      }
    };
    setPlaying(true);
  }

  function pause() {
    if (isWebAudioMode) {
      var ctx = getAudioCtx();
      if (ctx) {
        pauseOffset = ctx.currentTime - startTime + pauseOffset;
      }
      isPaused = true;
      stopCurrentSource();
      isWebAudioMode = true; // 保持，以便 resume
    } else {
      htmlAudio.pause();
    }
    setPlaying(false);
  }

  function stopCurrent() {
    stopCurrentSource();
    try { htmlAudio.pause(); } catch (e) {}
    htmlAudio.removeAttribute('src');
  }

  function stopCurrentSource() {
    if (currentSource) {
      try { currentSource.onended = null; currentSource.stop(0); } catch (e) {}
      try { currentSource.disconnect(); } catch (e) {}
      currentSource = null;
    }
  }

  function togglePlay() {
    if (isPlaying) pause();
    else play();
  }

  function onTrackEnded() {
    if (loop) {
      if (isWebAudioMode && tracks[currentIndex] && tracks[currentIndex].buffer) {
        playBuffer(tracks[currentIndex].buffer);
      } else {
        htmlAudio.currentTime = 0;
        htmlAudio.play().catch(function () {});
      }
      return;
    }
    playNext();
  }

  function playNext() {
    if (tracks.length === 0) return;
    var next;
    if (shuffle) {
      next = Math.floor(Math.random() * tracks.length);
    } else {
      next = currentIndex + 1;
      if (next >= tracks.length) next = 0;
    }
    loadTrack(next);
    if (isPlaying) play();
  }

  function playPrev() {
    if (tracks.length === 0) return;
    var prev;
    if (shuffle) {
      prev = Math.floor(Math.random() * tracks.length);
    } else {
      prev = currentIndex - 1;
      if (prev < 0) prev = tracks.length - 1;
    }
    loadTrack(prev);
    if (isPlaying) play();
  }

  // 预解码下一首（无延迟切歌的核心）
  function preloadNextTrack() {
    if (tracks.length < 2) return;
    var nextIdx = currentIndex + 1;
    if (nextIdx >= tracks.length) nextIdx = 0;
    if (nextIdx === preloadIndex && nextBuffer) return;
    var nextTrack = tracks[nextIdx];
    if (!nextTrack || !nextTrack.ext) return;
    preloadIndex = nextIdx;
    fetchAndDecode(nextTrack, nextTrack.ext)
      .then(function (buffer) {
        nextBuffer = buffer;
        nextTrack.buffer = buffer;
        nextTrack.duration = buffer.duration;
      })
      .catch(function () { nextBuffer = null; });
  }

  function setPlaying(state) {
    isPlaying = state;
    DOM.iconPlay.innerHTML = state ? PAUSE_ICON : PLAY_ICON;
    DOM.vinyl.classList.toggle('playing', state);
    DOM.rings.forEach(function (r) { r.classList.toggle('active', state); });
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    DOM.playBtn.addEventListener('click', togglePlay);
    DOM.prevBtn.addEventListener('click', playPrev);
    DOM.nextBtn.addEventListener('click', playNext);

    DOM.shuffleBtn.addEventListener('click', function () {
      shuffle = !shuffle;
      DOM.shuffleBtn.classList.toggle('active', shuffle);
    });
    DOM.loopBtn.addEventListener('click', function () {
      loop = !loop;
      DOM.loopBtn.classList.toggle('active', loop);
      htmlAudio.loop = loop;
    });

    // 首次触摸解锁音频（WebKit 要求）
    var unlockOnce = function () { unlockAudio(); window.removeEventListener('touchstart', unlockOnce); window.removeEventListener('click', unlockOnce); };
    window.addEventListener('touchstart', unlockOnce);
    window.addEventListener('click', unlockOnce);

    // 进度条点击
    DOM.progressBar.addEventListener('click', function (e) {
      var rect = DOM.progressBar.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      if (isWebAudioMode && tracks[currentIndex] && tracks[currentIndex].buffer) {
        pauseOffset = pct * (tracks[currentIndex].duration || 0);
        if (isPlaying) playBuffer(tracks[currentIndex].buffer, pauseOffset);
      } else if (htmlAudio.duration) {
        htmlAudio.currentTime = pct * htmlAudio.duration;
      }
    });

    // 音量
    DOM.volumeBar.addEventListener('click', function (e) {
      var rect = DOM.volumeBar.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      htmlAudio.volume = pct;
      if (audioCtx && audioCtx.listener) {}
      DOM.volumeFill.style.width = (pct * 100) + '%';
    });
    htmlAudio.volume = 0.7;

    // 键盘
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') playNext();
      if (e.code === 'ArrowLeft') playPrev();
    });

    // ===== 后台不断音核心逻辑 =====
    // 只暂停 UI 动画（CSS .page-hidden），绝不暂停 <audio> / Web Audio
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        document.body.classList.add('page-hidden');
        // Web Audio 在后台可能被节流，但会继续渲染，不主动停止
      } else {
        document.body.classList.remove('page-hidden');
        // 回前台：强制校正速率 + 恢复上下文（修复后台降速/静音断续）
        var ctx = getAudioCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
        if (isWebAudioMode && currentSource && !isPaused) {
          // 重新调度以确保不卡顿
          var now = ctx.currentTime;
          var elapsed = now - startTime;
          // 若明显掉速则重启当前曲（兜底）
        }
        if (!isWebAudioMode && isPlaying) {
          htmlAudio.playbackRate = 1.0;
          // 网络恢复可能中断，尝试续播
          if (htmlAudio.paused) htmlAudio.play().catch(function () {});
        }
      }
    });

    // 网络恢复自动续播
    window.addEventListener('online', function () {
      if (isPlaying && !isWebAudioMode && htmlAudio.paused) {
        htmlAudio.play().catch(function () {});
      }
    });
  }

  // ===== 初始化 =====
  function init() {
    loadBackground();
    bindEvents();
    scanLibrary();
  }

  init();
})();
