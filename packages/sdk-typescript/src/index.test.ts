import { expect, it, vi } from "vitest";
import {
  SpryPlannerClient,
  SpryPlannerApiError,
  SpryPlannerTransportError,
  SpryPlannerContractError,
  newTaskId,
} from "./index.js";
const apiKey = `ddk_${"a".repeat(48)}`;
const options = {
  baseUrl: "https://api.example.invalid",
  workspaceId: "workspace_fixture",
  apiKey,
};
it("requires a regional origin and a scoped key, never a human session", async () => {
  for (const baseUrl of [
    "http://external.invalid",
    "https://name:password@api.invalid",
    "https://api.invalid/api",
    "https://api.invalid/?secret=value",
  ])
    expect(() => new SpryPlannerClient({ ...options, baseUrl })).toThrow();
  expect(JSON.stringify(new SpryPlannerClient(options))).not.toContain(apiKey);
  try {
    new SpryPlannerClient({ ...options, baseUrl: `invalid origin ${apiKey}` });
  } catch (error) {
    expect((error as Error).message).not.toContain(apiKey);
  }
  const transport = vi.fn();
  await expect(
    new SpryPlannerClient({
      ...options,
      apiKey: "human-session",
      fetch: transport,
    }).discover(),
  ).rejects.toThrow(/scoped/);
  expect(transport).not.toHaveBeenCalled();
});
it("preserves the original mutation identity after an uncertain outcome and never retries automatically", async () => {
  const transport = vi.fn().mockRejectedValue(new Error("connection dropped"));
  const client = new SpryPlannerClient({ ...options, fetch: transport });
  const command = client.prepareCreateTask({
    id: newTaskId(),
    title: "Fixture",
  });
  await expect(client.execute(command)).rejects.toMatchObject({
    name: "SpryPlannerTransportError",
    operationId: command.operationId,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  await expect(
    client.execute(JSON.parse(JSON.stringify(command))),
  ).rejects.toBeInstanceOf(SpryPlannerTransportError);
  const packets = transport.mock.calls.map(([, request]) =>
    JSON.parse(request.body),
  );
  expect(packets[0]).toEqual(packets[1]);
  expect(transport.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    cache: "no-store",
  });
});
it("requires task-version preconditions and bounds the supported command slice", () => {
  const client = new SpryPlannerClient(options);
  expect(() =>
    client.prepareUpdateTask("task_fixture", 0, {
      title: "X",
      description: "",
    }),
  ).toThrow(/version/);
  const command = client.prepareReopenTask("task_fixture", 1);
  expect(() => client.execute({ ...command, expectedVersions: [] })).toThrow(
    /precondition/,
  );
  expect(() =>
    client.execute({ ...command, workspaceId: "workspace_other" }),
  ).toThrow(/workspace/);
});
it("keeps known HTTP failures structured even when their body is malformed", async () => {
  const transport = vi.fn().mockResolvedValue(
    new Response("unavailable", {
      status: 429,
      headers: { "retry-after": "30" },
    }),
  );
  const client = new SpryPlannerClient({ ...options, fetch: transport });
  await expect(client.getTask("task_fixture")).rejects.toMatchObject({
    name: "SpryPlannerApiError",
    status: 429,
    retryAfter: "30",
    retryable: true,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(SpryPlannerApiError).toBeDefined();
});
it("rejects invalid response contracts and a non-advancing pagination cursor", async () => {
  const bad = new SpryPlannerClient({
    ...options,
    fetch: vi.fn().mockResolvedValue(new Response("{}")),
  });
  await expect(bad.getTask("task_fixture")).rejects.toBeInstanceOf(
    SpryPlannerContractError,
  );
  const client = new SpryPlannerClient({
    ...options,
    fetch: vi.fn().mockImplementation(async () =>
      Response.json({
        items: [],
        page: { hasMore: true, nextCursor: "cursor_fixture" },
      }),
    ),
  });
  const query = {
    filters: {
      selectedProjectId: "all",
      realmFilter: "all",
      statusFilter: "all" as const,
      searchQuery: "",
      assigneeFilter: "all",
      labelFilter: "all",
      dueFilter: "all" as const,
    },
  };
  await expect(
    (async () => {
      for await (const page of client.taskPages(query))
        expect(page.items).toHaveLength(0);
    })(),
  ).rejects.toThrow(/non-advancing/);
});
it("honors cancellation before transmission and deadlines during a mutation", async () => {
  const transport = vi
    .fn()
    .mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
  const client = new SpryPlannerClient({ ...options, fetch: transport });
  await expect(
    client.discover({ signal: AbortSignal.abort() }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(transport).not.toHaveBeenCalled();
  const packet = client.prepareCreateTask({
    id: newTaskId(),
    title: "Fixture",
  });
  await expect(client.execute(packet, { timeoutMs: 20 })).rejects.toMatchObject(
    { name: "SpryPlannerTransportError", operationId: packet.operationId },
  );
  expect(transport).toHaveBeenCalledTimes(1);
});
