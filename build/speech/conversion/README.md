# Parakeet decoder compatibility conversion

After the editor's pinned `npm ci`, run:

```sh
node build/speech/conversion/convert.mjs ORIGINAL_INT8_DECODER OUTPUT_ONNX
```

The input is `decoder_joint-model.int8.onnx` from
`ysdede/parakeet-tdt-0.6b-v3-onnx` at revision
`f88260fa0777fe0868dda6df85d1a98f012a4a7a`. The converter verifies its SHA-256,
the pinned ORT protobuf parser and the final qualified output checksum. It runs
the unchanged `lower-decoder.cjs` locally without inference or a reference-server
dependency. The editor lockfile supplies ORT 1.30.0 and protobufjs 7.6.6.

Original packed initializer encodings remain unchanged. Dynamic activation
quantization is replaced by FP32 arithmetic and LSTM primitives for one frame,
one target token and batch size one. This is a local compatibility graph,
not an official export or bit-identical dynamic INT8 computation.
The output receipt records every original initializer hash.

`reference-convert.py`, `reference-package*.json` and `conversion-proof.json`
retain the original remote experiment's driver, environment and evidence. The
portable editor entry point above replaces that driver's repository-layout
assumptions; it does not modify the reference repository.
