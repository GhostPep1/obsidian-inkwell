import getStroke from "perfect-freehand";
import { Stroke, Viewport } from "../model/types";

export class StrokeRenderer {
  /**
   * Render a single stroke to the given canvas context.
   * Coordinates are in document space; caller must account for viewport offset.
   */
  renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, vp: Viewport): void {
    if (stroke.points.length < 2) return;

    const inputPoints = stroke.points.map(([x, y, pressure]) => ({
      x: x,
      y: y - vp.scrollY,
      pressure,
    }));

    const options = this.getStrokeOptions(stroke);
    const outlinePoints = getStroke(inputPoints, options);

    if (outlinePoints.length === 0) return;

    ctx.save();
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.opacity;
    ctx.beginPath();
    this.drawSmoothPath(ctx, outlinePoints);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Render multiple strokes (for the strokes layer).
   */
  renderAll(ctx: CanvasRenderingContext2D, strokes: Stroke[], vp: Viewport): void {
    for (const stroke of strokes) {
      // Quick viewport culling: skip strokes entirely above or below view
      if (this.isStrokeInViewport(stroke, vp)) {
        this.renderStroke(ctx, stroke, vp);
      }
    }
  }

  private getStrokeOptions(stroke: Stroke) {
    const base = {
      simulatePressure: false, // Real pressure from Apple Pencil
      smoothing: 0.5,
      streamline: 0.4,
      thinning: 0.5,
    };

    switch (stroke.tool) {
      case "pen":
        return { ...base, size: stroke.width * 3 };
      case "highlighter":
        return {
          ...base,
          size: stroke.width * 8,
          thinning: 0,       // Uniform width
          smoothing: 0.8,
        };
      default:
        return { ...base, size: stroke.width * 3 };
    }
  }

  private isStrokeInViewport(stroke: Stroke, vp: Viewport): boolean {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of stroke.points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // Stroke is visible if its Y range overlaps the viewport
    return maxY >= vp.scrollY && minY <= vp.scrollY + vp.height;
  }

  /**
   * Draw a smooth closed path from the outline points produced by perfect-freehand.
   */
  private drawSmoothPath(ctx: CanvasRenderingContext2D, points: number[][]): void {
    if (points.length < 3) {
      // Too few points — draw a small circle
      const [x, y] = points[0];
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      return;
    }

    ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const midX = (curr[0] + next[0]) / 2;
      const midY = (curr[1] + next[1]) / 2;
      ctx.quadraticCurveTo(curr[0], curr[1], midX, midY);
    }

    // Close to first point
    const last = points[points.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.closePath();
  }
}
