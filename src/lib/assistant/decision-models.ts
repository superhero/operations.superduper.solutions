// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import profiles from './decision-profiles.json';
import { defaultAssistantSettings } from './config.ts';
import { probeAssistantCompatibility, type GPUEnvironment } from './compatibility.ts';
export const decisionModels = profiles;
export type DecisionRequest = {state: unknown; questions: {q: {type: 'noul' | 'choice' | 'score'; instructions: string; criteria?: Record<string, string> | string[]}}};
export type DecisionResult = {answers: {q: {type: string; probabilities: Record<string, number>; confidence?: number; choice?: string; score?: number; noul?: number}}; raw: unknown; prepared: unknown; profile: string};
export function decisionProfile(id: string) {
  const profile = profiles.find(profile => profile.id === id);
  if (!profile) throw new Error('Choose an available decision model.');
  return profile;
}
export function validateDecisionRequest(value: unknown): DecisionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Supply a decision state and one question.');
  const request = value as DecisionRequest;
  if (Object.keys(request).some(key => !['state', 'questions'].includes(key)) || !Object.hasOwn(request, 'state') ||
      !request.questions || typeof request.questions !== 'object' || Array.isArray(request.questions) || Object.keys(request.questions).length !== 1 || !Object.hasOwn(request.questions, 'q')) throw new Error('Supply exactly one question named q.');
  const question = request.questions.q;
  if (!question || !['noul', 'choice', 'score'].includes(question.type) || Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key)) ||
      typeof question.instructions !== 'string' || !question.instructions.trim() || question.instructions.length > 4000) throw new Error('Enter a supported question with 1–4000 characters.');
  if (question.type === 'choice') {
    if (!question.criteria || Array.isArray(question.criteria) || typeof question.criteria !== 'object') throw new Error('Choices need an ordered object of labels and descriptions.');
    const entries = Object.entries(question.criteria);
    if (entries.length < 2 || entries.length > 255 || entries.some(([key, description]) => !key || key.length > 128 || typeof description !== 'string' || !description.trim())) throw new Error('Supply 2–255 named choices with descriptions.');
  } else if (question.type === 'score') {
    if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10 || question.criteria.some(value => typeof value !== 'string' || !value.trim())) throw new Error('Supply 2–10 ordered score descriptions.');
  } else if (question.criteria !== undefined) throw new Error('Yes/no questions do not use criteria.');
  const serialized = JSON.stringify(request);
  if (!serialized || serialized.length > 64000) throw new Error('Decision input exceeds 64000 characters. Native token limits are checked before inference.');
  return structuredClone(request);
}
export function validateDecisionResult(request: DecisionRequest, value: unknown): DecisionResult {
  const result = value as DecisionResult, answer = result?.answers?.q, question = request.questions.q;
  if (!answer || answer.type !== question.type || !answer.probabilities || typeof answer.probabilities !== 'object') throw new Error('Native decision returned an invalid answer.');
  const expected = question.type === 'noul' ? ['true', 'false'] : question.type === 'score' ? (question.criteria as string[]).map((_, index) => String(index)) : Object.keys(question.criteria!);
  const entries = Object.entries(answer.probabilities);
  if (entries.length !== expected.length || entries.some(([key, p]) => !expected.includes(key) || !Number.isFinite(p) || p < 0 || p > 1) ||
      Math.abs(entries.reduce((sum, [, p]) => sum + p, 0) - 1) > 0.0001) throw new Error('Native probabilities must cover every offered choice and sum to one.');
  if (answer.confidence !== undefined && !Number.isFinite(answer.confidence)) throw new Error('Native confidence is not finite.');
  const peak = Math.max(...entries.map(([, p]) => p));
  if (entries.filter(([, p]) => p === peak).length !== 1) throw new Error('Native probabilities have no unique highest choice.');
  if (question.type === 'choice' && answer.choice !== entries.find(([, p]) => p === peak)![0]) throw new Error('Native choice disagrees with its probabilities.');
  if (question.type === 'noul' && answer.noul !== answer.probabilities.true) throw new Error('Native yes/no probability is inconsistent.');
  if (question.type === 'score' && !Number.isFinite(answer.score)) throw new Error('Native ordinal score is not finite.');
  return result;
}
export async function checkDecisionCompatibility(id: string, environment: GPUEnvironment) {
  const profile = decisionProfile(id);
  if (profile.engine === 'strands-onnx' && profile.browser_probe.device === 'wasm') {
    const wasm = environment.WebAssembly ?? globalThis.WebAssembly;
    const ready = Boolean(environment.isSecureContext && environment.crossOriginIsolated && wasm.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])));
    return {ready, summary: ready ? 'Strands CPU Wasm available; memory fit is checked during loading.' : 'Strands needs a secure, cross-origin isolated page with WebAssembly.'};
  }
  const compatibility = await probeAssistantCompatibility(environment, {...defaultAssistantSettings,
    model: profile.engine === 'strands-onnx' ? '2b' : 'ornith-q4', executionMode: 'gpu', prefixCache: false});
  return {ready: compatibility.ready && compatibility.fp16, summary: compatibility.ready && compatibility.fp16 ? 'Native GPU requirements verified; memory fit is checked during loading.' : compatibility.summary + ' Native GPU execution also requires shader-f16.'};
}
