import { StrokePoint, ToolType, generateId } from "../model/types";

export interface InputCallbacks {
  onStrokeStart: (id: string, tool: ToolType, point: StrokePoint) => void;
  onStrokeMove: (point: StrokePoint) => void;
  onStrokeEnd: () => void;
  onScroll: (deltaY: number) => void;
}

export class InputHandler {
  private container: HTMLElement;
  private callbacks: InputCallbacks;
  private activeTool: ToolType = "pen";
  private isDrawing = false;
  private isPanning = false;
  private lastTouchY = 0;
  private activePointerId: number | null = null;
  private enabled = true;

  constructor(container: HTMLElement, callbacks: InputCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  setTool(tool: ToolType): void {
    this.activeTool = tool;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.isDrawing) {
      this.callbacks.onStrokeEnd();
      this.isDrawing = false;
      this.activePointerId = null;
    }
  }

  destroy(): void {
    this.unbindEvents();
  }

  private bindEvents(): void {
    const el = this.container;
    el.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    el.addEventListener("pointermove", this.onPointerMove, { passive: false });
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerUp);
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

  private onPointerDown = (e: PointerEvent): void => {
    // Always handle touch for scrolling
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.isPanning = true;
      this.activePointerId = e.pointerId;
      this.lastTouchY = e.clientY;
      this.container.setPointerCapture(e.pointerId);
      return;
    }

    // Skip pen/mouse when disabled (text mode)
    if (!this.enabled) return;

    e.preventDefault();

    if (e.pointerType === "pen" || e.pointerType === "mouse") {
      this.isDrawing = true;
      this.activePointerId = e.pointerId;
      this.container.setPointerCapture(e.pointerId);

      const point = this.extractPoint(e);
      const id = generateId("s");
      this.callbacks.onStrokeStart(id, this.activeTool, point);
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
      // Ignore
    }
  };

  private extractPoint(e: PointerEvent): StrokePoint {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure || 0.5;
    return [x, y, pressure, Date.now()];
  }
}
