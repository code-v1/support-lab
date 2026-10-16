import type {
  Call,
  CaseOptions,
  Scenario,
  ScenarioCase,
  ScenarioChoice,
} from "@/lib/types";

export const scenarioIds = [
  "account_locked",
  "export_config",
  "export_stuck",
  "report_guidance",
  "export_multi_fault",
  "export_engineering",
] as const;
export function createCase(choice: ScenarioChoice, options: CaseOptions = {}) {
  const seed = options.seed?.trim() || crypto.randomUUID();
  let state = 2166136261;
  for (const char of seed)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  const random = () => {
    state += 0x6d2b79f5;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const scenario: Scenario =
    choice === "random"
      ? scenarioIds[Math.floor(random() * scenarioIds.length)]
      : choice;
  const challenge = options.difficulty === "challenge";
  const targetRange = random() < 0.5 ? "q2" : "q3";
  const targetColumns = random() < 0.5 ? ["revenue"] : ["revenue", "tickets"];
  const recoveryRoll = random(),
    questionRoll = random();
  const goals: Record<Scenario, string> = {
    account_locked:
      "I need to sign in to my workspace and get back to my files before my deadline.",
    export_config: "I need a downloadable report for my finance team.",
    export_stuck: "I clicked Export report and need the download to finish.",
    report_guidance: `I need a ${targetRange.toUpperCase()} report containing ${targetColumns.join(" and ")}. I am unsure how to choose the right report settings; please guide me one step at a time.`,
    export_multi_fault:
      "I need to sign in AND download my report today; restored access alone will not finish my task.",
    export_engineering:
      "I need my report for today's finance review, but exporting keeps failing. If it cannot be fixed now, I need a clear next step and a way to track it.",
  };
  const questions: Record<Scenario, string[]> = {
    account_locked: [
      "Will unlocking my account change or remove any of my existing files?",
      "Do I need to create a new account, or can I keep using this one?",
    ],
    export_config: [
      "Does this change the report's data, or only the download format?",
      "Will my next report use the same download format?",
    ],
    export_stuck: [
      "Do I need to start another export now, or is this report already ready?",
      "Was this download completed, or should I wait for another one?",
    ],
    report_guidance: [
      "Will these report selections stay saved, or must I choose them again each time?",
      "If I change the period later, do I need to apply the preview before downloading?",
    ],
    export_multi_fault: [
      "Did getting my account back also fix the report, or were those separate problems?",
    ],
    export_engineering: [
      "How will I get an update, and should I keep retrying while engineering investigates?",
      "Is there a confirmed fix time, or should I wait for an update on the ticket?",
    ],
  };
  const followUp = options.followUp
    ? questions[scenario][Math.floor(questionRoll * questions[scenario].length)]
    : null;
  const scenarioCase: ScenarioCase = {
    selection: choice,
    seed,
    difficulty: challenge ? "challenge" : "standard",
    customerGoal: goals[scenario],
    symptom:
      scenario === "account_locked"
        ? "login"
        : scenario === "report_guidance"
          ? "builder"
          : "export",
    followUp,
    targetRange,
    targetColumns,
    actionLimit: challenge ? 1 : 3,
    recoveryFailures:
      challenge &&
      ["export_stuck", "export_multi_fault"].includes(scenario) &&
      recoveryRoll < 0.65
        ? 1
        : 0,
    noise: challenge,
    referenceTools: {
      account_locked: 8,
      export_config: 9,
      export_stuck: 8,
      report_guidance: 6,
      export_multi_fault: 13,
      export_engineering: 8,
    }[scenario],
    referenceTurns:
      scenario === "report_guidance"
        ? 5
        : scenario === "export_multi_fault"
          ? 3
          : 2,
  };
  return { scenario, scenarioCase };
}
export function readCase(call: Call): ScenarioCase {
  return call.scenario_case
    ? JSON.parse(call.scenario_case)
    : createCase(call.scenario, { seed: call.id }).scenarioCase;
}
