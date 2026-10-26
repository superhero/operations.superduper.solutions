# Pinned native runtime sources

The recipe inputs here match the retained build receipts under `src/public/assistant-runtime/ornith/upstream/` and `src/public/assistant-runtime/decision/vendor/`. They fetch public Wllama commit `3bb2a46f0dab0b924e8cd992b85e8881c3d3a859`, llama.cpp commit `970b51ce7c9ba5fff0726c5e9994f1c2f0e4eedc` and the pinned Dawn archive. Operations builds from the checked artifacts without requiring the reference checkout.

To reproduce a variant, copy its files into a fresh `/work` inside `emscripten/emsdk:4.0.20@sha256:33e992367f721747d8008c9141c04fa017139e3557a60e0c80be93a0870fe462`, then run `bash /work/build.sh` with the project resource limits. Recipes use the upstream npm lock and build runtime code only.

`base` serves chat and KnowLine; `elephant` and `pplx` retain dedicated readouts. `d3-inspect` is the corrected four-GiB no-forward inspector with its exact context variant. Every recipe input hash was checked against its original receipt. Binary rebuilding was not repeated during this integration; prebuilt hashes and real browser module/Wasm loading were verified. Wllama and llama.cpp retain their separate MIT licenses.
