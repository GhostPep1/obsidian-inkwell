import { StrokePoint, ToolType, generateId } from "../model/types";

export type InputMode = "draw" | "text";

export interface InputCallbacks {
  onStrokeStart: (id: string, tool: ToolType, point: StrokePoint) => void;
  onStrokeMove: (point: StrokePoint) => void;
  onStrokeEnd: () => void;
  onPan: (deltaX: number, deltaY: number) => void;
  onZoom: (scaleDelta: number) => void;
  onTouchTap: (x: number, y: number) => void;
}

const TAP_THRESHOLD = 10;  // pixels
const TAP_TIME = 300;      // ms

export class InputHandler {
  private container: HTMLElement;
  private callbacks: InputCallbacks;
  private activeTool: ToolType = "pen";
  private mode: InputMode = "draw";
  private isDrawing = false;
  private isPanning = false;
  private lastTouchX = 0;
  private lastTouchY = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;
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

  setTool(tool: ToolType): void { this.activeTool = tool; }
  setMode(mode: InputMode): void { this.mode = mode; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.isDrawing) {
      this.callbacks.onStrokeEnd();
      this.isDrawing = false;
      this.activePointerId = null;
    }
  }

  destroy(): void { this.unbindEvents(); }

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

  // ─── Mouse Wheel ─────────────────────────────────

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.callbacks.onZoom(-e.deltaY * 0.005);
    } else {
      this.callbacks.onPan(e.deltaX, e.deltaY);
    }
  };

  // ─── Pointer Events ──────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activeTouches.size === 2) {
        this.isPinching = true;
        this.isPanning = false;
        this.lastPinchDist = this.getPinchDistance();
        return;
      }

      // Single finger — record start for tap detection
      this.activePointerId = e.pointerId;
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
      this.touchStartX = e.clientX;
      this.touchStartY = e.clientY;
      this.touchStartTime = Date.now();
      this.isPanning = false; // Will become true on move
      this.container.setPointerCapture(e.pointerId);
      return;
    }

    // Pen/mouse in draw mode
    if (!this.enabled) return;
    e.preventDefault();

    if (e.pointerType === "pen" || e.pointerType === "mouse") {
      this.isDrawing = true;
      this.activePointerId = e.pointerId;
      this.container.setPointerCapture(e.pointerId);
      const point = this.extractPoint(e);
      this.callbacks.onStrokeStart(generateId("s"), this.activeTool, point);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.isPinching && this.activeTouches.size >= 2) {
        const dist = this.getPinchDistance();
        if (this.lastPinchDist > 0) {
          this.callbacks.onZoom((dist - this.lastPinchDist) * 0.005);
        }
        this.lastPinchDist = dist;
        return;
      }

      if (e.pointerId === this.activePointerId) {
        const dx = this.lastTouchX - e.clientX;
        const dy = this.lastTouchY - e.clientY;
        this.lastTouchX = e.clientX;
        this.lastTouchY = e.clientY;

        // Start panning once we exceed tap threshold
        if (!this.isPanning) {
          const totalDx = Math.abs(e.clientX - this.touchStartX);
          const totalDy = Math.abs(e.clientY - this.touchStartY);
          if (totalDx > TAP_THRESHOLD || totalDy > TAP_THRESHOLD) {
            this.isPanning = true;
          }
        }

        if (this.isPanning) {
          this.callbacks.onPan(dx, dy);
        }
      }
      return;
    }

    if (e.pointerId !== this.activePointerId) return;
    e.preventDefault();

    if (this.isDrawing && (e.pointerType === "pen" || e.pointerType === "mouse")) {
      this.callbacks.onStrokeMove(this.extractPoint(e));
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
        // Was it a tap? (short, small movement)
        if (!this.isPanning && !this.isPinching) {
          const elapsed = Date.now() - this.touchStartTime;
          if (elapsed < TAP_TIME) {
            this.callbacks.onTouchTap(e.clientX, e.clientY);
          }
        }

        this.isPanning = false;
        this.activePointerId = null;
      }

      try { this.container.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    if (e.pointerId !== this.activePointerId) return;

    if (this.isDrawing) this.callbacks.onStrokeEnd();

    this.isDrawing = false;
    this.isPanning = false;
    this.activePointerId = null;

    try { this.container.releasePointerCapture(e.pointerId); } catch {}
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
    return [e.clientX - rect.left, e.clientY - rect.top, e.pressure || 0.5, Date.now()];
  }
}
