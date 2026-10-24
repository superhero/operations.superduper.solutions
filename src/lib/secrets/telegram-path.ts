// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { telegramBotOrigin } from "../server-url.ts";
import { VaultError, type ApprovedOperation } from "./types.ts";

/** A single token path segment; no interpolation language, percent encoding or arbitrary host. */
export function telegramPrivateUrl(descriptor: ApprovedOperation, path: string, token: string): URL {
  if (descriptor.operation.privatePath !== "telegram-bot" || descriptor.origin !== telegramBotOrigin
    || !/^\/[A-Za-z][A-Za-z0-9]{0,127}$/.test(path) || path !== descriptor.operation.path
    || !/^[0-9]{1,20}:[A-Za-z0-9_-]{1,256}$/.test(token)) throw new VaultError("PERMISSION");
  const url = new URL(`${telegramBotOrigin}/bot${token}${path}`);
  if (url.origin !== telegramBotOrigin || url.pathname !== `/bot${token}${path}` || url.search || url.hash) throw new VaultError("PERMISSION");
  return url;
}
/** Include normalized and case-varied URL escapes, including double-encoded error echoes. */
export function privateUrlRedactions(value: string): string[] {
  const result = new Set([value]);
  let current = [value];
  for (let depth = 0; depth < 2; depth++) {
    current = current.flatMap(item => {
      const encoded = encodeURIComponent(item);
      return [encoded, encoded.replace(/%[a-f0-9]{2}/gi, escape => escape.toLowerCase())];
    });
    current.forEach(item => result.add(item));
  }
  return [...result];
}
