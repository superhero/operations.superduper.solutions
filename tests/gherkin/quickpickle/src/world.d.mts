// QuickPickle upstream types, MIT; see LICENSE and UPSTREAM.json.
import type { TestContext } from 'vitest';
import type { GherkinCaseMetadata } from './runtime.mjs';
import type { QuickPickleConfig } from './index.mjs';
import sanitize from './shims/path-sanitizer.mjs';
import type { PixelmatchOptions } from 'pixelmatch';
import { type AriaRole } from '@a11y-tools/aria-roles';
export type AriaRoleExtended = AriaRole | 'element' | 'input';
import { Buffer } from 'buffer';
export declare function isAriaRoleExtended(role: string): role is AriaRoleExtended;
interface Common {
    info: {
        feature: string;
        tags: string[];
    };
    [key: string]: any;
}
export interface QuickPickleWorldInterface {
    info: {
        config: QuickPickleConfig;
        feature: string;
        scenario: string;
        tags: string[];
        steps: string[];
        stepIdx?: number;
        rule?: string;
        step?: string;
        line?: number;
        explodedIdx?: number;
        errors: any[];
        gherkin?: GherkinCaseMetadata;
    };
    context: TestContext;
    /** Set before initialization; cleanup observes the original Vitest context. */
    _quickpickleContext: TestContext;
    signal: AbortSignal;
    abortController: AbortController;
    _quickpicklePendingWork: Set<Promise<unknown>>;
    _quickpickleFailure?: Error;
    isComplete: boolean;
    config: QuickPickleConfig;
    worldConfig: QuickPickleConfig['worldConfig'];
    data: Record<string, any>;
    common: Common;
    init: () => Promise<void>;
    tagsMatch(tags: string[]): string[] | null;
    sanitizePath: typeof sanitize;
    fullPath(path: string): string;
    wait(ms: number): Promise<void>;
}
export type InfoConstructor = Omit<QuickPickleWorldInterface['info'], 'errors'> & {
    common: Common;
};
export declare class QuickPickleWorld implements QuickPickleWorldInterface {
    private _projectRoot;
    info: QuickPickleWorldInterface['info'];
    common: QuickPickleWorldInterface['common'];
    context: TestContext;
    /** Set before initialization; cleanup observes the original Vitest context. */
    _quickpickleContext: TestContext;
    signal: AbortSignal;
    abortController: AbortController;
    _quickpicklePendingWork: Set<Promise<unknown>>;
    _quickpickleFailure?: Error;
    data: Record<string, any>;
    sanitizePath: typeof sanitize;
    constructor(context: TestContext, info: InfoConstructor);
    init(): Promise<void>;
    get config(): QuickPickleConfig;
    get worldConfig(): Partial<{
        [key: string]: any;
    }>;
    get isComplete(): boolean;
    get projectRoot(): string;
    /**
     * Checks the tags of the Scenario against a provided list of tags,
     * and returns the shared tags, with the "@" prefix character.
     *
     * @param tags tags to check
     * @returns string[]|null
     */
    tagsMatch(tags: string[]): string[] | null;
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
    fullPath(path: string): string;
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
    wait(ms: number): Promise<void>;
    toString(): string;
}
export type WorldConstructor = new (context: TestContext, info: InfoConstructor) => QuickPickleWorldInterface;
export declare function getWorldConstructor(): WorldConstructor;
export declare function setWorldConstructor(constructor: WorldConstructor): void;
export type VisualDiffResult = {
    diff: Buffer;
    pixels: number;
    pct: number;
};
export type ScreenshotComparisonOptions = any & Partial<PixelmatchOptions> & {
    /**
     * The maximum difference between the actual and expected images, as a percentage of the total number of pixels.
     */
    maxDiffPercentage?: number;
    /**
     * The maximum difference between the actual and expected images, as the number of pixels.
     */
    maxDiffPixels?: number;
    /**
     * Whether to compare the images even if they are of different sizes by resizing them as necessary.
     * @default false
     */
    resizeEnabled?: boolean;
    /**
     * Whether to ignore the resized area when comparing images.
     */
    resizeIgnored?: boolean;
    /**
     * The color to use for resizing images, in [r,g,b] format, with values from 0 to 255.
     * If this number is too similar to the color of the larger image, the resized area
     * will be ignored by the pixelmatch algorithm.
     * @default [255,0,128]
     */
    resizeColor?: [number, number, number];
    /**
     * The anchor point to use if the images are of different size.
     * @default "top left"
     */
    resizeAnchor?: 'top left' | 'top right' | 'bottom left' | 'bottom right' | 'center' | 'top' | 'bottom' | 'left' | 'right';
};
export declare const defaultScreenshotComparisonOptions: ScreenshotComparisonOptions;
export interface VisualConfigSetting {
    screenshotDir?: string;
    screenshotOpts?: Partial<ScreenshotComparisonOptions>;
}
interface StubVisualWorldInterface extends QuickPickleWorldInterface {
    /**
     * The directory where screenshots are saved, relative to the project root.
     */
    screenshotDir: string;
    /**
     * The filename for a screenshot based on the current Scenario.
     */
    screenshotFilename: string;
    /**
     * The full path to a screenshot file, from the root of the file system,
     * based on the current Scenario.
     */
    screenshotPath: string;
    /**
     * The options for the default screenshot comparisons.
     */
    screenshotOptions: Partial<ScreenshotComparisonOptions>;
    /**
     * The full path to a screenshot file, from the root of the file system,
     * based on the custom name provided, and including information on any
     * exploded tags as necessary.
     *
     * @param name
     */
    getScreenshotPath(name?: string): string;
    /**
     * A helper function to compare two screenshots, for visual regression testing.
     * If the screenshots do not match, the difference should be returned as a Buffer.
     */
    screenshotDiff(actual: Buffer, expected: Buffer, options?: any): Promise<VisualDiffResult>;
}
export interface VisualWorldInterface extends StubVisualWorldInterface {
    /**
     * A helper method for getting an element, which should work across different testing libraries.
     * The "Locator" interface used should be whatever is compatible with the testing library
     * being integrated by your World Constructor. This is intended as an 80% solution for
     * behavioral tests, so that a single step definition can get an element based on a variety
     * of factors, e.g. (in Playwright syntax):
     *
     * @example getLocator(page, 'Cancel', 'button') => page.getByRole('button', { name: 'Cancel' })
     * @example getLocator(page, 'Search', 'input') => page.getByLabel('Search').or(page.getByPlaceholder('Search'))
     * @example getLocator(page, 'ul.fourteen-points li', 'element', 'Open covenants of peace') => page.locator('ul.fourteen-points li').filter({ hasText: 'Open covenants of peace' })
     *
     * @param locator Locator
     * The container inside which to search for the required element.
     * @param identifier string
     * A string that identifies the element to be found. For ARIA roles this is the "name" attribute,
     * for role="input" it is the label or placeholder, and for role="element" it is the CSS selector.
     * @param role string
     * An ARIA role, or "input" to get an input by label or placeholder, or "element" to get an element by css selector.
     * @param text string
     * A string that the element must contain.
     */
    getLocator(locator: any, identifier: string, role: AriaRoleExtended | string, text?: string | null): any;
    /**
     * Sets a value on a form element based on its type (select, checkbox/radio, or other input).
     * The "Locator" interface used should be whatever is compatible with the testing library
     * being integrated by your World Constructor. This is intended as an 80% solution for
     * behavioral tests, so that a single step definition can get an element based on a variety
     * of factors, e.g.:
     *
     * @example setValue(<SelectInput>, "Option 1, Option 2") => Selects multiple options in a select element
     * @example setValue(<RadioInput>, "true") => Checks a checkbox/radio item
     * @example setValue(<CheckboxInput>, "false") => Unchecks a checkbox item
     * @example setValue(<TextInput>, "Some text") => Fills a text input with "Some text"
     * @example setValue(<NumberInput>, 5) => Sets a number input to the number 5
     *
     * @param locator Locator
     * The Locator for the form element
     * @param value string|any
     * The value to set can be string or other value type
     */
    setValue(locator: any, value: string | any): Promise<void>;
    /**
     * Scrolls an element by a number of pixels in a given direction.
     *
     * @param locator Locator
     * The locator that should be scrolled
     * @param direction "up"|"down"|"left"|"right"
     * The direction to scroll, i.e. "up", "down", "left", "right"
     * @param px
     * A number of pixels to scroll
     */
    scroll(locator: any, direction: string, px: number): Promise<void>;
    /**
     * A helper method for parsing text on a page or in an element.
     * Can be used to check for the presence OR absence of visible OR hidden text.
     *
     * Examples:
     * @example expectText(locator, 'text', true, true) // expect that a locator with the text is visible (and there may be hidden ones)
     * @example expectText(locator, 'text', false, true) // expect that NO locator with the text is visible (but there may be hidden ones)
     * @example expectText(locator, 'text', true, false) // expect that a HIDDEN locator with the text IS FOUND on the page (but there may be visible ones)
     * @example expectText(locator, 'text', false, false) // expect that NO hidden locator with the text is found on the page (but there may be visible ones)
     *
     * @param locator the locator to check
     * @param text the text to be found
     * @param toBePresent whether a locator with the text should be present
     * @param toBeVisible whether the locator with the text should be visible
     * @returns void
     */
    expectText(locator: any, text: string, toBePresent: boolean, toBeVisible: boolean): Promise<void>;
    /**
     * A helper function for parsing elements on a page or in an element.
     * Can be used to check for the presence OR absence of visible OR hidden elements.
     * Examples:
     * @example expectElement(locator, true) // expect that an element is visible (and there may be hidden ones)
     * @example expectElement(locator, false) // expect that NO element is visible (but there may be hidden ones)
     * @example expectElement(locator, true, false) // expect that a HIDDEN element IS FOUND on the page (but there may be visible ones)
     * @example expectElement(locator, false, false) // expect that NO hidden element is found on the page (but there may be visible ones)
     *
     * @param locator the locator to check
     * @param toBePresent whether an element should be present
     * @param toBeVisible whether the element should be visible
     */
    expectElement(locator: any, toBePresent: boolean, toBeVisible: boolean): Promise<void>;
    /**
     * A helper function to get a screenshot of the current page or an element.
     * Depending on the implementation, it may also save a screenshot to disk.
     */
    screenshot(opts?: {
        name?: string;
        locator?: any;
    }): Promise<Buffer>;
    /**
     * A helper function to test whether two screenshots match. The "Locator" interface used
     * should be whatever is compatible with the testing library being integrated by your World Constructor.
     *
     * @param locator the locator to check
     * @param screenshotName the name of the screenshot to compare against
     */
    expectScreenshotMatch(locator: any, screenshotName: string, options?: any): Promise<void>;
    screenshotOptions: Partial<ScreenshotComparisonOptions>;
}
export declare class VisualWorld extends QuickPickleWorld implements StubVisualWorldInterface {
    constructor(context: TestContext, info: InfoConstructor);
    init(): Promise<void>;
    get screenshotDir(): string;
    get screenshotFilename(): string;
    get screenshotPath(): string;
    get screenshotOptions(): any;
    getScreenshotPath(name?: string): string;
    screenshotDiff(actual: Buffer, expected: Buffer, opts: any): Promise<VisualDiffResult>;
}
export {};
