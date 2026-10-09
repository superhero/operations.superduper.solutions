<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount } from "svelte";
  let canvas: HTMLCanvasElement;
  onMount(() => {
    const context = canvas.getContext('2d');
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const systems = [
      { x: 0.14, y: 0.26, rx: 0.12, ry: 0.10, sx: 0.12, sy: 0.10, radius: 0.24, strength: 14, pull: 0.07, phase: 0.4 },
      { x: 0.34, y: 0.76, rx: 0.13, ry: 0.08, sx: 0.10, sy: 0.09, radius: 0.28, strength: 16, pull: 0.06, phase: 1.7 },
      { x: 0.63, y: 0.34, rx: 0.14, ry: 0.09, sx: 0.11, sy: 0.08, radius: 0.26, strength: 18, pull: 0.06, phase: 3.2 },
      { x: 0.88, y: 0.68, rx: 0.10, ry: 0.11, sx: 0.09, sy: 0.10, radius: 0.22, strength: 14, pull: 0.05, phase: 4.6 },
    ];
    const state = {
      width: 0,
      height: 0,
      viewportHeight: 0,
      dpr: 1,
      waves: [] as ReturnType<typeof createWave>[],
      anchors: systems.map(anchor => ({ ...anchor, currentX: 0, currentY: 0 })),
      raf: 0,
      pageHidden: false,
      geometryDirty: true,
      colorsDirty: true,
    };
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const random = (min: number, max: number) => min + Math.random() * (max - min);

    function createWave(index: number, count: number) {
      const progress = count <= 1 ? 0.5 : index / (count - 1);
      return {
        base: 0.08 + progress * 0.84,
        amplitude: random(4, 10),
        ripple: random(2, 6),
        freqA: random(0.004, 0.0068),
        freqB: random(0.007, 0.011),
        speedA: random(0.18, 0.34),
        speedB: random(0.10, 0.22),
        phaseA: random(0, Math.PI * 2),
        phaseB: random(0, Math.PI * 2),
        alpha: random(0.025, 0.06),
        accent: index % 5 === 0,
      };
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const viewportHeight = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (width !== state.width || viewportHeight !== state.viewportHeight || dpr !== state.dpr) {
        state.width = width;
        state.viewportHeight = viewportHeight;
        state.dpr = dpr;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(viewportHeight * dpr);
      }
      // Keep document-sized geometry, but allocate pixels only for the visible viewport.
      state.height = Math.max(viewportHeight, document.documentElement.scrollHeight, document.body.scrollHeight);
      const waveCount = clamp(Math.round(state.height / 16), 14, 24);
      if (state.waves.length !== waveCount) {
        state.waves = Array.from({ length: waveCount }, (_, index) => createWave(index, waveCount));
      }
    }

    function updateAnchors(time: number) {
      for (const anchor of state.anchors) {
        const driftX = Math.sin(time * anchor.sx + anchor.phase)
          + Math.sin(time * anchor.sx * 0.58 + anchor.phase * 1.8) * 0.32;
        const driftY = Math.cos(time * anchor.sy + anchor.phase * 1.2)
          + Math.sin(time * anchor.sy * 0.62 + anchor.phase) * 0.28;
        anchor.currentX = state.width * anchor.x + driftX * state.width * anchor.rx;
        anchor.currentY = state.height * anchor.y + driftY * state.height * anchor.ry;
      }
    }

    function anchorDisplacement(anchor: typeof state.anchors[number], x: number, baseY: number, time: number) {
      const dx = x - anchor.currentX;
      const dy = baseY - anchor.currentY;
      const distance = Math.hypot(dx, dy);
      const radius = Math.min(state.width, state.height) * anchor.radius;
      const influence = Math.exp(-(distance * distance) / (radius * radius || 1));
      return Math.sin(distance * 0.03 - time * 1.12 + anchor.phase) * anchor.strength * influence
        + (anchor.currentY - baseY) * anchor.pull * influence;
    }

    function lineY(x: number, wave: ReturnType<typeof createWave>, time: number) {
      const baseY = state.height * wave.base;
      let y = baseY;
      y += Math.sin(x * wave.freqA + time * wave.speedA + wave.phaseA) * wave.amplitude;
      y += Math.cos(x * wave.freqB - time * wave.speedB + wave.phaseB) * wave.ripple;
      for (const anchor of state.anchors) y += anchorDisplacement(anchor, x, baseY, time);
      return y;
    }

    let colors = { background: '', foreground: '' };

    function draw(time: number) {
      const scrollY = window.scrollY;
      ctx.globalAlpha = 1;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, -scrollY * state.dpr);
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, scrollY, state.width, state.viewportHeight);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const wave of state.waves) {
        ctx.beginPath();
        for (let x = -24; x <= state.width + 24; x += 12) {
          const y = lineY(x, wave, time);
          if (x === -24) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = colors.foreground;
        ctx.globalAlpha = wave.accent ? 0.05 : wave.alpha;
        ctx.lineWidth = wave.accent ? 1.15 : 0.9;
        ctx.stroke();
      }
    }

    function stop() {
      window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    }

    function render(now: number) {
      state.raf = 0;
      if (document.hidden || state.pageHidden) return;
      if (state.geometryDirty) {
        resize();
        state.geometryDirty = false;
      }
      if (state.colorsDirty) {
        const style = getComputedStyle(document.documentElement);
        colors = { background: style.getPropertyValue('--color-background'), foreground: style.getPropertyValue('--color-foreground') };
        state.colorsDirty = false;
      }
      const time = reducedMotion.matches ? 0 : now * 0.001;
      updateAnchors(time);
      draw(time);
      if (!reducedMotion.matches) state.raf = window.requestAnimationFrame(render);
    }

    function requestRender() {
      if (document.hidden || state.pageHidden) {
        stop();
        return;
      }
      // Resize observers can fire repeatedly during panel transitions. Fold those
      // updates into the next frame instead of redrawing the canvas synchronously.
      if (!state.raf) state.raf = window.requestAnimationFrame(render);
    }

    function refresh() {
      state.colorsDirty = true;
      requestRender();
    }

    function handleResize() {
      state.geometryDirty = true;
      requestRender();
    }

    const themeObserver = new MutationObserver(refresh);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    const sizeObserver = new ResizeObserver(handleResize);
    sizeObserver.observe(canvas);
    sizeObserver.observe(document.body);
    sizeObserver.observe(document.documentElement);
    const scroll = () => { if (reducedMotion.matches) requestRender(); };
    const hide = () => { state.pageHidden = true; stop(); };
    const show = () => { state.pageHidden = false; handleResize(); };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', scroll, { passive: true });
    reducedMotion.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    handleResize();
    return () => {
      stop(); themeObserver.disconnect(); sizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', scroll);
      reducedMotion.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  });
</script>

<canvas bind:this={canvas} class="background-wave" aria-hidden="true"></canvas>

<style>
  .background-wave { position: fixed; inset: 0; width: 100%; height: 100dvh; z-index: 0; pointer-events: none; }
</style>
