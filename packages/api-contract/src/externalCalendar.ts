import { z } from "zod";
import {
  calendarFeedCommandSchema,
  calendarFeedResultSchema,
} from "./calendarFeeds.js";
import {
  exactInstantSchema,
  compareInstants,
  instantMicroseconds,
} from "./temporalInstants.js";
import {
  entityIdSchema,
  untrustedUserContentSchema,
} from "./contentPrimitives.js";

/** Reserved until the command registry and regional runtime explicitly enable it. */
export const externalCalendarProviders = [
  "google_calendar",
  "microsoft_calendar",
  "icloud_calendar",
] as const;
export const externalCalendarProviderSchema = z.enum(externalCalendarProviders);
export type ExternalCalendarProvider = z.infer<
  typeof externalCalendarProviderSchema
>;

export const externalCalendarActions = [
  "read_busy",
  "read_details",
  "create_event",
  "reschedule_event",
  "cancel_event",
  "manage_links",
  "request_sync",
] as const;
export const externalCalendarActionSchema = z.enum(externalCalendarActions);
export type ExternalCalendarAction = z.infer<
  typeof externalCalendarActionSchema
>;

export const externalCalendarGrantSchema = z
  .object({
    connectionId: entityIdSchema,
    calendarId: entityIdSchema,
    actions: z
      .array(externalCalendarActionSchema)
      .min(1)
      .max(externalCalendarActions.length)
      .refine(
        (actions) => new Set(actions).size === actions.length,
        "Duplicate actions are not allowed.",
      ),
  })
  .strict();
export type ExternalCalendarGrant = z.infer<typeof externalCalendarGrantSchema>;

const instant = exactInstantSchema;
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date.");
const timeZone = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid time zone.");

export const externalCalendarScheduleSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("timed"),
        startAt: instant,
        endAt: instant,
        timeZone,
      })
      .strict(),
    z
      .object({
        kind: z.literal("all_day"),
        startDate: dateOnly,
        endDateExclusive: dateOnly,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    let valid = false;
    try {
      valid =
        value.kind === "timed"
          ? compareInstants(value.endAt, value.startAt) > 0
          : value.endDateExclusive > value.startDate;
    } catch {
      /* Invalid instants remain validation failures, never rounded. */
    }
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "End must follow start.",
        path: [value.kind === "timed" ? "endAt" : "endDateExclusive"],
      });
  });
export type ExternalCalendarSchedule = z.infer<
  typeof externalCalendarScheduleSchema
>;

export const externalCalendarWindowSchema = z
  .object({ start: instant, end: instant })
  .strict()
  .superRefine(({ start, end }, context) => {
    let valid = false;
    try {
      const duration = instantMicroseconds(end) - instantMicroseconds(start);
      valid = duration > 0n && duration <= BigInt(93 * 86400000) * 1000n;
    } catch {
      /* Base schema diagnostics also apply. */
    }
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "Calendar windows must be positive and at most 93 days.",
        path: ["end"],
      });
  });

export const externalCalendarOperationStates = [
  "queued",
  "running",
  "acknowledged",
  "conflict",
  "failed",
  "outcome_unknown",
] as const;
export const externalCalendarAvailabilitySchema = z.enum([
  "not_implemented",
  "not_connected",
  "needs_reauth",
  "grant_denied",
  "provider_read_only",
  "busy_only",
  "ready",
  "offline_unavailable",
  "quota_delayed",
]);

const itemBase = {
  id: entityIdSchema,
  connectionId: entityIdSchema,
  calendarId: entityIdSchema,
  provider: externalCalendarProviderSchema,
  schedule: externalCalendarScheduleSchema,
  generation: z.number().int().positive(),
  observedAt: instant,
  expiresAt: instant,
};

/** The busy variant cannot contain titles, locations, URLs or event-level identity. */
export const externalCalendarItemSchema = z.discriminatedUnion("privacy", [
  z
    .object({
      ...itemBase,
      privacy: z.literal("busy_only"),
      acquisition: z.enum(["availability_snapshot", "minimized_event"]),
    })
    .strict(),
  z
    .object({
      ...itemBase,
      privacy: z.literal("details"),
      title: untrustedUserContentSchema,
      location: untrustedUserContentSchema.nullable(),
      recurrence: z
        .object({
          seriesId: entityIdSchema,
          originalStartKey: z.string().min(1).max(256),
        })
        .strict()
        .nullable(),
      version: z.string().min(1).max(512),
      allowedActions: z
        .array(externalCalendarActionSchema)
        .max(externalCalendarActions.length),
      linkId: entityIdSchema.nullable(),
      syncState: z.enum(externalCalendarOperationStates).nullable(),
    })
    .strict(),
]);
export type ExternalCalendarItem = z.infer<typeof externalCalendarItemSchema>;

