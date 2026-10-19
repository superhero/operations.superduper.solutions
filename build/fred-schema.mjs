// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// The community v1 contract supplies the complete parameter inventory. These
// profiles add JSON workflow outputs and the documented v2 bulk endpoint.
// ALFRED is a historical view of the same /fred endpoints, not an /alfred API.
const documentation = 'https://fred.stlouisfed.org/docs/api/fred/';
const object = properties => ({ type: 'object', properties });
const string = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const array = items => ({ type: 'array', items });
const realtime = { realtime_start: string, realtime_end: string };
const page = { ...realtime, order_by: string, sort_order: string, count: integer, offset: integer, limit: integer };
const category = object({ id: integer, name: string, parent_id: integer });
const series = object({ id: string, ...realtime, title: string, observation_start: string, observation_end: string,
  frequency: string, frequency_short: string, units: string, units_short: string, seasonal_adjustment: string,
  seasonal_adjustment_short: string, last_updated: string, popularity: integer, group_popularity: integer, notes: string });
const release = object({ id: integer, ...realtime, name: string, press_release: boolean, link: string, notes: string });
const source = object({ id: integer, ...realtime, name: string, link: string, notes: string });
const tag = object({ name: string, group_id: string, notes: string, created: string, popularity: integer, series_count: integer });
const releaseDate = object({ release_id: integer, release_name: string, date: string });
// FRED deliberately returns numeric observation values as strings, including
// "." for missing data. Vintage-column output modes can add further properties.
const observation = object({ ...realtime, date: string, value: string });

function responseSchema(path) {
  if (['/fred/category', '/fred/category/children', '/fred/category/related', '/fred/series/categories'].includes(path))
    return object({ categories: array(category) });
  if (path === '/fred/series') return object({ ...realtime, seriess: array(series) });
  if (['/fred/category/series', '/fred/release/series', '/fred/series/search', '/fred/series/updates', '/fred/tags/series'].includes(path))
    return object({ ...page, seriess: array(series) });
  if (['/fred/release', '/fred/series/release'].includes(path)) return object({ ...realtime, releases: array(release) });
  if (['/fred/releases', '/fred/source/releases'].includes(path))
    return object({ ...page, releases: array(release) });
  if (['/fred/release/dates', '/fred/releases/dates'].includes(path))
    return object({ ...page, release_dates: array(releaseDate) });
  if (['/fred/source', '/fred/release/sources'].includes(path)) return object({ ...realtime, sources: array(source) });
  if (path === '/fred/sources') return object({ ...page, sources: array(source) });
  if (path.endsWith('/tags') || path.endsWith('/related_tags'))
    return object({ ...page, tags: array(tag) });
  if (path === '/fred/series/observations')
    return object({ ...page, observation_start: string, observation_end: string, units: string,
      output_type: integer, file_type: string, observations: array(observation) });
  if (path === '/fred/series/vintagedates') return object({ ...page, vintage_dates: array(string) });
}

function bulkObservations() {
  const url = `${documentation}v2/release_observations.html`;
  return {
    tags: ['Releases'], operationId: 'getBulkReleaseObservations', summary: 'Get bulk economic observations for a release (FRED v2)',
    description: 'Retrieve the history of all series in a release. Continue with next_cursor while has_more is true. '
      + 'Use a smaller limit for large releases. This FRED-only endpoint uses the API key as a bearer token.',
    externalDocs: { url }, security: [{ FredV2ApiKey: [] }],
    parameters: [
      { name: 'release_id', in: 'query', required: true, description: 'Release identifier.', schema: { type: 'integer', minimum: 1 } },
      { name: 'format', in: 'query', required: true, description: 'JSON format for structured workflow outputs.',
        schema: { type: 'string', enum: ['json'], default: 'json' } },
      { name: 'limit', in: 'query', description: 'Maximum observations in this page.',
        schema: { type: 'integer', minimum: 1, maximum: 500000, default: 500000 } },
      { name: 'next_cursor', in: 'query', description: 'Omit on the first request; use the previous response cursor for subsequent pages.', schema: string },
    ],
    responses: {
      '200': { description: 'A page of release observations.', content: { 'application/json': { schema: object({
        has_more: boolean, next_cursor: string,
        release: object({ release_id: integer, name: string, url: string, sources: array(object({ name: string, url: string, notes: string })) }),
        series: array(object({ series_id: string, title: string, frequency: string, units: string,
          seasonal_adjustment: string, last_updated: string, copyright_id: string, notes: string,
          observations: array(object({ date: string, value: string })) })),
      }) } } },
      '400': { description: 'Invalid request.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      '401': { description: 'Missing or invalid API key.' },
      '429': { description: 'API rate limit exceeded.' },
    },
  };
}

/** Preserve the upstream v1 operation identifiers, including saved GeoFRED nodes. */
export function adaptFredSchema(input, profile) {
  if (!['fred', 'alfred'].includes(profile)) throw new Error(`Unknown FRED profile: ${profile}`);
  const document = structuredClone(input);
  const archive = profile === 'alfred';
  document.info.title = archive ? 'ALFRED / Archival Federal Reserve Economic Data' : 'FRED / Federal Reserve Economic Data';
  document.info.description = archive
    ? 'Historical vintages and revisions of US and international economic data. ALFRED uses the FRED v1 API and the same API key. '
      + 'Choose a past realtime_start and realtime_end, or vintage_dates, to retrieve data as it was known then. '
      + 'Without a historical period, the API normally returns the current vintage. Managed by the Federal Reserve Bank of St. Louis.'
    : 'US and international economic time series, observations, releases, categories, sources and tags. '
      + 'Federal Reserve Economic Data is managed by the Federal Reserve Bank of St. Louis. '
      + 'Includes FRED v1, v2 bulk release observations and the existing GeoFRED mapping endpoints. An API key is required.';
  document.externalDocs = { url: archive ? `${documentation}realtime_period.html` : documentation };
  if (archive) {
    document.paths = Object.fromEntries(Object.entries(document.paths).filter(([path]) => path.startsWith('/fred/') && !path.startsWith('/fred/v2/')));
    document.tags = document.tags?.filter(tag => !/geofred/i.test(tag.name));
  }
  for (const [path, item] of Object.entries(document.paths)) {
    const operation = item.get;
    if (!operation) continue;
    if (path.startsWith('/fred/')) operation.externalDocs = { url: `${documentation}${path.slice(6).replaceAll('/', '_')}.html` };
    const format = operation.parameters?.find(parameter => parameter.in === 'query' && parameter.name === 'file_type');
    if (format) {
      format.required = true;
      format.description = 'JSON format for structured workflow outputs.';
      format.schema = { type: 'string', enum: ['json'], default: 'json' };
    }
    if (path === '/fred/series/search') operation.parameters.find(parameter => parameter.name === 'search_text').required = true;
    const shape = responseSchema(path);
    if (shape) operation.responses['200'].content['application/json'].schema = shape;
  }
  if (!archive) {
    document.components.securitySchemes.FredV2ApiKey = { type: 'http', scheme: 'bearer',
      description: 'Use the same registered FRED API key. FRED v2 requires Authorization: Bearer <api-key>.' };
    document.paths['/fred/v2/release/observations'] = { get: bulkObservations() };
  }
  return document;
}
