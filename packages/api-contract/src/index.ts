import { exactInstantSchema, instantMicroseconds } from "./temporalInstants.js";
export {
  exactInstantSchema,
  normalizeInstant,
  instantMicroseconds,
  compareInstants,
} from "./temporalInstants.js";
export {
  calendarEventCreatePayloadSchema,
  calendarEventReschedulePayloadSchema,
  calendarEventCancelPayloadSchema,
  calendarConnectionConfigurePayloadSchema,
  calendarConnectionRemovePayloadSchema,
  calendarLinkCreatePayloadSchema,
  calendarLinkConfigurePayloadSchema,
  calendarLinkRemovePayloadSchema,
  calendarConflictResolvePayloadSchema,
  calendarSimulationCreatePayloadSchema,
  calendarSyncRequestPayloadSchema,
  calendarSimulationEditPayloadSchema,
} from "./externalCalendar.js";
import {
  entityIdSchema,
  clientGeneratedEntityIdSchema,
  untrustedUserContentSchema,
} from "./contentPrimitives.js";
export {
  entityIdSchema,
  clientGeneratedEntityIdSchema,
  untrustedUserContentSchema,
} from "./contentPrimitives.js";
import {
  externalCalendarCommandTypesV1,
  calendarCommandPolicyFor,
} from "./externalCalendarRegistry.js";
export {
  externalCalendarRegistryV1,
  externalCalendarCommandTypesV1,
} from "./externalCalendarRegistry.js";
import { z } from "zod";
import { taskWorkflowPolicyFor } from "./taskWorkflowPolicy.js";
export {
  taskWorkflowPoliciesV1,
  taskWorkflowPolicyFor,
} from "./taskWorkflowPolicy.js";
export type { TaskWorkflowOperation } from "./taskWorkflowPolicy.js";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export { z };
export { calendarFeedCreatePayloadSchema, calendarFeedConfigurePayloadSchema, calendarFeedRotatePayloadSchema, calendarFeedRevokePayloadSchema } from "./calendarFeeds.js";

export const apiVersion = "v1" as const;

export const opaqueCursorSchema = z
  .string()
  .min(1)
  .max(4096)
  .openapi({ example: "eyJ2IjoxLCJwb3MiOlsxNzAwMDAwMDAwLCJ0YXNrXzEyMyJdfQ" });

export const workspaceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .openapi({ example: "workspace_01J3K2N1VQ2VQY7KMG44N9PJ2T" });

/** Short-lived Helpdesk customer assertion issued after regional user authentication. */
export const supportCustomerTokenResponseSchema = z
  .object({
    helpdeskBaseUrl: z.string().url(),
    helpdeskPortalUrl: z.string().url(),
    token: z.string().min(1),
    expiresInSeconds: z.number().int().positive().max(900),
  })
  .strict();
export type SupportCustomerTokenResponse = z.infer<
  typeof supportCustomerTokenResponseSchema
>;

export const requestIdSchema = z.string().uuid().openapi({
  example: "6c9eae73-6d53-46a9-9f30-a580894cae7d",
});

export const guardedOperationTypeSchema = z.enum([
  "task.purge",
  "project.purge",
  "purpose.purge",
  "goal.purge",
  "habit.purge",
  "note.purge",
  "realm.purge",
  "realm.merge_into",
  "task.import",
]);
/** Matches app.task_import_uploads' octet_length constraint. */
export const taskImportUploadMaximumBytes = 2_000_000;
export const taskImportUploadRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    format: z.enum(["csv", "json"]),
    content: z
      .string()
      .min(1)
      .max(taskImportUploadMaximumBytes)
      .refine(
        (content) =>
          new TextEncoder().encode(content).byteLength <=
          taskImportUploadMaximumBytes,
        {
          message: "Import content must contain at most 2000000 UTF-8 bytes.",
          params: {
            constraint: "utf8_byte_length",
            maximum: taskImportUploadMaximumBytes,
          },
        },
      ),
  })
  .strict();
export const taskImportUploadResponseSchema = z
  .object({
    uploadId: entityIdSchema,
    fileName: z.string(),
    format: z.enum(["csv", "json"]),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const taskImportMappingSchema = z
  .object({
    hasHeader: z.boolean().default(true),
    delimiter: z.enum([",", ";", "\t"]).default(","),
    columns: z
      .object({
        title: z.union([
          z.string().trim().min(1).max(128),
          z.number().int().nonnegative(),
        ]),
        description: z
          .union([
            z.string().trim().min(1).max(128),
            z.number().int().nonnegative(),
          ])
          .nullable()
          .default(null),
        dueAt: z
          .union([
            z.string().trim().min(1).max(128),
            z.number().int().nonnegative(),
          ])
          .nullable()
          .default(null),
        externalId: z
          .union([
            z.string().trim().min(1).max(128),
            z.number().int().nonnegative(),
          ])
          .nullable()
          .default(null),
      })
      .strict(),
  })
  .strict();
export const taskImportValidationRequestSchema = z
  .object({ mapping: taskImportMappingSchema })
  .strict();
export const taskImportValidationIssueSchema = z
  .object({
    row: z.number().int().positive(),
    field: z.string(),
    code: z.string(),
    message: z.string(),
  })
  .strict();
export const taskImportValidationResponseSchema = z
  .object({
    uploadId: entityIdSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    totalRows: z.number().int().nonnegative(),
    validRows: z.number().int().nonnegative(),
    invalidRows: z.number().int().nonnegative(),
    issues: z.array(taskImportValidationIssueSchema).max(1_000),
    readyForPreview: z.boolean(),
    appliesChanges: z.literal(false),
  })
  .strict();
export type TaskImportUploadRequest = z.infer<
  typeof taskImportUploadRequestSchema
>;
export type TaskImportUploadResponse = z.infer<
  typeof taskImportUploadResponseSchema
>;
export type TaskImportMapping = z.infer<typeof taskImportMappingSchema>;
export type TaskImportValidationRequest = z.infer<
  typeof taskImportValidationRequestSchema
>;
export type TaskImportValidationResponse = z.infer<
  typeof taskImportValidationResponseSchema
>;
export const guardedOperationPreviewRequestSchema = z
  .object({
    operation: guardedOperationTypeSchema,
    targetId: entityIdSchema.nullable(),
    expectedVersion: z.number().int().positive().nullable(),
    input: z.record(z.unknown()).default({}),
  })
  .strict();
export const guardedOperationPreviewResponseSchema = z
  .object({
    previewToken: z.string().min(32).max(512),
    operation: guardedOperationTypeSchema,
    targetId: entityIdSchema.nullable(),
    expectedVersion: z.number().int().positive().nullable(),
    expiresAt: z.string().datetime({ offset: true }),
    destructive: z.boolean(),
    confirmationPhrase: z.string().nullable(),
    affectedEntities: z.record(z.number().int().nonnegative()),
    warnings: z.array(z.string()),
    appliesChanges: z.literal(false),
  })
  .strict();
export const guardedOperationApplyRequestSchema = z
  .object({
    previewToken: z.string().min(32).max(512),
    confirmationPhrase: z.string().nullable().default(null),
  })
  .strict();
export const operationJobSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    type: guardedOperationTypeSchema,
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    progressCompleted: z.number().int().nonnegative(),
    progressTotal: z.number().int().nonnegative(),
    result: z.record(z.unknown()).nullable(),
    error: z
      .object({ code: z.string(), message: z.string() })
      .strict()
      .nullable(),
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type GuardedOperationPreviewRequest = z.infer<
  typeof guardedOperationPreviewRequestSchema
>;
export type GuardedOperationPreviewResponse = z.infer<
  typeof guardedOperationPreviewResponseSchema
>;
export type GuardedOperationApplyRequest = z.infer<
  typeof guardedOperationApplyRequestSchema
>;
export type OperationJob = z.infer<typeof operationJobSchema>;

/** P2 command kernel envelopes. Command-specific payloads register in P2.2. */
export const commandIdSchema = z.string().uuid();

export const expectedVersionSchema = z
  .object({
    entityType: z.string().trim().min(1).max(80),
    entityId: entityIdSchema,
    version: z.number().int().positive(),
  })
  .strict();

/** First registered P2.2 vertical-slice payload. */
export const taskCompleteCommandPayloadSchema = z
  .object({
    taskId: entityIdSchema,
    completedAt: exactInstantSchema.nullable().default(null),
  })
  .strict();
export const memberRemoveCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, userId: entityIdSchema })
  .strict();
export type MemberRemoveCommandPayload = z.infer<
  typeof memberRemoveCommandPayloadSchema
>;
export const memberSetRoleCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    userId: entityIdSchema,
    role: z.enum([
      "admin",
      "member",
      "coach",
      "viewer",
      "accountability_buddy",
    ]),
  })
  .strict();
export type MemberSetRoleCommandPayload = z.infer<
  typeof memberSetRoleCommandPayloadSchema
>;
export const memberSetScopeCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    userId: entityIdSchema,
    scope: z.discriminatedUnion("type", [
      z.object({ type: z.literal("workspace"), id: z.null() }).strict(),
      z.object({ type: z.literal("project"), id: entityIdSchema }).strict(),
      z.object({ type: z.literal("label"), id: entityIdSchema }).strict(),
    ]),
  })
  .strict();
export type MemberSetScopeCommandPayload = z.infer<
  typeof memberSetScopeCommandPayloadSchema
>;
export const workspaceOwnershipTransferPreviewRequestSchema = z
  .object({ targetUserId: entityIdSchema })
  .strict();
export const workspaceOwnershipTransferPreviewResponseSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    currentOwnerUserId: entityIdSchema,
    targetUserId: entityIdSchema,
    targetCurrentRole: z.enum([
      "admin",
      "member",
      "coach",
      "viewer",
      "accountability_buddy",
    ]),
    eligible: z.literal(true),
    appliesChanges: z.literal(false),
  })
  .strict();
export type WorkspaceOwnershipTransferPreviewRequest = z.infer<
  typeof workspaceOwnershipTransferPreviewRequestSchema
>;
export type WorkspaceOwnershipTransferPreviewResponse = z.infer<
  typeof workspaceOwnershipTransferPreviewResponseSchema
>;
/** Contract for the later preview-token-bound ownership transfer apply flow. */
export const workspaceOwnershipTransferConfirmationRequestSchema = z
  .object({
    previewToken: z.string().min(32).max(512),
    targetUserId: entityIdSchema,
    confirmationPhrase: z.literal("TRANSFER_OWNERSHIP"),
  })
  .strict();
export const workspaceOwnershipTransferConfirmationSchema = z
  .object({
    previewToken: z.string().min(32).max(512),
    workspaceId: workspaceIdSchema,
    targetUserId: entityIdSchema,
    initiatingUserId: entityIdSchema,
    expiresAt: z.string().datetime({ offset: true }),
    requiresDistinctApprover: z.literal(true),
    appliesChanges: z.literal(false),
  })
  .strict();
export type WorkspaceOwnershipTransferConfirmationRequest = z.infer<
  typeof workspaceOwnershipTransferConfirmationRequestSchema
>;
export type WorkspaceOwnershipTransferConfirmation = z.infer<
  typeof workspaceOwnershipTransferConfirmationSchema
>;
export const workspaceOwnershipTransferConfirmationIssueResponseSchema = z
  .object({
    confirmation: workspaceOwnershipTransferConfirmationSchema,
    token: z.string().min(32).max(512),
  })
  .strict();
export type WorkspaceOwnershipTransferConfirmationIssueResponse = z.infer<
  typeof workspaceOwnershipTransferConfirmationIssueResponseSchema
>;
export const workspaceOwnershipTransferApprovalRequestSchema = z
  .object({ token: z.string().min(32).max(512) })
  .strict();
export const workspaceOwnershipTransferApprovalResponseSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    targetUserId: entityIdSchema,
    approvedByUserId: entityIdSchema,
    status: z.literal("approved"),
    appliesChanges: z.literal(false),
  })
  .strict();
export type WorkspaceOwnershipTransferApprovalRequest = z.infer<
  typeof workspaceOwnershipTransferApprovalRequestSchema
>;
export type WorkspaceOwnershipTransferApprovalResponse = z.infer<
  typeof workspaceOwnershipTransferApprovalResponseSchema
>;
export const workspaceOwnershipTransferApplyRequestSchema = z
  .object({ token: z.string().min(32).max(512) })
  .strict();
export const workspaceOwnershipTransferApplyResponseSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    previousOwnerUserId: entityIdSchema,
    newOwnerUserId: entityIdSchema,
    status: z.literal("applied"),
  })
  .strict();
export type WorkspaceOwnershipTransferApplyRequest = z.infer<
  typeof workspaceOwnershipTransferApplyRequestSchema
>;
export type WorkspaceOwnershipTransferApplyResponse = z.infer<
  typeof workspaceOwnershipTransferApplyResponseSchema
