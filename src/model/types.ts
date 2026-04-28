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

// ─── Base Object ───────────────────────────────────────────────

export interface BaseObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
}

// ─── Stroke Object ─────────────────────────────────────────────

export type ToolType = "pen" | "highlighter" | "eraser";
export type StrokePoint = [number, number, number, number];

export interface StrokeObject extends BaseObject {
  type: "stroke";
  tool: ToolType;
  color: string;
  strokeWidth: number;
  opacity: number;
  points: StrokePoint[];
}

// ─── Text Object ───────────────────────────────────────────────

export interface TextObject extends BaseObject {
  type: "text";
  content: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  align: "left" | "center" | "right";
}

// ─── Image Object ──────────────────────────────────────────────

export interface ImageObject extends BaseObject {
  type: "image";
  assetId: string;
}

// ─── Widget Object (markdown) ──────────────────────────────────

export interface WidgetObject extends BaseObject {
  type: "widget";
  content: string;
}

// ─── Union Type ────────────────────────────────────────────────

export type CanvasObject = StrokeObject | TextObject | ImageObject | WidgetObject;

// ─── Asset Reference ───────────────────────────────────────────

export interface AssetEntry {
  vaultPath: string;
  mimeType: string;
  originalWidth?: number;
  originalHeight?: number;
}

// ─── Canvas State ──────────────────────────────────────────────

export interface CanvasConfig {
  width: number;
  height: number;
}

// ─── File Format v2 ────────────────────────────────────────────

// Field order matters: `modified` is intentionally placed LAST.
// JSON.stringify preserves insertion order for string keys (V8/JSC honor
// the ES2015 spec for non-integer keys). If `modified` is ever updated,
// its byte change lands in the final chunk only — leaving the file's
// header, paper, canvas, objects, and assets chunks recyclable across
// saves under LiveSync's content-defined chunking. Do not move volatile
// fields above `objects`.
export interface InkwellFile {
  version: number;
  created: string;
  paper: PaperConfig;
  canvas: CanvasConfig;
  objects: Record<string, CanvasObject>;
  assets: Record<string, AssetEntry>;
  modified: string;
}

// ─── Legacy Format (v1 migration) ──────────────────────────────

interface LegacyStroke {
  id: string;
  tool: ToolType;
  color: string;
  width: number;
  opacity: number;
  points: StrokePoint[];
}

interface LegacyFile {
  version: number;
  created: string;
  modified: string;
  paper: PaperConfig;
  canvas: CanvasConfig;
  strokes: LegacyStroke[];
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
    version: 2,
    created: now,
    paper: { type: paperType, ...preset },
    canvas: {
      width: 1200,
      height: 1600,
    },
    objects: {},
    assets: {},
    modified: now,
  };
}

// ─── Migration ─────────────────────────────────────────────────

export function computeBounds(points: StrokePoint[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function migrateV1(data: any): InkwellFile {
  const legacy = data as LegacyFile;
  const objects: Record<string, CanvasObject> = {};

  for (const s of legacy.strokes) {
    const bounds = computeBounds(s.points);
    objects[s.id] = {
      id: s.id,
      type: "stroke",
      ...bounds,
      locked: false,
      tool: s.tool,
      color: s.color,
      strokeWidth: s.width,
      opacity: s.opacity,
      points: s.points,
    };
  }

  return {
    version: 2,
    created: legacy.created,
    paper: legacy.paper,
    canvas: legacy.canvas,
    objects,
    assets: {},
    modified: legacy.modified,
  };
}

// ─── Helpers ───────────────────────────────────────────────────

let _counter = 0;
export function generateId(prefix: string = "obj"): string {
  return `${prefix}_${Date.now()}_${_counter++}`;
}

export function getStrokes(file: InkwellFile): StrokeObject[] {
  return Object.values(file.objects).filter((o): o is StrokeObject => o.type === "stroke");
}

export function getImages(file: InkwellFile): ImageObject[] {
  return Object.values(file.objects).filter((o): o is ImageObject => o.type === "image");
}

export function getTexts(file: InkwellFile): TextObject[] {
  return Object.values(file.objects).filter((o): o is TextObject => o.type === "text");
}
