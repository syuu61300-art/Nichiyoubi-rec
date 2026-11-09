// ==UserScript==
// @name         Karaoke Rec Original — YouTube EQ
// @namespace    karaoke-rec-original
// @version      1.0.0
// @description  10-band equalizer for YouTube. Inside the Karaoke Rec Original page it follows the app's "Song" equalizer.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://www.youtube-nocookie.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- 設定 ---------- */
  const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const LBL = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  const PRESETS = {
    flat:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    vocal:  [-3, -2, -1, 0, 2, 3.5, 3.5, 2.5, 1, 0],
    bass:   [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
    warm:   [2.5, 2, 1.5, 1, 0, -1, -1.5, -2, -2.5, -3],
    bright: [-1, -1, 0, 0, 0, 1, 2, 3, 4, 4.5],
    loud:   [5, 4, 2, 0, -1, -1, 0, 2, 4, 5]
  };
  const JA = /^ja/i.test(navigator.language || '');
  const T = JA
    ? { title: 'イコライザー', on: 'オン', reset: 'リセット', remote: 'カラオケ録音オリジナルから操作中',
        p: { flat: 'フラット', vocal: 'ボーカル', bass: '低音強調', treble: '高音強調', warm: 'あたたかい', bright: '明るい', loud: 'ラウドネス' } }
    : { title: 'Equalizer', on: 'On', reset: 'Reset', remote: 'Controlled by Karaoke Rec Original',
        p: { flat: 'Flat', vocal: 'Vocal', bass: 'Bass boost', treble: 'Treble boost', warm: 'Warm', bright: 'Bright', loud: 'Loudness' } };
  const KEY = 'kr-yt-eq';
  const IS_EMBED = location.pathname.startsWith('/embed/');

  let st = load();           // { on, g:[10], p }
  let remote = false;        // アプリから操作されているか
  let ctx = null;
  const chains = new WeakMap();
  const all = new Set();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.g) && s.g.length === 10) return { on: s.on !== false, g: s.g.map(clamp), p: s.p || '' };
    } catch (e) {}
    return { on: true, g: PRESETS.flat.slice(), p: 'flat' };
  }
  function save() { if (remote) return; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function clamp(x) { x = +x || 0; return Math.max(-12, Math.min(12, Math.round(x * 2) / 2)); }

  /* ---------- 音声のつなぎ込み ----------
     ・同じ <video> には一度しかつながない（YouTube は要素を使い回すため）
     ・AudioContext が動いていない間はつながない（つなぐと無音になるため） */
  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC({ latencyHint: 'playback' });
    }
    return ctx;
  }
  function tryAttach(video) {
    if (chains.has(video)) return;
    const c = getCtx(); if (!c) return;
    if (c.state !== 'running') {
      c.resume().then(() => { if (c.state === 'running') tryAttach(video); }).catch(() => {});
      return;
    }
    try {
      const src = c.createMediaElementSource(video);
      const pre = c.createGain();
      src.connect(pre);
      let prev = pre;
      const filters = BANDS.map((f, i) => {
        const b = c.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.05;
        prev.connect(b); prev = b; return b;
      });
      // 持ち上げたときの音割れ防止
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -2; lim.knee.value = 4; lim.ratio.value = 14; lim.attack.value = 0.003; lim.release.value = 0.12;
      prev.connect(lim); lim.connect(c.destination);
      const ch = { pre, filters };
      chains.set(video, ch); all.add(ch);
      apply();
      announce();
    } catch (e) {
      // すでに別の仕組みがつないでいる等。音はそのまま流れる
      chains.set(video, null);
      console.warn('[Karaoke EQ]', e);
    }
  }
  function apply() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const boost = st.on ? Math.max(0, ...st.g) : 0;
    for (const ch of all) {
      ch.filters.forEach((b, i) => b.gain.setTargetAtTime(st.on ? st.g[i] : 0, now, 0.02));
      ch.pre.gain.setTargetAtTime(Math.pow(10, (-boost * 0.6) / 20), now, 0.02);   // 持ち上げた分だけ前段を下げる
    }
  }
  function scan() {
    document.querySelectorAll('video').forEach(v => {
      if (chains.has(v)) return;
      if (!v.__krEq) {
        v.__krEq = true;
        const go = () => tryAttach(v);
        v.addEventListener('play', go);
        v.addEventListener('playing', go);
      }
      if (!v.paused) tryAttach(v);
    });
    if (!IS_EMBED) ensureUI();
  }
  // 操作のたびに一時停止中の音声処理を起こす
  const wake = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); scan(); };
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => document.addEventListener(ev, wake, true));

  let pending = false;
  new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; scan(); }); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', () => setTimeout(scan, 300));

  /* ---------- カラオケ録音オリジナルとの連携（埋め込みプレーヤー内） ---------- */
  function announce() { if (window.parent !== window) window.parent.postMessage({ type: 'kr-eq-ready', v: 1 }, '*'); }
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'kr-eq-ping') { announce(); return; }
    if (d.type !== 'kr-eq' || !Array.isArray(d.g) || d.g.length !== 10) return;
    remote = true;
    st = { on: d.on !== false, g: d.g.map(clamp), p: '' };
    apply(); syncUI();
  });
  announce();

  /* ---------- 画面（YouTube 本体のプレーヤーにボタンとパネルを追加） ----------
     YouTube は innerHTML を禁止しているので、すべて createElement で組み立てる */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(c => c && n.appendChild(c));
    return n;
  }
  function icon() {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 36 36'); s.setAttribute('width', '100%'); s.setAttribute('height', '100%');
    const paths = ['M12 9v7M12 21v6M18 9v11M18 25v2M24 9v3M24 17v10'];
    paths.forEach(d => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); p.setAttribute('stroke', '#fff'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('fill', 'none'); s.appendChild(p); });
    [[12, 18.5], [18, 22.5], [24, 14.5]].forEach(([x, y]) => { const r = document.createElementNS(SVGNS, 'rect'); r.setAttribute('x', x - 2.5); r.setAttribute('y', y - 2.5); r.setAttribute('width', 5); r.setAttribute('height', 5); r.setAttribute('rx', 1.2); r.setAttribute('fill', '#fff'); s.appendChild(r); });
    return s;
  }
  let btn = null, panel = null, faders = [], chips = {}, toggle = null, note = null;
  function injectStyle() {
    if (document.getElementById('kr-eq-style')) return;
    const css = `
#kr-eq-panel{position:absolute;right:12px;bottom:64px;z-index:70;width:min(420px,calc(100% - 24px));background:rgba(17,17,20,.94);color:#ededf0;border:1px solid #2c2c33;border-radius:14px;padding:12px;font:13px/1.4 "Hiragino Sans","Noto Sans JP",Roboto,Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.55);backdrop-filter:blur(12px);transform-origin:bottom right;animation:krIn .22s cubic-bezier(.3,.7,.2,1)}
#kr-eq-panel[hidden]{display:none}
@keyframes krIn{from{opacity:0;transform:translateY(8px) scale(.98)}}
#kr-eq-panel .h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
#kr-eq-panel .h b{flex:1;font-size:14px}
#kr-eq-panel button{font:inherit;color:inherit;background:#1d1d22;border:1px solid #2c2c33;border-radius:8px;padding:5px 10px;cursor:pointer}
#kr-eq-panel button:hover{border-color:#44444e}
#kr-eq-panel .sw{width:40px;height:22px;border-radius:11px;padding:0;position:relative;background:#26262c}
#kr-eq-panel .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#9a9aa3;transition:transform .18s}
#kr-eq-panel .sw[aria-checked="true"]{background:#ededf0;border-color:#ededf0}
#kr-eq-panel .sw[aria-checked="true"]::after{transform:translateX(18px);background:#111}
#kr-eq-panel .chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none}
#kr-eq-panel .chips button{flex:none;border-radius:999px;font-size:12px}
#kr-eq-panel .chips button[aria-pressed="true"]{background:#ededf0;color:#111;border-color:#ededf0}
#kr-eq-panel .fd{display:grid;grid-template-columns:repeat(10,1fr);gap:2px;background:#0f0f11;border:1px solid #2c2c33;border-radius:10px;padding:8px 2px 6px;margin-top:6px}
#kr-eq-panel .col{display:grid;justify-items:center;gap:4px}
#kr-eq-panel .col output{font:10px ui-monospace,Menlo,monospace;color:#8e8e98;height:12px}
#kr-eq-panel .col small{font:9.5px ui-monospace,Menlo,monospace;color:#5f5f69}
#kr-eq-panel input[type=range]{writing-mode:vertical-lr;direction:rtl;-webkit-appearance:slider-vertical;appearance:slider-vertical;width:22px;height:120px;accent-color:#ededf0;margin:0;cursor:ns-resize}
#kr-eq-panel .note{margin:8px 0 0;font-size:11.5px;color:#8e8e98}
#kr-eq-panel.off .fd{opacity:.4}
.kr-eq-btn{display:inline-flex!important;align-items:center;justify-content:center}
.kr-eq-btn.on svg{filter:drop-shadow(0 0 2px rgba(255,255,255,.6))}`;
    (document.head || document.documentElement).appendChild(el('style', { id: 'kr-eq-style', text: css }));
  }
  function ensureUI() {
    const controls = document.querySelector('.ytp-right-controls');
    const player = document.querySelector('.html5-video-player');
    if (!controls || !player) return;
    injectStyle();
    if (!btn || !btn.isConnected) {
      btn = el('button', { class: 'ytp-button kr-eq-btn', 'aria-label': T.title, title: T.title });
      btn.appendChild(icon());
      btn.addEventListener('click', e => { e.stopPropagation(); wake(); panel.hidden = !panel.hidden; btn.classList.toggle('on', !panel.hidden); });
      controls.prepend(btn);
    }
    if (!panel || !panel.isConnected) { panel = buildPanel(); player.appendChild(panel); }
  }
  function buildPanel() {
    const p = el('div', { id: 'kr-eq-panel', hidden: '' });
    ['click', 'dblclick', 'mousedown', 'keydown', 'wheel'].forEach(ev => p.addEventListener(ev, e => e.stopPropagation()));   // プレーヤーの一時停止やショートカットに反応させない
    toggle = el('button', { class: 'sw', role: 'switch', 'aria-label': T.on });
    toggle.addEventListener('click', () => { st.on = !st.on; commit(); });
    const reset = el('button', { text: T.reset });
    reset.addEventListener('click', () => { st.g = PRESETS.flat.slice(); st.p = 'flat'; commit(); });
    const close = el('button', { text: '×', 'aria-label': 'Close' });
    close.addEventListener('click', () => { p.hidden = true; btn && btn.classList.remove('on'); });
    p.appendChild(el('div', { class: 'h' }, [el('b', { text: T.title }), toggle, reset, close]));
    const chipBox = el('div', { class: 'chips' });
    chips = {};
    Object.keys(PRESETS).forEach(k => {
      const c = el('button', { text: T.p[k] });
      c.addEventListener('click', () => { st.g = PRESETS[k].slice(); st.p = k; commit(); });
      chips[k] = c; chipBox.appendChild(c);
    });
    p.appendChild(chipBox);
    const fd = el('div', { class: 'fd' });
    faders = BANDS.map((f, i) => {
      const out = el('output');
      const r = el('input', { type: 'range', min: '-12', max: '12', step: '0.5', 'aria-label': LBL[i] + ' Hz' });
      r.addEventListener('input', () => { st.g[i] = clamp(r.value); st.p = ''; commit(true); });
      r.addEventListener('dblclick', () => { st.g[i] = 0; st.p = ''; commit(); });
      fd.appendChild(el('div', { class: 'col' }, [out, r, el('small', { text: LBL[i] })]));
      return { r, out };
    });
    p.appendChild(fd);
    note = el('p', { class: 'note', text: T.remote, hidden: '' });
    p.appendChild(note);
    panel = p; syncUI();
    return p;
  }
  function commit(fromSlider) { remote = false; apply(); save(); syncUI(fromSlider); }
  function syncUI(fromSlider) {
    if (!panel) return;
    toggle.setAttribute('aria-checked', st.on);
    panel.classList.toggle('off', !st.on);
    Object.keys(chips).forEach(k => chips[k].setAttribute('aria-pressed', st.p === k));
    faders.forEach(({ r, out }, i) => { if (!fromSlider) r.value = st.g[i]; out.textContent = (st.g[i] > 0 ? '+' : '') + st.g[i]; });
    note.hidden = !remote;
  }

  scan();
})();
