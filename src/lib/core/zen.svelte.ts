function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

class ZenState {
  active = $state(false);

  toggle(): void {
    this.active = !this.active;
    if (inTauri()) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(this.active))
        .catch(() => {});
    }
  }
}

export const zen = new ZenState();