>;
export const workspaceLifecyclePreviewRequestSchema = z
  .object({ action: z.enum(["archive", "trash"]) })
  .strict();
export const workspaceLifecyclePreviewResponseSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    action: z.enum(["archive", "trash"]),
    taskCount: z.number().int().nonnegative(),
    noteCount: z.number().int().nonnegative(),
    memberCount: z.number().int().nonnegative(),
    appliesChanges: z.literal(false),
  })
  .strict();
export type WorkspaceLifecyclePreviewRequest = z.infer<
  typeof workspaceLifecyclePreviewRequestSchema
>;
export type WorkspaceLifecyclePreviewResponse = z.infer<
  typeof workspaceLifecyclePreviewResponseSchema
>;
export const workspaceArchiveCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema })
  .strict();
export type WorkspaceArchiveCommandPayload = z.infer<
  typeof workspaceArchiveCommandPayloadSchema
>;
export const workspaceTrashCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema })
  .strict();
export type WorkspaceTrashCommandPayload = z.infer<
  typeof workspaceTrashCommandPayloadSchema
>;
export const workspaceRestoreCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema })
  .strict();
export type WorkspaceRestoreCommandPayload = z.infer<
  typeof workspaceRestoreCommandPayloadSchema
>;
export const workspaceRenameCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(2).max(120),
  })
  .strict();
export type WorkspaceRenameCommandPayload = z.infer<
  typeof workspaceRenameCommandPayloadSchema
>;
export const privacyRequestResponseSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    requestType: z.enum(["export", "erasure"]),
    status: z.literal("requested"),
    requestedAt: z.string().datetime({ offset: true }),
    alreadyRequested: z.boolean(),
  })
  .strict();
export type PrivacyRequestResponse = z.infer<
  typeof privacyRequestResponseSchema
>;
export const privacyRequestListResponseSchema = z
  .object({
    items: z.array(privacyRequestResponseSchema),
    page: z
      .object({
        nextCursor: opaqueCursorSchema.nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type PrivacyRequestListResponse = z.infer<
  typeof privacyRequestListResponseSchema
>;
export const accountDataSpaceBindingRequestSchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    confirmOrganizationControl: z.boolean().default(false),
  })
  .strict();
export const accountDataSpaceBindingResponseSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    dataSpaceId: z.string().uuid(),
    ownerType: z.enum(["person", "organization"]),
    ownerId: z.string().uuid(),
    accountDataRegionId: z.string().trim().min(1),
    accountDataLocationId: z.string().trim().min(1),
    placementEpoch: z.number().int().positive(),
    verifiedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AccountDataSpaceBindingRequest = z.infer<
  typeof accountDataSpaceBindingRequestSchema
>;
export type AccountDataSpaceBindingResponse = z.infer<
  typeof accountDataSpaceBindingResponseSchema
>;

const recurrenceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    if (value.startsWith("0000-")) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Expected a real calendar date.");

export const recurrenceRuleSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().positive().max(10_000),
    startsOn: recurrenceDateSchema,
    timeZone: z.string().trim().min(1).max(100),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7),
    byMonthDay: z.array(z.number().int().min(1).max(31)).max(31),
    end: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("never") }).strict(),
      z
        .object({
          mode: z.literal("onDate"),
          date: recurrenceDateSchema,
        })
        .strict(),
      z
        .object({
          mode: z.literal("afterCount"),
          count: z.number().int().positive(),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((rule, context) => {
    const issue = (path: string[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: rule.timeZone });
    } catch {
      issue(["timeZone"], "Expected a valid IANA timezone.");
    }
    if (rule.frequency === "weekly" && rule.byWeekday.length === 0)
      issue(["byWeekday"], "Weekly rules require at least one weekday.");
    if (rule.frequency !== "weekly" && rule.byWeekday.length > 0)
      issue(
        ["byWeekday"],
        "Weekday selection is supported only for weekly rules.",
      );
    if (
      (rule.frequency === "daily" || rule.frequency === "weekly") &&
      rule.byMonthDay.length > 0
    )
      issue(
        ["byMonthDay"],
        "Month-day selection requires a monthly or yearly rule.",
      );
    if (rule.end.mode === "onDate" && rule.end.date < rule.startsOn)
      issue(["end", "date"], "The end date must not precede the start date.");
    if (
      rule.frequency === "yearly" ||
      (rule.frequency === "monthly" && rule.interval % 12 === 0)
    ) {
      const month = Number(rule.startsOn.slice(5, 7));
      const maximumDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
        month - 1
      ];
      if (
        maximumDay &&
        rule.byMonthDay.length > 0 &&
        rule.byMonthDay.every((day) => day > maximumDay)
      )
        issue(
          ["byMonthDay"],
          "No selected day can occur in the anchored month.",
        );
    }
  });
export const recurrenceEditScopeSchema = z.enum([
  "single_occurrence",
  "this_and_future",
  "entire_series",
]);
export const taskSetRecurrenceCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    seriesId: entityIdSchema,
    scope: recurrenceEditScopeSchema,
    rule: recurrenceRuleSchema,
  })
  .strict();
export type TaskSetRecurrenceCommandPayload = z.infer<
  typeof taskSetRecurrenceCommandPayloadSchema
>;
export const taskClearRecurrenceCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    scope: recurrenceEditScopeSchema,
  })
  .strict();
export type TaskClearRecurrenceCommandPayload = z.infer<
  typeof taskClearRecurrenceCommandPayloadSchema
>;
export const recurrenceSeriesLifecycleCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    seriesId: entityIdSchema,
  })
  .strict();
export type RecurrenceSeriesLifecycleCommandPayload = z.infer<
  typeof recurrenceSeriesLifecycleCommandPayloadSchema
>;
export const recurrenceOccurrenceLifecycleCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    occurrenceId: entityIdSchema,
  })
  .strict();
export type RecurrenceOccurrenceLifecycleCommandPayload = z.infer<
  typeof recurrenceOccurrenceLifecycleCommandPayloadSchema
>;
export const recurrenceOccurrenceRescheduleCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    occurrenceId: entityIdSchema,
    scheduledFor: z.string().datetime({ offset: true }),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type RecurrenceOccurrenceRescheduleCommandPayload = z.infer<
  typeof recurrenceOccurrenceRescheduleCommandPayloadSchema
>;
export const recurrenceOccurrenceMaterializeTaskCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    occurrenceId: entityIdSchema,
    materializedTaskId: entityIdSchema,
    title: z.string().trim().min(1).max(4_000),
    description: z.string().max(100_000).default(""),
  })
  .strict();
export type RecurrenceOccurrenceMaterializeTaskCommandPayload = z.infer<
  typeof recurrenceOccurrenceMaterializeTaskCommandPayloadSchema
>;
export const recurrenceOccurrenceDetachCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    occurrenceId: entityIdSchema,
  })
  .strict();
export type RecurrenceOccurrenceDetachCommandPayload = z.infer<
  typeof recurrenceOccurrenceDetachCommandPayloadSchema
>;
export const reminderChannelSchema = z.enum(["in_app", "push", "email"]);
export const reminderSetCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    reminderId: entityIdSchema,
    taskId: entityIdSchema,
    occurrenceId: entityIdSchema.nullable().default(null),
    channel: reminderChannelSchema,
    remindAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ReminderSetCommandPayload = z.infer<
  typeof reminderSetCommandPayloadSchema
>;
export const reminderClearCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    reminderId: entityIdSchema,
    taskId: entityIdSchema,
  })
  .strict();
export type ReminderClearCommandPayload = z.infer<
  typeof reminderClearCommandPayloadSchema
>;
export const recurrenceRulePreviewRequestSchema = z
  .object({
    rule: recurrenceRuleSchema,
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const recurrenceRulePreviewResponseSchema = z
  .object({
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(100),
    timeZone: z.string(),
    summary: z.string().max(500),
    warnings: z.array(z.string()).max(10),
  })
  .strict();
export type RecurrenceRulePreviewRequest = z.infer<
  typeof recurrenceRulePreviewRequestSchema
>;
export type RecurrenceRulePreviewResponse = z.infer<
  typeof recurrenceRulePreviewResponseSchema
>;
export const scheduleCapabilitiesQuerySchema = z
  .object({ objectType: z.enum(["task", "habit"]) })
  .strict();
export const scheduleCapabilitiesResponseSchema = z
  .object({
    objectType: z.enum(["task", "habit"]),
    supportedFrequencies: z.array(
      z.enum(["daily", "weekly", "monthly", "yearly"]),
    ),
    supportsRecurrence: z.boolean(),
    supportsOccurrenceEdits: z.boolean(),
    supportsTaskMaterialization: z.boolean(),
  })
  .strict();
export type ScheduleCapabilitiesResponse = z.infer<
  typeof scheduleCapabilitiesResponseSchema
>;
export const calendarItemsQuerySchema = z
  .object({
    start: exactInstantSchema,
    end: exactInstantSchema,
  })
  .strict()
  .superRefine(({ start, end }, context) => {
    if (
      !exactInstantSchema.safeParse(start).success ||
      !exactInstantSchema.safeParse(end).success
    )
      return;
    const duration = instantMicroseconds(end) - instantMicroseconds(start);
    if (duration <= 0n || duration > 93n * 24n * 60n * 60n * 1_000_000n) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Calendar windows must be greater than zero and no longer than 93 days.",
        path: ["end"],
      });
    }
  });
export const calendarItemSchema = z
  .object({
    id: entityIdSchema,
    objectType: z.enum(["task", "occurrence", "habit_occurrence"]),
    kind: z.enum(["scheduled", "due", "recurring"]),
    title: z.string().max(4_000),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }).nullable(),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    taskId: entityIdSchema.nullable(),
    habitId: entityIdSchema.nullable(),
    seriesId: entityIdSchema.nullable(),
    occurrenceId: entityIdSchema.nullable(),
    occurrenceKey: z.string().max(256).nullable(),
  })
  .strict();
export const calendarItemsResponseSchema = z
  .object({
    items: z.array(calendarItemSchema).max(1_000),
    completeness: z
      .object({
        complete: z.boolean(),
        reasons: z.array(
          z.enum([
            "item_limit",
            "series_limit",
            "habit_limit",
            "projection_limit",
            "byte_limit",
            "invalid_rule",
          ]),
        ),
      })
      .strict(),
  })
  .strict();
export type CalendarItemsResponse = z.infer<typeof calendarItemsResponseSchema>;
export const agentWorkspaceSearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(4_000),
    limit: z.number().int().min(1).max(25).default(10),
  })
  .strict();
export const agentWorkspaceSearchResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            id: entityIdSchema,
            entityType: z.enum(["task", "note"]),
            title: untrustedUserContentSchema,
            snippet: untrustedUserContentSchema,
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
export type AgentWorkspaceSearchRequest = z.infer<
  typeof agentWorkspaceSearchRequestSchema
>;
export type AgentWorkspaceSearchResponse = z.infer<
  typeof agentWorkspaceSearchResponseSchema
>;
export const workspaceResolveRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(4_000),
    limit: z.number().int().min(1).max(25).default(10),
  })
  .strict();
export const workspaceResolveResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            id: entityIdSchema,
            entityType: z.enum(["task", "project", "goal", "habit", "label"]),
            matchReason: z.enum([
              "exact_case_sensitive",
              "exact_case_insensitive",
            ]),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
export type WorkspaceResolveRequest = z.infer<
  typeof workspaceResolveRequestSchema
>;
export type WorkspaceResolveResponse = z.infer<
  typeof workspaceResolveResponseSchema
>;
export const workspaceRelationshipMatrix = [
  {
    relationshipType: "task_label",
    sourceType: "task",
    targetType: "label",
    cardinality: "many_to_many",
    sourceTable: "app.task_labels",
    cascade: "remove_link_when_target_deleted",
  },
  {
    relationshipType: "task_project",
    sourceType: "task",
    targetType: "project",
    cardinality: "many_to_many",
    sourceTable: "app.project_tasks",
    cascade: "remove_link_when_target_deleted",
  },
  {
    relationshipType: "task_goal",
    sourceType: "task",
    targetType: "goal",
    cardinality: "many_to_many",
    sourceTable: "app.goal_tasks",
    cascade: "remove_link_when_target_deleted",
  },
  {
    relationshipType: "task_habit",
    sourceType: "task",
    targetType: "habit",
    cardinality: "many_to_many",
    sourceTable: "app.habit_tasks",
    cascade: "remove_link_when_target_deleted",
  },
] as const;
export type WorkspaceRelationshipDefinition =
  (typeof workspaceRelationshipMatrix)[number];
export type WorkspaceRelationshipType =
  WorkspaceRelationshipDefinition["relationshipType"];
