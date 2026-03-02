import { jsPDF } from "jspdf";
import { InkwellFile, Viewport, Stroke } from "../model/types";
import { PaperRenderer, PAGE_HEIGHT } from "../canvas/PaperRenderer";
import { StrokeRenderer } from "../canvas/StrokeRenderer";

export class PdfExporter {
  private paperRenderer: PaperRenderer;
  private strokeRenderer: StrokeRenderer;

  constructor() {
    this.paperRenderer = new PaperRenderer();
    this.strokeRenderer = new StrokeRenderer();
  }

  exportToPdfBlob(file: InkwellFile): Blob {
    const pageWidth = file.canvas.width;
    const totalHeight = this.getContentHeight(file);
    const totalPages = Math.max(1, Math.ceil(totalHeight / PAGE_HEIGHT));

    // Find which pages have strokes
    const usedPages = this.getUsedPages(file.strokes, totalPages);

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

      // Fresh paper background for every page (scrollY=0 gives top margin)
      const bgVp: Viewport = { width: pageWidth, height: PAGE_HEIGHT, scrollY: 0 };
      this.paperRenderer.render(ctx, file.paper, bgVp);

      // Strokes offset for this page
      const strokeVp: Viewport = { width: pageWidth, height: PAGE_HEIGHT, scrollY: pageIdx * PAGE_HEIGHT };
      this.strokeRenderer.renderAll(ctx, file.strokes, strokeVp);

      const imgData = canvas.toDataURL("image/png");
      doc.addImage(imgData, "PNG", 0, 0, pageWidth, PAGE_HEIGHT);
    }

    return doc.output("blob");
  }

  private getUsedPages(strokes: Stroke[], totalPages: number): number[] {
    if (strokes.length === 0) return [0]; // At least one page

    const pages = new Set<number>();
    for (const stroke of strokes) {
      for (const [, y] of stroke.points) {
        const page = Math.floor(y / PAGE_HEIGHT);
        pages.add(page);
      }
    }

    return Array.from(pages).sort((a, b) => a - b);
  }

  private getContentHeight(file: InkwellFile): number {
    if (file.strokes.length === 0) return PAGE_HEIGHT;

    let maxY = 0;
    for (const stroke of file.strokes) {
      for (const [, y] of stroke.points) {
        if (y > maxY) maxY = y;
      }
    }
    return Math.max(maxY + 200, PAGE_HEIGHT);
  }
}
