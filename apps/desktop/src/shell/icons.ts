/** 内联线性图标(忠实迁移自设计稿 src/ui.jsx 的 I 映射)。viewBox 0 0 24 24,stroke 1.7。
 * 每个图标是一组 [tag, attrs] 的 SVG 子元素,由 Icon.vue 渲染。 */
export type IconEl = [string, Record<string, string | number>];

export const ICONS: Record<string, IconEl[]> = {
  dashboard: [
    ['rect', { x: 3, y: 3, width: 7, height: 9, rx: 1.5 }],
    ['rect', { x: 14, y: 3, width: 7, height: 5, rx: 1.5 }],
    ['rect', { x: 14, y: 12, width: 7, height: 9, rx: 1.5 }],
    ['rect', { x: 3, y: 16, width: 7, height: 5, rx: 1.5 }],
  ],
  market: [
    ['path', { d: 'M3 17l5-5 4 3 8-9' }],
    ['path', { d: 'M21 6v5h-5' }],
  ],
  news: [
    ['rect', { x: 4, y: 3, width: 14, height: 18, rx: 1.5 }],
    ['path', { d: 'M7 7h8M7 11h8M7 15h5' }],
    ['path', { d: 'M18 8h2v11a2 2 0 0 1-2 2' }],
  ],
  indicator: [
    ['line', { x1: 4, y1: 7, x2: 20, y2: 7 }],
    ['line', { x1: 4, y1: 12, x2: 20, y2: 12 }],
    ['line', { x1: 4, y1: 17, x2: 20, y2: 17 }],
    ['circle', { cx: 9, cy: 7, r: 2.3 }],
    ['circle', { cx: 16, cy: 12, r: 2.3 }],
    ['circle', { cx: 7, cy: 17, r: 2.3 }],
  ],
  model: [
    ['circle', { cx: 6, cy: 12, r: 2.4 }],
    ['circle', { cx: 18, cy: 6, r: 2.4 }],
    ['circle', { cx: 18, cy: 18, r: 2.4 }],
    ['path', { d: 'M8.2 11L15.6 7M8.2 13L15.6 17' }],
  ],
  backtest: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M3 9h18M9 21V9' }],
  ],
  signals: [['path', { d: 'M3 12h4l3 8 4-16 3 8h4' }]],
  portfolio: [
    ['path', { d: 'M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z' }],
    ['path', { d: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
  ],
  logs: [['path', { d: 'M4 5h16M4 10h16M4 15h10M4 20h7' }]],
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    [
      'path',
      {
        d: 'M12 2v3M12 19v3M22 12h-3M5 12H2M19.07 4.93l-2.12 2.12M7.05 16.95l-2.12 2.12M19.07 19.07l-2.12-2.12M7.05 7.05L4.93 4.93',
      },
    ],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'M21 21l-4.3-4.3' }],
  ],
  sun: [
    ['circle', { cx: 12, cy: 12, r: 4 }],
    [
      'path',
      {
        d: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
      },
    ],
  ],
  moon: [['path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' }]],
  monitor: [
    ['rect', { x: 3, y: 4, width: 18, height: 12, rx: 1.5 }],
    ['path', { d: 'M9 20h6M12 16v4' }],
  ],
  chevR: [['path', { d: 'M9 6l6 6-6 6' }]],
  chevD: [['path', { d: 'M6 9l6 6 6-6' }]],
  shield: [['path', { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }]],
  check: [['path', { d: 'M4 12l5 5L20 6' }]],
  alert: [
    ['path', { d: 'M12 8v5M12 17h.01' }],
    ['circle', { cx: 12, cy: 12, r: 9 }],
  ],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.6-6.3' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  db: [
    ['ellipse', { cx: 12, cy: 5, rx: 8, ry: 3 }],
    ['path', { d: 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }],
  ],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  lock: [
    ['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }],
    ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  ],
  compass: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M15.6 8.4l-2.2 5-5 2.2 2.2-5z' }],
  ],
};
