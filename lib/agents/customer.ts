import { generateText, stepCountIs, tool } from "ai";
import { all, customer, getCall, one, run } from "@/lib/db";
import { generationSettings, recordUsage } from "@/lib/ai/router";
import { observe, reportView, useReportControls } from "@/lib/demodesk";
import { reportActionSchema } from "@/lib/reporting";
import { readCase } from "@/lib/simulation/cases";
import type { Message } from "@/lib/types";

export async function customerMessage(callId: string) {
  const call = getCall(callId),
    person = customer(call.customer_id);
  const transcript = all<Message>(
    "SELECT * FROM messages WHERE call_id=? AND role!='system' ORDER BY id",
    callId,
  );
  const variant = readCase(call);
  const handoff = one<{ id: string; ticket_id: string }>(
    "SELECT id,ticket_id FROM engineering_handoffs WHERE call_id=?",
    callId,
  );
  // The symptom surface is the only scenario information available to this agent.
  const observation = handoff
    ? {
        accessible: false,
        observation: `My report still cannot be generated. My support ticket ${handoff.ticket_id} is with engineering under ${handoff.id}, pending triage.`,
      }
    : observe(person.id, variant.symptom);
  let actions = 0;
  const canUseControls =
    variant.symptom === "builder" && transcript.at(-1)?.role === "support";
  const result = await generateText({
    ...generationSettings("fast"),
    ...(canUseControls
      ? {
          tools: {
            use_report_controls: tool({
              description:
                "Use the visible report controls only as instructed by support. Choose a quarter, choose columns, apply preview, or download. Report actual feedback. These are customer UI actions, not repair tools.",
              inputSchema: reportActionSchema,
              execute: async (input) => {
                if (actions >= variant.actionLimit)
                  return {
                    ok: false,
                    observation:
                      "I need one step at a time. I will ask support what to do next.",
                  };
                actions++;
                const action = useReportControls(person.id, input);
                return {
                  ok: action.ok,
                  observation:
                    action.error ||
                    (action.view.downloaded
                      ? "My report downloaded successfully."
                      : "The report controls updated."),
                  report: action.view,
                };
              },
            }),
          },
          stopWhen: stepCountIs(variant.actionLimit + 1),
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber >= variant.actionLimit
              ? { toolChoice: "none" as const }
              : undefined,
        }
      : {}),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60000),
    system: `You are ${person.name}, a customer of DemoDesk at ${person.company}. Personality: ${person.personality} Technical skill: ${person.skill}. Style: ${person.style}.
Your actual goal is: ${variant.customerGoal} You attempted the visible action yourself and want it to work. The screen describes the result of your current attempt; it does not tell you who started an older job. Keep those events distinct and preserve your established first-person facts. If you said you clicked export, do not later claim you never tried to export. Never invent backend causes, configuration, automation, logs, or new customer history.
${variant.symptom === "builder" ? `You are learning the report builder, not repairing a broken backend. Only use a control when support clearly explains that step. Your desired quarter is ${variant.targetRange.toUpperCase()} and your needed columns are ${variant.targetColumns.join(" and ")}; reveal these when relevant or asked. You can manage at most ${variant.actionLimit} UI action(s) this turn. If an instruction is unclear or a step fails, say what happened and ask one focused clarification. After success confirm the period and columns shown on screen; do not claim a download that did not occur.` : ""}
${handoff ? "The report remains broken, but support has filed an actual engineering case. If the handoff and update path are clear, acknowledge that you understand and will wait for the ticket update. Never claim it was fixed. Ask about a missing update path or unclear next step only if actually needed; don't demand an invented repair time." : ""}
${variant.followUp && !call.followup_asked ? `You may ask ONE related follow-up after the goal works or an engineering handoff is explained: ${variant.followUp} Ask it naturally only if it has not already been answered; otherwise accept. Do not invent other new concerns.` : "Any planned related follow-up has already been used or is disabled; do not invent another question after acceptance."}
Stay focused on the original goal and actual unanswered questions. Do not create a new concern just because support mentions an irrelevant unknown, normal setting, log event or future possibility. Do not ask who started an older job unless that was already an explicit concern or support made an unsupported claim about you.
When your action works and the relevant explanation is clear, accept it naturally in one short sentence (for example, "That worked, thanks!"). If an actual concern remains, ask one focused follow-up. An honest statement that the logs cannot establish an answer can resolve a cause question. Do not repeat answered questions, request another verification after success, or invent a new need to prolong the call. Use 1-2 short sentences, with no technical jargon beyond your own established vocabulary.`,
    prompt: `Your original statement: ${transcript.find((m) => m.role === "customer")?.text || "(New call: describe your current attempt and visible problem.)"}\nWhat you currently see: ${JSON.stringify(observation)}\nConversation so far:\n${transcript.map((m) => `${m.role}: ${m.text}`).join("\n") || "(New call.)"}`,
  });
  recordUsage(callId, "customer", "fast", result.totalUsage);
  if (!result.text.trim())
    throw new Error(
      "Customer model returned no message. Try a different Fast model.",
    );
  const ready =
    !!handoff ||
    (variant.symptom === "builder"
      ? reportView(person.id).downloaded
      : observation.accessible);
  if (
    variant.followUp &&
    !call.followup_asked &&
    transcript.at(-1)?.role === "support" &&
    ready
  )
    run("UPDATE calls SET followup_asked=1 WHERE id=?", callId);
  return result.text;
}
