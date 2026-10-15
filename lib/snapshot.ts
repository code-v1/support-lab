import { all, batch } from "@/lib/db";
import { configuration, settings } from "@/lib/ai/router";
import { catalog } from "@/lib/tools/catalog";
import type { Snapshot } from "@/lib/types";
export function snapshot(): Snapshot {
  return {
    customers: all("SELECT * FROM customers"),
    calls: all("SELECT * FROM calls ORDER BY started_at DESC"),
    messages: all("SELECT * FROM messages ORDER BY id"),
    activities: all("SELECT * FROM activities ORDER BY id"),
    articles: all("SELECT * FROM articles ORDER BY created_at DESC"),
    workflows: all("SELECT * FROM workflows ORDER BY created_at DESC"),
    tickets: all("SELECT * FROM tickets ORDER BY created_at DESC"),
    logs: all("SELECT * FROM logs ORDER BY id DESC LIMIT 100"),
    usage: all("SELECT * FROM usage ORDER BY id"),
    settings: settings(),
    configuration: configuration(),
    tools: catalog,
    batch: batch(),
  };
}
