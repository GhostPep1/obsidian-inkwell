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

export type InteractionMode = "draw" | "text";

export interface ToolbarCallbacks {
  onToolChange: (tool: ToolType) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportPng: () => void;
  onExportPdf: () => void;
  onModeChange: (mode: InteractionMode) => void;
  onInsertImage: () => void;
}

export class Toolbar {
  private container: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private activeTool: ToolType = "pen";
  private activeColor = COLORS[0].value;
  private activeWidth = WIDTHS[1].value;
  private activeMode: InteractionMode = "draw";
  private toolGroup!: HTMLElement;

  constructor(parent: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parent.createDiv({ cls: "inkwell-toolbar" });
    this.build();
  }

  private build(): void {
    // ─── Tools + Modes (unified group) ─────────
    // Pen/Highlighter/Eraser → draw mode, T → text mode
    this.toolGroup = this.container.createDiv({ cls: "inkwell-toolbar-group" });

    this.addDrawToolButton(this.toolGroup, "pen", "✏️", "Pen");
    this.addDrawToolButton(this.toolGroup, "highlighter", "🖍️", "Highlighter");
    this.addDrawToolButton(this.toolGroup, "eraser", "🧹", "Eraser");

    // Text mode button — same group, mutually exclusive
    const textBtn = this.toolGroup.createEl("button", {
      cls: "inkwell-tool-btn",
      text: "T",
      attr: { "aria-label": "Text Mode", "data-tool": "text" },
    });
    textBtn.style.fontWeight = "bold";
    textBtn.style.fontSize = "18px";
    textBtn.addEventListener("click", () => {
      this.toolGroup.querySelectorAll(".inkwell-tool-btn").forEach((b) => b.removeClass("is-active"));
      textBtn.addClass("is-active");
      this.activeMode = "text";
      this.callbacks.onModeChange("text");
    });

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

    // ─── Insert ─────────────────────────────────
    const insertGroup = this.container.createDiv({ cls: "inkwell-toolbar-group" });

    const imgBtn = insertGroup.createEl("button", { cls: "inkwell-tool-btn", text: "🏞️", attr: { "aria-label": "Insert Image" } });
    imgBtn.addEventListener("click", () => this.callbacks.onInsertImage());

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

  private addDrawToolButton(group: HTMLElement, tool: ToolType, icon: string, label: string): void {
    const btn = group.createEl("button", {
      cls: "inkwell-tool-btn",
      text: icon,
      attr: { "aria-label": label, "data-tool": tool },
    });
    if (tool === this.activeTool && this.activeMode === "draw") btn.addClass("is-active");

    btn.addEventListener("click", () => {
      // Deactivate ALL buttons in the group (including T)
      group.querySelectorAll(".inkwell-tool-btn").forEach((b) => b.removeClass("is-active"));
      btn.addClass("is-active");
      this.activeTool = tool;
      this.activeMode = "draw";
      this.callbacks.onToolChange(tool);
      this.callbacks.onModeChange("draw");
    });
  }

  destroy(): void {
    this.container.remove();
  }
}
