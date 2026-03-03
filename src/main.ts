import { Plugin } from "obsidian";
import { InkwellView, INKWELL_VIEW_TYPE } from "./InkwellView";

export default class InkwellPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(INKWELL_VIEW_TYPE, (leaf) => new InkwellView(leaf, this));
    this.registerExtensions(["inkwell"], INKWELL_VIEW_TYPE);
  }

  async onunload(): Promise<void> {}
}
