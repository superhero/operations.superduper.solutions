// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Check server templates before URL parsing can conceal markers by encoding them. */
export function serverUrlHasPlaceholder(value: string): boolean
{
  return /[<>{}]|%(?:3c|3e|7b|7d)/i.test(value);
}

export const telegramBotOrigin = "https://api.telegram.org";
export const telegramBotTemplate = `${telegramBotOrigin}/bot{botToken}`;
export type PrivatePathProfile = "telegram-bot";
export function privatePathProfile(value: unknown): PrivatePathProfile | undefined {
  if (value === undefined) return;
  if (value === "telegram-bot") return value;
  throw new Error("This private token path profile is not supported.");
}
export function telegramPathSecurity(): { name: string; kind: "apiKey"; path: "telegram-bot" }[][] {
  return [[{ name: "Bot token", kind: "apiKey", path: "telegram-bot" }]];
}
/** Only this explicit, non-secret template can acquire a private token slot. */
export function telegramPrivateEndpoint(document: Record<string, any>, source: Record<string, any>, item: Record<string, any> = {}): string | undefined {
  if (!privatePathProfile(source["x-operations-private-path"])) return;
  const servers = document.servers, server = servers?.[0];
  if (!Array.isArray(servers) || servers.length !== 1 || server?.url !== telegramBotTemplate
    || server.variables?.botToken?.default !== "<bot_token>" || Object.keys(server.variables).length !== 1
    || document.security !== undefined || source.security !== undefined || source.servers !== undefined || item.servers !== undefined)
    throw new Error("The private bot token path requires the reviewed Telegram HTTPS template without endpoint or authentication overrides.");
  return telegramBotOrigin;
}
