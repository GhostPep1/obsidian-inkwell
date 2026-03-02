import { TextFileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { InkCanvas } from "./canvas/InkCanvas";
import { Toolbar } from "./ui/Toolbar";
import { InkwellFile, createDefaultFile } from "./model/types";
import type InkwellPlugin from "./main";

export const INKWELL_VIEW_TYPE = "inkwell-view";

export class InkwellView extends TextFileView {
  private plugin: InkwellPlugin;
  private inkCanvas: InkCanvas | null = null;
  private toolbar: Toolbar | null = null;
  private canvasContainer: HTMLElement | null = null;
  private fileData: InkwellFile | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: InkwellPlugin) {
    super(leaf);
    this.plugin = plugin;
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

  // ─── Lifecycle ─────────────────────────────────────────────

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("inkwell-root");
  }

  async onClose(): Promise<void> {
    this.destroyCanvas();
  }

  // ─── File I/O ──────────────────────────────────────────────

  getViewData(): string {
    if (this.fileData && this.inkCanvas) {
      this.fileData = this.inkCanvas.getFile();
    }
    return JSON.stringify(this.fileData, null, 2);
  }

  setViewData(data: string, clear: boolean): void {
    try {
      this.fileData = JSON.parse(data) as InkwellFile;
    } catch {
      // Invalid or empty file — create default
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

  // ─── UI Construction ───────────────────────────────────────

  private buildUI(): void {
    if (!this.fileData) return;
    this.destroyCanvas();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("inkwell-root");

    // Toolbar
    this.toolbar = new Toolbar(contentEl, {
      onToolChange: (tool: import("./model/types").ToolType) => this.inkCanvas?.setTool(tool),
      onColorChange: (color: string) => this.inkCanvas?.setColor(color),
      onWidthChange: (width: number) => this.inkCanvas?.setWidth(width),
      onUndo: () => this.inkCanvas?.undo(),
      onRedo: () => this.inkCanvas?.redo(),
      onExport: () => this.exportPng(),
    });

    // Canvas container
    this.canvasContainer = contentEl.createDiv({ cls: "inkwell-canvas-container" });

    // Init canvas
    this.inkCanvas = new InkCanvas(
      this.canvasContainer,
      this.fileData,
      () => this.scheduleSave()
    );

    // Keyboard shortcuts
    this.registerDomEvent(contentEl, "keydown", this.onKeyDown.bind(this));
  }

  // ─── Auto-Save ─────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.requestSave();
      this.inkCanvas?.markClean();
    }, 1000); // Save 1 second after last stroke
  }

  // ─── Keyboard ──────────────────────────────────────────────

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
    }
  }

  // ─── Export ────────────────────────────────────────────────

  private exportPng(): void {
    if (!this.inkCanvas || !this.file) return;

    const dataUrl = this.inkCanvas.exportToPng();
    const link = document.createElement("a");
    link.download = `${this.file.basename}.png`;
    link.href = dataUrl;
    link.click();
    new Notice("Exported to PNG");
  }

  // ─── Cleanup ───────────────────────────────────────────────

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
