import type { Recording } from './controller.js';
export function saveRecording(record: Recording): Promise<void>;
export function listRecordings(): Promise<Recording[]>;
export function deleteRecordings(): Promise<void>;
export function clearSpeechCache(): Promise<void>;
