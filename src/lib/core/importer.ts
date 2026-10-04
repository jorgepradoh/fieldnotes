/**
 * One front door for every file the user hands us — dropped on the window,
 * picked from a dialog, or chosen in a menu. Files are routed by type; each
 * kind reports back through a toast so nothing happens silently.
 */
import { LayoutImportError, describeDropped, parseLayoutImport } from "./layouts";
import { getModule } from "./registry";
import { toast } from "./toast.svelte";
import { workspace } from "./workspace.svelte";

export type ImportKind = "layout" | "unsupported";

export function classifyFile(file: { name: string }): ImportKind {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "json") return "layout";
  return "unsupported";
}

async function importLayoutFile(file: File): Promise<void> {
  try {
    const parsed = parseLayoutImport(await file.text(), (id) => getModule(id));
    workspace.addImported(parsed);
    const note = describeDropped(parsed.dropped);
    toast(
      `Imported layout “${parsed.name}” with ${parsed.instances.length} module${parsed.instances.length === 1 ? "" : "s"}.${note ? `\n${note}` : ""}`,
      "success",
    );
  } catch (err) {
    const message = err instanceof LayoutImportError ? err.message : "Could not read that file.";
    toast(`${file.name}: ${message}`, "error");
  }
}

export async function importFiles(files: File[]): Promise<void> {
  for (const file of files) {
    switch (classifyFile(file)) {
      case "layout":
        await importLayoutFile(file);
        break;
      default:
        toast(`${file.name}: unsupported file type.`, "error");
    }
  }
}
