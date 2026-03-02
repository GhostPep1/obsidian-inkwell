import { PaperRenderer, PAGE_HEIGHT } from "./PaperRenderer";
import { StrokeRenderer } from "./StrokeRenderer";
import { InputHandler } from "./InputHandler";
import type { InteractionMode } from "../ui/Toolbar";
import {
  InkwellFile,
  StrokeObject,
  TextObject,
  StrokePoint,
  ToolType,
  Viewport,
  CanvasObject,
  generateId,
  getStrokes,
} from "../model/types";

const TOOL_DEFAULTS: Record<ToolType, { color: string; width: number; opacity: number }> = {
  pen:         { color: "#1A1A2E", width: 3,  opacity: 1.0 },
  highlighter: { color: "#FFE066", width: 16, opacity: 0.35 },
  eraser:      { color: "#000000", width: 10, opacity: 1.0 },
};

const TEXT_DEFAULTS = {
  fontSize: 18,
  fontFamily: "sans-serif",
  color: "#1A1A2E",
  align: "left" as const,
};

const DRAG_THRESHOLD = 8; // px before tap becomes drag

export class InkCanvas {
  private container: HTMLElement;
  private bgCanvas: HTMLCanvasElement;
  private strokeCanvas: HTMLCanvasElement;
  private activeCanvas: HTMLCanvasElement;
  private overlayLayer: HTMLElement;

  private paperRenderer: PaperRenderer;
  private strokeRenderer: StrokeRenderer;
  private inputHandler: InputHandler;

  private file: InkwellFile;
  private viewport: Viewport;
  private currentStroke: StrokeObject | null = null;
  private undoStack: CanvasObject[] = [];
  private dirty = false;

  private onDirty: () => void;

  private currentTool: ToolType = "pen";
  private mode: InteractionMode = "draw";
  private penColor = "#1A1A2E";
  private penWidth = 4;
  private resizeObserver: ResizeObserver;

  // Text editing state
  private activeTextarea: HTMLTextAreaElement | null = null;
  private editingTextId: string | null = null;

  // Drag state
  private dragTarget: TextObject | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragObjStartX = 0;
  private dragObjStartY = 0;
  private isDragging = false;
  private pointerDownTime = 0;

  // Bound handlers for cleanup
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(container: HTMLElement, file: InkwellFile, onDirty: () => void) {
    this.container = container;
    this.file = file;
    this.onDirty = onDirty;

    if (this.file.canvas.height < PAGE_HEIGHT) {
      this.file.canvas.height = PAGE_HEIGHT;
    }

    this.bgCanvas = this.createCanvas("inkwell-bg");
    this.strokeCanvas = this.createCanvas("inkwell-strokes");

    this.overlayLayer = document.createElement("div");
    this.overlayLayer.addClass("inkwell-overlay");
    this.container.appendChild(this.overlayLayer);

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

    // Text mode pointer handlers
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);

    this.activeCanvas.addEventListener("pointerdown", this.boundPointerDown);
    this.activeCanvas.addEventListener("pointermove", this.boundPointerMove);
    this.activeCanvas.addEventListener("pointerup", this.boundPointerUp);

