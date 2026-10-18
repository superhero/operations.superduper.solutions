// Derived from QuickPickle 1.11.2, copyright SamZiegler and David Hunt.
// MIT License; see ../LICENSE and UPSTREAM.json for source provenance.
import { intersection } from 'lodash-es';
import parse from '@cucumber/tag-expressions';
export function normalizeTags(tags) {
    if (!tags)
        return [];
    tags = Array.isArray(tags) ? tags : tags.split(/\s*,\s*/g);
    return tags.filter(Boolean).map(tag => tag.startsWith('@') ? tag : `@${tag}`);
}
/**
 * Compares two lists of tags and returns the ones that are shared by both,
 * or null if there are no shared tags.
 *
 * @param confTags string[]
 * @param testTags string[]
 * @returns string[]|null
 */
export function tagsMatch(confTags, testTags) {
    if (!confTags || !testTags)
        return null;
    let tags = intersection(confTags.map(t => t.toLowerCase()), testTags.map(t => t.toLowerCase()));
    return tags?.length ? tags : null;
}
const parseTagsExpression = (tagsExpression) => {
    try {
        const parsedExpression = parse(tagsExpression);
        return parsedExpression;
    }
    catch (error) {
        throw new Error(`Failed to parse tag expression: ${error.message}`);
    }
};
export function tagsFunction(tagsExpression) {
    if (!tagsExpression) {
        return () => true;
    }
    const parsedTagsExpression = parseTagsExpression(tagsExpression);
    return (tags) => {
        const result = parsedTagsExpression.evaluate(tags);
        return result;
    };
}
