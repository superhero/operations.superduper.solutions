// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Keep this entry free of static imports: a failed dependency must reach the
// recovery handler before the application or its diagnostics can initialize.
type StartupHost = {
  document: Document;
  location: Pick<Location, "pathname" | "search" | "reload">;
  readonly sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  console: Pick<Console, "error">;
};

export async function loadApplication(load: () => Promise<unknown>, host: StartupHost, development = false): Promise<void> {
  const retryKey = "v1/startup/module-reload";
  const clearRetry = () => {
    try { host.sessionStorage.removeItem(retryKey); }
    catch { /* Startup also works when browser storage is unavailable. */ }
  };
  try {
    await load();
    clearRetry();
  } catch (error) {
    host.console.error("Application startup failed:", error);
    const app = host.document.getElementById("app");
    const moduleFailure = error instanceof TypeError &&
      /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message);
    if (development && moduleFailure && !app?.hasChildNodes()) {
      try {
        const page = host.location.pathname + host.location.search;
        if (host.sessionStorage.getItem(retryKey) !== page) {
          // Record before navigating, so persistent failures cannot reload forever.
          host.sessionStorage.setItem(retryKey, page);
          host.location.reload();
          return;
        }
      } catch { /* Without a durable retry guard, offer only a manual reload. */ }
    }

    const loader = host.document.getElementById("startup-status");
    if (!loader) return;
    const label = host.document.getElementById("startup-stage");
    if (label) {
      label.getAnimations().forEach(animation => animation.cancel());
      label.style.animation = "none";
      label.style.opacity = "1";
      label.textContent = "Loading failed";
    }
    host.document.getElementById("startup-recovery")?.remove();
    const recovery = host.document.createElement("div");
    recovery.id = "startup-recovery";
    recovery.setAttribute("role", "alert");
    const message = host.document.createElement("p");
    message.textContent = error instanceof Error ? error.message : String(error);
    const reload = host.document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => { clearRetry(); host.location.reload(); });
    recovery.append(message, reload);
    loader.append(recovery);
  }
}

if (typeof window !== "undefined") {
  void loadApplication(async () => {
    const { initializeApplication } = await import("./application.ts");
    await initializeApplication();
  }, window, import.meta.env.DEV);
}
