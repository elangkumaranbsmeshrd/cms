import { Injectable, effect, signal } from '@angular/core';

import { AccentRamp, rampFrom } from './accent';

// Same 6 presets and hex values as prototype/app-core.js's ACCENTS table —
// converted from that file's [accent,hover,subtle,line] tuples into the
// named AccentRamp shape rampFrom() already returns, so applyAccent() below
// doesn't need two different shapes for "preset" vs "custom".
export const ACCENTS: Record<string, { name: string; light: AccentRamp; dark: AccentRamp }> = {
  blue: {
    name: 'Blue (default)',
    light: { accent: '#2a4bd7', hover: '#1f3ab0', subtle: '#eaeeff', line: '#c3cffb' },
    dark: { accent: '#7592ff', hover: '#8fa6ff', subtle: '#18203a', line: '#2c3a63' },
  },
  purple: {
    name: 'Purple',
    light: { accent: '#7c3aed', hover: '#6425d1', subtle: '#f2ebfe', line: '#d8c2fb' },
    dark: { accent: '#a78bfa', hover: '#b79cfc', subtle: '#241a3d', line: '#3d2e5c' },
  },
  green: {
    name: 'Green',
    light: { accent: '#059669', hover: '#047857', subtle: '#e6f7f1', line: '#b9e8d6' },
    dark: { accent: '#34d399', hover: '#4ade80', subtle: '#103328', line: '#1f4d3c' },
  },
  amber: {
    name: 'Amber',
    light: { accent: '#d97706', hover: '#b45309', subtle: '#fef3e2', line: '#fbd9a5' },
    dark: { accent: '#fbbf24', hover: '#fcd34d', subtle: '#3a2a0d', line: '#5c4318' },
  },
  rose: {
    name: 'Rose',
    light: { accent: '#e11d48', hover: '#be123c', subtle: '#fde8ec', line: '#f9c2ce' },
    dark: { accent: '#fb7185', hover: '#fda4af', subtle: '#3a1620', line: '#5c2432' },
  },
  teal: {
    name: 'Teal',
    light: { accent: '#0d9488', hover: '#0f766e', subtle: '#e3f6f4', line: '#a8e0da' },
    dark: { accent: '#2dd4bf', hover: '#5eead4', subtle: '#0f2e2b', line: '#1b4842' },
  },
};

export type AccentName = keyof typeof ACCENTS;
export const SCALES = [90, 100, 110, 125, 150] as const;

/** How the shell looks — the second of the three root stores (ARCH-3 §2).
 * Session-only, never persisted to localStorage (ARCH-3 §5); a future
 * `PATCH /api/v1/me/preferences` can add server-side persistence without
 * this store's shape changing. Every signal here has a real, live DOM
 * effect wired below — this isn't just state, it's what actually repaints
 * the shell (prototype's own "in-memory only, never persisted" convention).
 */
@Injectable({ providedIn: 'root' })
export class UiStore {
  readonly theme = signal<'light' | 'dark'>('light');
  readonly accent = signal<AccentName | 'custom'>('blue');
  readonly customAccent = signal('#2a4bd7');
  readonly scale = signal(110);
  readonly sidebarCollapsed = signal(false);

  constructor() {
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.theme());
    });
    effect(() => {
      const dark = this.theme() === 'dark';
      const name = this.accent();
      const pal = name === 'custom' ? rampFrom(this.customAccent(), dark) : ACCENTS[name][dark ? 'dark' : 'light'];
      const root = document.documentElement.style;
      root.setProperty('--accent', pal.accent);
      root.setProperty('--accent-hover', pal.hover);
      root.setProperty('--accent-subtle', pal.subtle);
      root.setProperty('--accent-line', pal.line);
    });
    effect(() => {
      document.body.style.zoom = (this.scale() / 100).toFixed(2);
    });
  }

  setScale(n: number): void {
    this.scale.set(Math.max(80, Math.min(200, Math.round(n) || 100)));
  }

  setCustomAccent(hex: string): void {
    if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return;
    this.customAccent.set(hex.startsWith('#') ? hex : '#' + hex);
    this.accent.set('custom');
  }
}
