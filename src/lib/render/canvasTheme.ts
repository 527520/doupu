/**
 * Canvas 2D 无法可靠解析 CSS `var()`，因此在绘制前读取设计系统的计算值。
 * 语义颜色只定义在 globals.css；这里不复制视觉色值。
 */
export interface CanvasTheme {
  surface: string;
  empty: string;
  unavailable: string;
  external: string;
  grid: string;
  seam: string;
  activeRow: string;
  doneDark: string;
  doneLight: string;
  focusOuter: string;
  viewportFrame: string;
  primary: string;
  lilac: string;
}

function readColor(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

export function readCanvasTheme(element: Element): CanvasTheme {
  const style = getComputedStyle(element);
  return {
    surface: readColor(style, '--color-cream-deep', 'Canvas'),
    empty: readColor(style, '--color-canvas-empty', 'Canvas'),
    unavailable: readColor(style, '--color-canvas-unavailable', 'GrayText'),
    external: readColor(style, '--color-canvas-external', 'GrayText'),
    grid: readColor(style, '--color-canvas-grid', 'GrayText'),
    seam: readColor(style, '--color-canvas-seam', 'CanvasText'),
    activeRow: readColor(style, '--color-canvas-active-row', 'transparent'),
    doneDark: readColor(style, '--color-canvas-done-dark', 'CanvasText'),
    doneLight: readColor(style, '--color-canvas-done-light', 'Canvas'),
    focusOuter: readColor(style, '--color-canvas-focus-outer', 'Canvas'),
    viewportFrame: readColor(style, '--color-canvas-viewport-frame', 'Canvas'),
    primary: readColor(style, '--color-primary', 'CanvasText'),
    lilac: readColor(style, '--color-lilac', 'CanvasText'),
  };
}
