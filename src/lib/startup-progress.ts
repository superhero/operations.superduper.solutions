// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { logger } from "./logger.ts";
import { setStartupReporter } from "./startup-reporter.ts";

const stages = [
  ["application", "Loading application"],
  ["settings-storage", "Opening settings storage"],
  ["settings", "Reading settings"],
  ["apply-settings", "Applying settings"],
  ["schemas", "Loading schemas"],
  ["interface", "Rendering interface"],
  ["workflow-storage", "Opening workflow storage"],
  ["workflow-files", "Opening workflow files"],
  ["find-workflows", "Finding saved workflows"],
  ["check-workflows", "Checking saved workflows"],
  ["read-workflows", "Reading workflows"],
  ["load-workflow", "Loading latest workflow"],
  ["canvas", "Restoring canvas"],
] as const;

export type StartupStage = typeof stages[number][0];
const startupLogger = logger.scope("startup");
let current = -1;
let lastMessage = "";
let finished = false;
let stageTimer: ReturnType<typeof setTimeout> | undefined;

function showProgress(step: number, text: string): number {
  const count = document.getElementById("startup-step");
  if (count) {
    count.style.width = `${String(stages.length).length}ch`;
    count.textContent = String(step);
  }
  const total = document.getElementById("startup-total");
  if (total) total.textContent = String(stages.length);
  clearTimeout(stageTimer);
  const label = document.getElementById("startup-stage");
  if (!label) return 0;
  const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
  const opacity = getComputedStyle(label).opacity;
  label.getAnimations().forEach(animation => animation.cancel());
  label.style.opacity = "0";
  label.animate([{ opacity }, { opacity: 0 }], { duration, easing: "ease", fill: "forwards" });
  stageTimer = setTimeout(() => {
    if (!label.isConnected) return;
    label.getAnimations().forEach(animation => animation.cancel());
    label.textContent = text;
    label.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: "ease", fill: "forwards" });
  }, 400);
  return 400 + duration;
}

import.meta.hot?.dispose(() => clearTimeout(stageTimer));

/** Report real work once; later background refreshes cannot restart startup. */
export function reportStartup(stage: StartupStage, detail?: string): void
{
  if (finished || typeof document === "undefined" || !document.getElementById("startup-status")) return;
  const index = stages.findIndex(([key]) => key === stage);
  const entry = stages[index];
  if (!entry || index < current) return;
  const message = `${entry[1]} — ${index + 1} of ${stages.length}${detail ? ` · ${detail}` : ""}`;
  if (message === lastMessage) return;
  current = index;
  lastMessage = message;
  showProgress(index + 1, `${entry[1]}${detail ? ` · ${detail}` : ""}`);
  startupLogger.info(message);
}

setStartupReporter(reportStartup);

/** Reveal the rendered app on success or failure, keeping its recovery controls usable. */
export function finishStartup(error?: unknown): void
{
  if (error !== undefined) startupLogger.error(error instanceof Error ? error : new Error("Application startup failed.", { cause: error }));
  if (finished || typeof document === "undefined") return;
  if (error === undefined && current < stages.length - 1) return;
  finished = true;
  const app = document.getElementById("app");
  app?.removeAttribute("inert");
  app?.removeAttribute("aria-busy");
  const labelReady = showProgress(error === undefined ? stages.length : Math.max(current + 1, 1),
    error === undefined ? "Completed" : "Loading failed");
  if (error !== undefined) {
    if (!app?.hasChildNodes()) return;
  }
  const loader = document.getElementById("startup-status");
  if (loader) {
    const root = document.documentElement;
    // Measure the final gutter without painting it, then reserve that space
    // inside the page so the fixed loader covers the entire viewport.
    if (!root.hasAttribute("data-error-overlay-open")) {
      root.setAttribute("data-startup-measuring", "");
      const gutter = Math.max(0, innerWidth - root.getBoundingClientRect().width);
      root.removeAttribute("data-startup-measuring");
      root.style.setProperty("--startup-gutter", `${gutter}px`);
    }
    loader.style.pointerEvents = "none";
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fade = loader.animate([{ opacity: 1 }, { opacity: 0 }], {
      // Keep the completed final stage visible before the fade begins.
      delay: labelReady + 200,
      duration: reducedMotion ? 0 : 200,
      easing: "ease",
      fill: "forwards",
    });
    const remove = () => {
      clearTimeout(stageTimer);
      loader.style.opacity = "0";
      loader.remove();
      root.style.removeProperty("--startup-gutter");
    };
    void fade.finished.then(remove, remove);
  }
  if (error === undefined) startupLogger.info(`Ready — ${stages.length} of ${stages.length}`);
}
