import { jsPDF } from "jspdf";
import { InkwellFile, Viewport, Stroke } from "../model/types";
import { PaperRenderer } from "../canvas/PaperRenderer";
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
    const pageHeight = 1600;
    const totalHeight = this.getContentHeight(file);
    const numPages = Math.max(1, Math.ceil(totalHeight / pageHeight));

    const orientation = pageWidth > pageHeight ? "landscape" : "portrait";
    const doc = new jsPDF({
      orientation,
      unit: "px",
      format: [pageWidth, pageHeight],
      compress: true,
    });

    for (let page = 0; page < numPages; page++) {
      if (page > 0) doc.addPage([pageWidth, pageHeight], orientation);

      const canvas = document.createElement("canvas");
      canvas.width = pageWidth;
      canvas.height = pageHeight;
      const ctx = canvas.getContext("2d")!;

      // Background: render as fresh sheet (scrollY=0) so every page has margin
      const bgVp: Viewport = { width: pageWidth, height: pageHeight, scrollY: 0 };
      this.paperRenderer.render(ctx, file.paper, bgVp);

      // Strokes: render with actual scroll offset for this page
      const strokeVp: Viewport = { width: pageWidth, height: pageHeight, scrollY: page * pageHeight };
      this.strokeRenderer.renderAll(ctx, file.strokes, strokeVp);

      const imgData = canvas.toDataURL("image/png");
      doc.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
    }

    return doc.output("blob");
  }

  private getContentHeight(file: InkwellFile): number {
    if (file.strokes.length === 0) return 1600; // Single page if empty

    let maxY = 0;
    for (const stroke of file.strokes) {
      for (const [, y] of stroke.points) {
        if (y > maxY) maxY = y;
      }
    }
    return Math.max(maxY + 200, 1600);
  }
}