const workspaceRelationshipTypeValues = workspaceRelationshipMatrix.map(
  (definition) => definition.relationshipType,
) as [WorkspaceRelationshipType, ...WorkspaceRelationshipType[]];
const workspaceRelationshipTargetTypeValues = [
  "label",
  "project",
  "goal",
  "habit",
] as const;
export function workspaceRelationshipDefinition(
  relationshipType: WorkspaceRelationshipType,
): WorkspaceRelationshipDefinition {
  const definition = workspaceRelationshipMatrix.find(
    (candidate) => candidate.relationshipType === relationshipType,
  );
  if (!definition)
    throw new Error(`Unknown workspace relationship type: ${relationshipType}`);
  return definition;
}
export const workspaceRelationshipQuerySchema = z
  .object({
    sourceType: z.literal("task"),
    sourceId: entityIdSchema,
  })
  .strict();
export const workspaceRelationshipSchema = z
  .object({
    sourceType: z.literal("task"),
    sourceId: entityIdSchema,
    relationshipType: z.enum(workspaceRelationshipTypeValues),
    targetType: z.enum(workspaceRelationshipTargetTypeValues),
    targetId: entityIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const definition = workspaceRelationshipDefinition(value.relationshipType);
    if (
      value.sourceType !== definition.sourceType ||
      value.targetType !== definition.targetType
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Relationship endpoints must match the registered matrix definition.",
      });
    }
  });
export const workspaceRelationshipListResponseSchema = z
  .object({ items: z.array(workspaceRelationshipSchema).max(100) })
  .strict();
export type WorkspaceRelationshipListResponse = z.infer<
  typeof workspaceRelationshipListResponseSchema
>;

/**
 * @deprecated Historical non-executable taskId payload. Retained for source
 * compatibility only; task.create uses createTaskCommandSchema (id/workspaceId).
 * Adapters must derive their input from that canonical schema.
 */
export const taskCreateCommandPayloadSchema = z
  .object({
    taskId: entityIdSchema,
    title: z.string().trim().min(1).max(4_000),
    description: z.string().max(100_000).default(""),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    dueAt: exactInstantSchema.nullable().default(null),
    scheduledStartAt: exactInstantSchema.nullable().default(null),
    scheduledEndAt: exactInstantSchema.nullable().default(null),
    reminderLeadMinutes: z.number().int().min(0).max(52_560).default(1_440),
    realmId: entityIdSchema.nullable().default(null),
    assigneeUserId: entityIdSchema.nullable().default(null),
    labelIds: z.array(entityIdSchema).max(100).default([]),
    projectIds: z.array(entityIdSchema).max(100).default([]),
    goalIds: z.array(entityIdSchema).max(100).default([]),
    habitIds: z.array(entityIdSchema).max(100).default([]),
  })
  .strict();

export const taskReopenCommandPayloadSchema = z
  .object({ taskId: entityIdSchema })
  .strict();

export const taskLifecycleCommandPayloadSchema = z
  .object({ taskId: entityIdSchema })
  .strict();

export const taskUpdateContentCommandPayloadSchema = z
  .object({
    taskId: entityIdSchema,
    title: z.string().trim().min(1).max(4_000),
    description: z.string().max(100_000),
  })
  .strict();

const taskPrioritySelectionCommandSchema = z
  .object({
    modelId: z.string().trim().min(1).max(128),
    values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    sortWeight: z.number().finite().nullable(),
  })
  .strict();

export const taskSetPriorityCommandPayloadSchema = z
  .object({
    taskId: entityIdSchema,
    priority: z.enum(["low", "normal", "high"]),
    primaryPriority: taskPrioritySelectionCommandSchema,
    secondaryPriorities: z.array(taskPrioritySelectionCommandSchema).max(20),
  })
  .strict();

export const taskSetCalendarPlacementCommandPayloadSchema = z
  .object({
    taskId: entityIdSchema,
    dueAt: exactInstantSchema.nullable(),
    scheduledStartAt: exactInstantSchema.nullable(),
    scheduledEndAt: exactInstantSchema.nullable(),
    reminderLeadMinutes: z.number().int().min(0).max(52_560).nullable(),
    realmId: entityIdSchema.nullable(),
  })
  .strict();

export const taskAssignCommandPayloadSchema = z
  .object({ taskId: entityIdSchema, assigneeUserId: entityIdSchema.nullable() })
  .strict();

export const workspaceCommandSchema = z
  .object({
    operationId: commandIdSchema,
    idempotencyKey: z.string().trim().min(1).max(256),
    protocolVersion: z.literal(1),
    commandType: z.string().trim().min(1).max(160),
    commandSchemaVersion: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    deviceId: z.string().trim().min(1).max(256).nullable().default(null),
    clientId: z.string().trim().min(1).max(256).nullable().default(null),
    clientCreatedAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .default(null),
    expectedVersions: z.array(expectedVersionSchema).max(100).default([]),
    dependsOnOperationIds: z.array(commandIdSchema).max(100).default([]),
    payload: z.record(z.unknown()),
  })
  .strict();

/** Principal-bound device identity for command provenance. */
export const deviceRegistrationRequestSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(256),
    pushToken: z.string().trim().min(1).max(4_096).nullable().default(null),
  })
  .strict();

export const registeredDeviceSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(256),
    pushToken: z.string().nullable(),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    registeredAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const deviceRevocationRequestSchema = z
  .object({ deviceId: z.string().trim().min(1).max(256) })
  .strict();

export const apiKeyCapabilitySchema = z.enum([
  "read",
  "write",
  "destructive",
  "bulk",
]);
export const agentToolRiskClassSchema = z.enum([
  "read",
  "write",
  "destructive",
  "bulk",
]);
export const agentToolMetadataSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_.-]{1,159}$/),
    description: z.string().min(1).max(500),
    commandType: z.string().min(1).max(160),
    commandSchema: z.string().min(1).max(160),
    riskClass: agentToolRiskClassSchema,
    requiredCapability: apiKeyCapabilitySchema,
    idempotent: z.boolean(),
    previewAvailable: z.boolean(),
    example: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict();
export const workspaceCommandTypesV1 = [
  ...externalCalendarCommandTypesV1,
  "attachment.delete",
  "attachment.finalize",
  "attachment.upload_intent.create",
  "goal.create",
  "goal.update",
  "habit.check_in.create",
  "habit.check_in.delete",
  "habit.create",
  "habit.set_schedule",
  "habit.set_target",
  "habit.set_visibility",
  "habit.skip.create",
  "habit.skip.delete",
  "habit.update",
  "habit_occurrence.check_in",
  "history.redo",
  "history.undo",
  "label.assignments.remove_all",
  "label.assignments.restore",
  "label.create",
  "label.delete",
  "label.update",
  "member.remove",
  "member.set_role",
  "member.set_scope",
  "note.archive",
  "note.create",
  "note.label.add",
  "note.label.remove",
  "note.link.create",
  "note.link.delete",
  "note.restore",
  "note.trash",
  "note.update",
  "object_list.create",
  "object_list.delete",
  "object_list.update",
  "object_list_item.convert_to_task",
  "object_list_item.create",
  "object_list_item.delete",
  "object_list_item.update",
  "occurrence.complete",
  "occurrence.detach",
  "occurrence.materialize_task",
  "occurrence.reschedule",
  "occurrence.skip",
  "preferences.set_regional",
  "preferences.update",
  "project.close",
  "project.create",
  "project.delete",
  "project.reopen",
  "project.update_content",
  "project_subtask.convert_to_task",
  "project_subtask.create",
  "project_subtask.delete",
  "project_subtask.move",
  "project_subtask.outdent",
  "project_subtask.reorder",
  "project_subtask.set_linked_task",
  "project_subtask.update_content",
  "purpose.create",
  "realm.create",
  "realm.trash",
  "realm.update",
  "recurrence_series.pause",
  "recurrence_series.resume",
  "reminder.clear",
  "reminder.set",
  "saved_view.create",
  "saved_view.delete",
  "saved_view.update",
  "task.archive",
  "task.assign",
  "task.clear_recurrence",
  "task.comment.create",
  "task.comment_reaction.encourage.set",
  "task.complete",
  "task.convert_to_project",
  "task.create",
  "task.duplicate",
  "task.goal.link",
  "task.goal.unlink",
  "task.habit.link",
  "task.habit.unlink",
  "task.label.add",
  "task.label.remove",
  "task.note.create",
  "task.project.add",
  "task.project.remove",
  "task.reopen",
  "task.reorder",
  "task.restore",
  "task.set_calendar_placement",
  "task.set_priority",
  "task.set_recurrence",
  "task.trash",
  "task.update",
  "task.update_content",
  "task_template.apply",
  "user.update_profile",
  "value.trash",
  "value.update",
  "workspace.archive",
  "workspace.rename",
  "workspace.restore",
  "workspace.trash",
  "workspace_invitation.create",
  "workspace_invitation.revoke",
] as const;

const destructiveCommandTypes = new Set<string>([
  "attachment.delete",
  "history.undo",
  "history.redo",
  "member.remove",
  "note.trash",
  "object_list.delete",
  "object_list_item.delete",
  "project.delete",
  "project_subtask.delete",
  "label.assignments.remove_all",
  "label.delete",
  "realm.trash",
  "saved_view.delete",
  "task.archive",
  "task.trash",
  "value.trash",
  "workspace.archive",
  "workspace.trash",
  "workspace_invitation.revoke",
]);
/** Canonical grant classification shared by discovery and runtime authorization. */
export function requiredAgentCommandCapability(
  commandType: string,
  payload?: unknown,
): "write" | "destructive" | null {
  if (!(workspaceCommandTypesV1 as readonly string[]).includes(commandType))
    return null;
  const calendarPolicy = calendarCommandPolicyFor(commandType);
  if (calendarPolicy) return calendarPolicy.requiredCapability;
  const workflowPolicy = taskWorkflowPolicyFor(commandType);
  if (workflowPolicy && workflowPolicy.requiredCapability !== "write")
    throw new Error("A read workflow cannot classify a workspace command.");
  const update =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  return destructiveCommandTypes.has(commandType) ||
    /(?:\.trash|\.delete|\.archive|\.purge|\.remove|\.revoke|\.clear)$/.test(
      commandType,
    ) ||
    update?.status === "deleted" ||
    update?.status === "archived" ||
    update?.archivedAt != null
    ? "destructive"
    : (workflowPolicy?.requiredCapability ?? "write");
}

const previewCommandTypes = new Set<string>([
  "task.set_recurrence",
  "task.clear_recurrence",
]);
export const agentToolMetadataV1 = workspaceCommandTypesV1
  .filter((commandType) => !calendarCommandPolicyFor(commandType))
  .map((commandType) => {
    const riskClass = requiredAgentCommandCapability(commandType)!;
    return {
      name: commandType,
      description: `Execute the versioned SpryPlanner ${commandType} command. The regional API validates its registered command payload schema, permissions, idempotency, and version preconditions.`,
      commandType,
      commandSchema: "workspaceCommandSchema",
      riskClass,
      requiredCapability: riskClass,
      idempotent: true,
      previewAvailable: previewCommandTypes.has(commandType),
      example: { workspaceId: "workspace_id" },
    };
  }) satisfies readonly z.infer<typeof agentToolMetadataSchema>[];
export type AgentToolMetadata = z.infer<typeof agentToolMetadataSchema>;
export const apiKeyBudgetSchema = z
  .object({
    requestsPerMinute: z.number().int().positive().max(100_000),
    maximumOperationsPerDay: z.number().int().positive().max(10_000_000),
  })
  .strict();
export const apiKeyIssueRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    workspaceId: workspaceIdSchema,
    capabilities: z.array(apiKeyCapabilitySchema).min(1).max(4),
    expiresAt: z.string().datetime({ offset: true }),
    budget: apiKeyBudgetSchema,
  })
  .strict();
