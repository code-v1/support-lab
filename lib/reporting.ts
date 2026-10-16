import { z } from "zod";
export const reportRanges = {
  q1: "Q1 · January–March",
  q2: "Q2 · April–June",
  q3: "Q3 · July–September",
};
export const reportColumns = { revenue: "Revenue", tickets: "Support tickets" };
export const reportRows = [
  { month: "January", revenue: 12400, tickets: 86 },
  { month: "February", revenue: 15800, tickets: 102 },
  { month: "March", revenue: 18200, tickets: 94 },
  { month: "April", revenue: 17600, tickets: 90 },
  { month: "May", revenue: 19300, tickets: 108 },
  { month: "June", revenue: 21400, tickets: 116 },
  { month: "July", revenue: 20700, tickets: 99 },
  { month: "August", revenue: 22800, tickets: 112 },
  { month: "September", revenue: 24600, tickets: 121 },
];
export const reportActionSchema = z
  .object({
    action: z.enum([
      "choose_range",
      "choose_columns",
      "apply_preview",
      "download_report",
    ]),
    range: z.enum(["q1", "q2", "q3"]).optional(),
    columns: z
      .array(z.enum(["revenue", "tickets"]))
      .min(1)
      .max(2)
      .optional(),
  })
  .strict();
export type ReportAction = z.infer<typeof reportActionSchema>;
export const productGuides = {
  reports: {
    title: "Build and download a report",
    steps: [
      "Choose the report's quarter in Date range.",
      "Select Revenue, Support tickets, or both in Columns.",
      "Click Apply preview to save the selections and refresh the rows.",
      "Click Export report, then Download CSV.",
    ],
    notes:
      "Changing a selection creates a draft until Apply preview is clicked. Applied selections stay saved in this workspace. Changing CSV output format does not change source data. A previous stalled job can block a new export; preserve the customer's chosen report when recovering it.",
  },
  access: {
    title: "Restore account access",
    steps: [
      "Inspect account access and recent login events.",
      "Unlock only a locked account using the authorized support API.",
      "Confirm sign-in works.",
    ],
    notes:
      "Unlocking preserves the same account, files and report selections. Failed sign-in attempts do not identify who made them; do not attribute them to the customer without evidence.",
  },
  engineering: {
    title: "Engineering handoff and updates",
    steps: [
      "Inspect the current job and logs.",
      "Reproduce the failure once using an actual export attempt.",
      "If it fails with an unrecoverable renderer error, collect the request ID, observed error, customer impact, expected behavior and reproduction steps.",
      "Create an engineering handoff linked to the support ticket. Keep the ticket open for follow-up.",
    ],
    notes:
      "An engineering handoff is not a fix. The local engineering queue is pending triage, with no confirmed repair time. Updates belong on the linked support ticket. Repeated retries do not repair a renderer defect; do not promise an ETA or a workaround that has not been tested.",
  },
};
