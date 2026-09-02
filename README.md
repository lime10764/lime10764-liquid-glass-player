# Liquid Glass Player

玻璃拟态音乐播放器。播放器代码在这个仓库，**音乐文件在另一个独立仓库** [`lime10764/music`](https://github.com/lime10764/music)。

## 架构

```
仓库 A（本仓库）：lime10764-liquid-glass-player  ← 播放器（部署到 GitHub Pages）
仓库 B：music                                   ← 纯音乐文件
```

播放器通过 jsDelivr 的 `gh/` 目录接口自动扫描 `music` 仓库的文件列表，**你往 music 仓库丢文件，播放器自动识别，无需改任何代码**。

## 特性

- **自动扫描**：读取 `music` 仓库根目录，文件名 = 歌名（无后缀）
- **全格式**：MP3 / FLAC / WAV / OGG / M4A / AAC / OPUS / WMA / AIFF / APE / WV / CAF / WebM
- **无延迟切歌**：Web Audio API 预解码下一首，切歌直接内存播放
- **后台不断音**：`visibilitychange` 只停 UI 动画，音频照常；回前台强制 `playbackRate=1.0` + `AudioContext.resume()`
- **国内高速**：走 jsDelivr（可换 `jsd.cdn.zzko.cn` 国内镜像），无需 VPN
- **背景图**：从 `music` 仓库取 `image_download_1787389320083.jpg`，同站直连，失败降级 CSS 渐变
- **酷狗优化**：首次触摸解锁 WebKit 音频 + 预解码

> ⚠️ 酷狗 `.kgm` / `.kgg` 是 DRM 加密，浏览器无法解码。先用酷狗客户端转成 MP3/FLAC 再上传（文件名无后缀）。

## 怎么用

### 1. 部署本播放器

```bash
git clone https://github.com/lime10764/lime10764-liquid-glass-player.git
cd lime10764-liquid-glass-player
# 推到你自己的仓库后，Settings → Pages → main 分支
```

### 2. 往 music 仓库放歌

直接在 `music` 仓库根目录上传文件，**文件名就是歌名，不带后缀**：

```
晴天
海阔天空
Bohemian Rhapsody
```

想填歌手名，就在 `music` 仓库加一个 `manifest.json`：

```json
[
  { "file": "晴天", "artist": "周杰伦" },
  { "file": "海阔天空", "artist": "Beyond" }
]
```

不写 `manifest.json` 也能跑 —— 播放器通过 jsDelivr 目录列表自动识别所有音频文件及其真实后缀。

### 3. （可选）换背景图

把 `image_download_1787389320083.jpg` 放到 `music` 仓库根目录即可。找不到会自动用纯 CSS 渐变。

## 配置项（app.js 顶部）

```js
var MUSIC_USER   = 'lime10764';   // music 仓库的 owner
var MUSIC_REPO   = 'music';        // music 仓库名
var MUSIC_BRANCH = 'main';         // 分支
var JSD_CDN      = 'cdn.jsdelivr.net';  // 国内可换 'jsd.cdn.zzko.cn'
```

## 键盘

- `空格` 播放/暂停
- `← →` 上一首/下一首

## License

MIT
