// Changed JavaScript port of OmniJev/OneJev qev.prompt/engine/answers (Apache-2.0)
// at 81ce62f1597c91e46767d4d02d6ac2e18534fe94, with Base Labs' MIT serve.patch
// at baselabs/elephant-1 b3f8a93462fb1051a9de031e94a7ff380e254072.
// Native sources and their licenses are retained by elephant-reference.py.
// https://www.apache.org/licenses/LICENSE-2.0
export const ELEPHANT_SOURCE = Object.freeze({
  model: 'baselabs/elephant-1',
  revision: 'b3f8a93462fb1051a9de031e94a7ff380e254072',
  onejev: '81ce62f1597c91e46767d4d02d6ac2e18534fe94',
  promptVersion: 'qev-labels-v2',
});
const SYSTEM = 'Apply the question to the state. Choose exactly one of the listed options. ' +
  'Respond with only its uppercase letter, with no explanation or reasoning.';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NOT_ONE_TOKEN = new Set('BQ BZ CJ CQ CZ DQ DZ EJ EY FJ FQ FV FZ GJ GK GQ GZ HJ IY JF JG JH JL JN JQ'.split(' '));
const SLOT_LABELS = [...LETTERS, ...Array.from(LETTERS, a => Array.from(LETTERS, b => a + b)).flat().filter(label => !NOT_ONE_TOKEN.has(label)).slice(0, 230)];
const KW = Object.freeze({tokenize: false, add_generation_prompt: true, enable_thinking: false});
const cpLength = text => Array.from(text).length;
const same = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

function jsonValue(value) {
  if (value === undefined) throw Error('Undefined is not a native JSON value');
  const result = JSON.stringify(value, null, 2);
  if (result === undefined) throw Error('Unsupported native JSON value');
  return result;
}
const renderEntry = value => value == null ? '' : typeof value === 'string' ? value.trim() : jsonValue(value);
const renderState = value => value == null ? '' : typeof value === 'string' ? value : jsonValue(value);

function rejectMedia(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && (['image', 'image_url', 'video', 'audio', 'input_audio'].some(key => Object.hasOwn(value, key)) ||
      ['image', 'image_url', 'video', 'audio', 'input_audio'].includes(value.type))) {
    throw Error('This Elephant adapter accepts text only');
  }
  for (const item of Object.values(value)) rejectMedia(item);
}

export function elephantQuestionOptions(question) {
  if (!question || typeof question !== 'object') throw Error('An Elephant question is required');
  const criteria = question.criteria;
  if (question.type === 'noul') {
    if (criteria != null && (typeof criteria !== 'object' || Array.isArray(criteria))) throw Error('noul criteria must be an object');
    return {keys: ['yes', 'no'], names: ['yes', 'no'], descriptions: [
      criteria?.true == null ? 'the statement is true / the answer is yes' : renderEntry(criteria.true),
      criteria?.false == null ? 'the statement is false / the answer is no' : renderEntry(criteria.false),
    ], instructions: renderEntry(question.instructions) || 'Is the statement true, or is the answer to the question yes?'};
  }
  if (question.type === 'choice') {
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria) || Object.keys(criteria).length < 1 || Object.keys(criteria).length > 255) {
      throw Error('choice needs 1..255 criteria');
    }
    return {keys: Object.keys(criteria), names: Object.keys(criteria), descriptions: Object.values(criteria),
      instructions: renderEntry(question.instructions) || 'Which option applies to the state?'};
  }
  if (question.type === 'score') {
    if (!Array.isArray(criteria) || !criteria.length || criteria.length > 10) throw Error('score needs 1..10 levels');
    return {keys: criteria.map((_, index) => String(index)), names: criteria.map((_, index) => `level ${index}`), descriptions: criteria,
      instructions: renderEntry(question.instructions) || 'Which level describes the state?'};
  }
  throw Error(`unknown question type ${question.type}`);
}

function renderQuestion(question) {
  const options = elephantQuestionOptions(question), labels = SLOT_LABELS.slice(0, options.keys.length);
  const head = `${question.type === 'score' ? 'Rate the state:' : 'Question:'} ${options.instructions}\n\nOptions:\n`;
  const lines = options.names.map((name, index) => {
    const description = renderEntry(options.descriptions[index]);
    return `${labels[index]}. ${name}` + (description ? `: ${description}` : '');
  });
  let position = cpLength(head);
  const spans = lines.map(line => {const span = [position, position + cpLength(line)]; position += cpLength(line) + 1; return span;});
  const suffix = head + lines.join('\n') + '\n\n' +
    `Answer with one ${labels.length <= 26 ? 'letter' : 'label'}: ${labels.join(', ')}.`;
  return {...options, labels, suffix, spans};
}

