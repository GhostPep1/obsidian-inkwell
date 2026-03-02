import { PaperConfig, Viewport } from "../model/types";

export class PaperRenderer {
  render(ctx: CanvasRenderingContext2D, paper: PaperConfig, vp: Viewport): void {
    ctx.fillStyle = paper.color;
    ctx.fillRect(0, 0, vp.width, vp.height);

    switch (paper.type) {
      case "ruled":
        this.drawRuled(ctx, paper, vp);
        break;
      case "grid":
        this.drawGrid(ctx, paper, vp);
        break;
      case "dot":
        this.drawDots(ctx, paper, vp);
        break;
      case "blank":
        break;
    }
  }

  private drawRuled(ctx: CanvasRenderingContext2D, paper: PaperConfig, vp: Viewport): void {
    const { lineColor, lineSpacing, margin, marginTop } = paper;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.5;

    // First line starts at marginTop, then every lineSpacing after
    const firstLine = Math.max(0, Math.floor((vp.scrollY - marginTop) / lineSpacing));
    const lastLine = Math.ceil((vp.scrollY + vp.height - marginTop) / lineSpacing);

    ctx.beginPath();
    for (let i = firstLine; i <= lastLine; i++) {
      const y = Math.round(marginTop + i * lineSpacing - vp.scrollY) + 0.5;
      if (y < 0) continue;
      if (y > vp.height) break;
      ctx.moveTo(0, y);
      ctx.lineTo(vp.width, y);
    }
    ctx.stroke();

    // Red margin line
    if (margin > 0) {
      ctx.strokeStyle = "#E8A0A0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const x = Math.round(margin) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, vp.height);
      ctx.stroke();
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, paper: PaperConfig, vp: Viewport): void {
    const { lineColor, lineSpacing, marginTop } = paper;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.5;

    const firstRow = Math.max(0, Math.floor((vp.scrollY - marginTop) / lineSpacing));
    const lastRow = Math.ceil((vp.scrollY + vp.height - marginTop) / lineSpacing);

    ctx.beginPath();
    for (let i = firstRow; i <= lastRow; i++) {
      const y = Math.round(marginTop + i * lineSpacing - vp.scrollY) + 0.5;
      if (y < 0) continue;
      if (y > vp.height) break;
      ctx.moveTo(0, y);
      ctx.lineTo(vp.width, y);
    }

    const cols = Math.ceil(vp.width / lineSpacing);
    for (let i = 0; i <= cols; i++) {
      const x = Math.round(i * lineSpacing) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, vp.height);
    }
    ctx.stroke();
  }

  private drawDots(ctx: CanvasRenderingContext2D, paper: PaperConfig, vp: Viewport): void {
    const { lineColor, lineSpacing, marginTop } = paper;

    ctx.fillStyle = lineColor;
    const dotRadius = 1.2;

    const firstRow = Math.max(0, Math.floor((vp.scrollY - marginTop) / lineSpacing));
    const lastRow = Math.ceil((vp.scrollY + vp.height - marginTop) / lineSpacing);
    const cols = Math.ceil(vp.width / lineSpacing);

    for (let row = firstRow; row <= lastRow; row++) {
      const y = marginTop + row * lineSpacing - vp.scrollY;
      if (y < 0) continue;
      if (y > vp.height) break;
      for (let col = 0; col <= cols; col++) {
        const x = col * lineSpacing;
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
