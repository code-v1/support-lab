export const catalog = [
  {
    name: "get_product_guide",
    description:
      "Read official product instructions: reports (period, columns, apply preview, download and saved selections), access, or engineering handoff/update policy. Product documentation is separate from learned repair recipes.",
    mutates: false,
  },
  {
    name: "get_report_builder",
    description:
      "Inspect the customer's applied and draft report period/columns, preview state and download state. Teach the customer how to use the controls; do not silently change their selections.",
    mutates: false,
  },
  {
    name: "escalate_to_engineering",
    description:
      "Create an evidence-backed engineering handoff for an unrecoverable renderer defect. Requires job inspection, logs and one failed export reproduction. Include customer impact, reproduction steps, expected and actual behavior. Keeps the support ticket open with engineering; this is not a repair and provides no ETA.",
    mutates: true,
  },
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
      "Attempt the customer's action against DemoDesk. Choose action export when a report was requested; a successful login alone does not verify a report. A customer's actual report download also provides evidence.",
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
      "Save diagnosis and repair details with status investigating. Resolved status requires verified repair and assessed customer confirmation; the simulator handles final closure.",
    mutates: true,
  },
  {
    name: "reproduce_export",
    description:
      "Use an isolated Chromium browser to reproduce the export issue.",
    mutates: false,
  },
];