function verifySlots(encode, decode) {
  const one = label => {const ids = Array.from(encode(label)); return ids.length === 1 && decode(ids) === label ? ids[0] : null;};
  let ids = Array.from(LETTERS, one);
  if (ids.includes(null)) throw Error('Elephant A..Z answer slots must be single round-trip tokens');
  const extra = SLOT_LABELS.slice(26).map(one);
  if (!extra.includes(null)) ids = [...ids, ...extra];
  if (new Set(ids).size !== ids.length) throw Error('Elephant answer slot tokens collide');
  return ids;
}

function upperBound(values, target) {
  let lo = 0, hi = values.length;
  while (lo < hi) {const mid = (lo + hi) >>> 1; if (values[mid] <= target) lo = mid + 1; else hi = mid;}
  return lo;
}
function lowerBound(values, target) {
  let lo = 0, hi = values.length;
  while (lo < hi) {const mid = (lo + hi) >>> 1; if (values[mid] < target) lo = mid + 1; else hi = mid;}
  return lo;
}

// @huggingface/tokenizers 0.2 has token strings, but no offsets. Qwen's
// lossless ByteLevel tokens recover native offsets in Unicode codepoints.
// Byte splits inside one Unicode character deliberately have overlapping spans.
const BYTE_DECODER = (() => {
  const visible = [...Array.from({length: 94}, (_, i) => i + 33), ...Array.from({length: 12}, (_, i) => i + 161), ...Array.from({length: 82}, (_, i) => i + 174)];
  const mapping = new Map(visible.map(byte => [String.fromCodePoint(byte), byte]));
  let extra = 0;
  for (let byte = 0; byte < 256; byte++) if (!visible.includes(byte)) mapping.set(String.fromCodePoint(256 + extra++), byte);
  return mapping;
})();

export function elephantOffsetEncoding(text, encoding) {
  if (!encoding || !Array.isArray(encoding.ids) || !Array.isArray(encoding.tokens) || encoding.ids.length !== encoding.tokens.length) {
    throw Error('Elephant offsets require ByteLevel token strings and ids');
  }
  const encoder = new TextEncoder(), expected = encoder.encode(text), boundaries = [0], bytes = [], byteSpans = [];
  for (const character of text) boundaries.push(boundaries.at(-1) + encoder.encode(character).length);
  for (const token of encoding.tokens) {
    const start = bytes.length;
    for (const character of token) {
      const byte = BYTE_DECODER.get(character);
      if (byte === undefined) throw Error('Unsupported Elephant tokenizer normalization or added token');
      bytes.push(byte);
    }
    byteSpans.push([start, bytes.length]);
  }
  if (!same(bytes, expected)) throw Error('Elephant tokenizer is not lossless ByteLevel; native offsets are required');
  return {ids: encoding.ids, offsets: byteSpans.map(([start, end]) => [upperBound(boundaries, start) - 1, lowerBound(boundaries, end)])};
}

export function prepareElephantRequest(request, {encode, decode, encodeWithOffsets, applyChatTemplate}, {maxTokens = 1024} = {}) {
  if (![encode, decode, encodeWithOffsets, applyChatTemplate].every(item => typeof item === 'function')) {
    throw Error('Native Elephant tokenizer, offsets and chat-template callbacks are required');
  }
  rejectMedia(request);
  const entries = Object.entries(request.questions || {});
  if (entries.length !== 1) throw Error('Elephant browser smoke requires one question per request');
  const [questionId, question] = entries[0], rendered = renderQuestion(question), codebook = verifySlots(encode, decode);
  if (rendered.keys.length > codebook.length) throw Error('This tokenizer needs native option chunking, outside this browser smoke');
  const stateBlock = `<state>\n${renderState(request.state)}\n</state>\n\n`;
  const render = suffix => applyChatTemplate([{role: 'system', content: SYSTEM}, {role: 'user', content: stateBlock + suffix}], KW);
  const prompt = render(rendered.suffix), tokens = Array.from(encode(prompt));
  if (tokens.length > maxTokens) throw Error(`Rendered Elephant prompt has ${tokens.length} tokens, exceeding limit ${maxTokens}; no truncation allowed`);
  const markerPrompt = render('QEV_PREFIX_MARK'), cut = markerPrompt.indexOf('QEV_PREFIX_MARK');
  if (cut < 0) throw Error('Elephant chat template dropped the prefix marker');
  const candidate = Array.from(encode(markerPrompt.slice(0, cut)));
  let prefixLength = candidate.length;
  while (prefixLength > 0 && !same(tokens.slice(0, prefixLength), candidate.slice(0, prefixLength))) prefixLength--;
  if (prefixLength === tokens.length) throw Error('Elephant branch has an empty suffix');
  const layout = encodeWithOffsets(prompt), suffixStart = cpLength(prompt.slice(0, prompt.lastIndexOf(rendered.suffix)));
  if (!same(tokens, Array.from(layout.ids)) || layout.offsets?.length !== tokens.length) throw Error('Elephant layout tokenization differs from branch tokenization');
  const ends = layout.offsets.map(pair => pair[1]), starts = layout.offsets.map(pair => pair[0]);
  if (upperBound(ends, suffixStart) !== prefixLength) throw Error('Elephant offset boundary disagrees with the shared prefix cache');
  const optionSpans = rendered.spans.map(([start, end]) => {
    const a = upperBound(ends, suffixStart + start), b = lowerBound(starts, suffixStart + end);
    if (b <= a || a < prefixLength) throw Error('Elephant option span is empty or starts inside the shared prefix');
    return [a - prefixLength, b - prefixLength];
  });
  return {questionId, kind: question.type, prompt, tokens, prefixTokens: tokens.slice(0, prefixLength), suffixTokens: tokens.slice(prefixLength),
    offeredKeys: rendered.keys, labels: rendered.labels, labelTokenIds: codebook.slice(0, rendered.keys.length), optionSpans,
    temperature: 1, readout: 'slot_lm', attention: {full: 'block_bidirectional', linear: 'causal'}};
}

