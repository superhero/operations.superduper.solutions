// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/**
 * Transformers.js 4.3.1 public APIs, with explicit filenames for language-only
 * loads and the older 1.6B export. ONNX graphs and external data never change.
 * Source: https://github.com/huggingface/transformers.js/tree/4.3.1/packages/transformers/src
 */
export async function loadVisionRuntime(library, pin, {onProgress = () => {}, textOnly = false, sessionOptions = pin.sessionOptions, fetchText = async url => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Model template request failed (${response.status}): ${url}`);
  return response.text();
}, fetchJSON = async url => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Model metadata request failed (${response.status}): ${url}`);
  return response.json();
}} = {}) {
  const options = {revision: pin.revision, device: 'webgpu', progress_callback: onProgress,
    ...(sessionOptions ? {session_options: sessionOptions} : {})};
  let model, processor, tokenizer, chatTemplate;
  const sessions = {};
  try {
    if (pin.loader === 'auto' && !textOnly) {
      processor = await library.AutoProcessor.from_pretrained(pin.repo, {revision: pin.revision, progress_callback: onProgress});
      model = await library.AutoModelForImageTextToText.from_pretrained(pin.repo, {...options, dtype: pin.dtype, use_external_data_format: true});
      tokenizer = processor.tokenizer;
      chatTemplate = processor.chat_template ?? tokenizer.chat_template;
    } else {
      const base = `https://huggingface.co/${pin.repo}/resolve/${pin.revision}`;
      const config = await library.AutoConfig.from_pretrained(pin.repo, {revision: pin.revision});
      const generationConfig = await fetchJSON(`${base}/generation_config.json`);
      chatTemplate = await fetchText(`${base}/${pin.chatTemplate.filename}`);
      // Transformers 4.3.1 tokenizer discovery probes `main` even when its
      // caller supplies a revision. Load these known files from the same pin
      // and use the exact public constructor selected by the publisher config.
      const [tokenizerJSON, tokenizerConfig] = await Promise.all([
        fetchJSON(`${base}/tokenizer.json`), fetchJSON(`${base}/tokenizer_config.json`),
      ]);
      if (tokenizerConfig.tokenizer_class !== 'TokenizersBackend') throw Error('The pinned LiquidAI tokenizer class changed.');
      tokenizer = new library.TokenizersBackend(tokenizerJSON, tokenizerConfig);
      if (!textOnly) {
        const processorConfig = await fetchJSON(`${base}/processor_config.json`);
        processor = new library.Lfm2VlProcessor(processorConfig, {
          tokenizer, image_processor: new library.Lfm2VlImageProcessor(processorConfig.image_processor),
        }, chatTemplate);
      }
      // Explicit custom sessions also prevent multimodal architecture discovery
      // from making range requests for vision files in a text-only profile.
      // Only JS keys change; original graph and external-data paths are retained.
      for (const [name, filename] of Object.entries(pin.sessionFiles)) {
        if (textOnly && name === 'vision_encoder') continue;
        const component = await library.PreTrainedModel.from_pretrained(pin.repo, {
          ...options, config: {model_type: 'custom'}, model_file_name: filename,
          dtype: pin.dtype[name], use_external_data_format: pin.externalData?.[name] ?? true,
        });
        sessions[name] = component.sessions.model;
      }
      model = new library.Lfm2VlForConditionalGeneration(config, sessions, {generation_config: generationConfig});
    }
    if (textOnly && model.sessions.vision_encoder) throw Error('The text-only loader unexpectedly created a vision session.');
    for (const [name, output] of [['embed_tokens', 'inputs_embeds'], ...(!textOnly ? [['vision_encoder', 'image_features']] : []), ['decoder_model_merged', 'logits']]) {
      if (!model.sessions[name]?.outputNames.includes(output)) throw Error(`The official ${name} graph does not expose the required ${output} output.`);
    }
    return {model, processor, tokenizer, chatTemplate, textOnly,
      templateSource: textOnly || pin.loader !== 'auto' ? pin.chatTemplate : pin.tokenizerChatTemplate};
  } catch (error) {
    if (model) await model.dispose().catch(() => {});
    else await Promise.allSettled(Object.values(sessions).map(session => session.release?.()));
    throw error;
  }
}

export function bindVisionSessionOptions(pin, ownedDevice) {
  // Native ORT WebGPU requires this per-session binding; its env.device setter
  // alone does not bind the device used by the native execution provider.
  return ownedDevice ? {...pin.sessionOptions, executionProviders: [{name: 'webgpu', device: ownedDevice}]} : pin.sessionOptions;
}

