/**
 * Transformers.js 4.3.1 public APIs, with explicit filenames for language-only
 * loads and the older 1.6B export. ONNX graphs and external data never change.
 * Source: https://github.com/huggingface/transformers.js/tree/4.3.1/packages/transformers/src
 */
export async function loadVisionRuntime(library, pin, {onProgress = () => {}, textOnly = false, fetchText = async url => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Model template request failed (${response.status}): ${url}`);
  return response.text();
}, fetchJSON = async url => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Model metadata request failed (${response.status}): ${url}`);
  return response.json();
}} = {}) {
  const options = {revision: pin.revision, device: 'webgpu', progress_callback: onProgress};
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
      tokenizer = await library.AutoTokenizer.from_pretrained(pin.repo, {revision: pin.revision, progress_callback: onProgress});
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
          dtype: pin.dtype[name], use_external_data_format: true,
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

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  let library, runtime, contextTokens, outputTokens, preprocessing, active, queue = Promise.resolve();
  const send = (id, type, data = {}) => self.postMessage({id, type, ...data});
  self.onmessage = ({data}) => {
    if (data.type === 'cancel') { if (active?.id === data.id) active.stopping.interrupt(); return; }
    if (data.type === 'dispose') active?.stopping.interrupt();
    queue = queue.then(async () => {
      try {
        if (data.type === 'load') {
          const started = performance.now();
          library = await import('@huggingface/transformers');
          if (library.env.version !== '4.3.1') throw Error(`Unqualified Transformers.js version: ${library.env.version}`);
          if (!self.isSecureContext || !navigator.gpu) throw Error('Vision requires HTTPS and a browser with WebGPU.');
          const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
          if (!adapter) throw Error('The browser returned no WebGPU adapter. No CPU substitution was made.');
          if (!adapter.features.has('shader-f16')) throw Error('This official mixed FP16/Q4 export requires shader-f16. No precision substitution was made.');
          library.env.allowLocalModels = false;
          library.env.useFSCache = false;
          library.env.backends.onnx.wasm.numThreads = 1;
          library.env.backends.onnx.wasm.wasmPaths = new URL('./vision-ort/', self.location.href).href;
          library.env.backends.onnx.webgpu.adapter = adapter;
          runtime = await loadVisionRuntime(library, data.pin, {textOnly: data.textOnly === true, onProgress: progress => send(data.id, 'progress', {progress})});
          contextTokens = data.contextTokens; outputTokens = data.outputTokens;
          preprocessing = data.preprocessing ?? 'native';
          send(data.id, 'result', {result: {runtime: 'transformers.js', version: library.env.version, device: 'webgpu',
            requested_execution_provider: 'webgpu',
            placement_note: 'WebGPU EP requested; ORT may assign individual graph nodes to CPU, and sampling runs in JavaScript. Node placement was not measured.',
            wasm_threads: 1, dtype: Object.fromEntries(Object.entries(data.pin.dtype).filter(([name]) => !runtime.textOnly || name !== 'vision_encoder')),
            repo: data.pin.repo, revision: data.pin.revision,
            loader: runtime.textOnly ? 'published-language-session-names' : data.pin.loader, load_ms: performance.now() - started,
            chat_template: runtime.templateSource || null, input_mode: runtime.textOnly ? 'text' : 'text-and-image',
            loaded_sessions: Object.keys(runtime.model.sessions), tool_calls: 'unsupported-by-adapter',
            preprocessing,
            context_tokens: contextTokens, output_tokens: outputTokens,
            adapter: {description: adapter.info?.description || '', vendor: adapter.info?.vendor || '', architecture: adapter.info?.architecture || '', shader_f16: true}}});
        } else if (data.type === 'generate') {
          if (!runtime) throw Error('Load the vision model first.');
          active = {id: data.id, stopping: new library.InterruptableStoppingCriteria()};
          const result = await generateLfmChat(library, runtime, {...data, contextTokens, outputTokens, preprocessing, stopping: active.stopping,
            onText: text => send(data.id, 'text', {text})});
          active = null;
          send(data.id, 'result', {result});
        } else if (data.type === 'dispose') {
          await runtime?.model.dispose(); runtime = null;
          send(data.id, 'result', {result: null});
        }
      } catch (error) {
        active = null;
        send(data.id, 'error', {message: error.message || String(error), name: error.name || 'Error'});
      }
    });
  };
}
