import { TextFileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { InkCanvas } from "./canvas/InkCanvas";
import { Toolbar, InteractionMode } from "./ui/Toolbar";
import { PdfExporter } from "./export/PdfExporter";
import { InkwellFile, createDefaultFile, ToolType, migrateV1 } from "./model/types";
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

  getViewType(): string { return INKWELL_VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? "Inkwell Note"; }
  getIcon(): string { return "pencil"; }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("inkwell-root");
  }

  async onClose(): Promise<void> { this.destroyCanvas(); }

  getViewData(): string {
    if (this.fileData && this.inkCanvas) {
      this.fileData = this.inkCanvas.getFile();
    }
    return JSON.stringify(this.fileData, null, 2);
  }

  setViewData(data: string, clear: boolean): void {
    try {
      const parsed = JSON.parse(data);
      if (parsed.strokes && !parsed.objects) {
        this.fileData = migrateV1(parsed);
        setTimeout(() => this.requestSave(), 500);
      } else {
        this.fileData = parsed as InkwellFile;
      }
      if (this.fileData.paper.marginTop === undefined) {
        this.fileData.paper.marginTop = this.fileData.paper.type === "ruled" ? 64 : 28;
      }
      if (!this.fileData.assets) {
        this.fileData.assets = {};
      }
    } catch {
      this.fileData = createDefaultFile("ruled");
    }

    if (clear) this.destroyCanvas();
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
      onModeChange: (mode: InteractionMode) => this.inkCanvas?.setMode(mode),
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
    if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); this.inkCanvas?.undo(); }
    else if (mod && e.key === "z" && e.shiftKey) { e.preventDefault(); this.inkCanvas?.redo(); }
    else if (mod && e.key === "y") { e.preventDefault(); this.inkCanvas?.redo(); }
  }

  private async exportPng(): Promise<void> {
    if (!this.inkCanvas || !this.file) return;
    try {
      const dataUrl = this.inkCanvas.exportToPng();
      const base64 = dataUrl.split(",")[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const folder = this.file.parent?.path ?? "";
      const pngPath = folder ? `${folder}/${this.file.basename}.png` : `${this.file.basename}.png`;

      const existing = this.app.vault.getAbstractFileByPath(pngPath);
      if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, bytes.buffer);
      else await this.app.vault.createBinary(pngPath, bytes.buffer);

      new Notice(`Saved ${this.file.basename}.png`);
    } catch (err) {
      new Notice(`PNG export failed: ${err}`);
    }
  }

  private async exportPdf(): Promise<void> {
    if (!this.fileData || !this.file) return;
    try {
      new Notice("Generating PDF...");
      const blob = this.pdfExporter.exportToPdfBlob(this.fileData);
      const buffer = await blob.arrayBuffer();

      const folder = this.file.parent?.path ?? "";
      const pdfPath = folder ? `${folder}/${this.file.basename}.pdf` : `${this.file.basename}.pdf`;

      const existing = this.app.vault.getAbstractFileByPath(pdfPath);
      if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buffer);
      else await this.app.vault.createBinary(pdfPath, buffer);

      new Notice(`Saved ${this.file.basename}.pdf`);
    } catch (err) {
      new Notice(`PDF export failed: ${err}`);
    }
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
