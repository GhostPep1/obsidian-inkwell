import { ToolType } from "../model/types";

const COLORS = [
  { name: "Black",  value: "#1A1A2E" },
  { name: "Blue",   value: "#2563EB" },
  { name: "Red",    value: "#DC2626" },
  { name: "Green",  value: "#16A34A" },
  { name: "Purple", value: "#9333EA" },
  { name: "Gray",   value: "#6B7280" },
];

const WIDTHS = [
  { name: "Fine",   value: 2 },
  { name: "Medium", value: 4 },
  { name: "Bold",   value: 8 },
];

export interface ToolbarCallbacks {
  onToolChange: (tool: ToolType) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportPng: () => void;
  onExportPdf: () => void;
}

export class Toolbar {
  private container: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private activeTool: ToolType = "pen";
  private activeColor = COLORS[0].value;
  private activeWidth = WIDTHS[1].value;

  constructor(parent: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parent.createDiv({ cls: "inkwell-toolbar" });
    this.build();
  }

  private build(): void {
    // ─── Tools ──────────────────────────────────
    const toolGroup = this.container.createDiv({ cls: "inkwell-toolbar-group" });
    this.addToolButton(toolGroup, "pen", "✏️", "Pen");
    this.addToolButton(toolGroup, "highlighter", "🖍️", "Highlighter");
    this.addToolButton(toolGroup, "eraser", "🧹", "Eraser");

    this.container.createDiv({ cls: "inkwell-toolbar-sep" });

    // ─── Colors ─────────────────────────────────
    const colorGroup = this.container.createDiv({ cls: "inkwell-toolbar-group" });
    for (const color of COLORS) {
      const btn = colorGroup.createEl("button", {
        cls: "inkwell-color-btn",
        attr: { "aria-label": color.name, "data-color": color.value },
      });
      btn.style.backgroundColor = color.value;
      if (color.value === this.activeColor) btn.addClass("is-active");

      btn.addEventListener("click", () => {
        colorGroup.querySelectorAll(".inkwell-color-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        this.activeColor = color.value;
        this.callbacks.onColorChange(color.value);
      });
    }

    this.container.createDiv({ cls: "inkwell-toolbar-sep" });

    // ─── Widths ─────────────────────────────────
    const widthGroup = this.container.createDiv({ cls: "inkwell-toolbar-group" });
    for (const w of WIDTHS) {
      const btn = widthGroup.createEl("button", {
        cls: "inkwell-width-btn",
        text: w.name,
        attr: { "data-width": String(w.value) },
      });
      if (w.value === this.activeWidth) btn.addClass("is-active");

      btn.addEventListener("click", () => {
        widthGroup.querySelectorAll(".inkwell-width-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        this.activeWidth = w.value;
        this.callbacks.onWidthChange(w.value);
      });
    }

    this.container.createDiv({ cls: "inkwell-toolbar-sep" });

    // ─── Undo/Redo ──────────────────────────────
    const histGroup = this.container.createDiv({ cls: "inkwell-toolbar-group" });
    const undoBtn = histGroup.createEl("button", { cls: "inkwell-tool-btn", text: "↩", attr: { "aria-label": "Undo" } });
    undoBtn.addEventListener("click", () => this.callbacks.onUndo());

    const redoBtn = histGroup.createEl("button", { cls: "inkwell-tool-btn", text: "↪", attr: { "aria-label": "Redo" } });
    redoBtn.addEventListener("click", () => this.callbacks.onRedo());

    this.container.createDiv({ cls: "inkwell-toolbar-sep" });

    // ─── Export ─────────────────────────────────
    const exportGroup = this.container.createDiv({ cls: "inkwell-toolbar-group" });

    const pngBtn = exportGroup.createEl("button", { cls: "inkwell-tool-btn", text: "🖼️", attr: { "aria-label": "Export PNG" } });
    pngBtn.addEventListener("click", () => this.callbacks.onExportPng());

    const pdfBtn = exportGroup.createEl("button", { cls: "inkwell-tool-btn", text: "📄", attr: { "aria-label": "Export PDF" } });
    pdfBtn.addEventListener("click", () => this.callbacks.onExportPdf());
  }

  private addToolButton(group: HTMLElement, tool: ToolType, icon: string, label: string): void {
    const btn = group.createEl("button", {
      cls: "inkwell-tool-btn",
      text: icon,
      attr: { "aria-label": label, "data-tool": tool },
    });
    if (tool === this.activeTool) btn.addClass("is-active");

    btn.addEventListener("click", () => {
      group.querySelectorAll(".inkwell-tool-btn").forEach((b) => b.removeClass("is-active"));
      btn.addClass("is-active");
      this.activeTool = tool;
      this.callbacks.onToolChange(tool);
    });
  }

  destroy(): void {
    this.container.remove();
  }
}