export const apiKeySummarySchema = z
  .object({
    id: entityIdSchema,
    name: z.string(),
    workspaceId: workspaceIdSchema,
    capabilities: z.array(apiKeyCapabilitySchema),
    expiresAt: z.string().datetime({ offset: true }),
    lastUsedAt: z.string().datetime({ offset: true }).nullable(),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
/** The secret is display-once and must never appear in apiKeySummarySchema. */
export const apiKeyIssueResponseSchema = z
  .object({ key: apiKeySummarySchema, secret: z.string().min(32).max(512) })
  .strict();
export const apiKeyRevocationRequestSchema = z
  .object({ keyId: entityIdSchema })
  .strict();
export const apiKeyListResponseSchema = z
  .object({
    items: z.array(apiKeySummarySchema),
    canIssue: z.boolean().default(false),
  })
  .strict();
export type ApiKeyIssueRequest = z.infer<typeof apiKeyIssueRequestSchema>;
export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;
export type ApiKeyIssueResponse = z.infer<typeof apiKeyIssueResponseSchema>;
export type ApiKeyListResponse = z.infer<typeof apiKeyListResponseSchema>;

export type DeviceRegistrationRequest = z.infer<
  typeof deviceRegistrationRequestSchema
>;
export type RegisteredDevice = z.infer<typeof registeredDeviceSchema>;

export const commandOperationSchema = z
  .object({
    operationId: commandIdSchema,
    status: z.enum(["accepted", "rejected", "already_accepted"]),
    acceptedAt: z.string().datetime({ offset: true }),
    operationSequence: z.number().int().positive(),
  })
  .strict();

export const commandChangeSchema = z
  .object({
    sequence: z.number().int().positive(),
    kind: z.enum(["upsert", "tombstone", "relationship", "access_changed"]),
    entityType: z.string().min(1),
    entityId: entityIdSchema.nullable(),
    schemaVersion: z.number().int().positive(),
  })
  .strict();

export const commandResultSchema = z
  .object({
    operation: commandOperationSchema,
    result: z.record(z.unknown()).nullable(),
    changes: z.array(commandChangeSchema),
    nextSyncCursor: opaqueCursorSchema.nullable(),
    warnings: z.array(z.string()),
    requestId: requestIdSchema,
  })
  .strict();

export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;

/** P4 batch envelope; dependency validity is enforced by the API validator. */
export const commandBatchSchema = z
  .object({
    batchId: commandIdSchema,
    atomicity: z.enum(["all_or_nothing", "best_effort"]),
    commands: z.array(workspaceCommandSchema).min(1).max(100),
  })
  .strict()
  .superRefine((batch, context) => {
    const operationIds = new Set<string>();
    for (const [index, command] of batch.commands.entries()) {
      if (command.operationId === batch.batchId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commands", index, "operationId"],
          message: "Child operation IDs must differ from the batch ID.",
        });
      }
      if (operationIds.has(command.operationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commands", index, "operationId"],
          message: "Batch operation IDs must be unique.",
        });
      }
      operationIds.add(command.operationId);
    }
  });

export const commandBatchItemOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("accepted"),
      operationId: commandIdSchema,
      result: commandResultSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      operationId: commandIdSchema,
      errorCode: z.string().trim().min(1).max(160),
      retryable: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.literal("skipped_dependency"),
      operationId: commandIdSchema,
      dependencyOperationId: commandIdSchema,
    })
    .strict(),
]);

export const commandBatchResultSchema = z
  .object({
    batchId: commandIdSchema,
    atomicity: z.enum(["all_or_nothing", "best_effort"]),
    status: z.enum(["accepted", "partially_accepted", "rejected"]),
    items: z.array(commandBatchItemOutcomeSchema),
    requestId: requestIdSchema,
  })
  .strict();
export type CommandBatch = z.infer<typeof commandBatchSchema>;
export type CommandBatchResult = z.infer<typeof commandBatchResultSchema>;
export type CommandBatchItemOutcome = z.infer<
  typeof commandBatchItemOutcomeSchema
>;
export type CommandResult = z.infer<typeof commandResultSchema>;

export const workspaceChangeSchema = z
  .object({
    sequence: z.number().int().positive(),
    operationId: commandIdSchema,
    operationSequence: z.number().int().positive(),
    kind: z.enum(["upsert", "tombstone", "relationship", "access_changed"]),
    entityType: z.string().trim().min(1).max(160),
    entityId: entityIdSchema.nullable(),
    schemaVersion: z.number().int().positive(),
    payload: z.record(z.unknown()),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const workspaceChangePageSchema = z
  .object({
    changes: z.array(workspaceChangeSchema),
    nextCursor: opaqueCursorSchema.nullable(),
    hasMore: z.boolean(),
  })
  .strict();
export type WorkspaceChange = z.infer<typeof workspaceChangeSchema>;
export type WorkspaceChangePage = z.infer<typeof workspaceChangePageSchema>;

export const fieldValidationDetailSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])).min(1),
    code: z.string().min(1),
    constraint: z.string().min(1),
  })
  .strict();

export const errorActionSchema = z
  .object({
    type: z.string().min(1),
    labelKey: z.string().min(1),
    parameters: z.record(z.unknown()).default({}),
  })
  .strict();

export const v1ErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    messageKey: z.string().min(1),
    messageParameters: z.record(z.union([z.string(), z.number(), z.boolean()])),
    requestId: requestIdSchema,
    retryable: z.boolean(),
    target: z.string().nullable().optional(),
    details: z.array(fieldValidationDetailSchema).default([]),
    conflict: z.record(z.unknown()).nullable().optional(),
    homeRegionId: z.string().min(1).nullable().optional(),
    apiBaseUrl: z.string().url().nullable().optional(),
    actions: z.array(errorActionSchema).default([]),
  })
  .strict();

export const v1ErrorEnvelopeSchema = z
  .object({ error: v1ErrorSchema })
  .strict();

/** Minimal regional reporting facts; user-authored text is intentionally absent. */
const planningFactActorSchema = z
  .object({
    principalId: entityIdSchema,
    onBehalfOfPrincipalId: entityIdSchema.nullable(),
    grantId: entityIdSchema.nullable(),
  })
  .strict();
export const planningTaskFactStateSchema = z
  .object({
    status: z.enum(["open", "completed", "archived", "deleted"]),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export const planningGoalFactStateSchema = z
  .object({
    status: z.enum(["active", "completed", "archived", "deleted"]),
  })
  .strict();
const planningFactBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.literal("native_command"),
    workspaceId: workspaceIdSchema,
    entityId: entityIdSchema,
    operationId: commandIdSchema,
    commandType: z.string().min(1).max(160),
    beforeVersion: z.number().int().positive().nullable(),
    afterVersion: z.number().int().positive(),
    entityCreatedAt: z.string().datetime({ offset: true }),
    effectiveAt: z.string().datetime({ offset: true }),
    recordedAt: z.string().datetime({ offset: true }),
    actor: planningFactActorSchema,
  })
  .strict();
export const planningFactSchema = z.discriminatedUnion("entityType", [
  planningFactBaseSchema
    .extend({
      entityType: z.literal("task"),
      captureDomain: z.literal("task.command_core"),
      before: planningTaskFactStateSchema.nullable(),
      after: planningTaskFactStateSchema,
    })
    .strict(),
  planningFactBaseSchema
    .extend({
      entityType: z.literal("goal"),
      captureDomain: z.literal("goal.command_core"),
      before: planningGoalFactStateSchema.nullable(),
      after: planningGoalFactStateSchema,
    })
    .strict(),
]);
export type PlanningFact = z.infer<typeof planningFactSchema>;

export const temporalSchemas = {
  dateOnly: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  instant: z.string().datetime({ offset: true }),
  zonedDateTime: z
    .object({
      instant: z.string().datetime({ offset: true }),
      timeZone: z.string().min(1),
    })
    .strict(),
  floatingLocalDateTime: z
    .object({
      local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/),
      timeZone: z.string().min(1),
    })
    .strict(),
  allDayRange: z
    .object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDateExclusive: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict(),
};

export const pageInfoSchema = z
  .object({
    nextCursor: opaqueCursorSchema.nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const auditEventSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    operationId: z.string().nullable(),
    requestId: z.string().uuid().nullable(),
    eventType: z.string().max(256),
    subjectType: z.string().max(256),
    subjectId: entityIdSchema.nullable(),
    actorUserId: entityIdSchema.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const auditEventListResponseSchema = z
  .object({
    items: z.array(auditEventSummarySchema).max(100),
    page: pageInfoSchema,
  })
  .strict();
export type AuditEventListResponse = z.infer<
  typeof auditEventListResponseSchema
>;

export const taskSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    title: z.string(),
    status: z.enum(["open", "completed", "archived", "deleted"]),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();

export const taskListResponseSchema = z
  .object({
    items: z.array(taskSummarySchema),
    page: pageInfoSchema,
  })
  .strict();
export const taskListVersionResponseSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    listVersion: z.number().int().positive(),
  })
  .strict();

export const taskDetailSchema = taskSummarySchema
  .extend({
    description: z.string(),
    priority: z.enum(["low", "normal", "high"]),
    primaryPriority: z
      .object({
        modelId: z.string(),
        values: z.record(
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
        sortWeight: z.number().nullable(),
      })
      .strict(),
    secondaryPriorities: z.array(
      z
        .object({
          modelId: z.string(),
          values: z.record(
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          ),
          sortWeight: z.number().nullable(),
        })
        .strict(),
    ),
    realmId: entityIdSchema.nullable(),
    dueAt: temporalSchemas.instant.nullable(),
    scheduledStartAt: temporalSchemas.instant.nullable(),
    scheduledEndAt: temporalSchemas.instant.nullable(),
    recurrenceSeriesId: entityIdSchema.nullable().optional(),
    recurrenceRule: z
      .object({
        frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
        interval: z.number().int().positive(),
        weekDays: z.array(z.number().int().min(0).max(6)).optional(),
        monthDays: z.array(z.number().int().min(1).max(31)).optional(),
        end: z.union([
          z.object({ mode: z.literal("never") }).strict(),
          z
            .object({
              mode: z.literal("onDate"),
              date: temporalSchemas.dateOnly,
            })
            .strict(),
          z
            .object({
              mode: z.literal("afterCount"),
              count: z.number().int().positive(),
            })
            .strict(),
        ]),
        timeZone: z.string().nullable(),
      })
      .strict()
      .nullable(),
    recurrenceExceptions: z.array(
      z
        .object({
          date: temporalSchemas.dateOnly,
          status: z.enum(["completed", "skipped"]),
          completedAt: temporalSchemas.instant.nullable().optional(),
        })
        .strict(),
    ),
    reminderLeadMinutes: z.number().int().nullable(),
    assigneeUserId: entityIdSchema.nullable(),
    labelIds: z.array(entityIdSchema),
    projectIds: z.array(entityIdSchema),
    goalIds: z.array(entityIdSchema),
    habitIds: z.array(entityIdSchema),
    attachmentCount: z.number().int().nonnegative(),
    position: z.number().int(),
    createdAt: temporalSchemas.instant,
    completedAt: temporalSchemas.instant.nullable(),
  })
  .strict();

/**
 * Atomic replacement of the editable task projection. Clients send the
 * complete current projection so mixed-field edits remain one optimistic,
 * idempotent transaction instead of a sequence of partially applied writes.
 */
export const taskUpdateCommandPayloadSchema = taskDetailSchema
  .pick({
    title: true,
    description: true,
    priority: true,
    primaryPriority: true,
    secondaryPriorities: true,
    realmId: true,
    dueAt: true,
    scheduledStartAt: true,
    scheduledEndAt: true,
    reminderLeadMinutes: true,
    assigneeUserId: true,
    goalIds: true,
    habitIds: true,
  })
  .extend({
    taskId: entityIdSchema,
    title: taskUpdateContentCommandPayloadSchema.shape.title,
    description: taskUpdateContentCommandPayloadSchema.shape.description,
    primaryPriority: taskSetPriorityCommandPayloadSchema.shape.primaryPriority,
    secondaryPriorities:
      taskSetPriorityCommandPayloadSchema.shape.secondaryPriorities,
    reminderLeadMinutes:
      taskSetCalendarPlacementCommandPayloadSchema.shape.reminderLeadMinutes,
    goalIds: z.array(entityIdSchema).max(1000),
    habitIds: z.array(entityIdSchema).max(1000),
    dueAt: exactInstantSchema.nullable(),
    scheduledStartAt: exactInstantSchema.nullable(),
    scheduledEndAt: exactInstantSchema.nullable(),
    recurrenceExceptions: z
      .array(
        taskDetailSchema.shape.recurrenceExceptions.element.extend({
          date: recurrenceDateSchema,
          completedAt: exactInstantSchema.nullable().optional(),
        }),
      )
      .max(1000)
      .refine(
        (values) =>
          new Set(values.map((value) => value.date)).size === values.length,
        "Each recurrence exception date must be unique.",
      )
      .describe(
        "At most 1000 exceptions with unique real calendar dates and exactly representable completion instants.",
      )
      .optional(),
  })
  .strict();
export type TaskUpdateCommandPayload = z.infer<
  typeof taskUpdateCommandPayloadSchema
>;

export const noteSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    title: z.string(),
    status: z.enum(["active", "archived", "deleted"]),
    pinned: z.boolean(),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();

export const noteListResponseSchema = z
  .object({ items: z.array(noteSummarySchema), page: pageInfoSchema })
  .strict();

export const noteDetailSchema = noteSummarySchema
  .extend({
    body: z.string(),
    bodyFormat: z.enum(["plain_text", "markdown"]),
    realmId: entityIdSchema.nullable(),
    labelIds: z.array(entityIdSchema),
    sourceType: z.string(),
    sourceRef: z.string().nullable(),
    archivedAt: temporalSchemas.instant.nullable(),
    deletedAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const noteLinkSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    noteId: entityIdSchema,
    targetType: z.enum([
      "task",
      "value",
      "impact",
      "project",
      "goal",
      "habit",
      "calendar_event",
    ]),
    targetId: entityIdSchema,
    linkRole: z.string(),
    createdByUserId: entityIdSchema.nullable(),
    createdAt: temporalSchemas.instant,
    position: z.number().int(),
  })
  .strict();
export const noteLinkListResponseSchema = z
  .object({ items: z.array(noteLinkSchema), page: pageInfoSchema })
  .strict();
export const attachmentSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    uploadedByUserId: entityIdSchema,
    originalFilename: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().nullable(),
    dataRegionId: z.string(),
    dataLocationId: z.string(),
    storageProvider: z.string(),
    storageRegion: z.string(),
    storageBucket: z.string(),
    storageKey: z.string(),
    status: z.enum([
      "pending",
      "available",
      "failed",
      "quarantined",
      "deleted",
    ]),
    scanStatus: z.enum(["pending", "clean", "flagged", "skipped"]),
    createdAt: temporalSchemas.instant,
    updatedAt: temporalSchemas.instant,
    deletedAt: temporalSchemas.instant.nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const attachmentListResponseSchema = z
  .object({ items: z.array(attachmentSummarySchema), page: pageInfoSchema })
  .strict();
export const attachmentLinkSchema = z
  .object({
    attachmentId: entityIdSchema,
    workspaceId: workspaceIdSchema,
    targetType: z.enum([
      "task",
      "project",
      "note",
      "goal",
      "habit",
      "realm",
      "template",
      "comment",
    ]),
    targetId: entityIdSchema,
    createdByUserId: entityIdSchema,
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const attachmentLinkListResponseSchema = z
  .object({ items: z.array(attachmentLinkSchema), page: pageInfoSchema })
  .strict();

export const projectSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    name: z.string(),
    status: z.enum(["active", "closed", "archived", "deleted"]),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();

export const projectListResponseSchema = z
  .object({ items: z.array(projectSummarySchema), page: pageInfoSchema })
  .strict();

export const projectDetailSchema = projectSummarySchema
  .extend({
    description: z.string(),
    realmId: entityIdSchema.nullable(),
    labelIds: z.array(entityIdSchema),
    archivedAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const projectSubtaskSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    parentProjectSubtaskId: entityIdSchema.nullable(),
    title: z.string(),
    type: z.enum([
      "section",
      "milestone",
      "deliverable",
      "checklistItem",
      "taskPlaceholder",
    ]),
    status: z.enum(["open", "completed"]),
    targetDate: temporalSchemas.dateOnly.nullable(),
    linkedTaskId: entityIdSchema.nullable(),
    position: z.number().int(),
    depth: z.number().int().nonnegative(),
    createdAt: temporalSchemas.instant,
    updatedAt: temporalSchemas.instant,
    completedAt: temporalSchemas.instant.nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const projectSubtaskListResponseSchema = z
  .object({ items: z.array(projectSubtaskSchema), page: pageInfoSchema })
  .strict();
export const projectSubtaskCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: z
      .string()
      .regex(
        /^(?:[a-z][a-z0-9]*_)?(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
      ),
    title: z.string().trim().min(1).max(500),
    parentProjectSubtaskId: entityIdSchema.nullable().default(null),
    type: z
      .enum([
        "section",
        "milestone",
        "deliverable",
        "checklistItem",
        "taskPlaceholder",
      ])
      .default("taskPlaceholder"),
    targetDate: temporalSchemas.dateOnly.nullable().default(null),
    linkedTaskId: entityIdSchema.nullable().default(null),
  })
  .strict();
export const projectSubtaskUpdateContentCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: entityIdSchema,
    title: z.string().trim().min(1).max(500),
    type: z.enum([
      "section",
      "milestone",
      "deliverable",
      "checklistItem",
      "taskPlaceholder",
    ]),
    status: z.enum(["open", "completed"]),
    targetDate: temporalSchemas.dateOnly.nullable(),
  })
  .strict();
export const projectSubtaskMoveCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: entityIdSchema,
    parentProjectSubtaskId: entityIdSchema.nullable(),
  })
  .strict();
