// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
/** Normal unload waits for native cleanup; an unresponsive worker has a bounded
 * termination fallback. A forced teardown is not proof of explicit API cleanup. */
export function disposeWorker(worker, timeoutMs = 10000) {
  return new Promise(resolve => {
    let timer, finished = false;
    const finish = graceful => {
      if (finished) return; finished = true; clearTimeout(timer);
      worker.removeEventListener('message', message); worker.removeEventListener('error', failed);
      worker.terminate(); resolve(graceful);
    };
    const message = ({data}) => {if (data?.type === 'disposed') finish(true);};
    const failed = () => finish(false);
    worker.addEventListener('message', message); worker.addEventListener('error', failed);
    timer = setTimeout(() => finish(false), timeoutMs);
    try {worker.postMessage({type: 'dispose'});} catch {finish(false);}
  });
}
