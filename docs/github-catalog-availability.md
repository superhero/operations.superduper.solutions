# GitHub catalog availability

GitHub retired its Classroom REST API on 2026-08-28. These endpoints return
HTTP 410 Gone and are excluded from the active Operations catalog:

- `classroom/get-an-assignment`
- `classroom/list-accepted-assignments-for-an-assignment`
- `classroom/get-assignment-grades`
- `classroom/list-classrooms`
- `classroom/get-a-classroom`
- `classroom/list-assignments-for-a-classroom`

The [Classroom](https://docs.github.com/en/rest/classroom/classroom) and
[assignments](https://docs.github.com/en/rest/classroom/assignments) reference
documents describe the retirement. Changing credentials cannot restore these
APIs.

The pinned upstream bundle retains all 1,242 original operations. The full
authentication review runs before the versioned retirement correction removes
these six routes from the effective schema and its generated index. The active
catalog contains 1,236 operations. Retirement metadata records the reason, date
and original IDs; it does not count the excluded routes as passing operations.

Other GitHub routes retain their reviewed token profiles and wire contracts.
Migration archive downloads require the separately configured
[archive companion](../companions/github-archive/README.md). Restoring Classroom
routes requires fresh provider evidence, source review and contract validation.
