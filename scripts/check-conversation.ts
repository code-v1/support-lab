// Opt-in live check. Uses configured provider credits and records usage, but never
// advances the call, edits its transcript/ticket, or replaces saved assessments.
import { loadEnvConfig } from "@next/env";
import { all, getCall, one } from "@/lib/db";
import {
  acceptsCompletion,
  assessCompletion,
} from "@/lib/evaluation/conversation";
import { writeSupportReply } from "@/lib/agents/support";
import type { Activity, Message } from "@/lib/types";

async function main() {
  loadEnvConfig(process.cwd(), true);
  const options = new Map(
    process.argv.slice(2).map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(0, index), arg.slice(index + 1)];
    }),
  );
  const callId = options.get("--call");
  const ids = options.get("--messages")?.split(",").map(Number) || [];
  const expectations = options.get("--expect")?.split(",") || [];
  if (
    !callId ||
    !ids.length ||
    ids.length > 4 ||
    ids.some((id) => !Number.isInteger(id) || id < 1) ||
    expectations.length !== ids.length ||
    expectations.some((value) => !["accepted", "followup"].includes(value))
  )
    throw new Error(
      "Usage: npx tsx scripts/check-conversation.ts --call=ID --messages=11,14 --expect=followup,accepted [--reply-at=11]. At most four live reviews.",
    );
  getCall(callId);
  for (let index = 0; index < ids.length; index++) {
    const decision = await assessCompletion(callId, ids[index]);
    const actual = acceptsCompletion(decision) ? "accepted" : "followup";
    console.log(
      JSON.stringify({
        customerMessageId: ids[index],
        expected: expectations[index],
        actual,
        decision,
      }),
    );
    if (actual !== expectations[index])
      throw new Error(
        `Unexpected completion decision for message ${ids[index]}.`,
      );
  }
  if (options.has("--reply-at")) {
    const id = Number(options.get("--reply-at"));
    const anchor = one<Message>(
      "SELECT * FROM messages WHERE call_id=? AND id=? AND role='customer'",
      callId,
      id,
    );
    if (!anchor)
      throw new Error(
        "Reply sample requires a customer message from this call.",
      );
    const transcript = all<Message>(
      "SELECT * FROM messages WHERE call_id=? AND id<=? AND role!='system' ORDER BY id",
      callId,
      id,
    );
    const evidence = all<Activity>(
      "SELECT * FROM activities WHERE call_id=? AND created_at<=? ORDER BY id",
      callId,
      anchor.created_at,
    );
    const draft =
      one<Message>(
        "SELECT * FROM messages WHERE call_id=? AND id>? AND role='support' ORDER BY id LIMIT 1",
        callId,
        id,
      )?.text ||
      "Answer only the customer's latest question from actual evidence.";
    const reply = await writeSupportReply(
      callId,
      "balanced",
      transcript,
      evidence,
      draft,
    );
    const words = reply.split(/\s+/).length;
    console.log(JSON.stringify({ replyTo: id, words, reply }));
    if (words > 75 || /^\s*(?:#|\*\*|[-*] )/m.test(reply))
      throw new Error(
        "Live reply did not meet the brief conversational format.",
      );
  }
}
main().catch((error: unknown) => {
  // Provider errors can include request metadata; emit a bounded, redacted message.
  let message = error instanceof Error ? error.message : "Live check failed";
  for (const key of [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  ])
    if (key) message = message.replaceAll(key, "[redacted]");
  console.error(message.slice(0, 800));
  process.exitCode = 1;
});