export function summarizeVisionSessionOptions(options) {
  if (!options) return null;
  return {...options, ...(options.executionProviders ? {executionProviders: options.executionProviders.map(provider =>
    typeof provider === 'string' ? provider : {...provider, ...(provider.device ? {device: 'owned-gpu-device'} : {})})} : {})};
}

export async function configureVisionDevice(library, pin, {
  gpu = globalThis.navigator?.gpu, isSecureContext = globalThis.isSecureContext,
} = {}) {
  // Only this qualified publisher export may bypass the existing FP16 gate.
  const noF16 = pin.precisionVariant === 'official-q4-fp32-compatible-v1';
  const audit = noF16;
  if (pin.precisionVariant != null && (!noF16 || pin.repo !== 'LiquidAI/LFM2.5-VL-1.6B-ONNX' ||
      pin.revision !== 'd0e00ca26cc42892d9f3c4380faa631927218209' ||
      pin.dtype.embed_tokens !== 'fp32' || pin.dtype.vision_encoder !== 'q4' || pin.dtype.decoder_model_merged !== 'q4')) {
    throw Error(`Unqualified vision precision variant: ${pin.precisionVariant}`);
  }
  if (!isSecureContext || !gpu) throw Error('Vision requires HTTPS and a browser with WebGPU.');
  const adapter = await gpu.requestAdapter({powerPreference: 'high-performance'});
  if (!adapter) throw Error('The browser returned no WebGPU adapter. No CPU substitution was made.');
  if (!noF16 && !adapter.features.has('shader-f16')) throw Error('This official mixed FP16/Q4 export requires shader-f16. No precision substitution was made.');
  if (noF16 && (adapter.limits?.maxStorageBuffersPerShaderStage ?? 0) < 9)
    throw Error('Compatible vision requires at least 9 storage buffers per shader stage.');
  library.env.backends.onnx.webgpu.adapter = adapter;
  if (!noF16) return {adapter, device: null, requestedFeatures: null};
  // Match ORT's requested compute/buffer limits while omitting every optional
  // feature, including shader-f16 even when the adapter supports it.
  const limitNames = ['maxComputeWorkgroupStorageSize', 'maxComputeWorkgroupsPerDimension',
    'maxStorageBufferBindingSize', 'maxStorageBuffersPerShaderStage', 'maxBufferSize', 'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ'];
  const requiredLimits = Object.fromEntries(limitNames.filter(name => adapter.limits?.[name] != null).map(name => [name, adapter.limits[name]]));
  const device = await adapter.requestDevice({requiredFeatures: [], requiredLimits});
  try {
    if (device.features.has('shader-f16')) {
      throw Error('The explicit no-f16 WebGPU device unexpectedly enabled shader-f16.');
    }
    if ((device.limits?.maxStorageBuffersPerShaderStage ?? 0) < 9) {
      throw Error('The owned image device did not provide the required 9 storage buffers.');
    }
    library.env.backends.onnx.webgpu.device = device;
    library.env.backends.onnx.logLevel = 'error';
    return {adapter, device, requestedFeatures: [], ...(audit ? {placementAudit: instrumentVisionDevice(device)} : {})};
  } catch (error) { device.destroy(); throw error; }
}

