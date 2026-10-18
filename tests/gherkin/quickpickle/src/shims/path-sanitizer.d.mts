// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
export interface SanitizeOptions {
    decode?: ({
        regex: RegExp;
        replacement: string;
    })[];
    /**
     * RegEx that filters out stuff like \..\ or /../
     */
    parentDirectoryRegEx?: RegExp;
    /**
     * Characters to be removed from paths because the file system doesn't support these.
     */
    notAllowedRegEx?: RegExp;
}
interface SanitizeOptionsComplete {
    decode: ({
        regex: RegExp;
        replacement: string;
    })[];
    /**
     * RegEx that filters out stuff like \..\ or /../
     */
    parentDirectoryRegEx: RegExp;
    /**
     * Characters to be removed from paths because the file system doesn't support these.
     */
    notAllowedRegEx: RegExp;
}
export declare const DEFAULT_OPTIONS: SanitizeOptionsComplete;
/**
 * Sanitizes a portion of a path to avoid Path Traversal
 */
export default function sanitize(pathstr: string, options?: SanitizeOptions): string;
export {};