export const externalCalendarPageSchema = z
  .object({
    items: z.array(externalCalendarItemSchema).max(200),
    nextCursor: z.string().min(1).max(4096).nullable(),
    generation: z.number().int().positive(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.items.some((item) => item.generation !== page.generation))
      context.addIssue({
        code: "custom",
        message: "Mixed calendar generations are not allowed.",
        path: ["items"],
      });
  });

const commandBase = {
  connectionId: entityIdSchema,
  calendarId: entityIdSchema,
};
const version = z.string().min(1).max(512);
/** Payload only: the canonical command envelope owns operation ID and preconditions. */
export const externalCalendarCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("calendar_connection.configure"),
      payload: z
        .object({
          ...commandBase,
          visibility: z.enum(["hidden", "busy_only", "details"]),
          expectedVersion: z.number().int().positive().safe(),
          syncDirection: z.enum(["inbound", "outbound", "two_way_schedule"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_connection.remove"),
      payload: z.object({ connectionId: entityIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_event.create"),
      payload: z
        .object({
          ...commandBase,
          schedule: externalCalendarScheduleSchema,
          title: z.string().min(1).max(4000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_event.reschedule"),
      payload: z
        .object({
          ...commandBase,
          eventId: entityIdSchema,
          expectedVersion: version,
          schedule: externalCalendarScheduleSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_event.cancel"),
      payload: z
        .object({
          ...commandBase,
          eventId: entityIdSchema,
          expectedVersion: version,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_link.create"),
      payload: z
        .object({
          ...commandBase,
          taskId: entityIdSchema,
          expectedTaskVersion: z.number().int().positive().safe(),
          eventTitle: z.string().min(1).max(500).optional(),
          direction: z.enum(["outbound", "two_way_schedule"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_link.configure"),
      payload: z
        .object({
          ...commandBase,
          linkId: entityIdSchema,
          expectedVersion: version,
          direction: z.enum(["outbound", "two_way_schedule"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_link.remove"),
      payload: z
        .object({
          ...commandBase,
          linkId: entityIdSchema,
          expectedVersion: version,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_sync.request"),
      payload: z
        .object({ ...commandBase, cursor: z.string().max(8192).optional() })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_conflict.resolve"),
      payload: z
        .object({
          ...commandBase,
          linkId: entityIdSchema,
          expectedVersion: version,
          resolution: z.enum(["use_planner", "use_provider", "unlink"]),
          expectedTaskVersion: z.number().int().positive().safe(),
          expectedProviderVersion: version,
        })
        .strict(),
    })
    .strict(),
]);
export const calendarEventCreatePayloadSchema =
  externalCalendarCommandSchema.options[2].shape.payload;
export const calendarEventReschedulePayloadSchema =
  externalCalendarCommandSchema.options[3].shape.payload;
export const calendarEventCancelPayloadSchema =
  externalCalendarCommandSchema.options[4].shape.payload;
export const calendarConnectionConfigurePayloadSchema =
  externalCalendarCommandSchema.options[0].shape.payload;
export const calendarConnectionRemovePayloadSchema =
  externalCalendarCommandSchema.options[1].shape.payload;
export const calendarLinkCreatePayloadSchema =
  externalCalendarCommandSchema.options[5].shape.payload;
export const calendarLinkConfigurePayloadSchema =
  externalCalendarCommandSchema.options[6].shape.payload;
export const calendarLinkRemovePayloadSchema =
  externalCalendarCommandSchema.options[7].shape.payload;
export const calendarConflictResolvePayloadSchema =
  externalCalendarCommandSchema.options[9].shape.payload;
export const calendarSyncRequestPayloadSchema =
  externalCalendarCommandSchema.options[8].shape.payload;

export type ExternalCalendarCommand = z.infer<
  typeof externalCalendarCommandSchema
>;
export const calendarSimulationCreatePayloadSchema = z
  .object({ provider: externalCalendarProviderSchema })
  .strict();
export const calendarSimulationEditPayloadSchema = z
  .object({
    ...commandBase,
    eventId: entityIdSchema,
    expectedVersion: version,
    schedule: externalCalendarScheduleSchema.nullable(),
  })
  .strict();
export const calendarProviderNativeCommandSchema = z.union([
  externalCalendarCommandSchema,
  z
    .object({
      type: z.literal("calendar_simulation.create"),
      payload: calendarSimulationCreatePayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_simulation.edit_event"),
      payload: calendarSimulationEditPayloadSchema,
    })
    .strict(),
]);
export const calendarNativeCommandSchema = z.union([
  calendarFeedCommandSchema,
  calendarProviderNativeCommandSchema,
]);
export type CalendarNativeCommand = z.infer<typeof calendarNativeCommandSchema>;
export const calendarControlResultSchema = z.union([
  calendarFeedResultSchema,
  z
    .object({ eventId: entityIdSchema, state: z.enum(["edited", "cancelled"]) })
    .strict(),
  z
    .object({
      calendarId: entityIdSchema,
      state: z.literal("refreshed"),
      generation: z.number().int().positive().safe(),
      operationsProcessed: z.number().int().min(0).max(25),
      linksChecked: z.number().int().min(0).max(50),
      continuation: z.boolean(),
      nextCursor: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      calendarId: entityIdSchema,
      state: z.literal("queued"),
      jobId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      connectionId: entityIdSchema,
      calendarId: entityIdSchema,
      provider: externalCalendarProviderSchema,
      mode: z.literal("simulated"),
    })
    .strict(),
  z
    .object({
      calendarId: entityIdSchema,
      version: z.number().int().positive().safe(),
      generation: z.number().int().positive().safe(),
    })
    .strict(),
  z
    .object({
      connectionId: entityIdSchema,
      state: z.enum(["disconnecting", "disconnected"]),
      jobId: entityIdSchema,
      remoteStatus: z
        .enum(["revoked", "manual_revocation_required"])
        .optional(),
    })
    .strict(),
  z
    .object({
      linkId: entityIdSchema,
      version: z.number().int().positive().safe(),
      state: z.literal("pending"),
      providerOperationId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      state: z.enum(["pending", "linked", "paused", "conflict", "unlinked"]),
      version: z.number().int().positive().safe(),
      operationId: z.string().uuid().optional(),
    })
    .strict(),
]);

export const externalCalendarItemsRequestSchema = z
  .object({
    params: z
      .object({
        workspaceId: entityIdSchema,
        connectionId: entityIdSchema,
        calendarId: entityIdSchema,
      })
      .strict(),
    query: z
      .object({
        start: instant,
        end: instant,
        includeDetails: z
          .enum(["true", "false"])
          .default("false")
          .transform((value) => value === "true"),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        cursor: z.string().min(1).max(4096).optional(),
      })
      .strict(),
    body: z.object({}).strict(),
  })
  .strict();
export const externalCalendarOperationRequestSchema = z
  .object({
    params: z
      .object({
        workspaceId: entityIdSchema,
        connectionId: entityIdSchema,
        calendarId: entityIdSchema,
        operationId: z.string().uuid(),
      })
      .strict(),
    query: z.object({}).strict(),
    body: z.object({}).strict(),
  })
  .strict();
export const externalCalendarOperationSchema = z
  .object({
    operationId: z.string().uuid(),
    providerState: z.enum([
      "queued",
      "running",
      "acknowledged",
      "conflict",
      "failed",
      "outcome_unknown",
    ]),
  })
  .strict();
export const externalCalendarCapabilitiesSchema = z
  .object({
    protocolVersion: z.literal(1),
    enabled: z.boolean(),
    outboundEnabled: z.boolean(),
    eligible: z.boolean(),
    writable: z.boolean(),
    providerRegistration: z.literal("pending"),
    mode: z.enum(["disabled", "simulated", "live"]).optional(),
    linkingEnabled: z.boolean().optional(),
  })
  .strict();

type CommandPolicy = {
  requiredCapability: "write" | "destructive";
  action: ExternalCalendarAction | null;
  humanOnly: boolean;
  description: string;
};
/** No automatic MCP publication; external effects require separately reviewed bindings. */
export const externalCalendarCommandPolicies: Record<
  ExternalCalendarCommand["type"],
  CommandPolicy
> = {
  "calendar_connection.configure": {
    requiredCapability: "write",
    action: null,
    humanOnly: true,
    description: "Configure selected calendars and consented sync direction.",
  },
  "calendar_connection.remove": {
    requiredCapability: "destructive",
    action: null,
    humanOnly: true,
    description:
      "Disconnect and purge a connection; preserve external events and tasks.",
  },
  "calendar_event.create": {
    requiredCapability: "write",
    action: "create_event",
    humanOnly: false,
    description: "Queue creation in an explicitly granted external calendar.",
  },
  "calendar_event.reschedule": {
    requiredCapability: "write",
    action: "reschedule_event",
    humanOnly: false,
    description: "Queue rescheduling with provider version preconditions.",
  },
  "calendar_event.cancel": {
    requiredCapability: "destructive",
    action: "cancel_event",
    humanOnly: false,
    description: "Cancel an external event; never delete the linked task.",
  },
  "calendar_link.create": {
    requiredCapability: "write",
    action: "manage_links",
    humanOnly: false,
    description: "Link an authorized task to a selected external calendar.",
  },
  "calendar_link.configure": {
    requiredCapability: "write",
    action: "manage_links",
    humanOnly: false,
    description: "Change an existing link under current connection consent.",
  },
  "calendar_link.remove": {
    requiredCapability: "write",
    action: "manage_links",
    humanOnly: false,
    description: "Unlink while preserving the external event and task.",
  },
  "calendar_sync.request": {
    requiredCapability: "write",
    action: "request_sync",
    humanOnly: false,
    description:
      "Request or reuse bounded synchronization; provider changes may remain pending.",
  },
  "calendar_conflict.resolve": {
    requiredCapability: "write",
    action: "manage_links",
    humanOnly: false,
    description:
      "Resolve a link conflict with canonical task and external-event authorization.",
  },
};

export const externalCalendarCapabilitiesRequestSchema = z
  .object({
    params: z.object({ workspaceId: entityIdSchema }).strict(),
    query: z.object({}).strict(),
    body: z.object({}).strict(),
  })
  .strict();

export const calendarConnectionsRequestSchema = z
  .object({
    params: z.object({ workspaceId: entityIdSchema }).strict(),
    query: z.object({}).strict(),
    body: z.object({}).strict(),
  })
  .strict();
export const calendarConnectionsResponseSchema = z
  .object({
    connections: z
      .array(
        z
          .object({
            connectionId: entityIdSchema,
            provider: externalCalendarProviderSchema,
            mode: z.enum(["live", "simulated"]),
            state: z.enum([
              "connected",
              "needs_reauth",
              "revoked",
              "disconnecting",
              "disconnected",
            ]),
            accountLabel: untrustedUserContentSchema,
            calendars: z
              .array(
                z
                  .object({
                    calendarId: entityIdSchema,
                    label: untrustedUserContentSchema,
                    version: z.number().int().positive().safe(),
                    generation: z.number().int().positive().safe(),
                    visibility: z.enum(["hidden", "busy_only", "details"]),
                    syncDirection: z.enum([
                      "inbound",
                      "outbound",
                      "two_way_schedule",
                    ]),
                    writable: z.boolean(),
                  })
                  .strict(),
              )
              .max(200),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const calendarLinksRequestSchema = z
  .object({
    params: z
      .object({
        workspaceId: entityIdSchema,
        connectionId: entityIdSchema,
        calendarId: entityIdSchema,
      })
      .strict(),
    query: z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().max(8192).optional(),
      })
      .strict(),
    body: z.object({}).strict(),
  })
  .strict();
export const calendarLinksResponseSchema = z
  .object({
    links: z
      .array(
        z
          .object({
            linkId: entityIdSchema,
            taskId: entityIdSchema,
            version: z.number().int().positive().safe(),
            state: z.enum([
              "pending",
              "linked",
              "paused",
              "conflict",
              "unlinked",
            ]),
            direction: z.enum(["outbound", "two_way_schedule"]),
            eventId: entityIdSchema.nullable(),
            operationId: z.string().uuid().nullable(),
            canResolve: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.string().nullable(),
  })
  .strict();
