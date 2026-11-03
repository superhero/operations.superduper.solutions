export class BrowserWorkQueue {
  readonly busy: boolean;
  run<T>(run: () => Promise<T>, signal?: AbortSignal, onQueued?: () => void): Promise<T>;
}
export function browserLease(name: string, signal?: AbortSignal, locks?: LockManager): Promise<() => Promise<void>>;
export const runtimeOwnershipName: string;
export class BrowserRuntimeOwner {
  constructor(options: {suspend: () => Promise<void>; status?: (text: string) => void; onError?: (error: unknown) => void;
    locks?: LockManager; channel?: (name: string) => BroadcastChannel; id?: string});
  run<T>(run: () => Promise<T>, options?: {signal?: AbortSignal; gpu?: boolean; resident?: boolean}): Promise<T>;
  release(): Promise<void>;
  close(): Promise<void>;
}
