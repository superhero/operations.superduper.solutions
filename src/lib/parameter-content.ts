// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

type Value = Record<string, any>;
const object = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);

/** OpenAPI content parameters are one serialized JSON value, rather than form
 * or deepObject values. The URL transport percent-encodes that value once. */
export function parameterContentSchema(parameter: Value): Value | undefined {
  if (parameter.content === undefined) return;
  if (!['path', 'query'].includes(parameter.in)
    || ['schema', 'style', 'explode', 'allowReserved', 'allowEmptyValue'].some(key => Object.hasOwn(parameter, key)))
    throw new Error('JSON content parameters require a path/query location and cannot also declare schema or style/explode overrides.');
  const content = parameter.content;
  if (!object(content) || Object.keys(content).length !== 1 || !Object.hasOwn(content, 'application/json'))
    throw new Error('Content parameters require exactly one supported media type: application/json.');
  const media = content['application/json'];
  if (!object(media) || !object(media.schema) || Object.keys(media).some(key => !['schema', 'example', 'examples'].includes(key)))
    throw new Error('A JSON content parameter requires a schema without custom media encodings.');
  return media.schema;
}

export const bitbucketContentSourceSha256 = '29bdc3c5ef420a7ec6c500812d114cba7ca7257b596a6b29a06949846965855e';
export const bitbucketContentPaths = ['/branch-utils/latest/projects/{projectKey}/repos/{repositorySlug}/branches/info/{commitId}', '/ssh/latest/keys'] as const;

/** The source descriptions specify a raw commit ID and an optional username.
 * The SSH key object belongs to the JSON request body, not to the user query. */
export function bindBitbucketContentParameters(document: Value): void {
  const requireContract = (valid: unknown): void => { if (!valid) throw new Error('Bitbucket content parameters require the reviewed source contract.'); };
  requireContract(document.openapi === '3.0.1' && document.info?.title === 'Bitbucket Data Center' && document.info?.version === '10.5');
  for (const [index, path] of bitbucketContentPaths.entries()) {
    const method = index === 0 ? 'get' : 'post', name = index === 0 ? 'commitId' : 'user';
    const operation = document.paths?.[path]?.[method];
    const parameters = operation?.parameters?.filter((parameter: Value) => parameter.name === name && parameter.in === (index === 0 ? 'path' : 'query'));
    requireContract(operation?.operationId === `${method.toUpperCase()} ${path}` && parameters?.length === 1
      && operation['x-upstream-content-parameter'] === undefined);
    const parameter = parameters[0], expected = index === 0 ? { type: 'string', maxLength: 40 } : { $ref: '#/components/schemas/RestSshKey' };
    requireContract(parameter.schema === undefined && JSON.stringify(parameter.content) === JSON.stringify({ 'application/json': { schema: expected } }));
    operation['x-upstream-content-parameter'] = structuredClone(parameter);
    delete parameter.content;
    parameter.schema = index === 0 ? structuredClone(expected) : { type: 'string' };
  }
}
