// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError } from "./types.ts";
import type { GitlabOAuthCallback, GitlabOAuthTask } from "./gitlab-config.ts";

export const oauthCallbackMessage = "operations-gitlab-oauth-callback";
export function waitGitlabCallback(popup: Window, task: GitlabOAuthTask, signal: AbortSignal, profile: "gitlab" | "bluesky" = "gitlab"): Promise<GitlabOAuthCallback & { iss?: string }> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("operations-" + profile + "-oauth:" + task.state);
    const cleanup = () => { window.removeEventListener("message", message); signal.removeEventListener("abort", cancel); clearInterval(timer); channel?.close(); };
    const cancel = () => { if (finished) return; finished = true; cleanup(); popup.close(); reject(new VaultError("CANCELLED")); };
    const accept = (value: unknown) => {
      if (finished || signal.aborted || !value || typeof value !== "object") return;
      const data = value as Record<string, unknown>;
      if (data.source !== (profile === "gitlab" ? oauthCallbackMessage : "operations-bluesky-oauth-callback") || data.state !== task.state
        || typeof data.code !== "string" && typeof data.error !== "string") return;
      if (typeof data.code === "string" && data.code.length > 4096 || typeof data.error === "string" && data.error.length > 128) return;
      if (profile === "bluesky" && (typeof data.iss !== "string" || data.iss.length > 2048)) return;
      finished = true; cleanup(); popup.close();
      resolve({ state: task.state, ...(profile === "bluesky" ? { iss: data.iss as string } : {}), ...(typeof data.code === "string" ? { code: data.code } : {}), ...(typeof data.error === "string" ? { error: data.error } : {}) });
    };
    const message = (event: MessageEvent) => { if (event.origin === window.location.origin && event.source === popup) accept(event.data); };
    // COOP can sever the WindowProxy during provider navigation. Its `closed`
    // flag then becomes true even though sign-in continues in that window.
    const timer = setInterval(() => { if (Date.now() >= task.expiresAt) cancel(); }, 250);
    window.addEventListener("message", message); channel?.addEventListener("message", event => accept(event.data));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/** Called only by the early reserved callback branch, after URL cleanup. */
export function deliverGitlabCallback(callback: GitlabOAuthCallback & { iss?: string }, profile: "gitlab" | "bluesky" = "gitlab"): void {
  const payload = { source: profile === "gitlab" ? oauthCallbackMessage : "operations-bluesky-oauth-callback", ...callback };
  const stage = document.getElementById("startup-stage");
  if (stage) stage.textContent = "Returning to your connection…";
  if (window.opener) window.opener.postMessage(payload, window.location.origin);
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("operations-" + profile + "-oauth:" + callback.state);
    channel.postMessage(payload); setTimeout(() => channel.close(), 100);
  }
  setTimeout(() => window.close(), 150);
}

export async function waitAtprotoCallback(popup: Window, task: import("./atproto-config.ts").AtprotoOAuthTask, signal: AbortSignal): Promise<import("./atproto-config.ts").AtprotoOAuthCallback> {
  const value = await waitGitlabCallback(popup, task, signal, "bluesky");
  if (typeof value.iss !== "string") throw new VaultError("AUTHORIZATION");
  return { ...value, iss: value.iss };
}
