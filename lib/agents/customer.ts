import { generateText } from "ai";
import { all, customer, getCall } from "@/lib/db";
import { generationSettings, recordUsage } from "@/lib/ai/router";
import { observe } from "@/lib/demodesk";
import type { Message } from "@/lib/types";

export async function customerMessage(callId: string) {
  const call = getCall(callId),
    person = customer(call.customer_id);
  const transcript = all<Message>(
    "SELECT * FROM messages WHERE call_id=? ORDER BY id",
    callId,
  );
  // The symptom surface is the only scenario information available to this agent.
  const observation = observe(
    person.id,
    call.scenario === "account_locked" ? "login" : "export",
  );
  const result = await generateText({
    ...generationSettings("fast"),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60000),
    system: `You are ${person.name}, a customer of DemoDesk at ${person.company}. Personality: ${person.personality} Technical skill: ${person.skill}. Style: ${person.style}. You only know what you see on screen. Never invent backend causes, tools, configuration values or logs. Explain your visible symptoms naturally and react to the support representative. Remember the conversation. If your action works, confirm it. Keep each message to 1-3 short sentences.`,
    prompt: `What you currently see: ${JSON.stringify(observation)}\nConversation so far:\n${transcript.map((m) => `${m.role}: ${m.text}`).join("\n") || "(New call: explain your problem and desired resolution.)"}`,
  });
  recordUsage(callId, "customer", "fast", result.totalUsage);
  if (!result.text.trim())
    throw new Error(
      "Customer model returned no message. Try a different Fast model.",
    );
  return result.text;
}
