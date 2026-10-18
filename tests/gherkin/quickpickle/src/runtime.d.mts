import type { TestContext } from 'vitest';
import type { QuickPickleWorldInterface, InfoConstructor, WorldConstructor } from './world.mjs';

export interface GherkinStepMetadata {
  text: string;
  line: number;
  status?: 'passed' | 'failed';
  duration?: number;
  error?: { name: string; message: string; stack?: string };
}

export interface GherkinCaseMetadata {
  id: string;
  /** Relative to the configured project root, independent of CI checkout. */
  uri: string;
  line: number;
  column: number;
  exampleLine: number;
  exampleBlock: number;
  exampleRow: number;
  tags: string[];
  rule?: string;
  steps: GherkinStepMetadata[];
}

export declare function getWorkerFailure(): Error | undefined;
export declare function isWorkerQuarantined(): boolean;
export declare function runScenario(context: TestContext, World: WorldConstructor,
  info: InfoConstructor, body: (world: QuickPickleWorldInterface) => Promise<void>): Promise<void>;
export declare function gherkinStep(stepType: 'Context' | 'Action' | 'Outcome',
  step: string, state: QuickPickleWorldInterface, line: number, stepIndex: number,
  explodedIndex?: number, data?: unknown): Promise<unknown>;
