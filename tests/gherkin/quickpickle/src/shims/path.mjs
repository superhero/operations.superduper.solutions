// Derived from QuickPickle 1.11.2, copyright SamZiegler and David Hunt.
// MIT License; see ../LICENSE and UPSTREAM.json for source provenance.
/**
 * Shim for node:path.normalize
 * @param path string
 * @returns string
 */
export function normalize(path) {
    // Simple path normalization
    const isAbsolute = path.startsWith('/');
    const parts = path.split(/[/\\]+/).filter(Boolean);
    const normalizedParts = [];
    for (const part of parts) {
        if (part === '.')
            continue;
        if (part === '..') {
            normalizedParts.pop();
        }
        else {
            normalizedParts.push(part);
        }
    }
    return (isAbsolute ? '/' : '') + normalizedParts.join('/');
}
/**
 * Shim for node:path.join
 * @param paths string[]
 * @returns string
 */
export function join(...paths) {
    return normalize(paths.join('/'));
}
