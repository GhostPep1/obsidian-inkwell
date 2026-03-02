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

  async exportToPdf(file: InkwellFile, filename: string): Promise<void> {
    const jsPDF = await this.loadJsPDF();

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

    doc.save(filename);
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

  private async loadJsPDF(): Promise<any> {
    if ((window as any).jspdf) {
      return (window as any).jspdf.jsPDF;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js";
      script.onload = () => {
        const jsPDF = (window as any).jspdf?.jsPDF;
        if (jsPDF) resolve(jsPDF);
        else reject(new Error("jsPDF failed to load"));
      };
      script.onerror = () => reject(new Error("Failed to load jsPDF script"));
      document.head.appendChild(script);
    });
  }
}