export function instrumentVisionDevice(device) {
  // ORT's timestamp profiling is inactive with features[]. Count real WebGPU
  // calls instead; no shader sources or unbounded per-dispatch records are kept.
  const counts = {command_encoders: 0, compute_passes: 0, compute_pipelines: 0,
    direct_dispatches: 0, indirect_dispatches: 0, submitted_dispatches: 0,
    queue_submissions: 0, submitted_command_buffers: 0, queue_drained_dispatches: 0};
  const commandBuffers = new WeakMap(), pipelineLabels = new Set();
  let labelsTruncated = false;
  const wrap = (target, name, callback) => {
    const original = target[name].bind(target);
    Object.defineProperty(target, name, {configurable: true, writable: true, value: (...args) => callback(original, args)});
  };
  const recordPipeline = descriptor => {
    counts.compute_pipelines++;
    const label = String(descriptor?.label || '(unlabelled)').slice(0, 160);
    if (pipelineLabels.size < 16) pipelineLabels.add(label);
    else if (!pipelineLabels.has(label)) labelsTruncated = true;
  };
  wrap(device, 'createComputePipeline', (original, args) => {
    const pipeline = original(...args); recordPipeline(args[0]); return pipeline;
  });
  if (device.createComputePipelineAsync) wrap(device, 'createComputePipelineAsync', async (original, args) => {
    const pipeline = await original(...args); recordPipeline(args[0]); return pipeline;
  });
  wrap(device, 'createCommandEncoder', (original, args) => {
    const encoder = original(...args);
    counts.command_encoders++;
    let dispatches = 0;
    wrap(encoder, 'beginComputePass', (begin, passArgs) => {
      const pass = begin(...passArgs);
      counts.compute_passes++;
      for (const [method, counter] of [['dispatchWorkgroups', 'direct_dispatches'], ['dispatchWorkgroupsIndirect', 'indirect_dispatches']]) {
        wrap(pass, method, (dispatch, dispatchArgs) => {
          const result = dispatch(...dispatchArgs);
          counts[counter]++; dispatches++;
          return result;
        });
      }
      return pass;
    });
    wrap(encoder, 'finish', (finish, finishArgs) => {
      const buffer = finish(...finishArgs); commandBuffers.set(buffer, dispatches); return buffer;
    });
    return encoder;
  });
  wrap(device.queue, 'submit', (submit, args) => {
    const buffers = Array.from(args[0]);
    const result = submit(buffers);
    counts.queue_submissions++; counts.submitted_command_buffers += buffers.length;
    counts.submitted_dispatches += buffers.reduce((sum, buffer) => sum + (commandBuffers.get(buffer) ?? 0), 0);
    return result;
  });
  const snapshot = () => ({source: 'instrumented-webgpu-command-submission-v1', ...counts,
    encoded_dispatches: counts.direct_dispatches + counts.indirect_dispatches,
    pipeline_labels: [...pipelineLabels].sort(), pipeline_labels_truncated: labelsTruncated,
    interpretation: 'Counts WebGPU compute commands encoded and submitted on the owned device. Queue drain completion is not a per-node placement profile or proof that CPU operators were absent.'});
  return {snapshot, async drain() {
    const submitted = counts.submitted_dispatches;
    try {
      await device.queue.onSubmittedWorkDone();
      counts.queue_drained_dispatches = Math.max(counts.queue_drained_dispatches, submitted);
      return {...snapshot(), queue_drain: 'complete'};
    } catch (error) { return {...snapshot(), queue_drain: 'failed', queue_drain_error: error.message || String(error)}; }
  }};
}

export async function releaseVisionRuntime(runtime, ownedDevice) {
  try { await runtime?.model.dispose(); }
  finally {
    if (ownedDevice) {
      try { await ownedDevice.queue.onSubmittedWorkDone(); } catch { /* Device loss can reject the drain. */ }
      ownedDevice.destroy();
    }
  }
}

export function visionMessages(messages, hasImage) {
  if (!Array.isArray(messages) || !messages.length) throw Error('Vision generation requires a user question.');
  const normalized = messages.map(message => {
    if (!['system', 'user', 'assistant'].includes(message.role)) throw Error('Unsupported role in a standalone vision request.');
    const content = typeof message.content === 'string' ? message.content :
      Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') : '';
    return {role: message.role, content};
  });
  if (hasImage) {
    const user = normalized.findLast(message => message.role === 'user');
    if (!user) throw Error('An image must accompany a user question.');
    user.content = [{type: 'image'}, {type: 'text', text: user.content}];
  }
  return normalized;
}

export async function prepareVisionImage(library, raw, mode = 'native') {
  const originalWidth = raw.width, originalHeight = raw.height;
  if (mode === 'native') return {image: raw, metadata: {mode, original_width: originalWidth, original_height: originalHeight}};
  if (mode !== 'letterbox-white-square-v1') throw Error(`Unqualified vision preprocessing: ${mode}`);
  const side = 512, scale = Math.min(side / originalWidth, side / originalHeight);
  const width = Math.max(1, Math.min(side, Math.round(originalWidth * scale)));
  const height = Math.max(1, Math.min(side, Math.round(originalHeight * scale)));
  const left = Math.floor((side - width) / 2), top = Math.floor((side - height) / 2);
  const resized = await raw.resize(width, height);
  const data = new Uint8Array(side * side * 3).fill(255);
  if (resized.channels === 4) {
    // Composite alpha onto the same white background as the letterbox.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4, target = ((y + top) * side + x + left) * 3;
      const alpha = resized.data[source + 3] / 255;
      for (let channel = 0; channel < 3; channel++) data[target + channel] = Math.round(resized.data[source + channel] * alpha + 255 * (1 - alpha));
    }
  } else {
    const rgb = resized.rgb();
    for (let row = 0; row < height; row++) data.set(rgb.data.subarray(row * width * 3, (row + 1) * width * 3), ((row + top) * side + left) * 3);
  }
  return {image: new library.RawImage(data, side, side, 3), metadata: {
    mode, original_width: originalWidth, original_height: originalHeight, input_width: side, input_height: side,
    resized_width: width, resized_height: height, scale, scale_x: width / originalWidth, scale_y: height / originalHeight,
    padding: {left, top, right: side - width - left, bottom: side - height - top}, background_rgb: [255, 255, 255],
  }};
}

