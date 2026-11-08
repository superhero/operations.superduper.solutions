// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { atlassianAssetsServer } from "./atlassian-server-bindings.ts";

/** The token route has the same required import-source identity as its peers.
 * Result adoption is still governed by the separate private-result profile. */
export function bindAssetsImportSource(document: Record<string, any>): void {
  const path = "/importsource/{importSourceId}/token", operation = document.paths?.[path]?.post;
  if (document.info?.title !== "REST" || document.info.version !== "1"
    || document.servers?.length !== 1 || document.servers[0].url !== atlassianAssetsServer
    || operation?.operationId !== `POST ${path}` || operation.parameters !== undefined
    || operation["x-upstream-parameters"] !== undefined)
    throw new Error("Assets import-source parameters require the reviewed source contract.");
  operation["x-upstream-parameters"] = null;
  operation.parameters = [{ name: "importSourceId", in: "path", required: true,
    description: "The identifier of the selected Assets import source.",
    schema: { type: "string", minLength: 1 } }];
}
