// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export const retiredGithubClassroom = [
  ['/assignments/{assignment_id}', 'classroom/get-an-assignment'],
  ['/assignments/{assignment_id}/accepted_assignments', 'classroom/list-accepted-assignments-for-an-assignment'],
  ['/assignments/{assignment_id}/grades', 'classroom/get-assignment-grades'],
  ['/classrooms', 'classroom/list-classrooms'],
  ['/classrooms/{classroom_id}', 'classroom/get-a-classroom'],
  ['/classrooms/{classroom_id}/assignments', 'classroom/list-assignments-for-a-classroom'],
] as const;
const key = 'x-operations-github-classroom-retirement';
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Remove retired routes from the active projection after the full authentication review. */
export function excludeRetiredGithubClassroom(document: Record<string, any>): void {
  const marker = { version: 1, retiredOn: '2026-08-28',
    reason: 'GitHub retired these Classroom endpoints; requests return HTTP 410 Gone.',
    operationIds: retiredGithubClassroom.map(([, id]) => id) };
  const fail = () => { throw new Error('GitHub Classroom retirement requires the six reviewed routes and authentication provenance.'); };
  if (document.openapi !== '3.1.0' || document.info?.title !== 'GitHub v3 REST API' || document.info.version !== '1.1.4'
    || document.servers?.length !== 1 || document.servers[0]?.url !== 'https://api.github.com'
    || document.security !== undefined || !object(document.paths)
    || document['x-operations-github-authentication']?.version !== 8) fail();
  const marked = document[key] !== undefined;
  if (marked && JSON.stringify(document[key]) !== JSON.stringify(marker)) fail();
  for (const [path, item] of Object.entries(document.paths)) {
    if (!object(item)) fail();
    for (const [method, operation] of Object.entries(item as Record<string, any>)) {
      if (!object(operation) || typeof operation.operationId !== 'string' || !operation.operationId.startsWith('classroom/')) continue;
      if (marked || method !== 'get' || !retiredGithubClassroom.some(([expectedPath, id]) => path === expectedPath && operation.operationId === id)) fail();
    }
  }
  if (marked) {
    if (retiredGithubClassroom.some(([path]) => Object.hasOwn(document.paths, path))) fail();
    return;
  }
  for (const [path, id] of retiredGithubClassroom) {
    const item = document.paths[path], operation = item?.get;
    if (!object(item) || Object.keys(item).length !== 1 || !object(operation) || operation.operationId !== id
      || item.servers !== undefined || operation.servers !== undefined
      || JSON.stringify(operation.security) !== '[{"GitHubAuthenticationNotReviewed":[]}]'
      || JSON.stringify(operation['x-github-authentication']?.profiles) !== '["unreviewed"]') fail();
  }
  for (const [path] of retiredGithubClassroom) delete document.paths[path];
  document[key] = marker;
}
