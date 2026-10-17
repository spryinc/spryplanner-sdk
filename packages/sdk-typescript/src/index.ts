import {
  agentContextResponseSchema,
  commandResultSchema,
  workspaceCommandSchema,
  createTaskCommandSchema,
  taskUpdateContentCommandPayloadSchema,
  taskCompleteCommandPayloadSchema,
  taskReopenCommandPayloadSchema,
  taskDetailSchema,
  taskQueryRequestSchema,
  taskQueryPageResponseSchema,
  v1ErrorEnvelopeSchema,
  commandIdSchema,
  entityIdSchema,
  workspaceIdSchema,
  type z,
} from "../../api-contract/src/index.js";

/** Public models derive from the same schemas that validate regional HTTP. */
export type Task = z.infer<typeof taskDetailSchema>;
export type TaskQuery = z.input<typeof taskQueryRequestSchema>;
export type TaskPage = z.infer<typeof taskQueryPageResponseSchema>;
export type AgentContext = z.infer<typeof agentContextResponseSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
type Envelope = z.infer<typeof workspaceCommandSchema>;
export type TaskCommand = {
  [K in keyof typeof payloadSchemas]: Omit<
    Envelope,
    "commandType" | "payload"
  > & { commandType: K; payload: z.infer<(typeof payloadSchemas)[K]> };
}[keyof typeof payloadSchemas];
export type CreateTask = Omit<
  z.input<typeof createTaskCommandSchema>,
  "workspaceId"
>;
export type UpdateTask = Omit<
  z.input<typeof taskUpdateContentCommandPayloadSchema>,
  "taskId"
>;
export type ApiError = z.infer<typeof v1ErrorEnvelopeSchema>["error"];
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface ClientOptions {
  baseUrl: string;
  workspaceId: string;
  apiKey: string | (() => string | Promise<string>);
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
export class SpryPlannerApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError | null,
    readonly retryAfter: string | null,
    readonly operationId: string | null = null,
  ) {
    super(error?.message ?? `SpryPlanner request failed (${status})`);
    this.name = "SpryPlannerApiError";
  }
  get code() {
    return this.error?.code ?? "HTTP_ERROR";
  }
  get retryable() {
    return this.error?.retryable ?? (this.status === 429 || this.status >= 500);
  }
}
export class SpryPlannerTransportError extends Error {
  constructor(readonly operationId: string | null) {
    super(
      operationId
        ? "The operation outcome is uncertain. Keep the original command and recover by its operation ID."
        : "The request did not complete.",
    );
    this.name = "SpryPlannerTransportError";
  }
}
export class SpryPlannerContractError extends Error {
  constructor() {
    super("The response does not match the supported API contract.");
    this.name = "SpryPlannerContractError";
  }
}

