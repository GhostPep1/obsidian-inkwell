import { PaperConfig, Viewport } from "../model/types";

export const PAGE_HEIGHT = 1600;
const PAGE_GAP = 18; // visual gap at page breaks

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

    this.drawPageBreaks(ctx, paper, vp);
  }

  private drawPageBreaks(ctx: CanvasRenderingContext2D, paper: PaperConfig, vp: Viewport): void {
    const firstPage = Math.floor(vp.scrollY / PAGE_HEIGHT);
    const lastPage = Math.ceil((vp.scrollY + vp.height) / PAGE_HEIGHT);

    for (let p = firstPage + 1; p <= lastPage; p++) {
      const breakY = p * PAGE_HEIGHT - vp.scrollY;
      const gapTop = breakY - PAGE_GAP / 2;
      const gapBottom = breakY + PAGE_GAP / 2;

      // Fill gap with slightly darker background
      ctx.fillStyle = "#E8E8EC";
      ctx.fillRect(0, gapTop, vp.width, PAGE_GAP);

      // Dashed line in center of gap
      ctx.save();
      ctx.strokeStyle = "#B0B0C0";
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(breakY) + 0.5);
      ctx.lineTo(vp.width, Math.round(breakY) + 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawRuled(ctx: CanvasRenderingContext2D, paper: PaperConfig, vp: Viewport): void {
    const { lineColor, lineSpacing, margin, marginTop } = paper;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.5;

    // Draw lines per page so each page gets its own top margin
    const firstPage = Math.floor(vp.scrollY / PAGE_HEIGHT);
    const lastPage = Math.ceil((vp.scrollY + vp.height) / PAGE_HEIGHT);

    ctx.beginPath();
    for (let p = firstPage; p <= lastPage; p++) {
      const pageTop = p * PAGE_HEIGHT;
      const firstLine = 0;
      const lastLine = Math.floor((PAGE_HEIGHT - marginTop) / lineSpacing);

      for (let i = firstLine; i <= lastLine; i++) {
        const docY = pageTop + marginTop + i * lineSpacing;
        const screenY = Math.round(docY - vp.scrollY) + 0.5;
        if (screenY < -1) continue;
        if (screenY > vp.height + 1) break;
        ctx.moveTo(0, screenY);
        ctx.lineTo(vp.width, screenY);
      }
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

    const firstPage = Math.floor(vp.scrollY / PAGE_HEIGHT);
    const lastPage = Math.ceil((vp.scrollY + vp.height) / PAGE_HEIGHT);

    ctx.beginPath();
    for (let p = firstPage; p <= lastPage; p++) {
      const pageTop = p * PAGE_HEIGHT;
      const lastLine = Math.floor((PAGE_HEIGHT - marginTop) / lineSpacing);

      for (let i = 0; i <= lastLine; i++) {
        const docY = pageTop + marginTop + i * lineSpacing;
        const screenY = Math.round(docY - vp.scrollY) + 0.5;
        if (screenY < -1) continue;
        if (screenY > vp.height + 1) break;
        ctx.moveTo(0, screenY);
        ctx.lineTo(vp.width, screenY);
      }
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

    const firstPage = Math.floor(vp.scrollY / PAGE_HEIGHT);
    const lastPage = Math.ceil((vp.scrollY + vp.height) / PAGE_HEIGHT);
    const cols = Math.ceil(vp.width / lineSpacing);

    for (let p = firstPage; p <= lastPage; p++) {
      const pageTop = p * PAGE_HEIGHT;
      const lastRow = Math.floor((PAGE_HEIGHT - marginTop) / lineSpacing);

      for (let row = 0; row <= lastRow; row++) {
        const docY = pageTop + marginTop + row * lineSpacing;
        const screenY = docY - vp.scrollY;
        if (screenY < -1) continue;
        if (screenY > vp.height + 1) break;
        for (let col = 0; col <= cols; col++) {
          const x = col * lineSpacing;
          ctx.beginPath();
          ctx.arc(x, screenY, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}