export const projectSubtaskReorderCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: entityIdSchema,
    position: z.number().int().nonnegative(),
  })
  .strict();
export const projectSubtaskOutdentCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: entityIdSchema,
  })
  .strict();
export const projectSubtaskSetLinkedTaskCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: entityIdSchema,
    linkedTaskId: entityIdSchema.nullable(),
  })
  .strict();
export const projectSubtaskDeleteCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: entityIdSchema,
  })
  .strict();
export const projectSubtaskConvertToTaskCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    projectSubtaskId: entityIdSchema,
    taskId: entityIdSchema,
  })
  .strict();
export const preferencesUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    preferences: z.record(z.unknown()),
  })
  .strict();
export const preferencesSetRegionalCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    preferences: z.record(z.unknown()),
  })
  .strict();
export const userUpdateProfileCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();
export const habitUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000),
    realmId: entityIdSchema.nullable(),
    status: z.enum(["active", "paused", "archived", "deleted"]),
    schedule: z.record(z.unknown()),
  })
  .strict();
export const habitSetScheduleCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    schedule: z.record(z.unknown()),
  })
  .strict();
export const habitSetTargetCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    targetCount: z.number().int().positive().nullable(),
    targetPeriod: z.enum(["day", "week", "month"]).nullable(),
  })
  .strict()
  .refine(
    (value) => (value.targetCount === null) === (value.targetPeriod === null),
    {
      message:
        "Target count and period must be supplied together or both cleared.",
    },
  );
export const habitSetVisibilityCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    calendarVisibility: z.enum([
      "sidebarOnly",
      "calendarWhenScheduled",
      "calendarAndTasksWhenScheduled",
    ]),
    createTaskOccurrences: z.boolean(),
  })
  .strict();
export const habitCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000).default(""),
    schedule: z.record(z.unknown()),
  })
  .strict();
export const habitCheckInCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    localDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    occurrenceKey: z.string().trim().max(256).nullable().default(null),
    completedAt: temporalSchemas.instant.nullable().default(null),
    source: z.enum(["manual", "task"]).default("manual"),
    taskId: entityIdSchema.nullable().default(null),
    note: z.string().max(4_000).default(""),
  })
  .strict();
export const habitOccurrenceCheckInCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    occurrenceId: entityIdSchema,
    completedAt: temporalSchemas.instant.nullable().default(null),
    note: z.string().max(4_000).default(""),
  })
  .strict();
export const habitSkipCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    localDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    occurrenceKey: z.string().trim().max(256).nullable().default(null),
    skippedAt: temporalSchemas.instant.nullable().default(null),
    reason: z.string().max(4_000).default(""),
  })
  .strict();
export const habitCheckInDeleteCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    checkInId: entityIdSchema,
  })
  .strict();
export const habitSkipDeleteCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    skipId: entityIdSchema,
  })
  .strict();

export const goalSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    title: z.string(),
    status: z.enum(["active", "completed", "archived", "deleted"]),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();

export const goalListResponseSchema = z
  .object({ items: z.array(goalSummarySchema), page: pageInfoSchema })
  .strict();

