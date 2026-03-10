import { PaperRenderer, PAGE_HEIGHT } from "./PaperRenderer";
import { StrokeRenderer } from "./StrokeRenderer";
import { InputHandler } from "./InputHandler";
import type { InteractionMode } from "../ui/Toolbar";
import {
  InkwellFile,
  StrokeObject,
  TextObject,
  ImageObject,
  StrokePoint,
  ToolType,
  Viewport,
  CanvasObject,
  generateId,
  getStrokes,
  getTexts,
  getImages,
  computeBounds,
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

const DRAG_THRESHOLD = 8;
const HANDLE_SIZE = 12;       // visual size
const HANDLE_HIT_SIZE = 28;   // touch target

type DragAction = "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se";

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
  private viewScale = 1;
  private userZoom = 1;
  private baseScale = 1;

  // Text editing
  private activeTextarea: HTMLTextAreaElement | null = null;
  private editingTextId: string | null = null;

  // Drag/resize state (shared for text + image)
  private dragTarget: CanvasObject | null = null;
  private dragAction: DragAction = "move";
  private dragStartX = 0;
  private dragStartY = 0;
  private dragObjStartX = 0;
  private dragObjStartY = 0;
  private dragObjStartW = 0;
  private dragObjStartH = 0;
  private isDragging = false;

  // Image cache: assetId → loaded HTMLImageElement
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private imageLoadingSet: Set<string> = new Set();
  private resolveAssetUrl: (assetId: string) => string | null;

  // Pointer handlers
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(
    container: HTMLElement,
    file: InkwellFile,
    onDirty: () => void,
    resolveAssetUrl: (assetId: string) => string | null,
  ) {
    this.container = container;
    this.file = file;
    this.onDirty = onDirty;
    this.resolveAssetUrl = resolveAssetUrl;

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
      onZoom: this.handleZoom.bind(this),
    });

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);

    this.activeCanvas.addEventListener("pointerdown", this.boundPointerDown);
    this.activeCanvas.addEventListener("pointermove", this.boundPointerMove);
    this.activeCanvas.addEventListener("pointerup", this.boundPointerUp);

    // Preload existing images
    this.preloadImages();

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
    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const paperWidth = this.file.canvas.width; // 1200

    // Always fit paper to container width, then apply user zoom
    this.baseScale = containerW / paperWidth;
    this.viewScale = this.baseScale * this.userZoom;

    // Logical dimensions = what we render in canvas coordinates
    const logicalW = paperWidth;
    const logicalH = containerH / this.viewScale;

    this.viewport.width = logicalW;
    this.viewport.height = logicalH;

    for (const canvas of [this.bgCanvas, this.strokeCanvas, this.activeCanvas]) {
      canvas.width = logicalW * dpr;
      canvas.height = logicalH * dpr;
      canvas.style.width = `${containerW}px`;
      canvas.style.height = `${containerH}px`;

      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
    }

    this.renderBackground();
    this.renderAll();
  }

  // ═══════════════════════════════════════════════════════════════
  //  IMAGE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  private preloadImages(): void {
    const images = getImages(this.file);
    for (const img of images) {
      this.ensureImageLoaded(img.assetId);
    }
  }

  private ensureImageLoaded(assetId: string): void {
    if (this.imageCache.has(assetId) || this.imageLoadingSet.has(assetId)) return;

    const url = this.resolveAssetUrl(assetId);
    if (!url) return;

    this.imageLoadingSet.add(assetId);

    const img = new Image();
    img.onload = () => {
      this.imageCache.set(assetId, img);
      this.imageLoadingSet.delete(assetId);
      this.renderAll(); // Re-render once loaded
    };
    img.onerror = () => {
      this.imageLoadingSet.delete(assetId);
      console.error(`Inkwell: failed to load image asset ${assetId}`);
    };
    img.src = url;
  }

  /** Called by InkwellView after file picker inserts an image */
  addImage(assetId: string, docX: number, docY: number, width: number, height: number): void {
    const id = generateId("img");
    const imgObj: ImageObject = {
      id,
      type: "image",
      x: docX,
      y: docY,
      width,
      height,
      locked: false,
      assetId,
    };
    this.file.objects[id] = imgObj;
    this.ensureImageLoaded(assetId);
    this.dirty = true;
    this.onDirty();
    this.renderAll();
  }

  getViewport(): Viewport {
    return { ...this.viewport };
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODE & TOOL CONTROL
  // ═══════════════════════════════════════════════════════════════

  setMode(mode: InteractionMode): void {
    if (this.activeTextarea) this.commitText();
    this.mode = mode;
    this.inputHandler.setEnabled(mode === "draw");
    if (mode === "text") {
      this.activeCanvas.style.cursor = "default";
    } else {
      this.activeCanvas.style.cursor = "crosshair";
    }
    this.renderAll(); // Redraw selection outlines
  }

  setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.inputHandler.setTool(tool);
    this.mode = "draw";
    this.inputHandler.setEnabled(true);
    this.activeCanvas.style.cursor = "crosshair";
    this.renderAll();
  }

  setColor(color: string): void { this.penColor = color; }
  setWidth(width: number): void { this.penWidth = width; }
  getTool(): ToolType { return this.currentTool; }

  // ═══════════════════════════════════════════════════════════════
  //  POINTER HANDLING (text mode: tap / drag / resize)
  // ═══════════════════════════════════════════════════════════════

  private getDocCoords(e: PointerEvent): { screenX: number; screenY: number; docX: number; docY: number } {
    const rect = this.activeCanvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) / this.viewScale;
    const screenY = (e.clientY - rect.top) / this.viewScale;
    return { screenX, screenY, docX: screenX, docY: screenY + this.viewport.scrollY };
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.mode !== "text") return;
    if (e.pointerType === "touch") return;

    const { screenX, screenY, docX, docY } = this.getDocCoords(e);

    // Check resize handles first (images + text)
    const handleHit = this.findHandleAt(docX, docY);
    if (handleHit) {
      this.dragTarget = handleHit.obj;
      this.dragAction = handleHit.action;
      this.dragStartX = screenX;
      this.dragStartY = screenY;
      this.dragObjStartX = handleHit.obj.x;
      this.dragObjStartY = handleHit.obj.y;
      this.dragObjStartW = handleHit.obj.width;
      this.dragObjStartH = handleHit.obj.height;
      this.isDragging = true; // Resize starts immediately
      e.preventDefault();
      return;
    }

    // Check object body hit
    const hitObj = this.findObjectAt(docX, docY);
    if (hitObj) {
      this.dragTarget = hitObj;
      this.dragAction = "move";
      this.dragStartX = screenX;
      this.dragStartY = screenY;
      this.dragObjStartX = hitObj.x;
      this.dragObjStartY = hitObj.y;
      this.dragObjStartW = hitObj.width;
      this.dragObjStartH = hitObj.height;
      this.isDragging = false; // Wait for threshold
      e.preventDefault();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.mode !== "text") return;

    // Update cursor based on what's under pointer
    if (!this.dragTarget) {
      const { docX, docY } = this.getDocCoords(e);
      const handle = this.findHandleAt(docX, docY);
      if (handle) {
        this.activeCanvas.style.cursor = this.getCursorForAction(handle.action);
      } else if (this.findObjectAt(docX, docY)) {
        this.activeCanvas.style.cursor = "move";
      } else {
        this.activeCanvas.style.cursor = "text";
      }
      return;
    }

    const { screenX, screenY } = this.getDocCoords(e);
    const dx = screenX - this.dragStartX;
    const dy = screenY - this.dragStartY;

    if (!this.isDragging && this.dragAction === "move") {
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        this.isDragging = true;
        this.activeCanvas.style.cursor = "grabbing";
      }
    }

    if (!this.isDragging) return;

    const obj = this.dragTarget;

    if (this.dragAction === "move") {
      obj.x = this.dragObjStartX + dx;
      obj.y = this.dragObjStartY + dy;
    } else {
      // Resize — maintain aspect ratio for images
      const isImage = obj.type === "image";
      const aspectRatio = this.dragObjStartW / this.dragObjStartH;

      let newX = obj.x, newY = obj.y, newW = obj.width, newH = obj.height;

      switch (this.dragAction) {
        case "resize-se":
          newW = Math.max(40, this.dragObjStartW + dx);
          newH = isImage ? newW / aspectRatio : Math.max(20, this.dragObjStartH + dy);
          break;
        case "resize-sw":
          newW = Math.max(40, this.dragObjStartW - dx);
          newH = isImage ? newW / aspectRatio : Math.max(20, this.dragObjStartH + dy);
          newX = this.dragObjStartX + this.dragObjStartW - newW;
          break;
        case "resize-ne":
          newW = Math.max(40, this.dragObjStartW + dx);
          newH = isImage ? newW / aspectRatio : Math.max(20, this.dragObjStartH - dy);
          newY = this.dragObjStartY + this.dragObjStartH - newH;
          break;
        case "resize-nw":
          newW = Math.max(40, this.dragObjStartW - dx);
          newH = isImage ? newW / aspectRatio : Math.max(20, this.dragObjStartH - dy);
          newX = this.dragObjStartX + this.dragObjStartW - newW;
          newY = this.dragObjStartY + this.dragObjStartH - newH;
          break;
      }

      obj.x = newX;
      obj.y = newY;
      obj.width = newW;
      obj.height = newH;
    }

    this.file.objects[obj.id] = obj;
    this.renderAll();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.mode !== "text") return;
    if (e.pointerType === "touch") return;

    const { docX, docY, screenX, screenY } = this.getDocCoords(e);

    if (this.dragTarget && this.isDragging) {
      // Finished drag/resize
      this.dirty = true;
      this.onDirty();
      this.dragTarget = null;
      this.isDragging = false;
      this.activeCanvas.style.cursor = "default";
      this.renderAll();
      return;
    }

    // It was a tap
    this.dragTarget = null;
    this.isDragging = false;

    const hitText = this.findTextAt(docX, docY);
    if (hitText) {
      this.editExistingText(hitText);
    } else if (!this.findObjectAt(docX, docY)) {
      // Tapped empty space → new text
      this.createNewText(screenX, screenY, docX, docY);
    }
  }

  private getCursorForAction(action: DragAction): string {
    switch (action) {
      case "resize-nw": case "resize-se": return "nwse-resize";
      case "resize-ne": case "resize-sw": return "nesw-resize";
      default: return "move";
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  HIT TESTING
  // ═══════════════════════════════════════════════════════════════

  private findObjectAt(docX: number, docY: number): CanvasObject | null {
    const objects = Object.values(this.file.objects).filter(o => o.type === "text" || o.type === "image");
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (docX >= o.x && docX <= o.x + o.width && docY >= o.y && docY <= o.y + o.height) {
        return o;
      }
    }
    return null;
  }

  private findTextAt(docX: number, docY: number): TextObject | null {
    const texts = getTexts(this.file);
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      if (docX >= t.x && docX <= t.x + t.width && docY >= t.y && docY <= t.y + t.height) {
        return t;
      }
    }
    return null;
  }

  private findHandleAt(docX: number, docY: number): { obj: CanvasObject; action: DragAction } | null {
    const objects = Object.values(this.file.objects).filter(o => o.type === "text" || o.type === "image");

    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      const hs = HANDLE_HIT_SIZE / 2;

      const corners: { cx: number; cy: number; action: DragAction }[] = [
        { cx: o.x,           cy: o.y,            action: "resize-nw" },
        { cx: o.x + o.width, cy: o.y,            action: "resize-ne" },
        { cx: o.x,           cy: o.y + o.height, action: "resize-sw" },
        { cx: o.x + o.width, cy: o.y + o.height, action: "resize-se" },
      ];

      for (const c of corners) {
        if (Math.abs(docX - c.cx) < hs && Math.abs(docY - c.cy) < hs) {
          return { obj: o, action: c.action };
        }
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TEXT CRUD
  // ═══════════════════════════════════════════════════════════════

  private createNewText(screenX: number, screenY: number, docX: number, docY: number): void {
    if (this.activeTextarea) this.commitText();

    const id = generateId("txt");
    const textObj: TextObject = {
      id, type: "text",
      x: docX, y: docY, width: 300, height: 30,
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

    this.editingTextId = textObj.id;
    this.renderAll();

    const screenX = textObj.x;
    const screenY = textObj.y - this.viewport.scrollY;

    this.spawnTextarea(textObj, screenX, screenY);
    this.activeTextarea!.value = textObj.content;
  }

  private spawnTextarea(textObj: TextObject, screenX: number, screenY: number): void {
    const ta = document.createElement("textarea");
    ta.addClass("inkwell-text-input");
    ta.style.position = "absolute";
    ta.style.left = `${screenX * this.viewScale}px`;
    ta.style.top = `${screenY * this.viewScale}px`;
    ta.style.minWidth = `${100 * this.viewScale}px`;
    ta.style.minHeight = `${28 * this.viewScale}px`;
    ta.style.fontSize = `${textObj.fontSize * this.viewScale}px`;
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
      if (e.key === "Escape") { e.preventDefault(); ta.blur(); }
    });

    this.overlayLayer.appendChild(ta);
    this.activeTextarea = ta;
    ta.focus(); // SYNCHRONOUS for iPad keyboard
  }

  private commitText(): void {
    if (!this.activeTextarea || !this.editingTextId) return;

    const content = this.activeTextarea.value.trim();
    const ta = this.activeTextarea;

    if (content.length > 0) {
      const rect = ta.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      const screenX = (rect.left - containerRect.left) / this.viewScale;
      const screenY = (rect.top - containerRect.top) / this.viewScale;

      const existing = this.file.objects[this.editingTextId] as TextObject | undefined;

      const textObj: TextObject = {
        id: this.editingTextId, type: "text",
        x: screenX,
        y: screenY + this.viewport.scrollY,
        width: rect.width / this.viewScale, height: rect.height / this.viewScale,
        locked: false, content,
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

  // ═══════════════════════════════════════════════════════════════
  //  DRAWING HANDLERS
  // ═══════════════════════════════════════════════════════════════

  private maybeExtendCanvas(docY: number): void {
    if (docY > this.file.canvas.height - 300) {
      this.file.canvas.height += PAGE_HEIGHT;
      this.renderBackground();
    }
  }

  private handleStrokeStart(id: string, tool: ToolType, point: StrokePoint): void {
    if (this.mode === "text") return;

    // Scale screen coords to logical coords on phone
    const scaledPoint: StrokePoint = [point[0] / this.viewScale, point[1] / this.viewScale, point[2], point[3]];

    if (tool === "eraser") { this.eraseAtPoint(scaledPoint); return; }

    const defaults = TOOL_DEFAULTS[tool];
    const docPoint: StrokePoint = [scaledPoint[0], scaledPoint[1] + this.viewport.scrollY, scaledPoint[2], scaledPoint[3]];
    this.maybeExtendCanvas(docPoint[1]);

    this.currentStroke = {
      id: generateId("s"), type: "stroke",
      x: docPoint[0], y: docPoint[1], width: 0, height: 0,
      locked: false, tool,
      color: tool === "pen" ? this.penColor : defaults.color,
      strokeWidth: tool === "pen" ? this.penWidth : defaults.width,
      opacity: defaults.opacity,
      points: [docPoint],
    };
  }

  private handleStrokeMove(point: StrokePoint): void {
    if (this.mode === "text") return;

    const scaledPoint: StrokePoint = [point[0] / this.viewScale, point[1] / this.viewScale, point[2], point[3]];

    if (this.currentTool === "eraser") { this.eraseAtPoint(scaledPoint); return; }
    if (!this.currentStroke) return;

    const docPoint: StrokePoint = [scaledPoint[0], scaledPoint[1] + this.viewport.scrollY, scaledPoint[2], scaledPoint[3]];
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
      const bounds = computeBounds(this.currentStroke.points);
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
    const scaledDelta = deltaY / this.viewScale;
    const maxScroll = Math.max(0, this.file.canvas.height - this.viewport.height);
    this.viewport.scrollY = Math.max(0, Math.min(maxScroll, this.viewport.scrollY + scaledDelta));
    this.file.canvas.scrollY = this.viewport.scrollY;

    if (this.activeTextarea && this.editingTextId) {
      const obj = this.file.objects[this.editingTextId] as TextObject;
      if (obj) this.activeTextarea.style.top = `${(obj.y - this.viewport.scrollY) * this.viewScale}px`;
    }

    this.renderBackground();
    this.renderAll();
  }

  private handleZoom(scaleDelta: number): void {
    const oldZoom = this.userZoom;
    this.userZoom = Math.max(0.25, Math.min(3.0, this.userZoom + scaleDelta));
    if (this.userZoom === oldZoom) return;
    this.resize();
  }

  private eraseAtPoint(point: StrokePoint): void {
    const [px, py] = point;
    const docY = py + this.viewport.scrollY;
    const hitRadius = 15;

    // Check strokes
    const strokes = getStrokes(this.file);
    const hit = strokes.find((s) =>
      s.points.some(([sx, sy]) => (sx - px) ** 2 + (sy - docY) ** 2 < hitRadius * hitRadius)
    );
    if (hit) {
      delete this.file.objects[hit.id];
      this.undoStack.push(hit);
      this.dirty = true;
      this.renderAll();
      this.onDirty();
      return;
    }

    // Check text + images
    const objHit = this.findObjectAt(px, docY);
    if (objHit) {
      delete this.file.objects[objHit.id];
      this.undoStack.push(objHit);
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
      if (obj.type === "image") this.ensureImageLoaded((obj as ImageObject).assetId);
      this.dirty = true;
      this.renderAll();
      this.onDirty();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDERING
  // ═══════════════════════════════════════════════════════════════

  private renderBackground(): void {
    const ctx = this.bgCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.paperRenderer.render(ctx, this.file.paper, this.viewport);
  }

  renderAll(): void {
    const ctx = this.strokeCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    // Render images (behind strokes)
    this.renderImages(ctx);

    // Render strokes
    const strokes = getStrokes(this.file);
    this.strokeRenderer.renderAll(ctx, strokes, this.viewport);

    // Render text (on top)
    this.renderTextObjects(ctx);

    // Draw selection handles in text mode
    if (this.mode === "text") {
      this.renderSelectionHandles(ctx);
    }
  }

  private renderImages(ctx: CanvasRenderingContext2D): void {
    const images = getImages(this.file);

    for (const imgObj of images) {
      // Viewport culling
      if (imgObj.y + imgObj.height < this.viewport.scrollY - 50) continue;
      if (imgObj.y > this.viewport.scrollY + this.viewport.height + 50) continue;

      const screenY = imgObj.y - this.viewport.scrollY;
      const cachedImg = this.imageCache.get(imgObj.assetId);

      if (cachedImg) {
        ctx.drawImage(cachedImg, imgObj.x, screenY, imgObj.width, imgObj.height);
      } else {
        // Placeholder while loading
        ctx.save();
        ctx.fillStyle = "#F0F0F0";
        ctx.fillRect(imgObj.x, screenY, imgObj.width, imgObj.height);
        ctx.strokeStyle = "#CCC";
        ctx.lineWidth = 1;
        ctx.strokeRect(imgObj.x, screenY, imgObj.width, imgObj.height);
        ctx.fillStyle = "#999";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Loading...", imgObj.x + imgObj.width / 2, screenY + imgObj.height / 2);
        ctx.restore();
        this.ensureImageLoaded(imgObj.assetId);
      }
    }
  }

  private renderTextObjects(ctx: CanvasRenderingContext2D): void {
    const texts = getTexts(this.file);

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

  private renderSelectionHandles(ctx: CanvasRenderingContext2D): void {
    const objects = Object.values(this.file.objects).filter(o => o.type === "text" || o.type === "image");

    for (const o of objects) {
      if (o.id === this.editingTextId) continue;
      if (o.y + o.height < this.viewport.scrollY - 50) continue;
      if (o.y > this.viewport.scrollY + this.viewport.height + 50) continue;

      const screenY = o.y - this.viewport.scrollY;

      // Dashed border
      ctx.save();
      ctx.strokeStyle = "rgba(37, 99, 235, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(o.x, screenY, o.width, o.height);
      ctx.setLineDash([]);

      // Corner handles
      const hs = HANDLE_SIZE / 2;
      ctx.fillStyle = "#FFFFFF";
      ctx.strokeStyle = "#2563EB";
      ctx.lineWidth = 1.5;

      const corners = [
        [o.x, screenY],
        [o.x + o.width, screenY],
        [o.x, screenY + o.height],
        [o.x + o.width, screenY + o.height],
      ];

      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - hs, cy - hs, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(cx - hs, cy - hs, HANDLE_SIZE, HANDLE_SIZE);
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

  // ═══════════════════════════════════════════════════════════════
  //  EXPORT
  // ═══════════════════════════════════════════════════════════════

  exportToPng(): string {
    const canvas = document.createElement("canvas");
    canvas.width = this.file.canvas.width;
    canvas.height = this.file.canvas.height;
    const ctx = canvas.getContext("2d")!;

    const fullVp: Viewport = { width: this.file.canvas.width, height: this.file.canvas.height, scrollY: 0 };

    this.paperRenderer.render(ctx, this.file.paper, fullVp);

    // Images
    const images = getImages(this.file);
    for (const imgObj of images) {
      const cachedImg = this.imageCache.get(imgObj.assetId);
      if (cachedImg) {
        ctx.drawImage(cachedImg, imgObj.x, imgObj.y, imgObj.width, imgObj.height);
      }
    }

    // Strokes
    const strokes = getStrokes(this.file);
    this.strokeRenderer.renderAll(ctx, strokes, fullVp);

    // Text
    const savedVp = { ...this.viewport };
    const savedMode = this.mode;
    this.viewport = fullVp;
    this.mode = "draw"; // hide handles
    this.renderTextObjects(ctx);
    this.viewport = savedVp;
    this.mode = savedMode;

    return canvas.toDataURL("image/png");
  }

  // ═══════════════════════════════════════════════════════════════
  //  STATE
  // ═══════════════════════════════════════════════════════════════

  getFile(): InkwellFile {
    if (this.activeTextarea) this.commitText();
    this.file.modified = new Date().toISOString();
    return this.file;
  }

  isDirty(): boolean { return this.dirty; }
  markClean(): void { this.dirty = false; }

  getImageCache(): Map<string, HTMLImageElement> { return this.imageCache; }

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