/** Generate a UUIDv7 task identity; operation identities use crypto.randomUUID. */
export function newTaskId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index--) {
    bytes[index] = Number(timestamp & 255n);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const text = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
const payloadSchemas = {
  "task.create": createTaskCommandSchema,
  "task.update_content": taskUpdateContentCommandPayloadSchema,
  "task.complete": taskCompleteCommandPayloadSchema,
  "task.reopen": taskReopenCommandPayloadSchema,
};
export class SpryPlannerClient {
  readonly workspaceId: string;
  readonly #baseUrl: string;
  readonly #options: ClientOptions;
  constructor(options: ClientOptions) {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new Error("Invalid regional API origin.");
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error(
        "Use the HTTPS regional API origin, or explicit loopback HTTP for development.",
      );
    this.#baseUrl = url.origin;
    this.workspaceId = workspaceIdSchema.parse(options.workspaceId);
    this.#options = options;
  }
  private path(suffix: string) {
    return `/api/v1/workspaces/${encodeURIComponent(this.workspaceId)}${suffix}`;
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body: unknown | undefined,
    options: RequestOptions = {},
    operationId: string | null = null,
  ): Promise<T> {
    const timeout = options.timeoutMs ?? this.#options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000)
      throw new Error("timeoutMs must be between 1 and 120000.");
    options.signal?.throwIfAborted();
    const key =
      typeof this.#options.apiKey === "function"
        ? await this.#options.apiKey()
        : this.#options.apiKey;
    if (!/^ddk_[A-Za-z0-9_-]{32,}$/.test(key))
      throw new Error(
        "A scoped SpryPlanner API key is required; human session tokens are not supported.",
      );
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(options.signal ? [options.signal] : []),
    ]);
    let response: Response;
    let data: unknown;
    try {
      response = await (this.#options.fetch ?? globalThis.fetch)(
        `${this.#baseUrl}${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
    } catch {
      throw new SpryPlannerTransportError(operationId);
    }
    try {
      data = await response.json();
    } catch {
      if (response.ok) {
        if (operationId) throw new SpryPlannerTransportError(operationId);
        throw new SpryPlannerContractError();
      }
      data = null;
    }
    if (!response.ok) {
      const envelope = v1ErrorEnvelopeSchema.safeParse(data);
      throw new SpryPlannerApiError(
        response.status,
        envelope.success ? envelope.data.error : null,
        response.headers.get("retry-after"),
        operationId,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      if (operationId) throw new SpryPlannerTransportError(operationId);
      throw new SpryPlannerContractError();
    }
    return parsed.data;
  }
  async discover(options?: RequestOptions): Promise<AgentContext> {
    const result = await this.request(
      "/api/v1/agent-context",
      agentContextResponseSchema,
      undefined,
      options,
    );
    if (result.workspace.id !== this.workspaceId)
      throw new Error("The key belongs to a different workspace.");
    return result;
  }
  getTask(taskId: string, options?: RequestOptions): Promise<Task> {
    return this.request(
      this.path(`/tasks/${encodeURIComponent(entityIdSchema.parse(taskId))}`),
      taskDetailSchema,
      undefined,
      options,
    );
  }
  queryTasks(query: TaskQuery, options?: RequestOptions): Promise<TaskPage> {
    return this.request(
      this.path("/tasks/query"),
      taskQueryPageResponseSchema,
      taskQueryRequestSchema.parse(query),
      options,
    );
  }
  async *taskPages(
    query: TaskQuery,
    options?: RequestOptions,
  ): AsyncGenerator<TaskPage> {
    let cursor = query.cursor;
    const visited = new Set<string>(cursor ? [cursor] : []);
    for (let index = 0; index < 1000; index++) {
      const page = await this.queryTasks(
        { ...query, ...(cursor ? { cursor } : {}) },
        options,
      );
      const next = page.page.nextCursor;
      if (page.page.hasMore && (!next || visited.has(next)))
        throw new Error("The API returned a non-advancing task cursor.");
      yield page;
      if (!page.page.hasMore) return;
      visited.add(next!);
      cursor = next!;
    }
    throw new Error(
      "Task pagination exceeded 1000 pages; continue explicitly from the last cursor.",
    );
  }
  async *tasks(
    query: TaskQuery,
    options?: RequestOptions,
  ): AsyncGenerator<Task> {
    for await (const page of this.taskPages(query, options)) yield* page.items;
  }
  private prepare(
    commandType: TaskCommand["commandType"],
    payload: Record<string, unknown>,
    taskId?: string,
    version?: number,
  ): TaskCommand {
    if (taskId && (!Number.isSafeInteger(version) || version! < 1))
      throw new Error("A current positive task version is required.");
    const operationId = crypto.randomUUID();
    return workspaceCommandSchema.parse({
      protocolVersion: 1,
      commandSchemaVersion: 1,
      workspaceId: this.workspaceId,
      operationId,
      idempotencyKey: operationId,
      commandType,
      payload: payloadSchemas[commandType].parse(payload),
      expectedVersions: taskId
        ? [{ entityType: "task", entityId: taskId, version }]
        : [],
      clientId: "spryplanner-typescript-sdk",
    }) as TaskCommand;
  }
  prepareCreateTask(input: CreateTask): TaskCommand {
    return this.prepare("task.create", {
      ...input,
      workspaceId: this.workspaceId,
    });
  }
  prepareUpdateTask(
    taskId: string,
    version: number,
    input: UpdateTask,
  ): TaskCommand {
    return this.prepare(
      "task.update_content",
      { ...input, taskId },
      taskId,
      version,
    );
  }
  prepareCompleteTask(
    taskId: string,
    version: number,
    completedAt: string | null = null,
  ): TaskCommand {
    return this.prepare(
      "task.complete",
      { taskId, completedAt },
      taskId,
      version,
    );
  }
  prepareReopenTask(taskId: string, version: number): TaskCommand {
    return this.prepare("task.reopen", { taskId }, taskId, version);
  }
  execute(
    command: TaskCommand,
    options?: RequestOptions,
  ): Promise<CommandResult> {
    const parsed = workspaceCommandSchema.parse(command);
    if (
      parsed.workspaceId !== this.workspaceId ||
      !Object.hasOwn(payloadSchemas, parsed.commandType)
    )
      throw new Error(
        "Command is outside this SDK's workspace or supported capability set.",
      );
    const type = parsed.commandType as TaskCommand["commandType"];
    payloadSchemas[type].parse(parsed.payload);
    if (
      type !== "task.create" &&
      !parsed.expectedVersions.some(
        (entry) =>
          entry.entityType === "task" &&
          entry.entityId === parsed.payload.taskId,
      )
    )
      throw new Error("A current task-version precondition is required.");
    if (
      type === "task.create" &&
      parsed.payload.workspaceId !== this.workspaceId
    )
      throw new Error(
        "Task payload workspace must match the command workspace.",
      );
    return this.request(
      this.path("/commands"),
      commandResultSchema,
      parsed,
      options,
      parsed.operationId,
    );
  }
  operation(
    operationId: string,
    options?: RequestOptions,
  ): Promise<CommandResult> {
    return this.request(
      this.path(
        `/operations/${encodeURIComponent(commandIdSchema.parse(operationId))}`,
      ),
      commandResultSchema,
      undefined,
      options,
    );
  }
}