export const goalDetailSchema = goalSummarySchema
  .extend({
    description: z.string(),
    realmId: entityIdSchema.nullable(),
    archivedAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const goalProgressResponseSchema = z
  .object({
    goalId: entityIdSchema,
    totalTaskCount: z.number().int().nonnegative(),
    completedTaskCount: z.number().int().nonnegative(),
    completionRatio: z.number().min(0).max(1),
  })
  .strict();
export type GoalProgressResponse = z.infer<typeof goalProgressResponseSchema>;
/** Public v1 noun for the legacy internal `Value` record. */
export const purposeSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    title: z.string(),
    status: z.enum(["active", "archived", "deleted"]),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();
export const purposeListResponseSchema = z
  .object({ items: z.array(purposeSummarySchema), page: pageInfoSchema })
  .strict();
export const purposeDetailSchema = purposeSummarySchema
  .extend({
    description: z.string(),
    archivedAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();

export const habitSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    title: z.string(),
    status: z.enum(["active", "paused", "archived", "deleted"]),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();
export const habitListResponseSchema = z
  .object({ items: z.array(habitSummarySchema), page: pageInfoSchema })
  .strict();
export const habitScheduleSchema = z
  .object({
    cadence: z
      .object({
        frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
        interval: z.number().int().positive(),
        weekDays: z.array(z.number().int().min(0).max(6)).optional(),
        monthDays: z.array(z.number().int().min(1).max(31)).optional(),
        end: z.union([
          z.object({ mode: z.literal("never") }).strict(),
          z
            .object({
              mode: z.literal("onDate"),
              date: temporalSchemas.dateOnly,
            })
            .strict(),
          z
            .object({
              mode: z.literal("afterCount"),
              count: z.number().int().positive(),
            })
            .strict(),
        ]),
        timeZone: z.string().nullable(),
      })
      .strict()
      .nullable(),
    targetCount: z.number().int().positive().nullable(),
    targetPeriod: z.enum(["day", "week", "month"]).nullable(),
    plannedTimes: z.array(z.string()),
    calendarVisibility: z.enum([
      "sidebarOnly",
      "calendarWhenScheduled",
      "calendarAndTasksWhenScheduled",
    ]),
    createTaskOccurrences: z.boolean(),
  })
  .strict();
export const habitDetailSchema = habitSummarySchema
  .extend({
    description: z.string(),
    realmId: entityIdSchema.nullable(),
    schedule: habitScheduleSchema,
    archivedAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const habitCheckInSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    localDate: temporalSchemas.dateOnly,
    occurrenceKey: z.string().nullable(),
    completedAt: temporalSchemas.instant,
    source: z.enum(["manual", "task"]),
    taskId: entityIdSchema.nullable(),
    note: z.string(),
    createdAt: temporalSchemas.instant,
    updatedAt: temporalSchemas.instant,
    version: z.number().int().positive(),
  })
  .strict();
export const habitSkipSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    habitId: entityIdSchema,
    localDate: temporalSchemas.dateOnly,
    occurrenceKey: z.string().nullable(),
    skippedAt: temporalSchemas.instant,
    reason: z.string(),
    createdAt: temporalSchemas.instant,
    updatedAt: temporalSchemas.instant,
    version: z.number().int().positive(),
  })
  .strict();
export const habitCompletionHistoryBootstrapResponseSchema = z
  .object({
    checkIns: z
      .object({ items: z.array(habitCheckInSchema), page: pageInfoSchema })
      .strict(),
    skips: z
      .object({ items: z.array(habitSkipSchema), page: pageInfoSchema })
      .strict(),
  })
  .strict();
export const realmSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    name: z.string(),
    color: z.string(),
    position: z.number().int(),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();
export const realmListResponseSchema = z
  .object({ items: z.array(realmSummarySchema), page: pageInfoSchema })
  .strict();
export const realmDetailSchema = realmSummarySchema
  .extend({
    archivedAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const labelSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    name: z.string(),
    color: z.string(),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();
export const labelListResponseSchema = z
  .object({ items: z.array(labelSummarySchema), page: pageInfoSchema })
  .strict();
export const labelDetailSchema = labelSummarySchema
  .extend({
    realmIds: z.array(entityIdSchema),
    archivedAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const labelUsageSummarySchema = z
  .object({
    labelId: entityIdSchema,
    total: z.number().int().nonnegative(),
    tasks: z
      .object({
        open: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        archived: z.number().int().nonnegative(),
        deleted: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    notes: z
      .object({
        active: z.number().int().nonnegative(),
        archived: z.number().int().nonnegative(),
        deleted: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    projects: z
      .object({
        active: z.number().int().nonnegative(),
        archived: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    examples: z
      .array(
        z
          .object({
            type: z.enum(["task", "note", "project"]),
            id: entityIdSchema,
            title: z.string(),
            status: z.string(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export const workspaceAccessScopeSchema = z
  .object({
    type: z.enum(["workspace", "project", "label"]),
    id: entityIdSchema.nullable(),
  })
  .strict();
export const memberSummarySchema = z
  .object({
    userId: entityIdSchema,
    displayName: z.string(),
    role: z.string(),
    scope: workspaceAccessScopeSchema,
    email: z.string().email().optional(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const memberListResponseSchema = z
  .object({ items: z.array(memberSummarySchema), page: pageInfoSchema })
  .strict();
/** Invitation tokens are returned only from manager-authorized workspace reads. */
export const workspaceInvitationSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    email: z.string().email(),
    role: z.enum([
      "admin",
      "member",
      "coach",
      "viewer",
      "accountability_buddy",
    ]),
    scope: workspaceAccessScopeSchema,
    invitedByUserId: entityIdSchema,
    token: z.string().min(1),
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
    createdAt: temporalSchemas.instant,
    acceptedAt: temporalSchemas.instant.nullable(),
    revokedAt: temporalSchemas.instant.nullable(),
    expiresAt: temporalSchemas.instant.nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const workspaceInvitationListResponseSchema = z
  .object({
    items: z.array(workspaceInvitationSummarySchema),
    page: pageInfoSchema,
  })
  .strict();
export const workspaceInvitationAcceptRequestSchema = z
  .object({ token: z.string().min(32).max(512) })
  .strict();
export type WorkspaceInvitationAcceptRequest = z.infer<
  typeof workspaceInvitationAcceptRequestSchema
>;
/**
 * Bootstrap carries the caller's authorization projection so a client never
 * has to infer permissions from the member-list projection (which deliberately
 * omits email for non-managers).
 */
export const bootstrapWorkspaceAccessSchema = z
  .object({
    member: z
      .object({
        workspaceId: workspaceIdSchema,
        userId: entityIdSchema,
        displayName: z.string(),
        email: z.string().email(),
        role: z.string(),
        scope: workspaceAccessScopeSchema,
        createdAt: temporalSchemas.instant,
      })
      .strict(),
    canRead: z.boolean(),
    canWrite: z.boolean(),
    canManage: z.boolean(),
    // Kept transport-tolerant here: capability semantics are owned by the
    // session contract below, while bootstrap carries only the authorization
    // projection needed to initialize the local sync repository.
    capabilities: z.record(z.unknown()).optional(),
  })
  .strict();
export const savedViewSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    name: z.string(),
    version: z.number().int().positive(),
    updatedAt: temporalSchemas.instant,
  })
  .strict();
export const savedViewListResponseSchema = z
  .object({ items: z.array(savedViewSummarySchema), page: pageInfoSchema })
  .strict();
export const taskFilterSnapshotSchema = z
  .object({
    selectedProjectId: z.string(),
    realmFilter: z.string(),
    statusFilter: z.enum([
      "open",
      "completed",
      "archived",
      "deleted",
      "active",
      "all",
    ]),
    searchQuery: z.string(),
    assigneeFilter: z.string(),
    labelFilter: z.string(),
    labelFilterMode: z.enum(["any", "all", "advanced"]).optional(),
    advancedLabelFilter: z
      .object({
        includeLabelIds: z.array(entityIdSchema),
        includeMode: z.enum(["any", "all"]),
        excludeLabelIds: z.array(entityIdSchema),
        excludeMode: z.enum(["any", "all"]),
      })
      .strict()
      .optional(),
    priorityFilter: z.string().optional(),
    dueFilter: z.enum([
      "all",
      "overdue",
      "dueSoon",
      "dueToday",
      "upcoming",
      "scheduled",
      "none",
      "somedayMaybe",
    ]),
  })
  .strict();
/**
 * Filtered collection reads use an opaque, filter-bound cursor rather than
 * the legacy offset query shape. `sort` is part of the request so a cursor
 * cannot be replayed against a different ordering.
 */
export const taskQueryRequestSchema = z
  .object({
    filters: taskFilterSnapshotSchema,
    sort: z
      .enum([
        "manual",
        "createdAtDesc",
        "dueDateAsc",
        "priorityDesc",
        "updatedAtDesc",
      ])
      .default("updatedAtDesc"),
    cursor: opaqueCursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    /** Explicit IANA zone for due-date bucketing; defaults to the profile zone. */
    timeZone: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export const taskQueryPageResponseSchema = z
  .object({ items: z.array(taskDetailSchema), page: pageInfoSchema })
  .strict();

export const noteFilterSnapshotSchema = z
  .object({
    realmFilter: z.string(),
    statusFilter: z.enum(["active", "archived", "deleted", "all"]),
    searchQuery: z.string(),
    labelFilter: z.string(),
    linkedTargetType: z.enum([
      "task",
      "value",
      "impact",
      "project",
      "goal",
      "habit",
      "calendar_event",
      "board",
      "template",
      "realm",
      "all",
    ]),
    sourceType: z.string().trim().min(1).max(100).optional(),
    sourceRefs: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    includeArchivedInSearch: z.boolean().optional(),
    includeDeletedInSearch: z.boolean().optional(),
  })
  .strict();
export const noteQueryRequestSchema = z
  .object({
    filters: noteFilterSnapshotSchema,
    sort: z
      .enum(["updatedAtDesc", "createdAtDesc", "titleAsc"])
      .default("updatedAtDesc"),
    cursor: opaqueCursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const noteQueryPageResponseSchema = z
  .object({ items: z.array(noteDetailSchema), page: pageInfoSchema })
  .strict();
export const savedViewDetailSchema = savedViewSummarySchema
  .extend({
    userId: entityIdSchema,
    filters: taskFilterSnapshotSchema,
    sort: z.enum([
      "manual",
      "createdAtDesc",
      "dueDateAsc",
      "priorityDesc",
      "updatedAtDesc",
    ]),
    grouping: z.array(
      z
        .object({
          dimension: z.enum([
            "realm",
            "project",
            "label",
            "goal",
            "habit",
            "dueDate",
            "dueState",
            "priority",
            "status",
          ]),
        })
        .strict(),
    ),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const savedViewCreateCommandPayloadSchema = savedViewDetailSchema
  .pick({ filters: true, sort: true, grouping: true })
  .extend({
    workspaceId: workspaceIdSchema,
    savedViewId: entityIdSchema,
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export const savedViewUpdateCommandPayloadSchema =
  savedViewCreateCommandPayloadSchema
    .omit({ savedViewId: true })
    .extend({ savedViewId: entityIdSchema })
    .strict();
export const savedViewDeleteCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, savedViewId: entityIdSchema })
  .strict();
export type SavedViewCreateCommandPayload = z.infer<
  typeof savedViewCreateCommandPayloadSchema
>;
export type SavedViewUpdateCommandPayload = z.infer<
  typeof savedViewUpdateCommandPayloadSchema
>;
export type SavedViewDeleteCommandPayload = z.infer<
  typeof savedViewDeleteCommandPayloadSchema
>;
export const notificationSummarySchema = z
  .object({
    id: entityIdSchema,
    sequence: z.number().int().positive(),
    workspaceId: workspaceIdSchema.nullable(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    entityType: z.string(),
    entityId: entityIdSchema.nullable(),
    actionPath: z.string().nullable(),
    readAt: temporalSchemas.instant.nullable(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const notificationListResponseSchema = z
  .object({ items: z.array(notificationSummarySchema), page: pageInfoSchema })
  .strict();
export const notificationAcknowledgeRequestSchema = z
  .object({ upToSequence: z.number().int().positive() })
  .strict();
export const notificationAcknowledgeResponseSchema = z
  .object({ upToSequence: z.number().int().positive() })
  .strict();
/**
 * Reserved P1 lifecycle command payloads. They are specified here so P2 can
 * mount them on the command kernel without inventing public semantics later.
 */
export const lifecycleCommandTargetSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    entityId: entityIdSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const lifecycleCommandResultSchema = z
  .object({
    id: entityIdSchema,
    version: z.number().int().positive(),
    status: z.string(),
  })
  .strict();
export const v1LifecycleCommandNames = [
  "task.archive",
  "task.trash",
  "task.restore",
  "project.archive",
  "project.trash",
  "project.restore",
  "project.close",
  "project.reopen",
  "purpose.archive",
  "purpose.trash",
  "purpose.restore",
  "goal.archive",
  "goal.trash",
  "goal.restore",
  "habit.archive",
  "habit.trash",
  "habit.restore",
  "note.archive",
  "note.trash",
  "note.restore",
  "realm.archive",
  "realm.trash",
  "realm.restore",
  "label.archive",
  "label.trash",
  "label.restore",
] as const;
export const v1DeferredLifecycleCommandNames = [
  "task.purge",
  "project.purge",
  "purpose.purge",
  "goal.purge",
  "habit.purge",
  "note.purge",
  "realm.purge",
  "realm.merge_into",
] as const;
/** The sole v1 positioning command, backed by convergent fractional order keys. */
export const taskReorderCommandSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    listVersion: z.number().int().positive(),
    beforeTaskId: entityIdSchema.nullable(),
    afterTaskId: entityIdSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.beforeTaskId && input.afterTaskId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeTaskId"],
        message: "Specify only one relative task anchor.",
      });
    if (
      input.beforeTaskId === input.taskId ||
      input.afterTaskId === input.taskId
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskId"],
        message: "A task cannot be its own positioning anchor.",
      });
  });

export const taskReorderCommandResultSchema = z
  .object({
    taskId: entityIdSchema,
    taskVersion: z.number().int().positive(),
    listVersion: z.number().int().positive(),
  })
  .strict();
export const taskRelationshipCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    relatedEntityId: entityIdSchema,
  })
  .strict();
export const noteLabelCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    noteId: entityIdSchema,
    labelId: entityIdSchema,
  })
  .strict();
export const noteLinkCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    noteId: entityIdSchema,
    linkId: z
      .string()
      .regex(
        /^(?:[a-z][a-z0-9]*_)?(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
        "Expected a namespaced ULID or UUIDv7.",
      ),
    targetType: z.enum(["task", "value", "project", "goal", "habit", "realm"]),
    targetId: entityIdSchema,
    linkRole: z.string().trim().min(1).max(100).default("context"),
  })
  .strict();
export const noteLinkDeleteCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    noteId: entityIdSchema,
    linkId: entityIdSchema,
  })
  .strict();
export const taskNoteCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    noteId: entityIdSchema,
    noteLinkId: entityIdSchema,
  })
  .strict();
export type TaskNoteCreateCommandPayload = z.infer<
  typeof taskNoteCreateCommandPayloadSchema
>;
export const attachmentDeleteCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, attachmentId: entityIdSchema })
  .strict();
export type AttachmentDeleteCommandPayload = z.infer<
  typeof attachmentDeleteCommandPayloadSchema
>;
export const attachmentFinalizeCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, attachmentId: entityIdSchema })
  .strict();
export type AttachmentFinalizeCommandPayload = z.infer<
  typeof attachmentFinalizeCommandPayloadSchema
>;
export const historyMutationCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    historyOperationId: entityIdSchema,
  })
  .strict();
export type HistoryMutationCommandPayload = z.infer<
  typeof historyMutationCommandPayloadSchema
>;
export const workspaceInvitationRevokeCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, invitationId: entityIdSchema })
  .strict();
export type WorkspaceInvitationRevokeCommandPayload = z.infer<
  typeof workspaceInvitationRevokeCommandPayloadSchema
>;
export const taskHabitLinkCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    habitId: entityIdSchema,
    role: z
      .enum(["related", "check_in_evidence", "generated_occurrence"])
      .default("related"),
  })
  .strict();
export const attachmentUploadIntentCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    attachmentId: clientGeneratedEntityIdSchema,
    originalFilename: z.string().trim().min(1).max(255),
    mimeType: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
    byteSize: z.number().int().nonnegative().safe(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    targetType: z
      .enum(["task", "project", "note", "goal", "habit", "realm", "comment"])
      .optional(),
    targetId: entityIdSchema.optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (Boolean(payload.targetType) !== Boolean(payload.targetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Attachment target type and target id must be provided together.",
        path: payload.targetType ? ["targetId"] : ["targetType"],
      });
    }
  });
export type AttachmentUploadIntentCreateCommandPayload = z.infer<
  typeof attachmentUploadIntentCreateCommandPayloadSchema
>;
export const workspaceInvitationCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    invitationId: clientGeneratedEntityIdSchema,
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum([
      "admin",
      "member",
      "coach",
      "viewer",
      "accountability_buddy",
    ]),
    scope: z.discriminatedUnion("type", [
      z.object({ type: z.literal("workspace"), id: z.null() }).strict(),
      z
        .object({ type: z.enum(["project", "label"]), id: entityIdSchema })
        .strict(),
    ]),
  })
  .strict();
export type WorkspaceInvitationCreateCommandPayload = z.infer<
  typeof workspaceInvitationCreateCommandPayloadSchema
>;
export const taskTemplateApplyCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    templateId: z.string().trim().min(1).max(160),
    startDate: temporalSchemas.instant.optional(),
  })
  .strict();
export type TaskTemplateApplyCommandPayload = z.infer<
  typeof taskTemplateApplyCommandPayloadSchema
>;
/** Duplicate preserves the legacy task fields and supported task links atomically. */
export const taskDuplicateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    sourceTaskId: entityIdSchema,
    duplicateTaskId: clientGeneratedEntityIdSchema,
  })
  .strict();
export const taskDuplicateCommandResultSchema = z
  .object({
    sourceTaskId: entityIdSchema,
    duplicateTaskId: entityIdSchema,
    taskVersion: z.number().int().positive(),
    copiedSubtaskCount: z.number().int().nonnegative(),
  })
  .strict();
