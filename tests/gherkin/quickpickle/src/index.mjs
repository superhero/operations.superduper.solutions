// Derived from QuickPickle 1.11.2, copyright SamZiegler and David Hunt.
// MIT License; see ../LICENSE and UPSTREAM.json.
import { defaultsDeep } from 'lodash-es';
import { normalizeTags } from './tags.mjs';
import { renderGherkin, featureSourceMap } from './render.mjs';

export {
  BeforeAll, Before, BeforeStep, AfterAll, After, AfterStep, applyHooks,
} from './hooks.mjs';
export { addStepDefinition as Given, addStepDefinition as When,
  addStepDefinition as Then, defineParameterType } from './steps.mjs';
export { DataTable } from './models/DataTable.mjs';
export { DocString } from './models/DocString.mjs';
export { tagsMatch, normalizeTags } from './tags.mjs';
export { explodeTags } from './render.mjs';
export { QuickPickleWorld, VisualWorld, setWorldConstructor,
  getWorldConstructor, defaultScreenshotComparisonOptions,
  isAriaRoleExtended } from './world.mjs';
export { runScenario, gherkinStep, getWorkerFailure,
  isWorkerQuarantined } from './runtime.mjs';
export { hookReportError } from './diagnostics.mjs';

/** Bump when transformer/runtime contracts change, including unversioned edits. */
export const QUICKPICKLE_PATCH_ID = 'quickpickle-1.11.2-operations.1';

export const defaultConfig = {
  root: '', stepTimeout: 3000, stepAbortGrace: 1000,
  todoTags: ['@todo', '@wip'], skipTags: ['@skip'],
  failTags: ['@fails', '@failing', '@should-fail'],
  softFailTags: ['@soft', '@softfail'], concurrentTags: ['@concurrent'],
  sequentialTags: ['@sequential'], explodeTags: [], worldConfig: {},
  tagExpression: '', testModule: 'vitest',
};

/** Keep the complete message; only change a generated feature frame's line. */
export function formatStack(text, line) {
  return String(text).replace(/(\.feature(?:\.md)?):\d+:\d+/, `$1:${line}:1`);
}

export function quickpickle(passedConfig = {}) {
  let config;
  return {
    name: QUICKPICKLE_PATCH_ID,
    // Vite's feature-transform cache otherwise survives edits to a local fork.
    async config(viteConfig) {
      const base = viteConfig.cacheDir || 'node_modules/.vite';
      const cacheDir = base.endsWith(QUICKPICKLE_PATCH_ID)
        ? base : `${base}/${QUICKPICKLE_PATCH_ID}`;
      // Vitest 5 has a separate persistent transformed-module cache. Its default
      // path is independent of Vite.cacheDir and otherwise reuses a feature
      // generated with different tags, deadlines or fixture-module options.
      const { createHash } = await import('node:crypto');
      const settings = createHash('sha256').update(JSON.stringify({
        patch: QUICKPICKLE_PATCH_ID, passedConfig,
        config: viteConfig.quickpickle, test: viteConfig.test?.quickpickle,
      })).digest('hex').slice(0, 24);
      const moduleBase = viteConfig.test?.fsModuleCachePath || cacheDir;
      return { cacheDir, test: { fsModuleCachePath: `${moduleBase}/features-${settings}` } };
    },
    configResolved(resolved) {
      config = defaultsDeep({}, resolved.test?.quickpickle || {},
        resolved.quickpickle || {}, passedConfig, defaultConfig);
      for (const key of ['todoTags', 'skipTags', 'failTags', 'softFailTags',
        'concurrentTags', 'sequentialTags']) config[key] = normalizeTags(config[key]);
      const groups = config.explodeTags;
      config.explodeTags = Array.isArray(groups) && groups.every(Array.isArray)
        ? groups.map(normalizeTags) : [normalizeTags(groups)];
      config.root ||= resolved.root;
      if (!Number.isFinite(config.stepTimeout) || config.stepTimeout <= 0
        || !Number.isFinite(config.stepAbortGrace) || config.stepAbortGrace < 0)
        throw new TypeError('QuickPickle requires a positive stepTimeout and nonnegative stepAbortGrace.');
    },
    transform(source, id) {
      if (!/\.feature(?:\.md)?$/.test(id)) return;
      const code = renderGherkin(source, config, id.endsWith('.md'), id);
      return { code, map: featureSourceMap(code, source, id) };
    },
  };
}

export default quickpickle;
