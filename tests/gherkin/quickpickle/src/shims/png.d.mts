// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
interface PNGConstructor {
    new (options?: {
        width?: number;
        height?: number;
    }): PNGInstance;
    sync: {
        read(data: Buffer): PNGInstance;
        write(png: PNGInstance): Buffer;
    };
}
interface PNGInstance {
    width: number;
    height: number;
    data: Buffer;
}
export declare function getPNG(): Promise<PNGConstructor>;
export {};
