// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { enrollPasskey, unlockPasskey } from "./lib/secrets/passkeys.ts";
import { VaultError } from "./lib/secrets/types.ts";

const material = () => Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rawId = () => Uint8Array.from({ length: 48 }, (_, index) => index + 10);
const encode = bytes => Buffer.from(bytes).toString("base64");
const method = () => ({ credentialId: encode(rawId()), prfSalt: encode(material()) });
const safe = code => error => error instanceof VaultError && error.code === code
  && !Object.hasOwn(error, "cause") && !JSON.stringify(error).includes("PRIVATE PROVIDER DATA")
  && !String(error.stack).includes("PRIVATE PROVIDER DATA");
class MockCredential {
  constructor(prf = { results: { first: material().buffer } }, id = rawId()) {
    this.type = "public-key"; this.rawId = id.buffer.slice(id.byteOffset, id.byteOffset + id.byteLength);
    this.prf = prf;
  }
  getClientExtensionResults() { return this.prf === undefined ? {} : { prf: this.prf }; }
}
async function browser(run, overrides = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const calls = [];
  const mock = { isSecureContext: true, PublicKeyCredential: MockCredential, crypto: globalThis.crypto,
    navigator: { credentials: {
      async create(options) { calls.push(["create", options]); return new MockCredential({ enabled: true, results: { first: material().buffer } }); },
      async get(options) { calls.push(["get", options]); return new MockCredential(); },
    } }, ...overrides };
  Object.defineProperty(globalThis, "window", { configurable: true, value: mock });
  try { await run(mock, calls); }
  finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
}

Then("passkey enrollment requires user verification and returns only bounded PRF material and metadata", async () => {
  await browser(async (mock, calls) => {
    const supplied = material();
    mock.navigator.credentials.create = async options => {
      calls.push(["create", options]); return new MockCredential({ enabled: true, results: { first: supplied.buffer } });
    };
    const signal = new AbortController().signal, enrollment = await enrollPasskey(signal);
    assert.deepEqual(enrollment.prf, material());
    assert.ok(supplied.every(byte => byte === 0));
    assert.deepEqual(Object.keys(enrollment).sort(), ["credentialId", "kind", "prf", "prfSalt"]);
    assert.equal(enrollment.kind, "passkey"); assert.equal(enrollment.credentialId, method().credentialId);
    assert.equal(Buffer.from(enrollment.prfSalt, "base64").byteLength, 32);
    assert.equal(calls.length, 1);
    const [, request] = calls[0], options = request.publicKey;
    assert.equal(request.signal, signal);
    assert.equal(options.authenticatorSelection.userVerification, "required");
    assert.equal(options.authenticatorSelection.residentKey, "preferred");
    assert.equal(options.authenticatorSelection.authenticatorAttachment, undefined);
    assert.equal(options.attestation, "none"); assert.equal(options.rp.id, undefined);
    assert.equal(options.challenge.byteLength, 32); assert.equal(options.user.id.byteLength, 32);
    assert.equal(encode(options.extensions.prf.eval.first), enrollment.prfSalt);
    assert.ok(options.pubKeyCredParams.some(p => p.alg === -7));
  });
});

Then("passkey enrollment evaluates the same credential and salt when creation returns no PRF result", async () => {
  await browser(async (mock, calls) => {
    mock.navigator.credentials.create = async options => { calls.push(["create", options]); return new MockCredential({ enabled: true }); };
    const enrollment = await enrollPasskey();
    assert.deepEqual(enrollment.prf, material());
    assert.deepEqual(calls.map(([action]) => action), ["create", "get"]);
    const creation = calls[0][1].publicKey, assertion = calls[1][1].publicKey;
    assert.deepEqual(assertion.allowCredentials, [{ type: "public-key", id: rawId() }]);
    assert.equal(assertion.userVerification, "required");
    assert.equal(assertion.rpId, undefined);
    assert.deepEqual(assertion.extensions.prf.eval.first, creation.extensions.prf.eval.first);
    assert.notDeepEqual(assertion.challenge, creation.challenge);
  });
});

Then("missing or malformed passkey PRF output never completes vault enrollment", async () => {
  for (const [extension, expected] of [[{}, "UNAVAILABLE"], [{ enabled: false }, "UNAVAILABLE"],
    [{ results: { first: material() } }, "UNAVAILABLE"], [{ enabled: true, results: {} }, "AUTHENTICATION"],
    [{ enabled: true, results: { first: new Uint8Array(31) } }, "AUTHENTICATION"]]) {
    await browser(async (mock, calls) => {
      mock.navigator.credentials.create = async () => new MockCredential(extension);
      await assert.rejects(enrollPasskey(), safe(expected));
      assert.equal(calls.length, 0, "invalid creation must not launch a fallback ceremony");
    });
  }
  await browser(async mock => {
    mock.navigator.credentials.create = async () => new MockCredential({ enabled: true });
    mock.navigator.credentials.get = async () => new MockCredential({});
    await assert.rejects(enrollPasskey(), safe("UNAVAILABLE"));
  });
  for (const value of [null, {}, { type: "password" }, new MockCredential({ enabled: true }, new Uint8Array())]) {
    await browser(async mock => { mock.navigator.credentials.create = async () => value;
      await assert.rejects(enrollPasskey(), safe("AUTHENTICATION")); });
  }
});

