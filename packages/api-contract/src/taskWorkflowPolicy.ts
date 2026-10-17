const commandPolicy = {
  requiredCapability: "write",
  issuerPermission: "write",
  agentMemberScopes: ["workspace"],
  requiredLicenseCapability: "canUseTasks",
  preconditions: [
    "stable_operation_and_idempotency_identity",
    "workspace_writable_state",
    "payload_references_and_entity_access",
    "license_for_optional_fields",
  ],
  preview: "not_supported",
  errorSchema: "v1ErrorEnvelopeSchema",
  route: { method: "POST", path: "/api/v1/workspaces/{workspaceId}/commands" },
} as const;
const mutationPolicy = {
  ...commandPolicy,
  handlerKey: "executeTaskMutationCommand",
  expectedTaskVersion: true,
  preconditions: [...commandPolicy.preconditions, "current_task_version"],
  licenseFields: [],
} as const;
const readPolicy = {
  requiredCapability: "read",
  issuerPermission: "read",
  agentMemberScopes: ["workspace", "project", "label"],
  requiredLicenseCapability: "canUseTasks",
  preconditions: ["permitted_entity_scope"],
  preview: "not_applicable",
  errorSchema: "v1ErrorEnvelopeSchema",
  expectedTaskVersion: false,
  licenseFields: [],
} as const;

/** Contract identifiers bind native policies; license values come exclusively
 * from the domain's central workspace configuration at runtime. */
export const taskWorkflowPoliciesV1 = {
  "task.create": {
    ...commandPolicy,
    handlerKey: "executeTaskCreateCommand",
    lifecycle: "create_open",
    expectedTaskVersion: false,
    licenseFields: [
      {
        field: "assigneeUserId",
        when: "another_user",
        capability: "canAssignTasksToOthers",
      },
    ],
  },
  "task.update_content": { ...mutationPolicy, lifecycle: "update_content" },
  "task.complete": { ...mutationPolicy, lifecycle: "complete" },
  "task.reopen": { ...mutationPolicy, lifecycle: "reopen" },
  "task.query": {
    ...readPolicy,
    handlerKey: "queryV1TasksForUser",
    lifecycle: "query_current",
    route: {
      method: "POST",
      path: "/api/v1/workspaces/{workspaceId}/tasks/query",
    },
  },
  "task.get": {
    ...readPolicy,
    handlerKey: "v1TaskDetailForUser",
    lifecycle: "read_current",
    route: {
      method: "GET",
      path: "/api/v1/workspaces/{workspaceId}/tasks/{taskId}",
    },
  },
} as const;
export type TaskWorkflowOperation = keyof typeof taskWorkflowPoliciesV1;

export function taskWorkflowPolicyFor(name: string) {
  return Object.hasOwn(taskWorkflowPoliciesV1, name)
    ? taskWorkflowPoliciesV1[name as TaskWorkflowOperation]
    : null;
}
