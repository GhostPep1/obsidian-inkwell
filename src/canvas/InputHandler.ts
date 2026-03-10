import { StrokePoint, ToolType, generateId } from "../model/types";

export interface InputCallbacks {
  onStrokeStart: (id: string, tool: ToolType, point: StrokePoint) => void;
  onStrokeMove: (point: StrokePoint) => void;
  onStrokeEnd: () => void;
  onScroll: (deltaY: number) => void;
  onZoom: (scaleDelta: number) => void;
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

  // Pinch-to-zoom state
  private activeTouches: Map<number, { x: number; y: number }> = new Map();
  private lastPinchDist = 0;
  private isPinching = false;

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
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.style.touchAction = "none";
  }

  private unbindEvents(): void {
    const el = this.container;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerUp);
    el.removeEventListener("wheel", this.onWheel);
  }

  // ─── Mouse Wheel: scroll + ctrl-zoom ─────────────

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+wheel = zoom (or trackpad pinch which browsers send as ctrl+wheel)
      const zoomDelta = -e.deltaY * 0.005;
      this.callbacks.onZoom(zoomDelta);
    } else {
      // Regular scroll
      this.callbacks.onScroll(e.deltaY);
    }
  };

  // ─── Pointer Events ──────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activeTouches.size === 2) {
        // Second finger down → start pinch
        this.isPinching = true;
        this.isPanning = false;
        this.lastPinchDist = this.getPinchDistance();
        return;
      }

      // Single finger → pan
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
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.isPinching && this.activeTouches.size >= 2) {
        const dist = this.getPinchDistance();
        if (this.lastPinchDist > 0) {
          const scaleDelta = (dist - this.lastPinchDist) * 0.005;
          this.callbacks.onZoom(scaleDelta);
        }
        this.lastPinchDist = dist;
        return;
      }

      if (this.isPanning && e.pointerId === this.activePointerId) {
        const deltaY = this.lastTouchY - e.clientY;
        this.lastTouchY = e.clientY;
        this.callbacks.onScroll(deltaY);
      }
      return;
    }

    if (e.pointerId !== this.activePointerId) return;
    e.preventDefault();

    if (this.isDrawing && (e.pointerType === "pen" || e.pointerType === "mouse")) {
      const point = this.extractPoint(e);
      this.callbacks.onStrokeMove(point);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      this.activeTouches.delete(e.pointerId);

      if (this.isPinching && this.activeTouches.size < 2) {
        this.isPinching = false;
        this.lastPinchDist = 0;
      }

      if (e.pointerId === this.activePointerId) {
        this.isPanning = false;
        this.activePointerId = null;
      }

      try { this.container.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

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

  // ─── Helpers ─────────────────────────────────────

  private getPinchDistance(): number {
    const touches = Array.from(this.activeTouches.values());
    if (touches.length < 2) return 0;
    const dx = touches[0].x - touches[1].x;
    const dy = touches[0].y - touches[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private extractPoint(e: PointerEvent): StrokePoint {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure || 0.5;
    return [x, y, pressure, Date.now()];
  }
}
