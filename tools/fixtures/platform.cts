import sdk = require("@spryinc/spryplanner-sdk");
const client = new sdk.SpryPlannerClient({
  baseUrl: "https://api.example.invalid",
  workspaceId: "workspace_fixture",
  apiKey: `ddk_${"b".repeat(48)}`,
});
if (
  client.prepareCreateTask({ id: sdk.newTaskId(), title: "CommonJS fixture" })
    .workspaceId !== "workspace_fixture"
)
  throw Error("CommonJS failed");
