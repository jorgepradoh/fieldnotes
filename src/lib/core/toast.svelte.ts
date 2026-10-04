/**
 * Tiny transient-message service. Anything (imports, exports, errors that
 * have no module of their own) can call `toast(...)`; <Toasts/> renders them.
 */
export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export const toasts: Toast[] = $state([]);
let nextId = 1;

export function dismissToast(id: number): void {
  const at = toasts.findIndex((t) => t.id === id);
  if (at >= 0) toasts.splice(at, 1);
}

export function toast(text: string, kind: ToastKind = "info", ms?: number): void {
  const id = nextId++;
  toasts.push({ id, kind, text });
  // Errors linger a little longer so they can be read.
  setTimeout(() => dismissToast(id), ms ?? (kind === "error" ? 8000 : 4500));
}
