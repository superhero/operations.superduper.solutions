// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
import { type QuickPickleConfig } from './index.mjs';
export declare function relativeFeatureUri(filename: string, root?: string): string;
export declare function renderGherkin(src: string, config: QuickPickleConfig,
    isMarkdown?: boolean, filename?: string): string;
export declare function featureSourceMap(code: string, source: string, filename: string): {
    version: 3; file: string; sources: string[]; sourcesContent: string[];
    names: string[]; mappings: string;
};
/**
 * Creates a 2d array of all possible combinations of the items in the input array
 * @param arr A 2d array of strings
 * @returns A 2d array of all possible combinations of the items in the input array
 */
export declare function explodeArray(arr: string[][]): string[][];
/**
 * This function "explodes" any tags in the "explodeTags" setting and returns all possible
 * combinations of all the tags. The theory is that it allows you to write one Scenario that
 * runs multiple times in different ways; e.g. with and without JS or in different browsers.
 *
 * To take this case as an example, if the explodeTags are:
 * ```
 * [
 *   ['nojs', 'js'],
 *   ['firefox', 'chromium', 'webkit'],
 * ]
 * ```
 *
 * And the testTags are:
 * ```
 * ['nojs', 'js', 'snapshot']
 * ```
 *
 * Then the function will return:
 * ```
 * [
 *   ['nojs', 'snapshot'],
 *   ['js', 'snapshot'],
 * ]
 * ```
 *
 * In that case, the test will be run twice.
 *
 * @param explodeTags the 2d array of tags that should be exploded
 * @param testTags the tags to test against
 * @returns a 2d array of all possible combinations of tags
 */
export declare function explodeTags(explodeTags: string[][], testTags: string[]): string[][];
