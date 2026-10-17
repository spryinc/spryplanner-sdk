import { SpryPlannerClient, type Task } from "@spryinc/spryplanner-sdk";
declare const client: SpryPlannerClient;
declare const task: Task;
const version: number = task.version;
void version;
// @ts-expect-error Task titles must be strings, not any.
client.prepareCreateTask({ id: "fixture", title: 42 });
// @ts-expect-error Human credential management is not part of this SDK.
client.apiKeys;
// @ts-expect-error Task versions must be numeric.
client.prepareReopenTask(task.id, "old-version");
