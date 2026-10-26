# Assistant dependency notices

## Pi 1.3.0

@earendil-works/pi-agent-core and @earendil-works/pi-ai.
Source: https://github.com/earendil-works/pi/tree/v1.3.0

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Optional native language, vision and decision engines

Model artifacts and publisher terms are identified by immutable revisions in `language-profiles.json`, `vision-profile.json` and `decision-profiles.json`. Model weights are downloaded on demand and are not bundled.

Wllama source `3bb2a46f0dab0b924e8cd992b85e8881c3d3a859` and llama.cpp `970b51ce7c9ba5fff0726c5e9994f1c2f0e4eedc` retain their MIT licenses. Native variants have individual receipts. Corresponding build inputs and patches are retained under `build/native-runtime-sources/`. Wllama LICENCE files remain beside their binaries; the separate llama.cpp license is in `runtime/licenses/`.

LiteRT-LM core0.18.0 is Apache-2.0, copyright2025 Google LLC. Its npm package omits a standalone license file; the canonical Apache-2.0 text is retained in `runtime/licenses/LiteRT-LM-APACHE-2.0.txt`. Transformers.js4.3.1 and its nested ORT1.31 retain installed-package notices. Parakeet and Strands keep ORT1.30 separately.

The shared Strands LICENSE and THIRD_PARTY_NOTICES cover both CPU and native-device GPU trees. Tokenizers0.2 and Jinja0.5.3 retain original licenses in the decision vendor tree. Elephant and Perplexity preserve their source notices beside the adapters. The build distributes these notices under `assistant-runtime/licenses/`.

The pinned WebML Space runtime's redistribution license remains unestablished in the reference evidence. Operations continues fetching that exact runtime on demand with its existing size/checksum verification; it is not vendored here.
