import { StrokeObject, Viewport } from "../model/types";

export class StrokeRenderer {
  renderAll(ctx: CanvasRenderingContext2D, strokes: StrokeObject[], vp: Viewport): void {
    for (const stroke of strokes) {
      if (stroke.y + stroke.height < vp.scrollY - 50) continue;
      if (stroke.y > vp.scrollY + vp.height + 50) continue;
      this.renderStroke(ctx, stroke, vp);
    }
  }

  renderStroke(ctx: CanvasRenderingContext2D, stroke: StrokeObject, vp: Viewport): void {
    if (stroke.points.length < 2) return;

    ctx.save();
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (stroke.tool === "highlighter") {
      ctx.globalCompositeOperation = "multiply";
    }

    ctx.beginPath();
    const [x0, y0] = stroke.points[0];
    ctx.moveTo(x0, y0 - vp.scrollY);

    for (let i = 1; i < stroke.points.length; i++) {
      const [x, y] = stroke.points[i];
      ctx.lineTo(x, y - vp.scrollY);
    }
    ctx.stroke();
    ctx.restore();
  }
}
