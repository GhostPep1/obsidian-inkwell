import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { InkwellView, INKWELL_VIEW_TYPE } from "./InkwellView";
import { PaperType, createDefaultFile } from "./model/types";

export default class InkwellPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(INKWELL_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      return new InkwellView(leaf, this);
    });

    this.registerExtensions(["inkwell"], INKWELL_VIEW_TYPE);

    this.addCommand({
      id: "create-inkwell-note",
      name: "New handwritten note",
      callback: () => this.createNote("ruled"),
    });

    this.addCommand({
      id: "create-inkwell-ruled",
      name: "New handwritten note (ruled paper)",
      callback: () => this.createNote("ruled"),
    });

    this.addCommand({
      id: "create-inkwell-grid",
      name: "New handwritten note (grid paper)",
      callback: () => this.createNote("grid"),
    });

    this.addCommand({
      id: "create-inkwell-dot",
      name: "New handwritten note (dot grid)",
      callback: () => this.createNote("dot"),
    });

    this.addCommand({
      id: "create-inkwell-blank",
      name: "New handwritten note (blank)",
      callback: () => this.createNote("blank"),
    });

    this.addRibbonIcon("pencil", "New Inkwell note", () => {
      this.createNote("ruled");
    });
  }

  async onunload(): Promise<void> {}

  async createNote(paperType: PaperType): Promise<void> {
    const file = createDefaultFile(paperType);
    const content = JSON.stringify(file);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `Inkwell ${timestamp}.inkwell`;

    const activeFile = this.app.workspace.getActiveFile();
    const folder = activeFile?.parent?.path ?? "";
    const path = folder ? `${folder}/${filename}` : filename;

    try {
      const newFile = await this.app.vault.create(path, content);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(newFile);
      new Notice(`Created ${paperType} note`);
    } catch (err) {
      new Notice(`Failed to create note: ${err}`);
    }
  }
}