export const taskConvertToProjectCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    projectId: clientGeneratedEntityIdSchema,
  })
  .strict();
export const taskConvertToProjectCommandResultSchema = z
  .object({
    taskId: entityIdSchema,
    taskVersion: z.number().int().positive(),
    projectId: entityIdSchema,
    projectVersion: z.number().int().positive(),
  })
  .strict();
export const projectUpdateContentCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    projectId: entityIdSchema,
    name: z.string().trim().min(1).max(500),
    description: z.string().max(100_000),
    realmId: entityIdSchema.nullable(),
  })
  .strict();
export const projectDeleteCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, projectId: entityIdSchema })
  .strict();
export const projectLifecycleCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, projectId: entityIdSchema })
  .strict();
export const noteUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    noteId: entityIdSchema,
    title: z.string().trim().min(1).max(500),
    body: z.string().max(100_000),
    bodyFormat: z.enum(["plain_text", "markdown"]),
    realmId: entityIdSchema.nullable(),
    pinned: z.boolean(),
  })
  .strict();
export const noteArchiveCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, noteId: entityIdSchema })
  .strict();
export const noteTrashCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, noteId: entityIdSchema })
  .strict();
export const noteRestoreCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, noteId: entityIdSchema })
  .strict();
export const goalUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    goalId: entityIdSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000),
    realmId: entityIdSchema.nullable(),
    status: z.enum(["active", "completed", "archived", "deleted"]),
  })
  .strict();
export const valueUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    valueId: entityIdSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000),
    status: z.enum(["active", "archived", "deleted"]),
  })
  .strict();
export const valueTrashCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, valueId: entityIdSchema })
  .strict();
export const realmUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    realmId: entityIdSchema,
    name: z.string().trim().min(1).max(500),
    color: z.string().trim().min(1).max(64),
    position: z.number().int().nonnegative(),
    archivedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export const realmTrashCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, realmId: entityIdSchema })
  .strict();
export const labelUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    labelId: entityIdSchema,
    name: z.string().trim().min(1).max(500),
    color: z.string().trim().min(1).max(64),
    realmIds: z.array(entityIdSchema).max(100),
    archivedAt: z.string().datetime({ offset: true }).nullable(),
    acknowledgedUsage: z.boolean(),
  })
  .strict();
export const labelBulkAssignmentsCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, labelId: entityIdSchema })
  .strict();
export const labelDeleteCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, labelId: entityIdSchema })
  .strict();
export type LabelBulkAssignmentsCommandPayload = z.infer<
  typeof labelBulkAssignmentsCommandPayloadSchema
>;
export type LabelDeleteCommandPayload = z.infer<
  typeof labelDeleteCommandPayloadSchema
>;
const createCommandBaseSchema = z
  .object({ id: clientGeneratedEntityIdSchema, workspaceId: workspaceIdSchema })
  .strict();
const nullableEntityIdSchema = entityIdSchema.nullable();
export const createTaskCommandSchema = createCommandBaseSchema
  .extend({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000).default(""),
    dueAt: exactInstantSchema.nullable().default(null),
    scheduledStartAt: exactInstantSchema.nullable().default(null),
    scheduledEndAt: exactInstantSchema.nullable().default(null),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    primaryPriority: taskPrioritySelectionCommandSchema.optional(),
    secondaryPriorities: z
      .array(taskPrioritySelectionCommandSchema)
      .max(20)
      .default([]),
    reminderLeadMinutes: z
      .number()
      .int()
      .min(0)
      .max(52_560)
      .nullable()
      .default(1440),
    realmId: nullableEntityIdSchema.default(null),
    assigneeUserId: nullableEntityIdSchema.default(null),
    labelIds: z.array(entityIdSchema).default([]),
    projectIds: z.array(entityIdSchema).default([]),
    goalIds: z.array(entityIdSchema).default([]),
    habitIds: z.array(entityIdSchema).default([]),
    recurrence: z
      .object({
        seriesId: clientGeneratedEntityIdSchema,
        rule: recurrenceRuleSchema,
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export const createProjectCommandSchema = createCommandBaseSchema
  .extend({
    name: z.string().trim().min(1).max(500),
    description: z.string().max(100_000).default(""),
    realmId: nullableEntityIdSchema.default(null),
    labelIds: z.array(entityIdSchema).default([]),
  })
  .strict();
export const createGoalCommandSchema = createCommandBaseSchema
  .extend({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000).default(""),
    realmId: nullableEntityIdSchema.default(null),
  })
  .strict();
export const createPurposeCommandSchema = createCommandBaseSchema
  .extend({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000).default(""),
  })
  .strict();
export const createRealmCommandSchema = createCommandBaseSchema
  .extend({
    name: z.string().trim().min(1).max(500),
    color: z.string().trim().min(1).max(64),
  })
  .strict();
export const createLabelCommandSchema = createCommandBaseSchema
  .extend({
    name: z.string().trim().min(1).max(500),
    color: z.string().trim().min(1).max(64),
    realmIds: z.array(entityIdSchema).max(100).default([]),
  })
  .strict();
export const createHabitCommandSchema = createCommandBaseSchema
  .extend({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000).default(""),
    realmId: nullableEntityIdSchema.default(null),
    schedule: habitScheduleSchema.optional(),
  })
  .strict();
export const createNoteCommandSchema = createCommandBaseSchema
  .extend({
    title: z.string().trim().min(1).max(500),
    body: z.string().max(1_000_000).default(""),
    bodyFormat: z.enum(["plain_text", "markdown"]).default("plain_text"),
    realmId: nullableEntityIdSchema.default(null),
    labelIds: z.array(entityIdSchema).default([]),
    pinned: z.boolean().default(false),
    sourceType: z.string().trim().min(1).max(100).default("manual"),
    sourceRef: nullableEntityIdSchema.default(null),
  })
  .strict();
export const taskCommentSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    authorUserId: entityIdSchema,
    authorDisplayName: z.string(),
    body: z.string(),
    version: z.number().int().positive(),
    createdAt: temporalSchemas.instant,
    updatedAt: temporalSchemas.instant,
  })
  .strict();
export const taskCommentListResponseSchema = z
  .object({ items: z.array(taskCommentSummarySchema), page: pageInfoSchema })
  .strict();
export const taskCommentCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    commentId: z
      .string()
      .regex(
        /^(?:[a-z][a-z0-9]*_)?(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
        "Expected a namespaced ULID or UUIDv7.",
      ),
    body: z.string().trim().min(1).max(4_000),
  })
  .strict();
export const taskCommentReactionSetCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    commentId: entityIdSchema,
    selected: z.boolean(),
  })
  .strict();
export const taskActivitySummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    actorUserId: entityIdSchema.nullable(),
    actorDisplayName: z.string().nullable(),
    eventType: z.string(),
    summary: z.string(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const taskActivityListResponseSchema = z
  .object({ items: z.array(taskActivitySummarySchema), page: pageInfoSchema })
  .strict();
export const taskCommentReactionSummarySchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    taskId: entityIdSchema,
    commentId: entityIdSchema,
    userId: entityIdSchema,
    userDisplayName: z.string(),
    reactionType: z.string(),
    createdAt: temporalSchemas.instant,
  })
  .strict();
export const taskCommentReactionListResponseSchema = z
  .object({
    items: z.array(taskCommentReactionSummarySchema),
    page: pageInfoSchema,
  })
  .strict();
export const objectListSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    ownerType: z.enum([
      "task",
      "project",
      "note",
      "goal",
      "habit",
      "realm",
      "template",
    ]),
    ownerId: entityIdSchema,
    kind: z.enum(["checklist", "bulleted", "numbered"]),
    title: z.string().nullable(),
    position: z.number().int(),
    createdAt: temporalSchemas.instant,
    updatedAt: temporalSchemas.instant,
    version: z.number().int().positive(),
  })
  .strict();
export const objectListItemSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    listId: entityIdSchema,
    parentItemId: entityIdSchema.nullable(),
    text: z.string(),
    status: z.enum(["open", "completed"]),
    position: z.number().int(),
    createdAt: temporalSchemas.instant,
    updatedAt: temporalSchemas.instant,
    completedAt: temporalSchemas.instant.nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const objectListCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    listId: entityIdSchema,
    taskId: entityIdSchema,
    kind: z.enum(["checklist", "bulleted", "numbered"]),
    title: z.string().max(200).nullable(),
  })
  .strict();
export const objectListUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    listId: entityIdSchema,
    kind: z.enum(["checklist", "bulleted", "numbered"]),
    title: z.string().max(200).nullable(),
  })
  .strict();
export const objectListDeleteCommandPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema, listId: entityIdSchema })
  .strict();
export const objectListItemCreateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    listId: entityIdSchema,
    itemId: entityIdSchema,
    text: z.string().trim().min(1).max(10_000),
    parentItemId: entityIdSchema.nullable(),
  })
  .strict();
export const objectListItemUpdateCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    listId: entityIdSchema,
    itemId: entityIdSchema,
    text: z.string().trim().min(1).max(10_000),
    status: z.enum(["open", "completed"]),
    parentItemId: entityIdSchema.nullable(),
    position: z.number().int().nonnegative(),
  })
  .strict();
export const objectListItemDeleteCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    listId: entityIdSchema,
    itemId: entityIdSchema,
  })
  .strict();
export const objectListItemConvertToTaskCommandPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    listId: entityIdSchema,
    itemId: entityIdSchema,
    taskId: entityIdSchema,
  })
  .strict();
export type ObjectListCreateCommandPayload = z.infer<
  typeof objectListCreateCommandPayloadSchema
>;
export type ObjectListUpdateCommandPayload = z.infer<
  typeof objectListUpdateCommandPayloadSchema
>;
export type ObjectListDeleteCommandPayload = z.infer<
  typeof objectListDeleteCommandPayloadSchema
>;
export type ObjectListItemCreateCommandPayload = z.infer<
  typeof objectListItemCreateCommandPayloadSchema
>;
export type ObjectListItemUpdateCommandPayload = z.infer<
  typeof objectListItemUpdateCommandPayloadSchema
>;
export type ObjectListItemDeleteCommandPayload = z.infer<
  typeof objectListItemDeleteCommandPayloadSchema
>;
export type ObjectListItemConvertToTaskCommandPayload = z.infer<
  typeof objectListItemConvertToTaskCommandPayloadSchema
>;
/** Task-scoped checklist projection used by local sync hydration. */
export const taskObjectListBootstrapResponseSchema = z
  .object({
    lists: z.array(
      z
        .object({
          list: objectListSchema,
          items: z.array(objectListItemSchema),
          page: pageInfoSchema,
        })
        .strict(),
    ),
    hasMoreLists: z.boolean(),
  })
  .strict();
export const historyOperationSummarySchema = z
  .object({
    id: entityIdSchema,
    version: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    actorUserId: entityIdSchema.nullable(),
    actorDisplayName: z.string().nullable(),
    commandType: z.string(),
    targetType: z.string(),
    targetId: entityIdSchema.nullable(),
    targetTitle: z.string(),
    summary: z.string(),
    status: z.string(),
    createdAt: temporalSchemas.instant,
    appliedAt: temporalSchemas.instant,
  })
  .strict();
export const historyOperationListResponseSchema = z
  .object({
    items: z.array(historyOperationSummarySchema),
    page: pageInfoSchema,
  })
  .strict();
export const bootstrapResponseSchema = z
  .object({
    consistency: z.literal("snapshot"),
    bootstrapToken: z.literal("bootstrap-v1"),
    /** Journal boundary captured before the bounded projection scan. */
    syncSequence: z.number().int().nonnegative(),
    syncCursor: opaqueCursorSchema,
    access: bootstrapWorkspaceAccessSchema,
    collections: z
      .object({
        tasks: taskListResponseSchema,
        notes: noteListResponseSchema,
        projects: projectListResponseSchema,
        goals: goalListResponseSchema,
        purposes: purposeListResponseSchema,
        habits: habitListResponseSchema,
        realms: realmListResponseSchema,
        labels: labelListResponseSchema,
        members: memberListResponseSchema,
        invitations: workspaceInvitationListResponseSchema,
        savedViews: savedViewListResponseSchema,
        taskCommentReactions: taskCommentReactionListResponseSchema,
        attachments: attachmentListResponseSchema,
        attachmentLinks: attachmentLinkListResponseSchema,
      })
      .strict(),
  })
  .strict();
export const searchResultSchema = z
  .object({
    entityType: z.enum(["task", "note"]),
    id: entityIdSchema,
    workspaceId: workspaceIdSchema,
    title: z.string(),
    snippet: z.string(),
    updatedAt: temporalSchemas.instant,
    score: z.number(),
  })
  .strict();
export const searchResponseSchema = z
  .object({ items: z.array(searchResultSchema), page: pageInfoSchema })
  .strict();

