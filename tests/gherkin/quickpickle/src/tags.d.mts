// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
export declare function normalizeTags(tags?: string | string[] | undefined): string[];
/**
 * Compares two lists of tags and returns the ones that are shared by both,
 * or null if there are no shared tags.
 *
 * @param confTags string[]
 * @param testTags string[]
 * @returns string[]|null
 */
export declare function tagsMatch(confTags: string[], testTags: string[]): string[] | null;
export declare function tagsFunction(tagsExpression?: string): (tags: string[]) => boolean;