// Python round(x,6) rounds the exact binary float, with ties to even.
function nativeRound(value) {
  if (value === 0) return value;
  const buffer = new ArrayBuffer(8), view = new DataView(buffer);
  view.setFloat64(0, Math.abs(value), false);
  const bits = view.getBigUint64(0, false), exponent = Number((bits >> 52n) & 2047n);
  let numerator = ((bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)) * 1000000n;
  const shift = exponent ? exponent - 1023 - 52 : -1074;
  let denominator = 1n;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  let rounded = numerator / denominator;
  const twiceRemainder = 2n * (numerator % denominator);
  if (twiceRemainder > denominator || (twiceRemainder === denominator && rounded % 2n)) rounded++;
  return Math.sign(value) * Number(rounded) / 1000000;
}
const normalize = probabilities => {const sum = probabilities.reduce((a, b) => a + b, 0); return sum <= 0 ? probabilities.map(() => 1 / probabilities.length) : probabilities.map(p => p / sum);};

export function normalizeElephantAnswer(question, slotLogits, {allowedTokenMass = null} = {}) {
  const {keys, descriptions} = elephantQuestionOptions(question), logits = Array.from(slotLogits);
  if (logits.length !== keys.length || logits.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw Error('One finite native slot logit per offered option is required');
  if (allowedTokenMass !== null && (typeof allowedTokenMass !== 'number' || !Number.isFinite(allowedTokenMass) || allowedTokenMass < 0 || allowedTokenMass > 1)) throw Error('Allowed-token mass must come from the full-vocabulary readout');
  const peak = Math.max(...logits), weights = logits.map(value => Math.exp(value - peak)), total = weights.reduce((a, b) => a + b, 0);
  const probabilities = weights.map(value => value / total), p = normalize(probabilities), count = p.length;
  let answer;
  if (question.type === 'noul') answer = {type: 'noul', noul: nativeRound(Math.min(1, Math.max(0, probabilities[0])))};
  else if (question.type === 'choice') {
    const best = p.indexOf(Math.max(...p)), uniform = 1 / count;
    const confidence = count === 1 ? 1 : (Math.max(...normalize(p)) - uniform) / (1 - uniform);
    answer = {type: 'choice', choice: keys[best], probabilities: Object.fromEntries(keys.map((key, index) => [key, nativeRound(p[index])])), confidence: nativeRound(confidence)};
  } else {
    const confidenceP = normalize(p), mode = confidenceP.indexOf(Math.max(...confidenceP)), center = (count - 1) / 2;
    const distance = confidenceP.reduce((sum, value, index) => sum + value * Math.abs(index - mode), 0);
    const uniformMAD = Array.from({length: count}, (_, index) => Math.abs(index - center)).reduce((a, b) => a + b, 0) / count;
    const confidence = count === 1 ? 1 : Math.max(0, 1 - distance / uniformMAD);
    const expected = normalize(p).reduce((sum, value, index) => sum + index * value, 0);
    answer = {type: 'score', score: nativeRound(expected), legend: Object.fromEntries(descriptions.map((value, index) => [String(index), value])),
      probabilities: Object.fromEntries(p.map((value, index) => [String(index), nativeRound(value)])), confidence: nativeRound(confidence)};
  }
  return {answer, probabilities, allowedTokenMass, temperature: 1};
}