export const workspaceCapabilitiesSchema = z
  .object({
    licensePlanKey: z.string().min(1),
    includedAttachmentStorageBytes: z.number().int().nonnegative(),
    maxAttachmentFileBytes: z.number().int().nonnegative(),
    taskHistoryRetentionDays: z.number().int().nonnegative().nullable(),
    canCreateWorkspace: z.boolean(),
    canInviteWorkspaceMembers: z.boolean(),
    canAssignTasksToOthers: z.boolean(),
    canUseTasks: z.boolean(),
    canUseTaskListView: z.boolean(),
    canUseSubtasks: z.boolean(),
    canUseNotes: z.boolean(),
    canUseGoals: z.boolean(),
    canUseLabels: z.boolean(),
    canUseFiltering: z.boolean(),
    canUseRealms: z.boolean(),
    canUseProjects: z.boolean(),
    projectLimit: z.number().int().nonnegative().nullable(),
    canUseProjectBoards: z.boolean(),
    canUseBoards: z.boolean(),
    boardCapabilityLevel: z.enum(["none", "simple", "full"]),
    canUseTaskComments: z.boolean(),
    canMentionWorkspaceMembers: z.boolean(),
    canUseCommentReactions: z.boolean(),
    canUsePersonalTemplates: z.boolean(),
    canCreatePersonalTemplates: z.boolean(),
    canUseFamilyTemplates: z.boolean(),
    canUsePractitionerTemplates: z.boolean(),
    canUseTeamTemplates: z.boolean(),
  })
  .strict();

/** Preserve the original strict v1 capability keys as central policy expands. */
export function projectLegacyWorkspaceCapabilities(
  input: Record<string, unknown> | object,
) {
  const values = input as Record<string, unknown>;
  return workspaceCapabilitiesSchema.parse(
    Object.fromEntries(
      Object.keys(workspaceCapabilitiesSchema.shape).map((key) => [
        key,
        values[key],
      ]),
    ),
  );
}

export const v1SessionResponseSchema = z
  .object({
    user: z.object({ id: entityIdSchema, displayName: z.string() }).strict(),
    workspaces: z.array(
      z
        .object({
          id: workspaceIdSchema,
          dataRegionId: z.string().min(1),
          dataLocationId: z.string().min(1),
          apiBaseUrl: z.string().url(),
          role: z.string().min(1),
          scope: z
            .object({
              type: z.enum(["workspace", "project", "label"]),
              id: entityIdSchema.nullable(),
            })
            .strict(),
          entitlement: z
            .object({
              planKey: z.string().min(1),
              status: z.enum(["active", "trialing", "grace", "suspended"]),
              source: z.enum(["manual", "billing"]),
              reason: z.string().min(1),
              version: z.number().int().positive(),
              effectiveAt: temporalSchemas.instant,
              trialStartsAt: temporalSchemas.instant.nullable(),
              trialEndsAt: temporalSchemas.instant.nullable(),
            })
            .strict(),
          capabilities: workspaceCapabilitiesSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type V1ErrorEnvelope = z.infer<typeof v1ErrorEnvelopeSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export type TaskQueryRequest = z.infer<typeof taskQueryRequestSchema>;
export type TaskQueryPageResponse = z.infer<typeof taskQueryPageResponseSchema>;
export type NoteListResponse = z.infer<typeof noteListResponseSchema>;
export type NoteDetail = z.infer<typeof noteDetailSchema>;
export type NoteQueryRequest = z.infer<typeof noteQueryRequestSchema>;
export type NoteQueryPageResponse = z.infer<typeof noteQueryPageResponseSchema>;
export type NoteLinkListResponse = z.infer<typeof noteLinkListResponseSchema>;
export type AttachmentListResponse = z.infer<
  typeof attachmentListResponseSchema
>;
export type AttachmentLinkListResponse = z.infer<
  typeof attachmentLinkListResponseSchema
>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ProjectSubtaskListResponse = z.infer<
  typeof projectSubtaskListResponseSchema
>;
export type GoalListResponse = z.infer<typeof goalListResponseSchema>;
export type GoalDetail = z.infer<typeof goalDetailSchema>;
export type PurposeListResponse = z.infer<typeof purposeListResponseSchema>;
export type PurposeDetail = z.infer<typeof purposeDetailSchema>;
export type HabitListResponse = z.infer<typeof habitListResponseSchema>;
export type HabitDetail = z.infer<typeof habitDetailSchema>;
export type HabitCompletionHistoryBootstrapResponse = z.infer<
  typeof habitCompletionHistoryBootstrapResponseSchema
>;
export type RealmListResponse = z.infer<typeof realmListResponseSchema>;
export type RealmDetail = z.infer<typeof realmDetailSchema>;
export type LabelListResponse = z.infer<typeof labelListResponseSchema>;
export type LabelDetail = z.infer<typeof labelDetailSchema>;
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;
export type SavedViewListResponse = z.infer<typeof savedViewListResponseSchema>;
export type NotificationListResponse = z.infer<
  typeof notificationListResponseSchema
>;
export type TaskCommentListResponse = z.infer<
  typeof taskCommentListResponseSchema
>;
export type TaskActivityListResponse = z.infer<
  typeof taskActivityListResponseSchema
>;
export type TaskCommentReactionListResponse = z.infer<
  typeof taskCommentReactionListResponseSchema
>;
export type TaskObjectListBootstrapResponse = z.infer<
  typeof taskObjectListBootstrapResponseSchema
>;
export type HistoryOperationListResponse = z.infer<
  typeof historyOperationListResponseSchema
>;
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type V1SessionResponse = z.infer<typeof v1SessionResponseSchema>;
export type LifecycleCommandTarget = z.infer<
  typeof lifecycleCommandTargetSchema
>;
export type TaskReorderCommand = z.infer<typeof taskReorderCommandSchema>;
export type CreateTaskCommand = z.infer<typeof createTaskCommandSchema>;
export type CreateProjectCommand = z.infer<typeof createProjectCommandSchema>;
export type CreateGoalCommand = z.infer<typeof createGoalCommandSchema>;
export type CreatePurposeCommand = z.infer<typeof createPurposeCommandSchema>;
export type CreateHabitCommand = z.infer<typeof createHabitCommandSchema>;
export type CreateNoteCommand = z.infer<typeof createNoteCommandSchema>;

/** Versioned v1 concurrency rules for every sync-aware client. */
export const commandConflictPolicyV1 = {
  version: 1,
  clientRequirement: "preserve_authored_intent_for_reapply",
  unknownPolicyRequirement: "rebootstrap_or_upgrade_client",
  classes: {
    semanticLifecycle: {
      commandTypes: [
        "task.complete",
        "task.reopen",
        "task.archive",
        "task.trash",
        "task.restore",
      ],
      strategy: "entity_version_precondition",
      conflictBaseline: "server_entity_projection",
    },
    authoredContent: {
      commandTypes: [
        "task.update",
        "task.update_content",
        "project.update_content",
        "note.update",
        "goal.update",
        "value.update",
        "realm.update",
        "label.update",
        "saved_view.update",
        "saved_view.delete",
      ],
      strategy: "entity_version_precondition",
      conflictBaseline: "server_entity_projection",
    },
    commutativeRelationships: {
      commandTypes: [
        "task.label.add",
        "task.label.remove",
        "task.project.add",
        "task.project.remove",
        "task.goal.link",
        "task.goal.unlink",
        "task.habit.link",
        "task.habit.unlink",
      ],
      strategy: "relationship_intent_with_source_version_precondition",
      conflictBaseline: "current_relationship_projection",
    },
    orderedPlacement: {
      commandTypes: ["task.reorder"],
      strategy: "entity_and_list_version_preconditions",
      conflictBaseline: "server_entity_and_ordered_list_projection",
    },
    scopedPreferences: {
      commandTypes: ["preferences.set_regional"],
      strategy: "scope_row_version_precondition",
      conflictBaseline: "current_scope_projection",
    },
  },
} as const;

export type CommandConflictPolicyV1 = typeof commandConflictPolicyV1;

/** Additive task workflow registry. Existing commands outside this slice retain
 * their compatibility adapters until P04b binds their domain contracts. */
export const taskWorkflowRegistryV1 = (
  [
    {
      name: "task.create",
      kind: "command",
      description:
        "Create a task with a client-generated UUIDv7 ID and stable retry identity.",
      schemaName: "createTaskCommandSchema",
      requestSchema: createTaskCommandSchema,
      responseSchema: commandResultSchema,
      example: {
        workspaceId: "workspace_id",
        id: "019a0000-0000-7000-8000-000000000001",
        title: "Review the plan",
      },
    },
    {
      name: "task.update_content",
      kind: "command",
      description:
        "Edit an existing task's title and description using its current version; read back to verify.",
      schemaName: "taskUpdateContentCommandPayloadSchema",
      requestSchema: taskUpdateContentCommandPayloadSchema,
      responseSchema: commandResultSchema,
      example: {
        taskId: "task_id",
        title: "Updated plan",
        description: "Preserved user intent",
      },
    },
    {
      name: "task.complete",
      kind: "command",
      description:
        "Complete an identified task at its current version; optional completedAt records an explicit completion time.",
      schemaName: "taskCompleteCommandPayloadSchema",
      requestSchema: taskCompleteCommandPayloadSchema,
      responseSchema: commandResultSchema,
      example: { taskId: "task_id", completedAt: null },
    },
    {
      name: "task.reopen",
      kind: "command",
      description:
        "Reopen an identified task at its current version; read back to verify its status.",
      schemaName: "taskReopenCommandPayloadSchema",
      requestSchema: taskReopenCommandPayloadSchema,
      responseSchema: commandResultSchema,
      example: { taskId: "task_id" },
    },
    {
      name: "task.query",
      kind: "query",
      description:
        "Find permitted tasks with canonical filters, limit and cursor; follow nextCursor while hasMore.",
      schemaName: "taskQueryRequestSchema",
      requestSchema: taskQueryRequestSchema,
      responseSchema: taskQueryPageResponseSchema,
      example: {
        filters: {
          selectedProjectId: "all",
          realmFilter: "all",
          statusFilter: "all",
          searchQuery: "",
          assigneeFilter: "all",
          labelFilter: "all",
          dueFilter: "all",
        },
        limit: 25,
      },
    },
    {
      name: "task.get",
      kind: "query",
      description:
        "Read one permitted task ID and current version before editing or verifying a command.",
      schemaName: "taskIdentity",
      requestSchema: z.object({ taskId: entityIdSchema }).strict(),
      responseSchema: taskDetailSchema,
      example: { taskId: "task_id" },
    },
  ] as const
).map((entry) => {
  const policy = taskWorkflowPolicyFor(entry.name)!;
  return {
    ...entry,
    method: policy.route.method,
    path: policy.route.path,
    policy,
    expectedTaskVersion: policy.expectedTaskVersion,
    responseSchemaName:
      entry.kind === "command"
        ? "commandResultSchema"
        : entry.name === "task.query"
          ? "taskQueryPageResponseSchema"
          : "taskDetailSchema",
  };
});

export const agentContextResponseSchema = z
  .object({
    protocolVersion: z.literal(1),
    registryVersion: z.literal(1),
    coverage: z.literal("task_workflow_only"),
    workspace: z
      .object({
        id: workspaceIdSchema,
        dataRegionId: z.string().min(1),
        dataLocationId: z.string().min(1),
        scope: z
          .object({
            type: z.enum(["workspace", "project", "label"]),
            id: entityIdSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
    grantedCapabilities: z.array(apiKeyCapabilitySchema).max(4),
    operations: z
      .array(
        z
          .object({
            name: z.enum([
              "task.create",
              "task.update_content",
              "task.complete",
              "task.reopen",
              "task.query",
              "task.get",
            ]),
            method: z.enum(["GET", "POST"]),
            path: z.string().min(1),
            description: z.string().min(1),
            requiredCapability: apiKeyCapabilitySchema,
            availability: z.enum(["available", "conditional", "unavailable"]),
            reasons: z.array(
              z.enum([
                "missing_key_capability",
                "restricted_member_writes_unavailable",
                "member_cannot_write",
                "license_unavailable",
                "member_cannot_read",
                "entity_access_required",
                "command_preconditions_required",
              ]),
            ),
            requestSchema: z.string().min(1),
            example: z.record(z.unknown()),
            expectedTaskVersion: z.boolean(),
            preconditions: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .length(taskWorkflowRegistryV1.length)
      .refine(
        (operations) =>
          new Set(operations.map((operation) => operation.name)).size ===
          operations.length,
        "Each registered task operation must appear once.",
      ),
    otherOperations: z.literal("not_described_by_this_registry_slice"),
  })
  .strict();
export type AgentContextResponse = z.infer<typeof agentContextResponseSchema>;
