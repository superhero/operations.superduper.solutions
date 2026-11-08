// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { isNativeSectionMethod } from '../src/lib/native-runtime-contract.ts';

export async function nativeSectionsFixture(options = {}) {
  const allowSectionsRead = options.allowSectionsRead ?? true, allowSectionsWrite = options.allowSectionsWrite ?? true;
  return nativeHostFixture({ ...options, allowSectionsRead, allowSectionsWrite,
    ...(options.real ? { runtimeFactory: async f => {
      const runtime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256,
        allowSectionsRead, allowSectionsWrite });
      return { authority: runtime.authority, prepareQuery: runtime.prepareQuery, async start(receive, exited) {
        f.starts++; const child = await runtime.start(receive, exited); let stopped = false;
        return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() {
          await child.close(); if (!stopped) { stopped = true; f.stops++; }
        } };
      } };
    } } : {}), onFrame(frame, f, receive) {
      if (options.onFrame?.(frame, f, receive) === true) return true;
      if (!isNativeSectionMethod(frame.method)) return false;
      const store = f.sections ??= new Map(), p = frame.params; let result, missing = false;
      if (frame.method === 'threadSection/create') {
        const section = { id: randomUUID(), name: p.name.trim(), appearance: p.appearance ?? null };
        store.set(section.id, section); result = { section };
      } else if (frame.method === 'threadSection/update') {
        const section = store.get(p.sectionId); missing = !section;
        if (section) { section.name = p.name.trim(); if (Object.hasOwn(p, 'appearance')) section.appearance = p.appearance; result = { section }; }
      } else if (frame.method === 'threadSection/delete') { missing = !store.delete(p.sectionId); result = {}; }
      else {
        const offset = p.cursor ? Number(p.cursor.slice(7)) : 0, limit = Math.max(1, p.limit ?? 8), data = [...store.values()];
        result = { data: data.slice(offset, offset + limit), nextCursor: offset + limit < data.length ? 'offset:' + (offset + limit) : null };
      }
      const reply = missing ? { id: frame.id, error: { code: -32602, message: 'Section absent from the owned store.' } }
        : { id: frame.id, result: structuredClone(f.sectionOverride ?? result) };
      const send = () => receive(reply); if (f.holdSection) f.release.push(send); else queueMicrotask(send);
      return true;
    } });
}
