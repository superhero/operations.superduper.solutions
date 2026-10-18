// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
type HookFunction = (state: any) => void | Promise<void>;
interface Hook {
    name: string;
    f: HookFunction;
    tags: string;
    tagsFunction: (tags: string[]) => boolean;
    weight: number;
}
export declare const applyHooks: (hooksName: string, state: any) => Promise<void>;
type AddHookFunction = (p1: string | Partial<Hook> | {
    f: HookFunction;
} | HookFunction, p2?: HookFunction) => void;
export declare const BeforeAll: AddHookFunction;
export declare const Before: AddHookFunction;
export declare const BeforeStep: AddHookFunction;
export declare const AfterAll: AddHookFunction;
export declare const After: AddHookFunction;
export declare const AfterStep: AddHookFunction;
export {};
