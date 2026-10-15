export const catalog = [
  {
    name: "get_customer",
    description: "Retrieve the customer record for this call.",
    mutates: false,
  },
  {
    name: "get_account_status",
    description: "Inspect account access and permissions.",
    mutates: false,
  },
  {
    name: "get_application_logs",
    description: "Read recent events and errors for this account.",
    mutates: false,
  },
  {
    name: "inspect_export_job",
    description: "Inspect export format and job status.",
    mutates: false,
  },
  {
    name: "update_account_status",
    description: "Unlock a locked test account. Suspensions cannot be changed.",
    mutates: true,
  },
  {
    name: "repair_export_config",
    description: "Restore the supported CSV output format.",
    mutates: true,
  },
  {
    name: "retry_export",
    description: "Clear a stuck job and attempt an actual report export.",
    mutates: true,
  },
  {
    name: "verify_fix",
    description:
      "Attempt the customer action against DemoDesk to verify the outcome.",
    mutates: false,
  },
  {
    name: "search_knowledge",
    description: "Search verified articles and linked reusable workflows.",
    mutates: false,
  },
  {
    name: "run_workflow",
    description:
      "Run a validated recipe for this account after checking its precondition.",
    mutates: true,
  },
  {
    name: "create_ticket",
    description: "Create or retrieve the support ticket for this call.",
    mutates: true,
  },
  {
    name: "update_ticket",
    description:
      "Update a ticket; resolved status requires deterministic verification.",
    mutates: true,
  },
  {
    name: "reproduce_export",
    description:
      "Use an isolated Chromium browser to reproduce the export issue.",
    mutates: false,
  },
];
