import { z } from "zod";

export const entityIdSchema = z.string().trim().min(1).max(128);

export const untrustedUserContentSchema = z
  .object({
    value: z.string().max(4_000),
    provenance: z.literal("untrusted_user_content"),
  })
  .strict();

export const clientGeneratedEntityIdSchema = z
  .string()
  .regex(
    /^(?:[a-z][a-z0-9]*_)?(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
    "Expected a namespaced ULID or UUIDv7.",
  );
