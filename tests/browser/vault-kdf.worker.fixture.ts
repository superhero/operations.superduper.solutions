// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { argon2id } from "hash-wasm";
import { passwordKey, encodeBase64 } from "../../src/lib/secrets/crypto.ts";
import { vectors } from "./vault-kdf-vectors.fixture.ts";

type Vector = { password?: string; passwordHex?: string; salt?: string; saltHex?: string;
  memorySize: number; iterations: number; parallelism: number; hashLength: number };
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, value => parseInt(value, 16));
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
const encode = (value: string) => new TextEncoder().encode(value);
const derive = (value: Vector) => argon2id({ ...value,
  password: value.passwordHex ? bytes(value.passwordHex) : encode(value.password!),
  salt: value.saltHex ? bytes(value.saltHex) : encode(value.salt!), outputType: "binary" });
const comparisonOutputs = ["187b6e7679ffca736fc8e626e25c5380e49482cea9bb3884134114200d41d72d",
  "31afb3b136c2f10c7c67ff123400cadf0b44cb11667647b07ddd5a3bd5142508",
  "70e9be0ce3b876bd4bff46f0fd7ae9956550d26ab06c24412de928f5b79e0d28"];
self.onmessage = async () => {
  try {
    const profile = vectors.comparison[0]!;
    const timings: number[] = [];
    for (let index = 0; index < 6; index++) {
      const started = performance.now();
      const value = hex(await derive(profile));
      timings.push(performance.now() - started);
      if (value !== comparisonOutputs[0]) throw new Error("Selected Argon2 profile mismatch");
    }
    for (const vector of vectors.reference)
      if (hex(await derive(vector)) !== vector.expected) throw new Error(`Official reference mismatch: ${vector.id}`);
    for (const [index, vector] of vectors.comparison.entries())
      if (hex(await derive(vector)) !== comparisonOutputs[index]) throw new Error(`Sodium fixture mismatch: ${vector.id}`);
    const expected = await crypto.subtle.importKey("raw", bytes(comparisonOutputs[0]!), "AES-GCM", false, ["encrypt"]);
    const actual = await passwordKey(profile.password, encodeBase64(bytes(profile.saltHex)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const box = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, expected, encode("application-profile-match"));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, actual, box);
    if (new TextDecoder().decode(plain) !== "application-profile-match" || actual.extractable) throw new Error("Application KDF key mismatch");
    self.postMessage({ ok: true, references: vectors.reference.length, comparisons: vectors.comparison.length,
      applicationKey: "matched-nonextractable", profile: { algorithm: "argon2id", version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, saltBytes: 16, outputBytes: 32 },
      coldMs: timings[0], warmMs: timings.slice(1), userAgent: navigator.userAgent });
  } catch (error) { self.postMessage({ ok: false, message: (error as Error).message }); }
};
