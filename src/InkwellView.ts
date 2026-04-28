import { TextFileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { InkCanvas } from "./canvas/InkCanvas";
import { Toolbar, InteractionMode } from "./ui/Toolbar";
import { PdfExporter } from "./export/PdfExporter";
import { InkwellFile, createDefaultFile, ToolType, migrateV1, generateId } from "./model/types";
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
  if (!this.fileData) return "";

  // Force canonical field order on every save. Legacy files have `modified`
  // and `assets` in the wrong positions; if we re-stringify in source order
  // we bake their misplacement into chunk-1 territory and break LiveSync
  // dedup file-wide. Rebuilding in declared order pins volatile fields
  // (`modified`) to the end of the file.
  const f = this.fileData;
  const ordered = {
    version: f.version,
    created: f.created,
    paper: f.paper,
    canvas: f.canvas,
    objects: f.objects,
    assets: f.assets,
    modified: f.modified,
  };
  return JSON.stringify(ordered);
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
      if (!this.fileData.assets) this.fileData.assets = {};
      if (!this.fileData.objects) this.fileData.objects = {};
      // Strip legacy viewport state. scrollY was serialized in <=0.13.0;
      // it cascades chunk-1 byte shifts file-wide via length-shifting floats.
      if ("scrollY" in this.fileData.canvas) delete (this.fileData.canvas as any).scrollY;
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

  // ─── Asset URL Resolver ─────────────────────────────────────

  private resolveAssetUrl = (assetId: string): string | null => {
    if (!this.fileData) return null;
    const asset = this.fileData.assets[assetId];
    if (!asset) return null;

    const tFile = this.app.vault.getAbstractFileByPath(asset.vaultPath);
    if (tFile instanceof TFile) {
      return this.app.vault.getResourcePath(tFile);
    }
    return null;
  };

  // ─── Image Insertion: Native File Picker ────────────────────
  // On iOS this shows Camera / Photo Library / Files

  private insertImage(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file) {
        await this.handleExternalImage(file);
      }
      input.remove();
    });

    // Clean up if they cancel
    input.addEventListener("cancel", () => input.remove());
    // Fallback cleanup
    setTimeout(() => { if (input.parentNode) input.remove(); }, 120000);

    input.click();
  }

  // ─── Image Insertion: Clipboard Paste ───────────────────────

  private handlePaste = async (e: ClipboardEvent): Promise<void> => {
    if (!e.clipboardData) return;

    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;

    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (!blob) return;

    await this.handleExternalImage(blob);
  };

  // ─── Shared: Save external image to vault, then insert ──────

  private async handleExternalImage(file: File | Blob): Promise<void> {
    if (!this.inkCanvas || !this.fileData || !this.file) return;

    try {
      // Read file data
      const buffer = await file.arrayBuffer();

      // Determine filename and mime
      const isFile = file instanceof File;
      const originalName = isFile ? (file as File).name : "pasted-image";
      const mimeType = file.type || "image/png";
      const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const timestamp = Date.now();
      const fileName = isFile
        ? (file as File).name
        : `paste-${timestamp}.${ext}`;

      // Save to vault: same folder as the .inkwell file
      const folder = this.file.parent?.path ?? "";
      const assetDir = folder ? `${folder}/inkwell-assets` : "inkwell-assets";

      // Ensure asset directory exists
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      // Deduplicate filename
      let assetPath = `${assetDir}/${fileName}`;
      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(assetPath)) {
        const base = fileName.replace(/\.[^.]+$/, "");
        assetPath = `${assetDir}/${base}-${counter}.${ext}`;
        counter++;
      }

      // Write to vault
      await this.app.vault.createBinary(assetPath, buffer);

      // Create asset entry
      const assetId = generateId("asset");
      this.fileData.assets[assetId] = {
        vaultPath: assetPath,
        mimeType,
      };

      // Load to get dimensions, then insert
      const tFile = this.app.vault.getAbstractFileByPath(assetPath);
      if (!(tFile instanceof TFile)) {
        new Notice("Failed to save image");
        return;
      }

      const url = this.app.vault.getResourcePath(tFile);
      const img = new Image();

      img.onload = () => {
        const maxWidth = 400;
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }

        this.fileData!.assets[assetId].originalWidth = img.naturalWidth;
        this.fileData!.assets[assetId].originalHeight = img.naturalHeight;

        const vp = this.inkCanvas!.getViewport();
        const docX = Math.max(20, (vp.width - width) / 2);
        const docY = vp.scrollY + Math.max(20, (vp.height - height) / 2);

        this.inkCanvas!.addImage(assetId, docX, docY, width, height);
        new Notice(`Inserted ${fileName}`);
      };

      img.onerror = () => {
        delete this.fileData!.assets[assetId];
        new Notice(`Failed to load image`);
      };

      img.src = url;
    } catch (err) {
      new Notice(`Image insert failed: ${err}`);
      console.error("Inkwell: image insert failed", err);
    }
  }

  // ─── UI Build ───────────────────────────────────────────────

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
      onInsertImage: () => this.insertImage(),
    });

    this.canvasContainer = contentEl.createDiv({ cls: "inkwell-canvas-container" });

    this.inkCanvas = new InkCanvas(
      this.canvasContainer,
      this.fileData,
      () => this.scheduleSave(),
      this.resolveAssetUrl,
    );

    // Clipboard paste for images
    this.registerDomEvent(contentEl, "paste", this.handlePaste as EventListener);
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

  // ─── Export ─────────────────────────────────────────────────

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
    if (!this.fileData || !this.file || !this.inkCanvas) return;
    try {
      new Notice("Generating PDF...");
      const blob = this.pdfExporter.exportToPdfBlob(this.fileData, this.inkCanvas.getImageCache());
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

  // ─── Cleanup ────────────────────────────────────────────────

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
