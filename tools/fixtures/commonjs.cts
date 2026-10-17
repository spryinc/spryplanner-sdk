import sdk = require("@spryinc/spryplanner-sdk");
declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};
const context = JSON.parse(process.env.SPRY_SDK_CONTEXT!);
const client = new sdk.SpryPlannerClient({
  baseUrl: context.baseUrl,
  workspaceId: context.workspaceId,
  apiKey: context.apiKey,
});
client
  .discover()
  .then((result) => {
    if (result.workspace.id !== context.workspaceId)
      throw new Error("CommonJS discovery failed");
    console.log("External CommonJS SDK discovery passed");
  })
  .catch(() => {
    process.exitCode = 1;
  });
