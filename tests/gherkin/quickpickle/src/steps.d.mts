// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
import { Expression } from '@cucumber/cucumber-expressions';
import { type IParameterTypeDefinition } from './shims/cucumber.mjs';
interface StepDefinition {
    expression: string | RegExp;
    f: (state: any, ...args: any[]) => any;
    cucumberExpression: Expression;
    priority: number;
}
interface StepDefinitionMatch {
    stepDefinition: StepDefinition;
    parameters: any[];
}
export declare const defineParameterType: (parameterType: IParameterTypeDefinition<any>) => void;
export declare const addStepDefinition: (expression: string | RegExp, f: (state: any, ...args: any[]) => any, priority?: number) => void;
type SnippetData = {
    stepType: 'Context' | 'Action' | 'Outcome';
    dataType: string;
};
export declare const findStepDefinitionMatch: (step: string, snippetData: SnippetData) => StepDefinitionMatch;
export {};
