import { PaperRenderer } from "./PaperRenderer";
import { StrokeRenderer } from "./StrokeRenderer";
import { InputHandler } from "./InputHandler";
import {
  InkwellFile,
  Stroke,
  StrokePoint,
  ToolType,
  Viewport,
  generateStrokeId,
} from "../model/types";

const PAGE_HEIGHT = 1600;

const TOOL_DEFAULTS: Record<ToolType, { color: string; width: number; opacity: number }> = {
  pen:         { color: "#1A1A2E", width: 2,  opacity: 1.0 },
  highlighter: { color: "#FFE066", width: 4,  opacity: 0.35 },
  eraser:      { color: "#000000", width: 10, opacity: 1.0 },
};

export class InkCanvas {
  private container: HTMLElement;
  private bgCanvas: HTMLCanvasElement;
  private strokeCanvas: HTMLCanvasElement;
  private activeCanvas: HTMLCanvasElement;

  private paperRenderer: PaperRenderer;
  private strokeRenderer: StrokeRenderer;
  private inputHandler: InputHandler;

  private file: InkwellFile;
  private viewport: Viewport;
  private currentStroke: Stroke | null = null;
  private undoStack: Stroke[] = [];
  private dirty = false;

  private onDirty: () => void;

  private currentTool: ToolType = "pen";
  private penColor = "#1A1A2E";
  private penWidth = 2;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, file: InkwellFile, onDirty: () => void) {
    this.container = container;
    this.file = file;
    this.onDirty = onDirty;

    // Default to single page height if not set
    if (this.file.canvas.height < PAGE_HEIGHT) {
      this.file.canvas.height = PAGE_HEIGHT;
    }

    this.bgCanvas = this.createCanvas("inkwell-bg");
    this.strokeCanvas = this.createCanvas("inkwell-strokes");
    this.activeCanvas = this.createCanvas("inkwell-active");

    this.paperRenderer = new PaperRenderer();
    this.strokeRenderer = new StrokeRenderer();

    this.viewport = {
      width: container.clientWidth,
      height: container.clientHeight,
      scrollY: file.canvas.scrollY,
    };

    this.inputHandler = new InputHandler(this.activeCanvas, {
      onStrokeStart: this.handleStrokeStart.bind(this),
      onStrokeMove: this.handleStrokeMove.bind(this),
      onStrokeEnd: this.handleStrokeEnd.bind(this),
      onScroll: this.handleScroll.bind(this),
    });

    this.resize();
    this.renderBackground();
    this.renderStrokes();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  private createCanvas(className: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.addClass(className);
    this.container.appendChild(canvas);
    return canvas;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    this.viewport.width = w;
    this.viewport.height = h;

    for (const canvas of [this.bgCanvas, this.strokeCanvas, this.activeCanvas]) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
    }

    this.renderBackground();
    this.renderStrokes();
  }

  // ─── Tool Control ──────────────────────────────────────────

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.inputHandler.setTool(tool);
  }

  setColor(color: string): void {
    this.penColor = color;
  }

  setWidth(width: number): void {
    this.penWidth = width;
  }

  getTool(): ToolType {
    return this.currentTool;
  }

  // ─── Page Management ───────────────────────────────────────

  addPage(): void {
    this.file.canvas.height += PAGE_HEIGHT;
    this.dirty = true;
    this.onDirty();

    // Scroll to the new page
    const newPageTop = this.file.canvas.height - PAGE_HEIGHT;
    this.viewport.scrollY = newPageTop;
    this.file.canvas.scrollY = newPageTop;

    this.renderBackground();
    this.renderStrokes();
  }

  // ─── Drawing Handlers ─────────────────────────────────────

  private handleStrokeStart(id: string, tool: ToolType, point: StrokePoint): void {
    if (tool === "eraser") {
      this.eraseAtPoint(point);
      return;
    }

    const defaults = TOOL_DEFAULTS[tool];
    const docPoint: StrokePoint = [point[0], point[1] + this.viewport.scrollY, point[2], point[3]];

    this.currentStroke = {
      id,
      tool,
      color: tool === "pen" ? this.penColor : defaults.color,
      width: tool === "pen" ? this.penWidth : defaults.width,
      opacity: defaults.opacity,
      points: [docPoint],
    };
  }

  private handleStrokeMove(point: StrokePoint): void {
    if (this.currentTool === "eraser") {
      this.eraseAtPoint(point);
      return;
    }

    if (!this.currentStroke) return;

    const docPoint: StrokePoint = [point[0], point[1] + this.viewport.scrollY, point[2], point[3]];
    this.currentStroke.points.push(docPoint);

    const ctx = this.activeCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.strokeRenderer.renderStroke(ctx, this.currentStroke, this.viewport);
  }

  private handleStrokeEnd(): void {
    if (!this.currentStroke) return;

    if (this.currentStroke.points.length >= 2) {
      this.file.strokes.push(this.currentStroke);
      this.undoStack = [];
      this.dirty = true;
    }

    this.currentStroke = null;

    const actCtx = this.activeCanvas.getContext("2d")!;
    actCtx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.renderStrokes();
    this.onDirty();
  }

  private handleScroll(deltaY: number): void {
    const maxScroll = Math.max(0, this.file.canvas.height - this.viewport.height);
    this.viewport.scrollY = Math.max(0, Math.min(maxScroll, this.viewport.scrollY + deltaY));
    this.file.canvas.scrollY = this.viewport.scrollY;

    this.renderBackground();
    this.renderStrokes();
  }

  // ─── Eraser ────────────────────────────────────────────────

  private eraseAtPoint(point: StrokePoint): void {
    const [px, py] = point;
    const docY = py + this.viewport.scrollY;
    const hitRadius = 15;

    const idx = this.file.strokes.findIndex((stroke) =>
      stroke.points.some(([sx, sy]) => {
        const dx = sx - px;
        const dy = sy - docY;
        return dx * dx + dy * dy < hitRadius * hitRadius;
      })
    );

    if (idx >= 0) {
      const removed = this.file.strokes.splice(idx, 1)[0];
      this.undoStack.push(removed);
      this.dirty = true;
      this.renderStrokes();
      this.onDirty();
    }
  }

  // ─── Undo / Redo ──────────────────────────────────────────

  undo(): void {
    const stroke = this.file.strokes.pop();
    if (stroke) {
      this.undoStack.push(stroke);
      this.dirty = true;
      this.renderStrokes();
      this.onDirty();
    }
  }

  redo(): void {
    const stroke = this.undoStack.pop();
    if (stroke) {
      this.file.strokes.push(stroke);
      this.dirty = true;
      this.renderStrokes();
      this.onDirty();
    }
  }

  // ─── Rendering ─────────────────────────────────────────────

  private renderBackground(): void {
    const ctx = this.bgCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.paperRenderer.render(ctx, this.file.paper, this.viewport);
  }

  private renderStrokes(): void {
    const ctx = this.strokeCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.strokeRenderer.renderAll(ctx, this.file.strokes, this.viewport);
  }

  // ─── Export ────────────────────────────────────────────────

  exportToPng(): string {
    const canvas = document.createElement("canvas");
    canvas.width = this.file.canvas.width;
    canvas.height = this.file.canvas.height;
    const ctx = canvas.getContext("2d")!;

    const fullVp: Viewport = {
      width: this.file.canvas.width,
      height: this.file.canvas.height,
      scrollY: 0,
    };
    this.paperRenderer.render(ctx, this.file.paper, fullVp);
    this.strokeRenderer.renderAll(ctx, this.file.strokes, fullVp);

    return canvas.toDataURL("image/png");
  }

  // ─── State ─────────────────────────────────────────────────

  getFile(): InkwellFile {
    this.file.modified = new Date().toISOString();
    return this.file;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markClean(): void {
    this.dirty = false;
  }

  // ─── Cleanup ───────────────────────────────────────────────

  destroy(): void {
    this.inputHandler.destroy();
    this.resizeObserver.disconnect();
    this.bgCanvas.remove();
    this.strokeCanvas.remove();
    this.activeCanvas.remove();
  }
}