    this.resize();
    this.renderBackground();
    this.renderAll();

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
    this.renderAll();
  }

  // ─── Mode & Tool Control ───────────────────────────────────

  setMode(mode: InteractionMode): void {
    if (this.activeTextarea) this.commitText();
    this.mode = mode;
    if (mode === "text") {
      this.activeCanvas.style.cursor = "text";
    } else {
      this.activeCanvas.style.cursor = "crosshair";
    }
  }

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.inputHandler.setTool(tool);
    this.mode = "draw";
    this.activeCanvas.style.cursor = "crosshair";
  }

  setColor(color: string): void { this.penColor = color; }
  setWidth(width: number): void { this.penWidth = width; }
  getTool(): ToolType { return this.currentTool; }

  // ─── Pointer Handling (text mode: tap vs drag) ─────────────

  private getDocCoords(e: PointerEvent): { screenX: number; screenY: number; docX: number; docY: number } {
    const rect = this.activeCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      screenX,
      screenY,
      docX: screenX,
      docY: screenY + this.viewport.scrollY,
    };
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.mode !== "text") return;
    if (e.pointerType === "touch") return;

    const { screenX, screenY, docX, docY } = this.getDocCoords(e);
    const hitText = this.findTextAt(docX, docY);

    if (hitText) {
      // Potential drag — record start
      this.dragTarget = hitText;
      this.dragStartX = screenX;
      this.dragStartY = screenY;
      this.dragObjStartX = hitText.x;
      this.dragObjStartY = hitText.y;
      this.isDragging = false;
      this.pointerDownTime = Date.now();
      e.preventDefault();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.mode !== "text" || !this.dragTarget) return;

    const { screenX, screenY } = this.getDocCoords(e);
    const dx = screenX - this.dragStartX;
    const dy = screenY - this.dragStartY;

    if (!this.isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      this.isDragging = true;
      this.activeCanvas.style.cursor = "grabbing";
    }

    if (this.isDragging) {
      this.dragTarget.x = this.dragObjStartX + dx;
      this.dragTarget.y = this.dragObjStartY + dy;
      this.file.objects[this.dragTarget.id] = this.dragTarget;
      this.renderAll();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.mode !== "text") return;
    if (e.pointerType === "touch") return;

    const { screenX, screenY, docX, docY } = this.getDocCoords(e);

    if (this.dragTarget && this.isDragging) {
      // Finished drag — commit position
      this.dirty = true;
      this.onDirty();
      this.dragTarget = null;
      this.isDragging = false;
      this.activeCanvas.style.cursor = "text";
      this.renderAll();
      return;
    }

    // It was a tap, not a drag
    this.dragTarget = null;
    this.isDragging = false;

    const hitText = this.findTextAt(docX, docY);
    if (hitText) {
      this.editExistingText(hitText);
    } else {
      this.createNewText(screenX, screenY, docX, docY);
    }
  }

  // ─── Text CRUD ─────────────────────────────────────────────

  private findTextAt(docX: number, docY: number): TextObject | null {
    const texts = Object.values(this.file.objects).filter(
      (o): o is TextObject => o.type === "text"
    );
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      if (docX >= t.x && docX <= t.x + t.width &&
          docY >= t.y && docY <= t.y + t.height) {
        return t;
      }
    }
    return null;
  }

  private createNewText(screenX: number, screenY: number, docX: number, docY: number): void {
    if (this.activeTextarea) this.commitText();

    const id = generateId("txt");
    const textObj: TextObject = {
      id,
      type: "text",
      x: docX,
      y: docY,
      width: 300,
      height: 30,
      locked: false,
      content: "",
      fontSize: TEXT_DEFAULTS.fontSize,
      fontFamily: TEXT_DEFAULTS.fontFamily,
      color: this.penColor,
      align: TEXT_DEFAULTS.align,
    };

    this.spawnTextarea(textObj, screenX, screenY);
    this.editingTextId = id;
  }

  private editExistingText(textObj: TextObject): void {
    if (this.activeTextarea) this.commitText();

    const screenX = textObj.x;
    const screenY = textObj.y - this.viewport.scrollY;

    this.editingTextId = textObj.id;
    this.renderAll();

    this.spawnTextarea(textObj, screenX, screenY);
    this.activeTextarea!.value = textObj.content;
  }

  private spawnTextarea(textObj: TextObject, screenX: number, screenY: number): void {
    const ta = document.createElement("textarea");
    ta.addClass("inkwell-text-input");
    ta.style.position = "absolute";
    ta.style.left = `${screenX}px`;
    ta.style.top = `${screenY}px`;
    ta.style.minWidth = "100px";
    ta.style.minHeight = "28px";
    ta.style.fontSize = `${textObj.fontSize}px`;
    ta.style.fontFamily = textObj.fontFamily;
    ta.style.color = textObj.color;
    ta.style.textAlign = textObj.align;
    ta.style.background = "rgba(255,255,240,0.85)";
    ta.style.border = "1px dashed #2563EB";
    ta.style.borderRadius = "3px";
    ta.style.padding = "4px 6px";
    ta.style.outline = "none";
    ta.style.resize = "both";
    ta.style.overflow = "hidden";
    ta.style.zIndex = "10";
    ta.style.lineHeight = "1.4";
    ta.style.boxSizing = "border-box";

    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    });

    ta.addEventListener("blur", () => this.commitText());

    ta.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ta.blur();
      }
    });

    this.overlayLayer.appendChild(ta);
    this.activeTextarea = ta;
    ta.focus();
  }

  private commitText(): void {
    if (!this.activeTextarea || !this.editingTextId) return;

    const content = this.activeTextarea.value.trim();
    const ta = this.activeTextarea;

    if (content.length > 0) {
      const rect = ta.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();

      const screenX = rect.left - containerRect.left;
      const screenY = rect.top - containerRect.top;

      const existing = this.file.objects[this.editingTextId] as TextObject | undefined;

      const textObj: TextObject = {
        id: this.editingTextId,
        type: "text",
        x: screenX,
        y: screenY + this.viewport.scrollY,
        width: rect.width,
        height: rect.height,
        locked: false,
        content,
        fontSize: existing?.fontSize ?? TEXT_DEFAULTS.fontSize,
        fontFamily: existing?.fontFamily ?? TEXT_DEFAULTS.fontFamily,
        color: existing?.color ?? this.penColor,
        align: existing?.align ?? TEXT_DEFAULTS.align,
      };

      this.file.objects[this.editingTextId] = textObj;
      this.dirty = true;
      this.onDirty();
    } else {
      delete this.file.objects[this.editingTextId];
    }

    ta.remove();
    this.activeTextarea = null;
    this.editingTextId = null;
    this.renderAll();
  }

  // ─── Auto-extend ──────────────────────────────────────────

  private maybeExtendCanvas(docY: number): void {
    const bottomMargin = 300;
    if (docY > this.file.canvas.height - bottomMargin) {
      this.file.canvas.height += PAGE_HEIGHT;
      this.renderBackground();
    }
  }

  // ─── Drawing Handlers ─────────────────────────────────────

  private handleStrokeStart(id: string, tool: ToolType, point: StrokePoint): void {
    if (this.mode === "text") return;

    if (tool === "eraser") {
      this.eraseAtPoint(point);
      return;
    }

    const defaults = TOOL_DEFAULTS[tool];
    const docPoint: StrokePoint = [point[0], point[1] + this.viewport.scrollY, point[2], point[3]];

    this.maybeExtendCanvas(docPoint[1]);

    this.currentStroke = {
      id: generateId("s"),
      type: "stroke",
      x: docPoint[0],
      y: docPoint[1],
      width: 0,
      height: 0,
      locked: false,
      tool,
      color: tool === "pen" ? this.penColor : defaults.color,
      strokeWidth: tool === "pen" ? this.penWidth : defaults.width,
      opacity: defaults.opacity,
      points: [docPoint],
    };
  }

  private handleStrokeMove(point: StrokePoint): void {
    if (this.mode === "text") return;

    if (this.currentTool === "eraser") {
      this.eraseAtPoint(point);
      return;
    }

    if (!this.currentStroke) return;

    const docPoint: StrokePoint = [point[0], point[1] + this.viewport.scrollY, point[2], point[3]];
    this.currentStroke.points.push(docPoint);

    this.maybeExtendCanvas(docPoint[1]);

    const ctx = this.activeCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.strokeRenderer.renderStroke(ctx, this.currentStroke, this.viewport);
  }

  private handleStrokeEnd(): void {
    if (this.mode === "text") return;
    if (!this.currentStroke) return;

    if (this.currentStroke.points.length >= 2) {
      const bounds = computeBoundsFromPoints(this.currentStroke.points);
      this.currentStroke.x = bounds.x;
      this.currentStroke.y = bounds.y;
      this.currentStroke.width = bounds.width;
      this.currentStroke.height = bounds.height;

      this.file.objects[this.currentStroke.id] = this.currentStroke;
      this.undoStack = [];
      this.dirty = true;
    }

    this.currentStroke = null;

    const actCtx = this.activeCanvas.getContext("2d")!;
    actCtx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.renderAll();
    this.onDirty();
  }

  private handleScroll(deltaY: number): void {
    const maxScroll = Math.max(0, this.file.canvas.height - this.viewport.height);
    this.viewport.scrollY = Math.max(0, Math.min(maxScroll, this.viewport.scrollY + deltaY));
    this.file.canvas.scrollY = this.viewport.scrollY;

    if (this.activeTextarea && this.editingTextId) {
      const obj = this.file.objects[this.editingTextId] as TextObject;
      if (obj) {
        this.activeTextarea.style.top = `${obj.y - this.viewport.scrollY}px`;
      }
    }

    this.renderBackground();
    this.renderAll();
  }

  private eraseAtPoint(point: StrokePoint): void {
    const [px, py] = point;
    const docY = py + this.viewport.scrollY;
    const hitRadius = 15;

    const strokes = getStrokes(this.file);
    const hit = strokes.find((stroke) =>
      stroke.points.some(([sx, sy]) => {
        const dx = sx - px;
        const dy = sy - docY;
        return dx * dx + dy * dy < hitRadius * hitRadius;
      })
    );

    if (hit) {
      delete this.file.objects[hit.id];
      this.undoStack.push(hit);
      this.dirty = true;
      this.renderAll();
      this.onDirty();
      return;
    }

    const textHit = this.findTextAt(px, docY);
    if (textHit) {
      delete this.file.objects[textHit.id];
      this.undoStack.push(textHit);
      this.dirty = true;
      this.renderAll();
      this.onDirty();
    }
  }

  undo(): void {
    const ids = Object.keys(this.file.objects);
    if (ids.length === 0) return;
    const lastId = ids[ids.length - 1];
    const obj = this.file.objects[lastId];
    delete this.file.objects[lastId];
    this.undoStack.push(obj);
    this.dirty = true;
    this.renderAll();
    this.onDirty();
  }

  redo(): void {
    const obj = this.undoStack.pop();
    if (obj) {
      this.file.objects[obj.id] = obj;
      this.dirty = true;
      this.renderAll();
      this.onDirty();
    }
  }

  // ─── Rendering ─────────────────────────────────────────────

  private renderBackground(): void {
    const ctx = this.bgCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.paperRenderer.render(ctx, this.file.paper, this.viewport);
  }

  private renderAll(): void {
    const ctx = this.strokeCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    const strokes = getStrokes(this.file);
    this.strokeRenderer.renderAll(ctx, strokes, this.viewport);
    this.renderTextObjects(ctx);
  }

  private renderTextObjects(ctx: CanvasRenderingContext2D): void {
    const texts = Object.values(this.file.objects).filter(
      (o): o is TextObject => o.type === "text"
    );

    for (const t of texts) {
      if (t.id === this.editingTextId) continue;

      if (t.y + t.height < this.viewport.scrollY - 50) continue;
      if (t.y > this.viewport.scrollY + this.viewport.height + 50) continue;

      const screenY = t.y - this.viewport.scrollY;

      ctx.save();
      ctx.font = `${t.fontSize}px ${t.fontFamily}`;
      ctx.fillStyle = t.color;
      ctx.textAlign = t.align as CanvasTextAlign;
      ctx.textBaseline = "top";

      // Subtle highlight when in text mode (shows it's tappable/draggable)
      if (this.mode === "text") {
        ctx.strokeStyle = "rgba(37, 99, 235, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(t.x, screenY, t.width, t.height);
        ctx.setLineDash([]);
      }

      const lines = this.wrapText(ctx, t.content, t.width - 12);
      const lineHeight = t.fontSize * 1.4;

      let textX = t.x + 6;
      if (t.align === "center") textX = t.x + t.width / 2;
      else if (t.align === "right") textX = t.x + t.width - 6;

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], textX, screenY + 4 + i * lineHeight);
      }

      ctx.restore();
    }
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const paragraphs = text.split("\n");
    const lines: string[] = [];

    for (const para of paragraphs) {
      if (para === "") { lines.push(""); continue; }
      const words = para.split(" ");
      let currentLine = words[0] || "";

      for (let i = 1; i < words.length; i++) {
        const test = currentLine + " " + words[i];
        if (ctx.measureText(test).width <= maxWidth) {
          currentLine = test;
        } else {
          lines.push(currentLine);
          currentLine = words[i];
        }
      }
      lines.push(currentLine);
    }
    return lines;
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

    const strokes = getStrokes(this.file);
    this.strokeRenderer.renderAll(ctx, strokes, fullVp);

    const savedScrollY = this.viewport.scrollY;
    const savedMode = this.mode;
    this.viewport.scrollY = 0;
    this.mode = "draw"; // Hide selection outlines in export
    this.renderTextObjects(ctx);
    this.viewport.scrollY = savedScrollY;
    this.mode = savedMode;

    return canvas.toDataURL("image/png");
  }

  getFile(): InkwellFile {
    if (this.activeTextarea) this.commitText();
    this.file.modified = new Date().toISOString();
    return this.file;
  }

  isDirty(): boolean { return this.dirty; }
  markClean(): void { this.dirty = false; }

  destroy(): void {
    if (this.activeTextarea) this.commitText();
    this.inputHandler.destroy();
    this.resizeObserver.disconnect();
    this.activeCanvas.removeEventListener("pointerdown", this.boundPointerDown);
    this.activeCanvas.removeEventListener("pointermove", this.boundPointerMove);
    this.activeCanvas.removeEventListener("pointerup", this.boundPointerUp);
    this.bgCanvas.remove();
    this.strokeCanvas.remove();
    this.activeCanvas.remove();
    this.overlayLayer.remove();
  }
}

function computeBoundsFromPoints(points: [number, number, number, number][]): {
  x: number; y: number; width: number; height: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
