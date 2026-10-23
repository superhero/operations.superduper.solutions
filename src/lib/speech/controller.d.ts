export interface SpeechState {
  phase: 'unloaded' | 'downloading' | 'initializing' | 'ready' | 'requesting' | 'recording' | 'finalizing';
  status: string; error: string; provisional: string; storageError: string; seconds: number;
}
export interface Dictation { sessionId: string; confirmed: string; final: boolean }
export interface Recording {
  id: string; created: string; status: string; expected: string; audio: Blob;
  metadata: Record<string, unknown>; events: unknown[]; partials: { text: string }[];
  final: { text: string } | null; signal: Record<string, number>;
}
export class SpeechController {
  constructor(options: { state: (state: SpeechState) => void; text: (text: Dictation) => void; recordings: (records: Recording[]) => void });
  state: SpeechState;
  preferences: { mode: string; loaded: boolean; restore: boolean; refine: boolean };
  preferencesChanged(value: Partial<SpeechController['preferences']>): void;
  load(): void; unload(): void; hidden(): void; destroy(): void;
  startRecording(): Promise<void>; stopRecording(): Promise<void>; file(file: File | undefined): Promise<void>;
  refreshRecordings(): Promise<void>;
  flushStorage(): Promise<void>;
}
