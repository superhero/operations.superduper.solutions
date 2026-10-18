// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
export declare class PickleTable {
    rows: readonly PickleTableRow[];
}
export declare class PickleTableCell {
    value: string;
}
export declare class PickleTableRow {
    cells: readonly PickleTableCell[];
}
export declare class DataTable {
    private readonly rawTable;
    constructor(sourceTable: PickleTable | string[][]);
    /**
     * This method returns an array of objects of the shape { [key: string]: string }.
     * It is intended for tables with a header row, as follows:
     *
     * ```
     * | id | name   | color  | taste |
     * | 1  | apple  | red    | sweet |
     * | 2  | banana | yellow | sweet |
     * | 3  | orange | orange | sour  |
     * ```
     *
     * This would return the following array of objects:
     *
     * ```
     * [
     *   { id: '1', name: 'apple', color: 'red', taste: 'sweet' },
     *   { id: '2', name: 'banana', color: 'yellow', taste: 'sweet' },
     *   { id: '3', name: 'orange', color: 'orange', taste: 'sour' },
     * ]
     * ```
     *
     * @returns Record<string, string>[]
     */
    hashes(): Record<string, string>[];
    /**
     * This method returns the raw table as a two-dimensional array.
     * It can be used for tables with or without a header row, for example:
     *
     * ```
     * | id | name   | color  | taste |
     * | 1  | apple  | red    | sweet |
     * | 2  | banana | yellow | sweet |
     * | 3  | orange | orange | sour  |
     * ```
     *
     * would return the following array of objects:
     *
     * ```
     * [
     *   ['id', 'name', 'color', 'taste'],
     *   ['1', 'apple', 'red', 'sweet'],
     *   ['2', 'banana', 'yellow', 'sweet'],
     *   ['3', 'orange', 'orange', 'sour'],
     * ]
     * ```
     *
     * @returns string[][]
     */
    raw(): string[][];
    /**
     * This method is intended for tables with a header row, and returns
     * the value rows as a two-dimensional array, without the header row:
     *
     * ```
     * | id | name   | color  | taste |
     * | 1  | apple  | red    | sweet |
     * | 2  | banana | yellow | sweet |
     * | 3  | orange | orange | sour  |
     * ```
     *
     * would return the following array of objects:
     *
     * ```
     * [
     *   ['1', 'apple', 'red', 'sweet'],
     *   ['2', 'banana', 'yellow', 'sweet'],
     *   ['3', 'orange', 'orange', 'sour'],
     * ]
     * ```
     *
     * @returns string[][]
     */
    rows(): string[][];
    /**
     * This method is intended for tables with exactly two columns.
     * It returns a single object with the first column as keys and
     * the second column as values.
     *
     * ```
     * | id    | 1     |
     * | name  | apple |
     * | color | red   |
     * | taste | sweet |
     * ```
     *
     * would return the following object:
     *
     * ```
     * {
     *   id: '1',
     *   name: 'apple',
     *   color: 'red',
     *   taste: 'sweet',
     * }
     * ```
     *
     * @returns Record<string, string>
     */
    rowsHash(): Record<string, string>;
    /**
     * This method transposes the DataTable, making the columns into rows
     * and vice versa. For example the following raw table:
     *
     * ```
     * [
     *   ['1', 'apple', 'red', 'sweet'],
     *   ['2', 'banana', 'yellow', 'sweet'],
     *   ['3', 'orange', 'orange', 'sour'],
     * ]
     * ```
     *
     * would be transposed to:
     *
     * ```
     * [
     *   ['1', '2', '3'],
     *   ['apple', 'banana', 'orange'],
     *   ['red', 'yellow', 'orange'],
     *   ['sweet', 'sweet', 'sour'],
     * ]
     * ```
     *
     * @returns DataTable
     */
    transpose(): DataTable;
}
