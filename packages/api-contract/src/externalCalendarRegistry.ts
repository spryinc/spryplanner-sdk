import {
  externalCalendarCommandPolicies,
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
  calendarFeedCreatePayloadSchema,
  calendarFeedConfigurePayloadSchema,
  calendarFeedRotatePayloadSchema,
  calendarFeedRevokePayloadSchema,
} from "./calendarFeeds.js";

/** Registered native commands; the remaining calendar declarations stay reserved. */
export const externalCalendarCommandTypesV1 = [
  "calendar_event.create",
  "calendar_event.reschedule",
  "calendar_event.cancel",
  "calendar_connection.configure",
  "calendar_connection.remove",
  "calendar_link.create",
  "calendar_link.configure",
  "calendar_link.remove",
  "calendar_conflict.resolve",
  "calendar_simulation.create",
  "calendar_sync.request",
  "calendar_simulation.edit_event",
  "calendar_feed.create",
  "calendar_feed.configure",
  "calendar_feed.rotate",
  "calendar_feed.revoke",
] as const;
export type CalendarNativeCommandType =
  (typeof externalCalendarCommandTypesV1)[number];
export const externalCalendarRegistryV1 = externalCalendarCommandTypesV1.map(
  (name) => {
    const payloads = {
      "calendar_event.create": calendarEventCreatePayloadSchema,
      "calendar_event.reschedule": calendarEventReschedulePayloadSchema,
      "calendar_event.cancel": calendarEventCancelPayloadSchema,
      "calendar_connection.configure": calendarConnectionConfigurePayloadSchema,
      "calendar_connection.remove": calendarConnectionRemovePayloadSchema,
      "calendar_link.create": calendarLinkCreatePayloadSchema,
      "calendar_link.configure": calendarLinkConfigurePayloadSchema,
      "calendar_link.remove": calendarLinkRemovePayloadSchema,
      "calendar_conflict.resolve": calendarConflictResolvePayloadSchema,
      "calendar_simulation.create": calendarSimulationCreatePayloadSchema,
      "calendar_sync.request": calendarSyncRequestPayloadSchema,
      "calendar_simulation.edit_event": calendarSimulationEditPayloadSchema,
      "calendar_feed.create": calendarFeedCreatePayloadSchema,
      "calendar_feed.configure": calendarFeedConfigurePayloadSchema,
      "calendar_feed.rotate": calendarFeedRotatePayloadSchema,
      "calendar_feed.revoke": calendarFeedRevokePayloadSchema,
    };
    return {
      name,
      payloadSchema: payloads[name],
      policy:
        name === "calendar_simulation.create" ||
        name === "calendar_simulation.edit_event"
          ? {
              requiredCapability: "write" as const,
              action: null,
              humanOnly: true,
              description:
                name === "calendar_simulation.create"
                  ? "Create a credential-free simulated calendar in a dedicated development/test database."
                  : "Edit or delete a simulated provider event independently from native task scheduling; human-only development/test console.",
            }
          : name.startsWith("calendar_feed.")
            ? {
                requiredCapability:
                  name === "calendar_feed.revoke"
                    ? ("destructive" as const)
                    : ("write" as const),
                action: null,
                humanOnly: true,
                description:
                  "Manage a private selected-task calendar subscription; secret material never enters command receipts.",
              }
            : externalCalendarCommandPolicies[
                name as keyof typeof externalCalendarCommandPolicies
              ],
      requiredLicenseCapability: "canWriteExternalCalendars" as const,
      receiptVisibility: "private" as const,
      handlerKey: name.startsWith("calendar_event.")
        ? ("enqueueCalendarOperation" as const)
        : ("createCalendarNativeHandler" as const),
      automaticMcpPublication: false as const,
    };
  },
);
export function calendarCommandPolicyFor(name: string) {
  return (
    externalCalendarRegistryV1.find((entry) => entry.name === name)?.policy ??
    null
  );
}
