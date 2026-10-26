// Exact input preparation and guards. These functions never run a model forward.
export class InputPreflightError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InputPreflightError';
    this.code = code;
    this.details = details;
  }
}

const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

export function knowLinePromptBudget(profile, contextSize = profile.browser_probe?.load_options?.n_ctx) {
  const budget = profile.settings.max_rendered_prompt_tokens;
  if (!positiveInteger(budget) || !positiveInteger(contextSize) || contextSize < 2) {
    throw Error('KnowLine requires a positive prompt budget and a context with a reserved sample position');
  }
  return Math.min(budget, contextSize - 1);
}

/** Validate the actual, manifest-verified export setting rather than a reported constant. */
export function strandsMaxLength(config, expected = 4096) {
  if (!positiveInteger(config?.max_length) || config.max_length !== expected) {
    throw Error(`Loaded Strands max_length differs from the pinned export: ${config?.max_length}`);
  }
  return config.max_length;
}

/** The full IDs and native fitted IDs are retained so fitting cannot silently discard text. */
export function prepareStrandsInput(request, {tokenizer, renderState, renderQuestion, buildInputs, maxLength}) {
  const entries = Object.entries(request.questions || {});
  if (entries.length !== 1 || entries[0][0] !== 'q') throw Error('Strands browser trial requires one question named q');
  const question = entries[0][1];
  const stateText = renderState(request.state), questionText = renderQuestion(question).text;
  const stateIds = Array.from(tokenizer.encode(stateText, {add_special_tokens: false}).ids);
  const questionIds = Array.from(tokenizer.encode(questionText, {add_special_tokens: false}).ids);
  let fitted, fittingError;
  try { fitted = buildInputs(tokenizer, request.state, [question], maxLength); }
  catch (error) { fittingError = error.message || String(error); }
  const fittedStateIds = fitted ? Array.from(fitted.stateIds) : null;
  const fittedQuestionIds = fitted ? Array.from(fitted.questions[0].ids) : null;
  return {
    tokens: [...stateIds, ...questionIds], rendered_tokens: stateIds.length + questionIds.length,
    state_tokens: stateIds.length, question_tokens: questionIds.length,
    stateIds, questionIds, fittedStateIds, fittedQuestionIds,
    fitted_state_tokens: fittedStateIds?.length ?? null,
    fitted_question_tokens: fittedQuestionIds?.length ?? null,
    fitted_tokens: fitted ? fittedStateIds.length + fittedQuestionIds.length : null,
    native_fitting_loss: !fitted || !same(stateIds, fittedStateIds) || !same(questionIds, fittedQuestionIds),
    native_fitting_error: fittingError ?? null, native_max_length: maxLength,
    question_reservation_tokens: Math.min(questionIds.length, Math.max(1, Math.floor(maxLength * 0.75))),
    prompt: stateText + questionText,
  };
}

/** A whole noncausal prompt must fit one microbatch; Elephant supplies two complete blocks. */
export function assertInputBudget(prepared, {
  harnessLimit, contextSize, batchSize, microbatchSize, nativeLimit,
  reservedTokens = 0, minTokens = 1, blockTokenCounts,
} = {}) {
  const count = prepared.rendered_tokens ?? prepared.tokens?.length;
  if (!Number.isSafeInteger(count) || count < 0) throw Error('Exact prepared token count is required');
  if (!positiveInteger(harnessLimit) || !positiveInteger(contextSize)) throw Error('Verified prompt and context limits are required');
  const details = {
    accepted: true, rendered_tokens: count, minimum_tokens: minTokens,
    harness_limit: harnessLimit, context_size: contextSize, reserved_tokens: reservedTokens,
    batch_size: batchSize ?? null, microbatch_size: microbatchSize ?? null,
    native_limit: nativeLimit ?? null,
    effective_max_prompt_tokens: Math.min(harnessLimit, contextSize - reservedTokens, nativeLimit ?? Infinity),
  };
  const reject = (code, message) => { throw new InputPreflightError(code, message, {...details, accepted: false}); };
  if (count < minTokens) reject('input_too_short', `Rendered prompt has ${count} tokens; native minimum is ${minTokens}`);
  if (prepared.native_fitting_loss) {
    reject('native_fitting_loss', 'Native Strands input fitting would discard state or question tokens; no truncation allowed');
  }
  if (count > details.effective_max_prompt_tokens) {
    reject('input_budget_exceeded', `Rendered prompt has ${count} tokens, exceeding limit ${details.effective_max_prompt_tokens}; no truncation allowed`);
  }
  for (const [name, size] of [['batch', batchSize], ['microbatch', microbatchSize]]) {
    if (size == null) continue;
    if (!positiveInteger(size)) throw Error(`Verified native ${name} capacity is required`);
    if ((blockTokenCounts || [count]).some(length => length > size)) {
      reject(name + '_budget_exceeded', `Complete attention block exceeds native ${name} capacity ${size}`);
    }
  }
  return details;
}

export function preparedSummary(prepared) {
  const summary = {rendered_tokens: prepared.rendered_tokens ?? prepared.tokens.length};
  for (const key of ['onceTokens', 'readTwice', 'state_tokens', 'question_tokens', 'fitted_state_tokens',
    'fitted_question_tokens', 'fitted_tokens', 'native_fitting_loss', 'native_fitting_error',
    'native_max_length', 'question_reservation_tokens', 'readoutIndex', 'trailingTokens']) {
    if (prepared[key] !== undefined) summary[key] = prepared[key];
  }
  if (prepared.prefixTokens) summary.prefix_tokens = prepared.prefixTokens.length;
  if (prepared.suffixTokens) summary.suffix_tokens = prepared.suffixTokens.length;
  return summary;
}
