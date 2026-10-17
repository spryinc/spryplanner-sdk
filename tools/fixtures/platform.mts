import {
  SpryPlannerClient,
  SpryPlannerApiError,
  newTaskId,
} from "@spryinc/spryplanner-sdk";
const key = `ddk_${"a".repeat(48)}`;
const client = new SpryPlannerClient({
  baseUrl: "https://api.example.invalid",
  workspaceId: "workspace_fixture",
  apiKey: key,
  fetch: async () =>
    new Response("limited", { status: 429, headers: { "retry-after": "30" } }),
});
const packet = client.prepareCreateTask({
  id: newTaskId(),
  title: "Platform fixture",
});
if (
  packet.workspaceId !== "workspace_fixture" ||
  JSON.stringify(client).includes(key)
)
  throw Error("Prepared command or key privacy failed");
try {
  await client.getTask("task_fixture");
  throw Error("Expected HTTP error");
} catch (error) {
  if (
    !(error instanceof SpryPlannerApiError) ||
    error.status !== 429 ||
    error.retryAfter !== "30"
  )
    throw error;
}
