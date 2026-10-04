/**
 * File in / file out, working both inside Tauri and in a plain browser.
 *
 * In: an `<input type=file>` (no fs plugin or broad disk scope needed — the
 * webview hands us File objects, same as for drag-and-drop).
 * Out: Tauri's native save dialog + fs write inside the app (anchor downloads
 * are unreliable in the webviews), an anchor download in the browser.
 */
import { inTauri } from "./net";

/** Open the OS file picker. Must be called straight from a user gesture. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    // WebKit can collect a detached input before `change` fires; keep it in the DOM.
    document.body.appendChild(input);
    const done = (files: File[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    input.click();
  });
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** Ask where to save, then write. Resolves "cancelled" if the user backs out. */
export async function saveTextFile(
  defaultName: string,
  text: string,
  mime = "text/plain",
): Promise<"saved" | "cancelled"> {
  if (inTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = extensionOf(defaultName);
    const path = await save({
      defaultPath: defaultName,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!path) return "cancelled";
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, text);
    return "saved";
  }

  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
