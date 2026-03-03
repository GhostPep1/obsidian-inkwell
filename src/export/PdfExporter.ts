import { jsPDF } from "jspdf";
import { InkwellFile, StrokeObject, ImageObject, Viewport, getStrokes, getImages, getTexts, TextObject } from "../model/types";
import { PaperRenderer, PAGE_HEIGHT } from "../canvas/PaperRenderer";
import { StrokeRenderer } from "../canvas/StrokeRenderer";

export class PdfExporter {
  private paperRenderer: PaperRenderer;
  private strokeRenderer: StrokeRenderer;

  constructor() {
    this.paperRenderer = new PaperRenderer();
    this.strokeRenderer = new StrokeRenderer();
  }

  exportToPdfBlob(file: InkwellFile, imageCache: Map<string, HTMLImageElement>): Blob {
    const pageWidth = file.canvas.width;
    const strokes = getStrokes(file);
    const images = getImages(file);
    const texts = getTexts(file);
    const totalHeight = this.getContentHeight(strokes, images, texts);
    const totalPages = Math.max(1, Math.ceil(totalHeight / PAGE_HEIGHT));

    const usedPages = this.getUsedPages(strokes, images, texts, totalPages);

    const orientation = pageWidth > PAGE_HEIGHT ? "landscape" : "portrait";
    const doc = new jsPDF({
      orientation,
      unit: "px",
      format: [pageWidth, PAGE_HEIGHT],
      compress: true,
    });

    let firstPage = true;
    for (const pageIdx of usedPages) {
      if (!firstPage) doc.addPage([pageWidth, PAGE_HEIGHT], orientation);
      firstPage = false;

      const canvas = document.createElement("canvas");
      canvas.width = pageWidth;
      canvas.height = PAGE_HEIGHT;
      const ctx = canvas.getContext("2d")!;

      // Fresh paper background
      const bgVp: Viewport = { width: pageWidth, height: PAGE_HEIGHT, scrollY: 0 };
      this.paperRenderer.render(ctx, file.paper, bgVp);

      // Content viewport for this page
      const contentVp: Viewport = { width: pageWidth, height: PAGE_HEIGHT, scrollY: pageIdx * PAGE_HEIGHT };

      // Images
      for (const imgObj of images) {
        const cachedImg = imageCache.get(imgObj.assetId);
        if (!cachedImg) continue;
        const screenY = imgObj.y - contentVp.scrollY;
        if (screenY + imgObj.height < -50 || screenY > PAGE_HEIGHT + 50) continue;
        ctx.drawImage(cachedImg, imgObj.x, screenY, imgObj.width, imgObj.height);
      }

      // Strokes
      this.strokeRenderer.renderAll(ctx, strokes, contentVp);

      // Text
      for (const t of texts) {
        const screenY = t.y - contentVp.scrollY;
        if (screenY + t.height < -50 || screenY > PAGE_HEIGHT + 50) continue;

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

      const imgData = canvas.toDataURL("image/png");
      doc.addImage(imgData, "PNG", 0, 0, pageWidth, PAGE_HEIGHT);
    }

    return doc.output("blob");
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
        if (ctx.measureText(test).width <= maxWidth) currentLine = test;
        else { lines.push(currentLine); currentLine = words[i]; }
      }
      lines.push(currentLine);
    }
    return lines;
  }

  private getUsedPages(strokes: StrokeObject[], images: ImageObject[], texts: TextObject[], totalPages: number): number[] {
    if (strokes.length === 0 && images.length === 0 && texts.length === 0) return [0];

    const pages = new Set<number>();

    for (const stroke of strokes) {
      for (const [, y] of stroke.points) pages.add(Math.floor(y / PAGE_HEIGHT));
    }
    for (const img of images) {
      pages.add(Math.floor(img.y / PAGE_HEIGHT));
      pages.add(Math.floor((img.y + img.height) / PAGE_HEIGHT));
    }
    for (const t of texts) {
      pages.add(Math.floor(t.y / PAGE_HEIGHT));
    }

    return Array.from(pages).sort((a, b) => a - b);
  }

  private getContentHeight(strokes: StrokeObject[], images: ImageObject[], texts: TextObject[]): number {
    let maxY = 0;

    for (const stroke of strokes) {
      for (const [, y] of stroke.points) { if (y > maxY) maxY = y; }
    }
    for (const img of images) {
      const bottom = img.y + img.height;
      if (bottom > maxY) maxY = bottom;
    }
    for (const t of texts) {
      const bottom = t.y + t.height;
      if (bottom > maxY) maxY = bottom;
    }

    return Math.max(maxY + 200, PAGE_HEIGHT);
  }
}
