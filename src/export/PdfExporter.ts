import { jsPDF } from "jspdf";
import { InkwellFile, Viewport } from "../model/types";
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

      const scrollY = page * pageHeight;
      const vp: Viewport = { width: pageWidth, height: pageHeight, scrollY };

      const canvas = document.createElement("canvas");
      canvas.width = pageWidth;
      canvas.height = pageHeight;
      const ctx = canvas.getContext("2d")!;

      this.paperRenderer.render(ctx, file.paper, vp);
      this.strokeRenderer.renderAll(ctx, file.strokes, vp);

      const imgData = canvas.toDataURL("image/png");
      doc.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
    }

    return doc.output("blob");
  }

  private getContentHeight(file: InkwellFile): number {
    if (file.strokes.length === 0) return file.canvas.height;

    let maxY = 0;
    for (const stroke of file.strokes) {
      for (const [, y] of stroke.points) {
        if (y > maxY) maxY = y;
      }
    }
    return Math.max(maxY + 200, file.canvas.height);
  }
}
