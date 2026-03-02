// ─── Paper Types ───────────────────────────────────────────────

export type PaperType = "ruled" | "grid" | "dot" | "blank";

export interface PaperConfig {
  type: PaperType;
  color: string;
  lineColor: string;
  lineSpacing: number;
  margin: number;
  marginTop: number;
}

// ─── Stroke Data ───────────────────────────────────────────────

export type ToolType = "pen" | "highlighter" | "eraser";

export type StrokePoint = [number, number, number, number];

export interface Stroke {
  id: string;
  tool: ToolType;
  color: string;
  width: number;
  opacity: number;
  points: StrokePoint[];
}

// ─── Canvas State ──────────────────────────────────────────────

export interface CanvasConfig {
  width: number;
  height: number;
  scrollY: number;
}

// ─── File Format ───────────────────────────────────────────────

export interface InkwellFile {
  version: number;
  created: string;
  modified: string;
  paper: PaperConfig;
  canvas: CanvasConfig;
  strokes: Stroke[];
}

// ─── Viewport ──────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
  scrollY: number;
}

// ─── Defaults ──────────────────────────────────────────────────

export const PAPER_PRESETS: Record<PaperType, Omit<PaperConfig, "type">> = {
  ruled: {
    color: "#FFFEF9",
    lineColor: "#C8D0E0",
    lineSpacing: 32,
    margin: 72,
    marginTop: 64,
  },
  grid: {
    color: "#FFFEF9",
    lineColor: "#D0D8E4",
    lineSpacing: 28,
    margin: 0,
    marginTop: 28,
  },
  dot: {
    color: "#FFFEF9",
    lineColor: "#B8C0D0",
    lineSpacing: 28,
    margin: 0,
    marginTop: 28,
  },
  blank: {
    color: "#FFFFFF",
    lineColor: "#000000",
    lineSpacing: 32,
    margin: 0,
    marginTop: 0,
  },
};

export function createDefaultFile(paperType: PaperType = "ruled"): InkwellFile {
  const now = new Date().toISOString();
  const preset = PAPER_PRESETS[paperType];

  return {
    version: 1,
    created: now,
    modified: now,
    paper: { type: paperType, ...preset },
    canvas: {
      width: 1200,
      height: 3200,
      scrollY: 0,
    },
    strokes: [],
  };
}

let _strokeCounter = 0;
export function generateStrokeId(): string {
  return `s_${Date.now()}_${_strokeCounter++}`;
}
