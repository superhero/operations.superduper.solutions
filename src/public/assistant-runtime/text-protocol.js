// Transport and parsing only. Tool execution belongs to the caller's Pi loop.
export const litertAssetBase = moduleUrl => new URL('../vendor/litert-lm/', moduleUrl).href;

export function textMessages(messages, image) {
  if (image || !Array.isArray(messages) || !messages.length) throw Error('Text messages are required; images are unsupported by this engine');
  return messages.map(message => {
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) throw Error('Unsupported message role: ' + message.role);
    let content = message.content ?? '';
    if (Array.isArray(content)) {
      if (content.some(part => part.type !== 'text')) throw Error('This engine accepts text only; image/audio content is unsupported');
      content = content.map(part => part.text).join('');
    }
    if (typeof content !== 'string') throw Error('Message content must be text');
    const result = {...message, content};
    if (result.tool_calls) result.tool_calls = result.tool_calls.map(call => ({...call,
      function: {...call.function, arguments: typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments}}));
    return result;
  });
}

export const nativeTools = tools => tools.map(tool => tool.function ? structuredClone(tool) : {type: 'function', function: structuredClone(tool)});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const namePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

function validate(value, schema = {}, path = 'arguments') {
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) throw Error(path + ' is outside its enum');
  const type = schema.type;
  const matches = type === 'object' ? object(value) : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'null' ? value === null : !type || typeof value === type;
  if (!matches || (typeof value === 'number' && !Number.isFinite(value))) throw Error(path + ' must have type ' + type);
  if (object(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw Error(path + ' is missing required field ' + key);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key) && schema.additionalProperties === false) throw Error(path + ' has unknown field ' + key);
      validate(item, schema.properties?.[key] ?? {}, path + '.' + key);
    }
  }
  if (Array.isArray(value)) value.forEach((item, index) => validate(item, schema.items ?? {}, path + '[' + index + ']'));
}

function toolFor(name, tools) {
  const tool = nativeTools(tools).find(tool => tool.function.name === name)?.function;
  if (!tool) throw Error('No offered tool named ' + name);
  return tool;
}

export function checkedToolCalls(calls = [], tools = []) {
  const valid = [], errors = [];
  for (const call of calls) {
    try {
      if (call.type && call.type !== 'function') throw Error('Unsupported native tool-call type');
      const name = call.function?.name;
      if (!namePattern.test(name ?? '')) throw Error('Invalid native function name');
      const declaration = toolFor(name, tools);
      const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
      if (!object(args)) throw Error(name + ' arguments must be a JSON object');
      if (call.errors?.length) throw Error('Native parser: ' + call.errors.join('; '));
      validate(args, declaration.parameters ?? {type: 'object'});
      valid.push({id: call.id || crypto.randomUUID(), type: 'function', function: {name, arguments: structuredClone(args)}});
    } catch (error) {errors.push({message: error.message, call: structuredClone(call)});}
  }
  // A partly malformed response must not cause a subset of its actions to run.
  return {tool_calls: errors.length ? [] : valid, parse_errors: errors};
}

export function parseQwenResponse(raw, tools = [], initialThinking = false) {
  let text = raw.replace(/(?:<\|im_end\|>|<\|endoftext\|>)\s*$/, ''), reasoning = '';
  const errors = [], calls = [];
  if (initialThinking && !text.startsWith('<think>')) text = '<think>' + text;
  text = text.replace(/<think>([\s\S]*?)<\/think>/g, (_match, thought) => {reasoning += thought; return '';});
  if (text.includes('<think>')) {
    const at = text.indexOf('<think>'); reasoning += text.slice(at + 7); text = text.slice(0, at);
  }
  const first = text.indexOf('<tool_call>');
  if (first < 0) return {text: text.trim(), reasoning: reasoning.trim(), tool_calls: [], parse_errors: [], raw_text: raw};
  const prefix = text.slice(0, first).trim();
  let remaining = text.slice(first).trim();
  while (remaining) {
    try {
      const block = remaining.match(/^<tool_call>\s*<function=([a-zA-Z_][a-zA-Z0-9_-]*)>([\s\S]*?)<\/function>\s*<\/tool_call>/);
      if (!block) throw Error('Malformed or incomplete Qwen trained tool-call syntax');
      const declaration = toolFor(block[1], tools), args = Object.create(null);
      let body = block[2].trim();
      while (body) {
        const parameter = body.match(/^<parameter=([a-zA-Z_][a-zA-Z0-9_-]*)>([\s\S]*?)<\/parameter>/);
        if (!parameter) throw Error('Malformed Qwen parameter syntax');
        const key = parameter[1], value = parameter[2].trim(), schema = declaration.parameters?.properties?.[key];
        if (Object.hasOwn(args, key)) throw Error('Duplicate Qwen parameter: ' + key);
        args[key] = schema?.type === 'string' ? value : JSON.parse(value);
        body = body.slice(parameter[0].length).trim();
      }
      calls.push({type: 'function', function: {name: block[1], arguments: args}});
      remaining = remaining.slice(block[0].length).trim();
      if (remaining && !remaining.startsWith('<tool_call>')) throw Error('Unexpected text after Qwen tool-call block');
    } catch (error) {errors.push({message: error.message, raw: remaining}); break;}
  }
  const checked = checkedToolCalls(calls, tools);
  errors.push(...checked.parse_errors);
  return {text: errors.length ? text.trim() : prefix, reasoning: reasoning.trim(), tool_calls: errors.length ? [] : checked.tool_calls, parse_errors: errors, raw_text: raw};
}

export function litertMessages(messages) {
  const names = new Map();
  return textMessages(messages).map(message => {
    for (const call of message.tool_calls ?? []) names.set(call.id, call.function.name);
    if (message.role !== 'tool') return message;
    const name = message.name || names.get(message.tool_call_id);
    if (!name) throw Error('Tool response is missing the original function identity');
    return {...message, content: [{type: 'tool_response', name, response: message.content}]};
  });
}

// Withhold partial control tags and tool syntax from the visible text channel.
export function qwenStream(emitText, emitThinking, initialThinking = false) {
  let pending = '', channel = initialThinking ? 'thinking' : 'text';
  const tags = ['<think>', '</think>', '<tool_call>', '</tool_call>', '<|im_end|>', '<|endoftext|>'];
  const emit = value => {if (channel === 'text') emitText(value); else if (channel === 'thinking') emitThinking(value);};
  return {push(chunk) {
    pending += chunk;
    while (pending) {
      const positions = tags.map(tag => ({tag, at: pending.indexOf(tag)})).filter(item => item.at >= 0).sort((a, b) => a.at - b.at);
      if (positions.length) {
        const {tag, at} = positions[0]; emit(pending.slice(0, at)); pending = pending.slice(at + tag.length);
        if (tag === '<think>') channel = 'thinking';
        else if (tag === '</think>' || tag === '</tool_call>') channel = 'text';
        else if (tag === '<tool_call>') channel = 'tool';
        else channel = 'ended';
      } else {
        let keep = 0;
        for (const tag of tags) for (let size = 1; size < tag.length; size++) if (pending.endsWith(tag.slice(0, size))) keep = Math.max(keep, size);
        emit(pending.slice(0, pending.length - keep)); pending = pending.slice(pending.length - keep); break;
      }
    }
  }, end() {emit(pending); pending = '';}};
}
