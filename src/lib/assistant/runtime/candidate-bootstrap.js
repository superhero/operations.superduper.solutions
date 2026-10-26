// Served unchanged beside the publisher's Wasm files as a classic HTTP worker.
// Keep self.location here: the native Emscripten loader resolves Wasm from it.
const buffered = [];
let importing = false;

function buffer(event) {
  event.stopImmediatePropagation();
  const data = event.data;
  if (data?.type !== 'bootstrap') {buffered.push(data); return;}
  if (importing) return;
  importing = true;
  let moduleUrl;
  try {
    moduleUrl = new URL(data.moduleUrl, self.location.href);
    if (!['http:', 'https:'].includes(moduleUrl.protocol)) throw Error('LiteRT module requires an HTTP URL');
  } catch (error) {
    self.postMessage({type: 'bootstrap_error', error: {message: error.message, stack: error.stack}});
    return;
  }
  import(moduleUrl.href).then(() => {
    const receive = self.onmessage;
    if (typeof receive !== 'function') throw Error('LiteRT worker did not install its message handler');
    self.removeEventListener('message', buffer);
    self.postMessage({type: 'bootstrap_ready'});
    for (const message of buffered) receive.call(self, {data: message});
    buffered.length = 0;
  }).catch(error => self.postMessage({type: 'bootstrap_error', error: {message: error.message, stack: error.stack}}));
}

self.addEventListener('message', buffer);
