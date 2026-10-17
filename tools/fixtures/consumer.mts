import {
  SpryPlannerClient,
  SpryPlannerApiError,
  SpryPlannerTransportError,
  newTaskId,
  type Task,
} from "@spryinc/spryplanner-sdk";
declare const process: { env: Record<string, string | undefined> };
const context = JSON.parse(process.env.SPRY_SDK_CONTEXT!);
const client = new SpryPlannerClient({
  baseUrl: context.baseUrl,
  workspaceId: context.workspaceId,
  apiKey: context.apiKey,
});
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
assert(
  !JSON.stringify(client).includes(context.apiKey),
  "Client inspection exposed the API key",
);
async function denied(status: number) {
  try {
    await client.discover();
    throw new Error("Expected denial");
  } catch (error) {
    assert(
      error instanceof SpryPlannerApiError && error.status === status,
      "Unexpected authorization result",
    );
  }
}
if (context.phase === "revoked" || context.phase === "expired")
  await denied(401);
else if (["downgraded", "suspended", "expired-trial"].includes(context.phase))
  await denied(403);
else if (context.phase === "removed") await denied(421);
else if (context.phase === "scope") {
  await client.discover();
  try {
    await client.execute(
      client.prepareCreateTask({
        id: newTaskId(),
        title: "SDK denied fixture",
      }),
    );
    throw new Error("Expected denial");
  } catch (error) {
    assert(
      error instanceof SpryPlannerApiError && error.status === 403,
      "Write scope was not enforced",
    );
  }
} else {
  const discovered = await client.discover();
  assert(
    discovered.workspace.id === context.workspaceId,
    "Discovery workspace mismatch",
  );
  const id = newTaskId();
  const packet = client.prepareCreateTask({
    id,
    title: "SDK external fixture first",
  });
  let requests = 0;
  const uncertain = new SpryPlannerClient({
    baseUrl: context.baseUrl,
    workspaceId: context.workspaceId,
    apiKey: context.apiKey,
    fetch: async (url, options) => {
      requests++;
      const response = await fetch(url, options);
      await response.arrayBuffer();
      throw new Error("Simulated lost response after acceptance");
    },
  });
  try {
    await uncertain.execute(packet);
    throw new Error("Expected uncertainty");
  } catch (error) {
    assert(
      error instanceof SpryPlannerTransportError &&
        error.operationId === packet.operationId,
      "Original operation identity lost",
    );
  }
  assert(requests === 1, "Mutation was automatically retried");
  assert(
    (await client.operation(packet.operationId)).operation.status ===
      "accepted",
    "Receipt recovery failed",
  );
  const replay = await client.execute(JSON.parse(JSON.stringify(packet)));
  assert(
    replay.operation.status === "already_accepted",
    "Stable replay failed",
  );
  await client.execute(
    client.prepareCreateTask({
      id: newTaskId(),
      title: "SDK external fixture second",
    }),
  );
  const filters = {
    selectedProjectId: "all",
    realmFilter: "all",
    statusFilter: "all" as const,
    searchQuery: "SDK external fixture",
    assigneeFilter: "all",
    labelFilter: "all",
    dueFilter: "all" as const,
  };
  const seen = new Set<string>();
  let pages = 0;
  for await (const page of client.taskPages({ filters, limit: 1 })) {
    pages++;
    for (const task of page.items) seen.add(task.id);
  }
  assert(pages === 2 && seen.size === 2, "Pagination lost or duplicated tasks");
  const before: Task = await client.getTask(id);
  await client.execute(
    client.prepareUpdateTask(id, before.version, {
      title: "SDK edited fixture",
      description: "External consumer",
    }),
  );
  try {
    await client.execute(
      client.prepareUpdateTask(id, before.version, {
        title: "Stale fixture",
        description: "",
      }),
    );
    throw new Error("Expected conflict");
  } catch (error) {
    assert(
      error instanceof SpryPlannerApiError &&
        error.status === 409 &&
        error.error !== null,
      "Structured stale conflict missing",
    );
  }
  const edited = await client.getTask(id);
  assert(edited.title === "SDK edited fixture", "Edit read-back failed");
  const completedAt = new Date().toISOString();
  await client.execute(
    client.prepareCompleteTask(id, edited.version, completedAt),
  );
  const completed = await client.getTask(id);
  assert(
    completed.status === "completed" && completed.completedAt === completedAt,
    "Completion failed",
  );
  await client.execute(client.prepareReopenTask(id, completed.version));
  assert((await client.getTask(id)).status === "open", "Reopen failed");
  const wrongWorkspace = new SpryPlannerClient({
    baseUrl: context.baseUrl,
    workspaceId: "workspace_wrong_fixture",
    apiKey: context.apiKey,
  });
  try {
    await wrongWorkspace.getTask(id);
    throw new Error("Expected scope denial");
  } catch (error) {
    assert(
      error instanceof SpryPlannerApiError && error.status === 403,
      "Workspace boundary was not enforced",
    );
  }
}
console.log("External ESM SDK journey passed: " + context.phase);
