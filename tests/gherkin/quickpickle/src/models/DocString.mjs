// Derived from QuickPickle 1.11.2, copyright SamZiegler and David Hunt.
// MIT License; see ../LICENSE and UPSTREAM.json for source provenance.
import yaml from 'js-yaml';
export class DocString extends String {
    mediaType;
    data;
    constructor(content, mediaType = '') {
        super(content);
        this.mediaType = mediaType ?? '';
        if (this.mediaType)
            try {
                if (this.mediaType === 'json')
                    this.data = JSON.parse(content);
                else if (this.mediaType?.match(/^ya?ml$/))
                    this.data = yaml.load(content);
            }
            catch (e) {
                throw new Error(`parsing ${this.mediaType} content failed: ${e?.message || 'Unknown error'}${e?.stack ? '\n' + e.stack : ''}`);
            }
    }
    toString() {
        return this.valueOf();
    }
    [Symbol.toPrimitive](hint) {
        if (hint === 'number') {
            return Number(this.valueOf());
        }
        return this.valueOf();
    }
}
