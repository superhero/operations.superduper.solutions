// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
import { Plugin } from 'vite';
import { BeforeAll, Before, AfterAll, After, BeforeStep, AfterStep, applyHooks } from './hooks.mjs';
import { explodeTags } from './render.mjs';
import { DataTable } from './models/DataTable.mjs';
import { DocString } from './models/DocString.mjs';
import { normalizeTags, tagsMatch } from './tags.mjs';
export { setWorldConstructor, getWorldConstructor, QuickPickleWorld, QuickPickleWorldInterface, ScreenshotComparisonOptions, VisualConfigSetting, VisualWorld, VisualWorldInterface, VisualDiffResult, defaultScreenshotComparisonOptions, InfoConstructor, AriaRoleExtended, isAriaRoleExtended, } from './world.mjs';
export { DocString, DataTable };
export { explodeTags, tagsMatch, normalizeTags, applyHooks };
export { defineParameterType } from './steps.mjs';
export { BeforeAll, Before, AfterAll, After, BeforeStep, AfterStep };
export declare const Given: (expression: string | RegExp, f: (state: any, ...args: any[]) => any, priority?: number) => void;
export declare const When: (expression: string | RegExp, f: (state: any, ...args: any[]) => any, priority?: number) => void;
export declare const Then: (expression: string | RegExp, f: (state: any, ...args: any[]) => any, priority?: number) => void;
export declare function formatStack(text: string, line: string): string;
declare const legacyGherkinStep: (stepType: "Context" | "Action" | "Outcome", step: string, state: any, line: number, stepIdx: number, explodeIdx?: number, data?: any) => Promise<any>;
export type QuickPickleConfigSetting<T = {
    [key: string]: any;
}> = Partial<{
    root?: string;
    stepTimeout: number;
    stepAbortGrace: number;
    tagExpression: string;
    testModule: string;
    todoTags: string | string[];
    skipTags: string | string[];
    failTags: string | string[];
    softFailTags: string | string[];
    concurrentTags: string | string[];
    sequentialTags: string | string[];
    explodeTags: string | string[] | string[][];
    worldConfig: Partial<T>;
}>;
export type QuickPickleConfig<T = {
    [key: string]: any;
}> = {
    root: string;
    stepTimeout: number;
    stepAbortGrace: number;
    tagExpression: string;
    testModule: string;
    todoTags: string[];
    skipTags: string[];
    failTags: string[];
    softFailTags: string[];
    concurrentTags: string[];
    sequentialTags: string[];
    explodeTags: string[][];
    worldConfig: Partial<T>;
};
export declare const defaultConfig: QuickPickleConfig;
export declare const quickpickle: (conf?: Partial<QuickPickleConfigSetting>) => Plugin;
export default quickpickle;

export { runScenario, gherkinStep, getWorkerFailure, isWorkerQuarantined } from './runtime.mjs';
export { hookReportError } from './diagnostics.mjs';
export type { GherkinCaseMetadata, GherkinStepMetadata } from './runtime.mjs';
export declare const QUICKPICKLE_PATCH_ID: 'quickpickle-1.11.2-operations.1';