Then("passkey unlock validates metadata and rejects substituted credentials or invalid PRF results", async () => {
  await browser(async (mock, calls) => {
    for (const patch of [{ credentialId: "" }, { credentialId: "AAAA_" }, { credentialId: "AB==" },
      { credentialId: encode(new Uint8Array(1025)) }, { prfSalt: encode(new Uint8Array(31)) },
      { prfSalt: encode(new Uint8Array(33)) }, { prfSalt: "PRIVATE PROVIDER DATA" }]) {
      await assert.rejects(unlockPasskey({ ...method(), ...patch }), safe("INVALID"));
    }
    await assert.rejects(unlockPasskey(null), safe("INVALID"));
    assert.equal(calls.length, 0);
    mock.navigator.credentials.get = async () => new MockCredential(undefined, new Uint8Array([1]));
    await assert.rejects(unlockPasskey(method()), safe("AUTHENTICATION"));
    for (const [extension, expected] of [[{}, "UNAVAILABLE"], [{ enabled: false }, "UNAVAILABLE"],
      [{ results: { first: "PRIVATE PROVIDER DATA" } }, "AUTHENTICATION"],
      [{ results: { first: new Uint8Array(33) } }, "AUTHENTICATION"]]) {
      mock.navigator.credentials.get = async () => new MockCredential(extension);
      await assert.rejects(unlockPasskey(method()), safe(expected));
    }
    const memory = new Uint8Array(64); memory.set(material(), 16);
    mock.navigator.credentials.get = async () => new MockCredential({ results: { first: new DataView(memory.buffer, 16, 32) } });
    assert.deepEqual(await unlockPasskey(method()), material());
    assert.ok(memory.every(byte => byte === 0));
  });
});

Then("aborted passkey ceremonies reject before dispatch and after delayed browser completion", async () => {
  await browser(async (mock, calls) => {
    const cancelled = new AbortController(); cancelled.abort("PRIVATE PROVIDER DATA");
    await assert.rejects(enrollPasskey(cancelled.signal), safe("CANCELLED"));
    await assert.rejects(unlockPasskey(method(), cancelled.signal), safe("CANCELLED"));
    assert.equal(calls.length, 0);
    for (const action of ["create", "get"]) {
      const controller = new AbortController(), source = material();
      mock.navigator.credentials[action] = async options => {
        assert.equal(options.signal, controller.signal);
        await Promise.resolve(); controller.abort("PRIVATE PROVIDER DATA");
        return new MockCredential({ ...(action === "create" ? { enabled: true } : {}), results: { first: source } });
      };
      await assert.rejects(action === "create" ? enrollPasskey(controller.signal) : unlockPasskey(method(), controller.signal), safe("CANCELLED"));
      assert.ok(source.every(byte => byte === 0), "late PRF material is discarded");
    }
    const controller = new AbortController(); let getCalls = 0;
    mock.navigator.credentials.create = async () => { controller.abort(); return new MockCredential({ enabled: true }); };
    mock.navigator.credentials.get = async () => { getCalls++; return new MockCredential(); };
    await assert.rejects(enrollPasskey(controller.signal), safe("CANCELLED"));
    assert.equal(getCalls, 0);
  });
});

Then("passkey provider failures and unavailable environments produce only safe vault errors", async () => {
  for (const [error, expected] of [[new DOMException("PRIVATE PROVIDER DATA", "AbortError"), "CANCELLED"],
    [new DOMException("PRIVATE PROVIDER DATA", "NotAllowedError"), "CANCELLED"],
    [new DOMException("PRIVATE PROVIDER DATA", "SecurityError"), "UNAVAILABLE"],
    [new Error("PRIVATE PROVIDER DATA", { cause: "PRIVATE PROVIDER DATA" }), "UNAVAILABLE"]]) {
    await browser(async mock => {
      mock.navigator.credentials.create = mock.navigator.credentials.get = async () => { throw error; };
      await assert.rejects(enrollPasskey(), safe(expected));
      await assert.rejects(unlockPasskey(method()), safe(expected));
    });
  }
  for (const overrides of [{ isSecureContext: false }, { PublicKeyCredential: undefined },
    { navigator: {} }, { navigator: { credentials: { get() {} } } }]) {
    await browser(async () => {
      await assert.rejects(enrollPasskey(), safe("UNAVAILABLE"));
      await assert.rejects(unlockPasskey(method()), safe("UNAVAILABLE"));
    }, overrides);
  }
  await assert.rejects(enrollPasskey(), safe("UNAVAILABLE"));
});

Then("repeated passkey unlocks use fresh challenges while preserving credential identity and PRF salt", async () => {
  await browser(async (_mock, calls) => {
    const first = await unlockPasskey(method()), second = await unlockPasskey(method());
    assert.notEqual(first, second); assert.deepEqual(first, second);
    const a = calls[0][1].publicKey, b = calls[1][1].publicKey;
    assert.notDeepEqual(a.challenge, b.challenge);
    assert.deepEqual(a.allowCredentials, b.allowCredentials);
    assert.deepEqual(a.extensions.prf.eval.first, b.extensions.prf.eval.first);
    assert.equal(a.userVerification, "required");
    first.fill(0); second.fill(0);
  });
});
