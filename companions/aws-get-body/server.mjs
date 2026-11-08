// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { lstat, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAwsGetBodyCompanion } from "./host.mjs";
export async function runAwsGetBodyCompanion(environment = process.env) {
  const file = environment.OPERATIONS_EFS_PAIRING_KEY_FILE, metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.mode & 0o077 || metadata.uid !== process.getuid?.() || metadata.size > 512)
    throw new Error("An owner-only EFS pairing key file is required.");
  const hostname = environment.OPERATIONS_EFS_LISTEN_HOST ?? "127.0.0.1";
  const companion = createAwsGetBodyCompanion({ publicOrigin: environment.OPERATIONS_EFS_PUBLIC_ORIGIN,
    pairingKey: (await readFile(file, "utf8")).trim(), allowedOrigins: JSON.parse(environment.OPERATIONS_EFS_ALLOWED_ORIGINS ?? "[]") });
  const tls = environment.OPERATIONS_EFS_TLS_KEY_FILE && environment.OPERATIONS_EFS_TLS_CERT_FILE
    ? { key: await readFile(environment.OPERATIONS_EFS_TLS_KEY_FILE), cert: await readFile(environment.OPERATIONS_EFS_TLS_CERT_FILE) } : undefined;
  if (!tls && (environment.OPERATIONS_EFS_TRUSTED_TLS_PROXY !== "1" || !["127.0.0.1", "::1"].includes(hostname))) throw new Error("Trusted HTTPS is required.");
  const server = (tls ? httpsServer : httpServer)(tls ?? {}, (req, res) => { void companion.handle(req, res); });
  server.on("upgrade", (_req, socket) => socket.destroy()); server.maxConnections = 16;
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const port = Number(environment.OPERATIONS_EFS_PORT ?? 8448);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid EFS companion port.");
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, hostname, resolve); });
  return { server, async close() { companion.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await runAwsGetBodyCompanion();
  const close = () => { void service.close().finally(() => process.exit()); };
  process.once("SIGTERM", close); process.once("SIGINT", close);
}
