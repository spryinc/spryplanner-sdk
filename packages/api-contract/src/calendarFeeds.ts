import { z } from "zod";
import { entityIdSchema } from "./contentPrimitives.js";
import { exactInstantSchema } from "./temporalInstants.js";

export const calendarFeedSelectionSchema = z
  .array(entityIdSchema)
  .min(1)
  .max(1000)
  .refine((ids) => new Set(ids).size === ids.length);
export const calendarFeedDetailSchema = z.enum([
  "busy_only",
  "titles",
  "titles_and_links",
]);
export const calendarFeedCredentialDigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);
const profile = {
  taskIds: calendarFeedSelectionSchema,
  detailLevel: calendarFeedDetailSchema,
  expiresAt: exactInstantSchema,
};
const versioned = {
  feedId: entityIdSchema,
  expectedVersion: z.number().int().positive().safe(),
};
export const calendarFeedCreatePayloadSchema = z
  .object({
    feedId: entityIdSchema,
    ...profile,
    credentialDigest: calendarFeedCredentialDigestSchema,
  })
  .strict();
export const calendarFeedConfigurePayloadSchema = z
  .object({ ...versioned, ...profile })
  .strict();
export const calendarFeedRotatePayloadSchema = z
  .object({
    ...versioned,
    credentialDigest: calendarFeedCredentialDigestSchema,
  })
  .strict();
export const calendarFeedRevokePayloadSchema = z.object(versioned).strict();
export const calendarFeedCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("calendar_feed.create"),
      payload: calendarFeedCreatePayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_feed.configure"),
      payload: calendarFeedConfigurePayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_feed.rotate"),
      payload: calendarFeedRotatePayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar_feed.revoke"),
      payload: calendarFeedRevokePayloadSchema,
    })
    .strict(),
]);
export type CalendarFeedCommand = z.infer<typeof calendarFeedCommandSchema>;
export const calendarFeedResultSchema = z
  .object({
    feedId: entityIdSchema,
    version: z.number().int().positive().safe(),
    state: z.enum(["active", "revoked"]),
  })
  .strict();
export const calendarFeedProfileSchema = z
  .object({
    feedId: entityIdSchema,
    version: z.number().int().positive().safe(),
    ...profile,
    state: z.enum(["active", "revoked", "expired"]),
    createdAt: exactInstantSchema,
  })
  .strict();
export const calendarFeedsRequestSchema = z
  .object({
    params: z.object({ workspaceId: entityIdSchema }).strict(),
    query: z.object({}).strict(),
    body: z.object({}).strict(),
  })
  .strict();
export const calendarFeedsResponseSchema = z
  .object({ feeds: z.array(calendarFeedProfileSchema).max(100) })
  .strict();
