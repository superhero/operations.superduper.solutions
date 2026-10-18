// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
export declare class DocString extends String {
    mediaType: string;
    data?: any;
    constructor(content: string, mediaType?: string);
    toString(): string;
    [Symbol.toPrimitive](hint: string): string | number;
}
