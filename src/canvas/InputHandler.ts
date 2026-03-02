import { StrokePoint, ToolType, generateId } from "../model/types";

export interface InputCallbacks {
  onStrokeStart: (id: string, tool: ToolType, point: StrokePoint) => void;
  onStrokeMove: (point: StrokePoint) => void;
  onStrokeEnd: () => void;
  onScroll: (deltaY: number) => void;
}

/**
 * Handles pointer events with automatic palm rejection.
 *
 * Key insight: PointerEvent.pointerType tells us EXACTLY what's touching:
 *   - "pen"   → Apple Pencil / stylus → DRAW
 *   - "touch" → finger → SCROLL only
 *   - "mouse" → mouse/trackpad → DRAW (for desktop testing)
 */
export class InputHandler {
  private container: HTMLElement;
  private callbacks: InputCallbacks;
  private activeTool: ToolType = "pen";
  private isDrawing = false;
  private isPanning = false;
  private lastTouchY = 0;
  private activePointerId: number | null = null;

  constructor(container: HTMLElement, callbacks: InputCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  setTool(tool: ToolType): void {
    this.activeTool = tool;
  }

  destroy(): void {
    this.unbindEvents();
  }

  // ─── Event Binding ─────────────────────────────────────────

  private bindEvents(): void {
    const el = this.container;
    // Use { passive: false } so we can preventDefault on touch events
    // to stop Obsidian from scrolling the page
    el.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    el.addEventListener("pointermove", this.onPointerMove, { passive: false });
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerUp);

    // Prevent default touch actions (we handle scrolling ourselves)
    el.style.touchAction = "none";
  }

  private unbindEvents(): void {
    const el = this.container;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerUp);
  }

  // ─── Event Handlers ────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();

    if (e.pointerType === "pen" || e.pointerType === "mouse") {
      // Stylus or mouse → draw
      this.isDrawing = true;
      this.activePointerId = e.pointerId;
      this.container.setPointerCapture(e.pointerId);

      const point = this.extractPoint(e);
      const id = generateId();
      this.callbacks.onStrokeStart(id, this.activeTool, point);

    } else if (e.pointerType === "touch") {
      // Finger → scroll/pan only
      this.isPanning = true;
      this.activePointerId = e.pointerId;
      this.lastTouchY = e.clientY;
      this.container.setPointerCapture(e.pointerId);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    e.preventDefault();

    if (this.isDrawing && (e.pointerType === "pen" || e.pointerType === "mouse")) {
      const point = this.extractPoint(e);
      this.callbacks.onStrokeMove(point);

    } else if (this.isPanning && e.pointerType === "touch") {
      const deltaY = this.lastTouchY - e.clientY;
      this.lastTouchY = e.clientY;
      this.callbacks.onScroll(deltaY);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;

    if (this.isDrawing) {
      this.callbacks.onStrokeEnd();
    }

    this.isDrawing = false;
    this.isPanning = false;
    this.activePointerId = null;

    try {
      this.container.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore — pointer may already be released
    }
  };

  // ─── Helpers ───────────────────────────────────────────────

  private extractPoint(e: PointerEvent): StrokePoint {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure || 0.5; // Default pressure for mouse
    return [x, y, pressure, Date.now()];
  }
}