export async function generateVision(library, runtime, {
  messages, image, maxTokens, contextTokens, outputTokens, onText = () => {}, stopping, preprocessing = 'native',
}) {
  if (!image?.data || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw Error('Supply a PNG, JPEG or WebP image for this vision test.');
  const started = performance.now();
  const raw = await library.RawImage.fromURL(`data:${image.mimeType};base64,${image.data}`);
  const preparedImage = await prepareVisionImage(library, raw, preprocessing);
  const chat = visionMessages(messages, true);
  const prompt = runtime.processor.apply_chat_template(chat, {add_generation_prompt: true});
  const inputs = await runtime.processor(preparedImage.image, prompt, {add_special_tokens: false});
  const promptTokens = inputs.input_ids.dims.at(-1);
  const imageToken = BigInt(runtime.model.config.image_token_id);
  const imageTokens = Array.from(inputs.input_ids.data).filter(token => BigInt(token) === imageToken).length;
  if (!inputs.pixel_values?.size || !imageTokens) throw Error('Image preprocessing did not produce vision tensors and image tokens.');
  const imageInfo = {width: raw.width, height: raw.height, mime_type: image.mimeType, image_tokens: imageTokens,
    preprocessing: preparedImage.metadata,
    tensor_shapes: Object.fromEntries(['pixel_values', 'pixel_attention_mask', 'spatial_shapes'].filter(key => inputs[key]).map(key => [key, inputs[key].dims]))};
  return generateFromInputs(library, runtime, inputs, {started, maxTokens, contextTokens, outputTokens, onText, stopping}, imageInfo);
}

export async function generateLfmText(library, runtime, {
  messages, maxTokens, contextTokens, outputTokens, onText = () => {}, stopping,
}) {
  const started = performance.now(), tokenizer = runtime.tokenizer || runtime.processor?.tokenizer;
  if (!tokenizer) throw Error('Load the LiquidAI tokenizer before sending text.');
  const prompt = tokenizer.apply_chat_template(visionMessages(messages, false), {
    tokenize: false, add_generation_prompt: true, chat_template: runtime.chatTemplate ?? tokenizer.chat_template,
  });
  const inputs = await tokenizer(prompt, {add_special_tokens: false});
  return generateFromInputs(library, runtime, inputs, {started, maxTokens, contextTokens, outputTokens, onText, stopping}, null);
}

export function generateLfmChat(library, runtime, options) {
  if (runtime.textOnly && options.image) return Promise.reject(Error('This text-only profile does not accept images.'));
  return options.image ? generateVision(library, runtime, options) : generateLfmText(library, runtime, options);
}

async function generateFromInputs(library, runtime, inputs, {
  started, maxTokens, contextTokens, outputTokens, onText, stopping,
}, imageInfo) {
  const promptTokens = inputs.input_ids.dims.at(-1), tokenizer = runtime.tokenizer || runtime.processor.tokenizer;
  const budget = Math.min(maxTokens, outputTokens, contextTokens - promptTokens);
  if (budget < 1) throw Error(`The image and prompt require ${promptTokens} tokens, exceeding the ${contextTokens}-token context budget.`);
  const prepared = performance.now();
  let firstToken, tokenCount = 0;
  const streamer = new library.TextStreamer(tokenizer, {
    skip_prompt: true, skip_special_tokens: true, callback_function: onText,
    token_callback_function: tokens => { firstToken ??= performance.now(); tokenCount += tokens.length; },
  });
  const generated = await runtime.model.generate({...inputs, max_new_tokens: budget, do_sample: false,
    return_dict_in_generate: false, streamer, ...(stopping ? {stopping_criteria: stopping} : {})});
  const finished = performance.now();
  const output = generated.slice(null, [promptTokens, null]);
  const completionTokens = output.dims.at(-1);
  const text = tokenizer.batch_decode(output, {skip_special_tokens: true})[0];
  return {text, reasoning: '', tool_calls: [], usage: {prompt_tokens: promptTokens, completion_tokens: completionTokens},
    timings: {preprocess_ms: prepared - started, generation_ms: finished - prepared, total_ms: finished - started,
      ttft_ms: firstToken == null ? null : firstToken - started,
      decode_tokens_per_second: firstToken == null || tokenCount < 2 ? null : (tokenCount - 1) * 1000 / (finished - firstToken)},
    finish_reason: stopping?.interrupted ? 'cancelled' : completionTokens >= budget ? 'length' : 'stop',
    image: imageInfo, input_mode: imageInfo ? 'image' : 'text',
    effective_max_new_tokens: budget};
}
