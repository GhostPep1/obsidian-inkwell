import { TextFileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { InkCanvas } from "./canvas/InkCanvas";
import { Toolbar } from "./ui/Toolbar";
import { PdfExporter } from "./export/PdfExporter";
import { InkwellFile, createDefaultFile, ToolType } from "./model/types";
import type InkwellPlugin from "./main";

export const INKWELL_VIEW_TYPE = "inkwell-view";

export class InkwellView extends TextFileView {
  private plugin: InkwellPlugin;
  private inkCanvas: InkCanvas | null = null;
  private toolbar: Toolbar | null = null;
  private canvasContainer: HTMLElement | null = null;
  private fileData: InkwellFile | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pdfExporter: PdfExporter;

  constructor(leaf: WorkspaceLeaf, plugin: InkwellPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.pdfExporter = new PdfExporter();
  }

  getViewType(): string {
    return INKWELL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Inkwell Note";
  }

  getIcon(): string {
    return "pencil";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("inkwell-root");
  }

  async onClose(): Promise<void> {
    this.destroyCanvas();
  }

  getViewData(): string {
    if (this.fileData && this.inkCanvas) {
      this.fileData = this.inkCanvas.getFile();
    }
    return JSON.stringify(this.fileData, null, 2);
  }

  setViewData(data: string, clear: boolean): void {
    try {
      this.fileData = JSON.parse(data) as InkwellFile;
      // Migrate old files without marginTop
      if (this.fileData.paper.marginTop === undefined) {
        this.fileData.paper.marginTop = this.fileData.paper.type === "ruled" ? 64 : 28;
      }
    } catch {
      this.fileData = createDefaultFile("ruled");
    }

    if (clear) {
      this.destroyCanvas();
    }
    this.buildUI();
  }

  clear(): void {
    this.fileData = createDefaultFile("ruled");
    this.destroyCanvas();
  }

  private buildUI(): void {
    if (!this.fileData) return;
    this.destroyCanvas();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("inkwell-root");

    this.toolbar = new Toolbar(contentEl, {
      onToolChange: (tool: ToolType) => this.inkCanvas?.setTool(tool),
      onColorChange: (color: string) => this.inkCanvas?.setColor(color),
      onWidthChange: (width: number) => this.inkCanvas?.setWidth(width),
      onUndo: () => this.inkCanvas?.undo(),
      onRedo: () => this.inkCanvas?.redo(),
      onExportPng: () => this.exportPng(),
      onExportPdf: () => this.exportPdf(),
      onPrint: () => this.printNote(),
    });

    this.canvasContainer = contentEl.createDiv({ cls: "inkwell-canvas-container" });

    this.inkCanvas = new InkCanvas(
      this.canvasContainer,
      this.fileData,
      () => this.scheduleSave()
    );

    this.registerDomEvent(contentEl, "keydown", this.onKeyDown.bind(this));
  }

  private scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.requestSave();
      this.inkCanvas?.markClean();
    }, 1000);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.inkCanvas?.undo();
    } else if (mod && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      this.inkCanvas?.redo();
    } else if (mod && e.key === "y") {
      e.preventDefault();
      this.inkCanvas?.redo();
    } else if (mod && e.key === "p") {
      e.preventDefault();
      this.printNote();
    }
  }

  private exportPng(): void {
    if (!this.inkCanvas || !this.file) return;
    const dataUrl = this.inkCanvas.exportToPng();
    const link = document.createElement("a");
    link.download = `${this.file.basename}.png`;
    link.href = dataUrl;
    link.click();
    new Notice("Exported to PNG");
  }

  private async exportPdf(): Promise<void> {
    if (!this.fileData || !this.file) return;
    try {
      new Notice("Generating PDF...");
      await this.pdfExporter.exportToPdf(this.fileData, `${this.file.basename}.pdf`);
      new Notice("Exported to PDF");
    } catch (err) {
      new Notice(`PDF export failed: ${err}`);
      console.error("Inkwell: PDF export failed", err);
    }
  }

  private printNote(): void {
    if (!this.inkCanvas) return;
    const dataUrl = this.inkCanvas.exportToPng();
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      new Notice("Popup blocked — allow popups to print");
      return;
    }
    printWindow.document.write(`
      <html><head><title>Print Inkwell Note</title>
      <style>
        @media print { body { margin: 0; } img { width: 100%; height: auto; } }
        body { margin: 0; display: flex; justify-content: center; }
        img { max-width: 100%; }
      </style></head>
      <body><img src="${dataUrl}" onload="window.print(); window.close();" /></body></html>
    `);
  }

  private destroyCanvas(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.inkCanvas?.destroy();
    this.inkCanvas = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.canvasContainer?.remove();
    this.canvasContainer = null;
  }
}
