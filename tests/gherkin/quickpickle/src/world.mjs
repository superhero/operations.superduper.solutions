// Derived from QuickPickle 1.11.2, copyright SamZiegler and David Hunt.
// MIT License; see ../LICENSE and UPSTREAM.json for source provenance.
import { tagsMatch } from './tags.mjs';
import sanitize from './shims/path-sanitizer.mjs';
import { ariaRoles } from '@a11y-tools/aria-roles';
import { getPNG } from './shims/png.mjs';
import { defaultsDeep } from 'lodash-es';
import { resizeImage } from 'image-crop-or-pad';
export function isAriaRoleExtended(role) {
    return role === 'element' || role === 'input' || ariaRoles.hasOwnProperty(role);
}
export class QuickPickleWorld {
    _projectRoot = '';
    info;
    common;
    context;
    data = {};
    sanitizePath = sanitize;
    constructor(context, info) {
        this.context = context;
        this.common = info.common;
        this.info = { ...info, errors: [] };
        this._projectRoot = info.config.root;
    }
    async init() { }
    get config() { return this.info.config; }
    get worldConfig() { return this.info.config.worldConfig; }
    get isComplete() { return this.info.stepIdx === this.info.steps.length; }
    get projectRoot() { return this._projectRoot; }
    /**
     * Checks the tags of the Scenario against a provided list of tags,
     * and returns the shared tags, with the "@" prefix character.
     *
     * @param tags tags to check
     * @returns string[]|null
     */
    tagsMatch(tags) {
        return tagsMatch(tags, this.info.tags);
    }
    /**
     * Given a provided path-like string, returns a full path that:
     *
     * 1. contains no invalid characters.
     * 2. is a subdirectory of the project root.
     *
     * This is intended for security when retrieving and saving files;
     * it does not slugify filenames or check for a file's existence.
     *
     * @param path string the path to sanitize
     * @return string the sanitized path, including the project root
     */
    fullPath(path) {
        return `${this._projectRoot}/${this.sanitizePath(path)}`;
    }
    /**
     * A helper function for when you really just need to wait.
     *
     * @deprecated Waiting for arbitrary amounts of time makes your tests flaky! There are
     * usually better ways to wait for something to happen, and this functionality will be
     * removed from the API as soon we're sure nobody will **EVER** want to use it again.
     * (That may be a long time.)
     *
     * @param ms milliseconds to wait
     */
    async wait(ms) {
        await new Promise(r => setTimeout(r, ms));
    }
    toString() {
        let parts = [
            this.constructor.name,
            this.info.feature,
            this.info.scenario + (this.info.explodedIdx ? ` (${this.info.tags.join(',')})` : ''),
            `${this.info.stepIdx?.toString().padStart(2, '0')} ${this.info.step}`,
        ];
        return parts.join('_');
    }
}
let worldConstructor = QuickPickleWorld;
export function getWorldConstructor() {
    return worldConstructor;
}
export function setWorldConstructor(constructor) {
    worldConstructor = constructor;
}
export const defaultScreenshotComparisonOptions = {
    maxDiffPercentage: 0,
    resizeColor: [255, 0, 128],
    anchor: 'top left',
    threshold: 0.1,
    alpha: 0.6,
};
export class VisualWorld extends QuickPickleWorld {
    constructor(context, info) {
        super(context, info);
    }
    async init() { }
    get screenshotDir() {
        return this.sanitizePath(this.worldConfig.screenshotDir);
    }
    get screenshotFilename() {
        return `${this.toString().replace(/^.+?Feature: /, 'Feature: ').replace(' ' + this.info.step, '').replace(/\//g, ' ')}.png`;
    }
    get screenshotPath() {
        return this.fullPath(`${this.screenshotDir}/${this.screenshotFilename}`);
    }
    get screenshotOptions() {
        return defaultsDeep((this.worldConfig.screenshotOptions || {}), (this.worldConfig.screenshotOpts || {}), defaultScreenshotComparisonOptions);
    }
    getScreenshotPath(name) {
        if (!name)
            return this.screenshotPath;
        // If name is already a full absolute path (starts with project root), return as-is
        if (name.startsWith(this.projectRoot)) {
            return name;
        }
        // If name starts with the screenshot directory, remove it
        else if (name.startsWith(this.screenshotDir))
            name = name.slice(this.screenshotDir.length);
        // If name already ends with .png, remove it
        const hasExtension = name.endsWith('.png');
        const baseName = hasExtension ? name.slice(0, -4) : name;
        // Add the exploded tags if necessary
        let explodedTags = this.info.explodedIdx ? `_(${this.info.tags.join(',')})` : '';
        if (name.includes(explodedTags))
            explodedTags = '';
        // Return the full path
        return this.fullPath(`${this.screenshotDir}/${baseName}${explodedTags}.png`);
    }
    async screenshotDiff(actual, expected, opts) {
        // Get the PNG constructor using the shim
        const PNG = await getPNG();
        // Parse PNG images to get raw pixel data
        let actualPng = PNG.sync.read(actual);
        let expectedPng = PNG.sync.read(expected);
        // Check if dimensions differ and resize if necessary
        if ((opts?.resizeEnabled || this?.worldConfig?.screenshotOptions?.resizeEnabled)
            && (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height)) {
            // Calculate the maximum dimensions
            const maxWidth = Math.max(actualPng.width, expectedPng.width);
            const maxHeight = Math.max(actualPng.height, expectedPng.height);
            // Get the anchor setting
            const rgba = opts?.resizeColor || this.screenshotOptions.resizeColor || [255, 0, 128];
            rgba[3] = (opts?.resizeIgnored || this.screenshotOptions.resizeIgnored) ? 0 : 255;
            const anchor = opts?.anchor || this.screenshotOptions.anchor || 'top left';
            // Resize both images to the maximum dimensions
            if (actualPng.width !== maxWidth || actualPng.height !== maxHeight) {
                const resizedActualData = resizeImage(actualPng.data, actualPng.width, actualPng.height, maxWidth, maxHeight, { rgba, anchor });
                /**
                 * There are a couple of choices for initializing the data property:
                 * 1. We could use Buffer.from(), except that causes problems if QuickPickle is run in a browser.
                 * 2. We can set up a new PNG instance and use the fill method, but that seems like unnecessary overkill.
                 * 3. I've chosen to use the any cast, since the downstream doesn't use the Buffer capabilities.
                 */
                actualPng = { ...actualPng, data: resizedActualData, width: maxWidth, height: maxHeight };
            }
            if (expectedPng.width !== maxWidth || expectedPng.height !== maxHeight) {
                const resizedExpectedData = resizeImage(expectedPng.data, expectedPng.width, expectedPng.height, maxWidth, maxHeight, { rgba, anchor });
                expectedPng = { ...expectedPng, data: resizedExpectedData, width: maxWidth, height: maxHeight };
            }
        }
        const { width, height } = expectedPng;
        const diffPng = new PNG({ width, height });
        let runPixelmatch;
        try {
            runPixelmatch = (await import('pixelmatch')).default;
        }
        catch (e) {
            const err = e;
            if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
                throw new Error('Screenshot comparison requires the optional peer dependency `pixelmatch`. Add it to your project (e.g. npm install -D pixelmatch or pnpm add -D pixelmatch).');
            }
            throw e;
        }
        try {
            const pixels = runPixelmatch(actualPng.data, expectedPng.data, diffPng.data, width, height, opts);
            const pct = (pixels / (width * height)) * 100;
            return { diff: PNG.sync.write(diffPng), pixels, pct };
        }
        catch (e) {
            e.message += `
        expected: w:${width}px h:${height}px ${expectedPng.data.length}b
        actual: w:${actualPng.width}px h:${actualPng.height}px ${actualPng.data.length}b
        - NOTE: set screenshotOptions.resizeEnabled to compare images of different sizes.`;
            throw e;
        }
    }
}
