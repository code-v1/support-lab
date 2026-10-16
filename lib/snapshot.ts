import { all, batch } from "@/lib/db";
import { configuration, settings } from "@/lib/ai/router";
import { catalog } from "@/lib/tools/catalog";
import type { Snapshot } from "@/lib/types";
import { performance } from "@/lib/evaluation/performance";
export function snapshot(): Snapshot {
  const calls: Snapshot["calls"] = all(
    "SELECT * FROM calls ORDER BY started_at DESC",
  );
  const activities: Snapshot["activities"] = all(
    "SELECT * FROM activities ORDER BY id",
  );
  const usage: Snapshot["usage"] = all("SELECT * FROM usage ORDER BY id");
  return {
    customers: all("SELECT * FROM customers"),
    calls,
    messages: all("SELECT * FROM messages ORDER BY id"),
    completionChecks: all("SELECT * FROM completion_checks ORDER BY id"),
    activities,
    articles: all("SELECT * FROM articles ORDER BY created_at DESC"),
    workflows: all("SELECT * FROM workflows ORDER BY created_at DESC"),
    tickets: all("SELECT * FROM tickets ORDER BY created_at DESC"),
    logs: all("SELECT * FROM logs ORDER BY id DESC LIMIT 100"),
    usage,
    engineering: all(
      "SELECT * FROM engineering_handoffs ORDER BY created_at DESC",
    ),
    performance: calls.map((call) => performance(call, activities, usage)),
    settings: settings(),
    configuration: configuration(),
    tools: catalog,
    batch: batch(),
  };
}
