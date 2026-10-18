// Derived from QuickPickle 1.11.2, copyright SamZiegler and David Hunt.
// MIT License; see ../LICENSE and UPSTREAM.json for source provenance.
export class DataTable {
    rawTable;
    constructor(sourceTable) {
        if (sourceTable instanceof Array) {
            this.rawTable = sourceTable;
        }
        else {
            this.rawTable = sourceTable.rows.map((row) => row.cells.map((cell) => cell.value));
        }
    }
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
    hashes() {
        const copy = this.raw();
        const keys = copy[0];
        const valuesArray = copy.slice(1);
        return valuesArray.map((values) => {
            const rowObject = {};
            keys.forEach((key, index) => (rowObject[key] = values[index]));
            return rowObject;
        });
    }
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
    raw() {
        return this.rawTable.slice(0);
    }
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
    rows() {
        const copy = this.raw();
        copy.shift();
        return copy;
    }
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
    rowsHash() {
        const rows = this.raw();
        const everyRowHasTwoColumns = rows.every((row) => row.length === 2);
        if (!everyRowHasTwoColumns) {
            throw new Error('rowsHash can only be called on a data table where all rows have exactly two columns');
        }
        const result = {};
        rows.forEach((x) => (result[x[0]] = x[1]));
        return result;
    }
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
    transpose() {
        const transposed = this.rawTable[0].map((x, i) => this.rawTable.map((y) => y[i]));
        return new DataTable(transposed);
    }
}
