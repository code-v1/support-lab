"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Code2,
  ExternalLink,
  FileText,
  FlaskConical,
  Headphones,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  TrendingUp,
  Users,
  Volume2,
  VolumeX,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { Call, Customer, Scenario, Settings, Snapshot } from "@/lib/types";
import { useVoice } from "@/lib/voice/useVoice";
import {
  defaultModel,
  defaultReasoning,
  recommendedProfiles,
  reasoningLabels,
  reasoningOptions,
} from "@/lib/ai/config";

const tabs = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Live Simulation", icon: AudioLines },
  { name: "CRM", icon: Users },
  { name: "Knowledge", icon: BookOpen },
  { name: "Results", icon: TrendingUp },
  { name: "Agent Settings", icon: Settings2 },
];
const scenarios: {
  id: Scenario;
  name: string;
  description: string;
  icon: typeof ShieldCheck;
  tag: string;
}[] = [
  {
    id: "account_locked",
    name: "Account lockout",
    description: "A customer can’t get into their workspace.",
    icon: ShieldCheck,
    tag: "Access & identity",
  },
  {
    id: "export_config",
    name: "Report export failure",
    description: "A report fails to download from DemoDesk.",
    icon: FileText,
    tag: "Configuration",
  },
  {
    id: "export_stuck",
    name: "Stuck export job",
    description: "An export keeps processing indefinitely.",
    icon: Clock3,
    tag: "Job recovery",
  },
];
const scenarioName = (id: string) =>
  scenarios.find((s) => s.id === id)?.name || id;
const time = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const terminal = (call: Call) => !["running", "paused"].includes(call.status);
function IconEmpty({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof BookOpen;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={23} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
function Avatar({
  customer,
  small = false,
}: {
  customer: Customer;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${customer.id} ${small ? "small" : ""}`}>
      {customer.initials}
    </span>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<Snapshot | null>(null),
    [tab, setTab] = useState("Overview");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("maya"),
    [selectedScenario, setSelectedScenario] =
      useState<Scenario>("account_locked"),
    [maxTurns, setMaxTurns] = useState(6);
  const [selectedCall, setSelectedCall] = useState<string | null>(null),
    [resetOpen, setResetOpen] = useState(false),
    [preserve, setPreserve] = useState(true),
    [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Settings | null>(null),
    [crmCustomer, setCrmCustomer] = useState("maya");
  const voice = useVoice(),
    runner = useRef(false),
    state = useRef(data);
  state.current = data;
  const active = data?.calls.find((c) => !terminal(c));
  const activeId = active?.id,
    activeStatus = active?.status;
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/lab");
      if (!response.ok) throw new Error("Could not load the local database.");
      const value = await response.json();
      setData(value);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 1500);
    return () => clearInterval(interval);
  }, [refresh]);
  async function action(body: object, quiet = false) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request failed");
      setData(result);
      return result as Snapshot;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }
  // Each server step emits one speaker; wait for speech before advancing the agents.
  useEffect(() => {
    if (activeStatus !== "running" || runner.current) return;
    const timer = setTimeout(
      async () => {
        if (runner.current) return;
        runner.current = true;
        setBusy(true);
        try {
          const before = new Set(state.current?.messages.map((m) => m.id));
          const result = await action(
            { action: "step", callId: activeId },
            true,
          );
          if (
            result &&
            state.current?.calls.find((c) => c.id === activeId)?.status !==
              "paused" &&
            state.current?.calls.find((c) => c.id === activeId)?.status !==
              "cancelled"
          )
            await voice.play(
              result.messages.filter(
                (m) => m.call_id === activeId && !before.has(m.id),
              ),
              false,
              result.customers.find((c) => c.id === active?.customer_id)
                ?.voice || 0,
            );
        } finally {
          runner.current = false;
          setBusy(false);
        }
      },
      voice.fast ? 100 : 450,
    );
    return () => clearTimeout(timer);
    // Speech settings take effect between utterances. Polling does not launch parallel steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeStatus, busy, voice.fast]);
  useEffect(() => {
    if (voice.muted || voice.fast) voice.stop();
  }, [voice.muted, voice.fast]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data)
    return (
      <div className="startup">
        <FlaskConical size={38} />
        <h2>Opening Support Lab</h2>
        <p>{error || "Connecting to your local workspace…"}</p>
      </div>
    );
  const completed = data.calls.filter((c) =>
      ["resolved", "failed"].includes(c.status),
    ),
    resolved = completed.filter((c) => c.verified),
    rate = completed.length
      ? Math.round((resolved.length / completed.length) * 100)
      : 0;
  const call =
    data.calls.find((c) => c.id === (selectedCall || active?.id)) ||
    data.calls[0];
  const callCustomer = data.customers.find((c) => c.id === call?.customer_id);
  const transcript = data.messages.filter((m) => m.call_id === call?.id),
    activities = data.activities.filter((a) => a.call_id === call?.id);
  const tokens = data.usage.reduce(
    (n, u) => n + (u.input_tokens || 0) + (u.output_tokens || 0),
    0,
  );
  const average = completed.length
    ? (completed.reduce((n, c) => n + c.turns, 0) / completed.length).toFixed(1)
    : "—";
  async function startCall() {
    voice.stop();
    const result = await action({
      action: "start",
      customerId: selectedCustomer,
      scenario: selectedScenario,
      maxTurns,
    });
    if (result) {
      setSelectedCall(result.calls[0]?.id || null);
      setTab("Live Simulation");
    }
  }
  const go = (name: string) => {
    setTab(name);
    setQuery("");
  };
  const setup = (
    <section className="panel setup-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SIMULATION SETUP</span>
          <h2>Put your agent to the test</h2>
        </div>
        <span className="mini-label">3 scenarios available</span>
      </div>
      <div className="field-heading">
        <span>01</span> Choose a customer
      </div>
      <div className="personas">
        {data.customers.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCustomer(c.id)}
            className={`persona ${selectedCustomer === c.id ? "selected" : ""}`}
          >
            <Avatar customer={c} />
            <strong>{c.name}</strong>
            <span>{c.company}</span>
            <div className="persona-trait">
              {c.id === "maya"
                ? "Frustrated · Nontechnical"
                : c.id === "oliver"
                  ? "Calm · Technical"
                  : "Confused · Beginner"}
            </div>
            <i className="radio">
              {selectedCustomer === c.id && (
                <Circle size={8} fill="currentColor" />
              )}
            </i>
          </button>
        ))}
      </div>
      <div className="field-heading">
        <span>02</span> Select a support scenario
      </div>
      <div className="scenarios">
        {scenarios.map((s) => (
          <button
            key={s.id}
            className={`scenario ${selectedScenario === s.id ? "selected" : ""}`}
            onClick={() => setSelectedScenario(s.id)}
          >
            <div className="scenario-icon">
              <s.icon size={19} />
            </div>
            <div>
              <strong>{s.name}</strong>
              <p>{s.description}</p>
            </div>
            <i className="radio">
              {selectedScenario === s.id && (
                <Circle size={8} fill="currentColor" />
              )}
            </i>
          </button>
        ))}
      </div>
      <div className="setup-footer">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={voice.fast}
            onChange={(e) => voice.setFast(e.target.checked)}
          />
          <span className="switch" />
          <span>Text-only fast mode</span>
          <Zap size={13} />
        </label>
        <label className="turn-select">
          Turn limit{" "}
          <select
            aria-label="Maximum turns"
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value))}
          >
            {[4, 6, 8, 12].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={!data.configuration.ready || !!active || loading}
          onClick={() => void startCall()}
        >
          <Play size={15} fill="currentColor" /> Start simulation
        </button>
      </div>
      {!data.configuration.ready && (
        <div className="setup-hint">
          <CircleHelp size={14} /> Connect an AI provider in Agent Settings to
          start a real call.
        </div>
      )}
    </section>
  );
  const activityPanel = (
    <section className="panel activity-panel">
      <div className="section-heading">
        <h2>
          <Terminal size={17} /> Tool activity
        </h2>
        <Badge tone={busy ? "teal" : "neutral"}>
          {busy ? "Processing" : "Audit log"}
        </Badge>
      </div>
      {activities.length ? (
        <div className="activity-list">
          {activities.map((a) => (
            <details key={a.id} className="tool-event">
              <summary>
                <span
                  className={`event-dot ${a.success ? "success" : "failure"}`}
                >
                  {a.success ? <Check size={11} /> : <X size={11} />}
                </span>
                <code>{a.name}</code>
                <small>{a.duration_ms} ms</small>
                <ChevronDown size={13} />
              </summary>
              <div className="tool-detail">
                <b>Input</b>
                <pre>{JSON.stringify(JSON.parse(a.input), null, 2)}</pre>
                <b>Result</b>
                <pre>{JSON.stringify(JSON.parse(a.output), null, 2)}</pre>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <IconEmpty icon={Terminal} title="Every action, visible">
          Tool calls and their actual results will appear here during a
          simulation.
        </IconEmpty>
      )}
    </section>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <FlaskConical size={22} />
          </span>
          Support Lab
          <span className="brand-dot" />
        </a>
        <div className="workspace">
          <span className="workspace-avatar">SL</span>
          <div>
            <strong>Local workspace</strong>
            <span>Development lab</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.name}
              onClick={() => go(t.name)}
              className={tab === t.name ? "nav-item active" : "nav-item"}
            >
              <t.icon size={18} />
              {t.name}
              {t.name === "Live Simulation" && active && (
                <span className="live-nav-dot" />
              )}
              {t.name === "Knowledge" && data.articles.length > 0 && (
                <span className="nav-count">{data.articles.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-lower">
          <div className="sandbox-card">
            <span>
              <Boxes size={18} /> YOUR SANDBOX
            </span>
            <strong>Meet DemoDesk</strong>
            <p>
              A real little app.
              <br />
              Real problems to solve.
            </p>
            <a href="/demodesk" target="_blank" rel="noreferrer">
              Open application <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="local-status">
            <span className="dot" /> SQLite connected <span>LOCAL</span>
          </div>
          <div className="sidebar-footer">
            <span className="user-avatar">Y</span>
            <div>
              <strong>Your support lab</strong>
              <small>Learn. Resolve. Repeat.</small>
            </div>
            <FlaskConical size={15} />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <strong>{tab}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <span className="dot" /> Local environment
            </span>
            <span className="separator" />
            <a
              href="/demodesk"
              target="_blank"
              rel="noreferrer"
              aria-label="Open DemoDesk"
            >
              <ExternalLink size={17} />
            </a>
            <span className="user-avatar small">Y</span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                SUPPORT LAB <span>/</span>{" "}
                {tab === "Overview"
                  ? "YOUR EXPERIMENT WORKSPACE"
                  : tab.toUpperCase()}
              </div>
              <h1>
                {tab === "Overview"
                  ? "Better support starts with practice."
                  : tab === "Live Simulation"
                    ? "A conversation. A real investigation."
                    : tab === "CRM"
                      ? "The customer, in context."
                      : tab === "Knowledge"
                        ? "Every resolution becomes a lesson."
                        : tab === "Results"
                          ? "Measure what your agent learns."
                          : "Your agents. Your configuration."}
              </h1>
              <p>
                {tab === "Overview"
                  ? "Simulate real problems. Watch your agents work. Build knowledge that lasts."
                  : tab === "Live Simulation"
                    ? "Follow the dialogue, inspect every tool call, and verify the outcome."
                    : tab === "CRM"
                      ? "Customer accounts, support tickets, and application history in one place."
                      : tab === "Knowledge"
                        ? "Verified solutions and safe, reusable troubleshooting workflows."
                        : tab === "Results"
                          ? "Compare verified outcomes across calls and reset-and-replay batches."
                          : "Choose models, explore personas, and set the tools your agent can use."}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => setResetOpen(true)}
              disabled={!!active || loading}
            >
              <RotateCcw size={15} /> Reset & replay
            </button>
          </div>
          {error && (
            <div role="alert" className="alert error">
              <X size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert notice">
              <CheckCircle2 size={17} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!data.configuration.ready && (
            <div className="config-banner">
              <div className="config-icon">
                <Zap size={19} />
              </div>
              <div>
                <strong>
                  Your lab is ready. Connect a model to bring it to life.
                </strong>
                <p>
                  Add an OpenRouter, OpenAI, or Google Gemini API key to start
                  AI-to-AI conversations.
                </p>
              </div>
              <button
                onClick={() => {
                  go("Agent Settings");
                  setDraft(data.settings);
                }}
              >
                Configure agents <ArrowRight size={15} />
              </button>
            </div>
          )}

          {tab === "Overview" && (
            <>
              {active && (
                <section className="panel active-call-notice">
                  <AudioLines size={20} />
                  <div>
                    <strong>
                      {
                        data.customers.find((c) => c.id === active.customer_id)
                          ?.name
                      }{" "}
                      · {scenarioName(active.scenario)}
                    </strong>
                    <p>
                      {active.status === "paused"
                        ? "Simulation paused"
                        : "Call in progress"}{" "}
                      · Turn {active.turns} of {active.max_turns}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelectedCall(active.id);
                      go("Live Simulation");
                    }}
                  >
                    Watch conversation <ArrowRight size={15} />
                  </button>
                </section>
              )}
              <div className="metrics">
                <Metric
                  label="TOTAL CALLS"
                  value={String(data.calls.length)}
                  detail={
                    data.calls.length
                      ? "Across all experiments"
                      : "Ready for your first experiment"
                  }
                  icon={Headphones}
                />
                <Metric
                  label="RESOLUTION RATE"
                  value={completed.length ? `${rate}%` : "—"}
                  detail={
                    completed.length
                      ? `${resolved.length} of ${completed.length} verified`
                      : "Measured against real app state"
                  }
                  icon={CheckCircle2}
                />
                <Metric
                  label="KNOWLEDGE ARTICLES"
                  value={String(data.articles.length)}
                  detail={
                    data.articles.length
                      ? "Verified and available to agents"
                      : "Your agent starts with a clean slate"
                  }
                  icon={BookOpen}
                />
                <Metric
                  label="AVG. SUPPORT TURNS"
                  value={average}
                  detail={
                    completed.length
                      ? "Per completed conversation"
                      : "Learning begins with the first call"
                  }
                  icon={Workflow}
                />
              </div>
              <div className="overview-grid">
                {setup}
                <div className="right-stack">
                  <section className="panel agent-card">
                    <div className="section-heading">
                      <h2>Your support agent</h2>
                      <span
                        className={`status-dot ${active ? "pulsing" : ""}`}
                      />
                    </div>
                    <div className="agent-profile">
                      <div className="bot-avatar">
                        <Bot size={31} />
                        <i />
                      </div>
                      <h3>Alex</h3>
                      <span>DemoDesk support specialist</span>
                      <Badge
                        tone={data.configuration.ready ? "teal" : "neutral"}
                      >
                        {active
                          ? active.status === "paused"
                            ? "Call paused"
                            : "Investigating a case"
                          : data.configuration.ready
                            ? "Ready to investigate"
                            : "Awaiting configuration"}
                      </Badge>
                    </div>
                    <div className="agent-spec">
                      <span>Primary model</span>
                      <strong>{data.settings.profiles.balanced.model}</strong>
                    </div>
                    <div className="agent-spec">
                      <span>Escalation model</span>
                      <strong>{data.settings.profiles.advanced.model}</strong>
                    </div>
                    <div className="agent-spec">
                      <span>Available tools</span>
                      <strong>
                        {
                          data.tools.filter(
                            (t) =>
                              !data.settings.disabledTools.includes(t.name) &&
                              (t.name !== "reproduce_export" ||
                                data.configuration.browserEnabled),
                          ).length
                        }{" "}
                        approved tools
                      </strong>
                    </div>
                    <div className="agent-spec">
                      <span>Model usage</span>
                      <strong>
                        {data.usage.length} requests · {tokens.toLocaleString()}{" "}
                        tokens
                      </strong>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => go("Agent Settings")}
                    >
                      Agent settings <ArrowUpRight size={14} />
                    </button>
                  </section>
                  <section className="learning-note">
                    <span className="note-icon">
                      <Lightbulb size={20} />
                    </span>
                    <h3>Learning is the whole point.</h3>
                    <p>
                      Every verified resolution can become an article and a
                      reusable workflow. Run a similar case again to see what
                      changes.
                    </p>
                    <button onClick={() => go("Knowledge")}>
                      Explore the knowledge base <ArrowRight size={14} />
                    </button>
                  </section>
                </div>
              </div>
              <section className="panel recent">
                <div className="section-heading">
                  <div>
                    <h2>Recent simulations</h2>
                    <p>A running record of your agent’s progress.</p>
                  </div>
                  <button className="text-button" onClick={() => go("Results")}>
                    View all results <ArrowRight size={14} />
                  </button>
                </div>
                {data.calls.length ? (
                  <CallTable
                    calls={data.calls.slice(0, 5)}
                    data={data}
                    open={(id) => {
                      setSelectedCall(id);
                      go("Live Simulation");
                    }}
                  />
                ) : (
                  <div className="recent-empty">
                    <span className="empty-icon">
                      <AudioLines size={22} />
                    </span>
                    <div>
                      <strong>Your first conversation starts here</strong>
                      <p>
                        Pick a customer and a scenario above. We’ll take care of
                        the rest.
                      </p>
                    </div>
                    <span className="dashed-arrow">↑</span>
                  </div>
                )}
              </section>
              <div className="bottom-caption">
                <ShieldCheck size={13} /> Real application state. Verified
                outcomes. No invented results.
                <span>
                  Support Lab <i /> MVP 0.1
                </span>
              </div>
            </>
          )}

          {tab === "Live Simulation" && (
            <>
              {!call ? (
                <>
                  {setup}
                  <div className="live-help">
                    <AudioLines size={20} /> Start a simulation to watch both
                    agents at work.
                  </div>
                </>
              ) : (
                <>
                  <section className="panel call-toolbar">
                    <div>
                      <Badge
                        tone={
                          call.status === "resolved"
                            ? "teal"
                            : call.status === "failed"
                              ? "red"
                              : active
                                ? "teal"
                                : "neutral"
                        }
                      >
                        {call.status}
                      </Badge>
                      <strong>{scenarioName(call.scenario)}</strong>
                      <span>
                        Turn {call.turns} / {call.max_turns}
                      </span>
                    </div>
                    <div className="call-controls">
                      <button
                        className="icon-button"
                        aria-label={voice.muted ? "Unmute" : "Mute"}
                        onClick={() => voice.setMuted(!voice.muted)}
                      >
                        {voice.muted ? (
                          <VolumeX size={18} />
                        ) : (
                          <Volume2 size={18} />
                        )}
                      </button>
                      <select
                        aria-label="Conversation speed"
                        value={voice.rate}
                        onChange={(e) => voice.setRate(Number(e.target.value))}
                      >
                        {[0.75, 1, 1.25, 1.5, 2].map((n) => (
                          <option key={n} value={n}>
                            {n}× speed
                          </option>
                        ))}
                      </select>
                      <label>
                        <input
                          type="checkbox"
                          checked={voice.fast}
                          onChange={(e) => voice.setFast(e.target.checked)}
                        />{" "}
                        Text only
                      </label>
                      {!terminal(call) ? (
                        <>
                          <button
                            className="button secondary"
                            onClick={() => {
                              voice.stop();
                              void action({
                                action:
                                  call.status === "paused" ? "resume" : "pause",
                                callId: call.id,
                              });
                            }}
                          >
                            {call.status === "paused" ? (
                              <Play size={14} />
                            ) : (
                              <Pause size={14} />
                            )}{" "}
                            {call.status === "paused" ? "Resume" : "Pause"}
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Stop call"
                            onClick={() => {
                              voice.stop();
                              void action({
                                action: "cancel",
                                callId: call.id,
                              });
                            }}
                          >
                            <Square size={16} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="button secondary"
                          disabled={voice.speaking}
                          onClick={() =>
                            void voice.play(
                              transcript,
                              true,
                              callCustomer?.voice,
                            )
                          }
                        >
                          <Play size={14} /> Replay voice
                        </button>
                      )}
                    </div>
                  </section>
                  <div className="live-grid">
                    <section className="panel conversation">
                      <div className="conversation-header">
                        <div>
                          {callCustomer && <Avatar customer={callCustomer} />}
                          <span>
                            <strong>{callCustomer?.name}</strong>
                            <small>Customer agent</small>
                          </span>
                        </div>
                        <span className="connection-line">
                          <i />
                          <AudioLines size={21} />
                          <i />
                        </span>
                        <div>
                          <span>
                            <strong>Alex</strong>
                            <small>Support agent</small>
                          </span>
                          <span className="avatar alex">
                            <Bot size={24} />
                          </span>
                        </div>
                      </div>
                      <div className="transcript">
                        {transcript.length ? (
                          transcript.map((m) =>
                            m.role === "system" ? (
                              <div key={m.id} className="system-message">
                                <ShieldCheck size={13} />
                                {m.text}
                              </div>
                            ) : (
                              <div key={m.id} className={`message ${m.role}`}>
                                <span className="message-author">
                                  {m.role === "customer"
                                    ? callCustomer?.name
                                    : "Alex · Support"}
                                  <time>{time(m.created_at)}</time>
                                </span>
                                <div>{m.text}</div>
                              </div>
                            ),
                          )
                        ) : (
                          <IconEmpty
                            icon={Mic}
                            title="Connecting the conversation"
                          >
                            The customer agent will describe what they see in
                            DemoDesk.
                          </IconEmpty>
                        )}
                        {busy && (
                          <div className="thinking">
                            <Loader2 className="spin" size={14} />
                            {voice.speaking
                              ? "Speaking…"
                              : "Agent is investigating…"}
                          </div>
                        )}
                      </div>
                      <div className="transcript-footer">
                        <span className="dot" />
                        {terminal(call)
                          ? "Conversation complete"
                          : call.status === "paused"
                            ? "Paused · current request may finish"
                            : "Live transcript"}
                        <span>
                          {transcript.filter((m) => m.role !== "system").length}{" "}
                          messages
                        </span>
                      </div>
                    </section>
                    {activityPanel}
                  </div>
                  <div className="call-bottom">
                    <span>
                      <ShieldCheck size={16} />
                      {call.verified
                        ? "Application outcome independently verified"
                        : "Resolution requires an actual application check"}
                    </span>
                    <span>
                      {call.tool_calls} tool calls · {call.escalations}{" "}
                      escalation{call.escalations === 1 ? "" : "s"} ·{" "}
                      {call.knowledge_used
                        ? "Knowledge used"
                        : "No knowledge used"}
                    </span>
                  </div>
                  {terminal(call) && (
                    <div className="panel outcome">
                      <h3>
                        {call.verified
                          ? "Verified resolution"
                          : "Call ended without a verified resolution"}
                      </h3>
                      <p>{call.learning_status}</p>
                      {call.error && <p className="error-text">{call.error}</p>}
                      {call.verified &&
                        call.learning_status.startsWith("Learning failed") && (
                          <button
                            className="button secondary"
                            onClick={() =>
                              void action({ action: "learn", callId: call.id })
                            }
                          >
                            Retry learning
                          </button>
                        )}
                      <button
                        className="text-button"
                        onClick={() => go("Overview")}
                      >
                        Set up another call <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {tab === "CRM" && (
            <>
              <div className="section-tabs">
                {data.customers.map((c) => (
                  <button
                    className={crmCustomer === c.id ? "active" : ""}
                    key={c.id}
                    onClick={() => setCrmCustomer(c.id)}
                  >
                    <Avatar customer={c} small />
                    {c.name}
                  </button>
                ))}
              </div>
              {(() => {
                const c = data.customers.find((x) => x.id === crmCustomer)!;
                const logs = data.logs.filter((l) => l.customer_id === c.id);
                const tickets = data.tickets.filter(
                  (t) => t.customer_id === c.id,
                );
                return (
                  <>
                    <div className="crm-grid">
                      <section className="panel customer-detail">
                        <Avatar customer={c} />
                        <h2>{c.name}</h2>
                        <p>{c.email}</p>
                        <Badge tone={c.status === "active" ? "teal" : "amber"}>
                          {c.status}
                        </Badge>
                        <dl>
                          <dt>Company</dt>
                          <dd>{c.company}</dd>
                          <dt>Permissions</dt>
                          <dd>{c.role}</dd>
                          <dt>Export format</dt>
                          <dd>{c.export_format}</dd>
                          <dt>Export job</dt>
                          <dd>{c.export_job}</dd>
                          <dt>Technical skill</dt>
                          <dd>{c.skill}</dd>
                        </dl>
                        <a
                          className="button secondary"
                          href={`/demodesk?customer=${c.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open customer app <ExternalLink size={14} />
                        </a>
                      </section>
                      <section className="panel">
                        <div className="section-heading">
                          <h2>Support tickets</h2>
                          <span className="mini-label">
                            {tickets.length} tickets
                          </span>
                        </div>
                        {tickets.length ? (
                          <div className="ticket-list">
                            {tickets.map((t) => (
                              <button
                                key={t.id}
                                onClick={() => {
                                  setSelectedCall(t.call_id);
                                  go("Live Simulation");
                                }}
                              >
                                <div>
                                  <code>{t.id}</code>
                                  <Badge
                                    tone={
                                      t.status === "resolved" ? "teal" : "amber"
                                    }
                                  >
                                    {t.status}
                                  </Badge>
                                </div>
                                <h3>{t.subject}</h3>
                                {t.resolution && <p>{t.resolution}</p>}
                                <small>
                                  {new Date(t.created_at).toLocaleString()}
                                </small>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <IconEmpty icon={FileText} title="No tickets yet">
                            Tickets created by the support agent appear here.
                          </IconEmpty>
                        )}
                      </section>
                    </div>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Application history</h2>
                        <button
                          className="text-button"
                          disabled={!!active || loading}
                          onClick={() =>
                            void action({
                              action: "inject",
                              customerId: c.id,
                              scenario: selectedScenario,
                            })
                          }
                        >
                          Inject {scenarioName(selectedScenario).toLowerCase()}{" "}
                          <Zap size={14} />
                        </button>
                      </div>
                      {logs.length ? (
                        <div className="logs">
                          {logs.map((l) => (
                            <div key={l.id}>
                              <time>{time(l.created_at)}</time>
                              <Badge
                                tone={
                                  l.level === "error"
                                    ? "red"
                                    : l.level === "warn"
                                      ? "amber"
                                      : "neutral"
                                }
                              >
                                {l.level}
                              </Badge>
                              <code>{l.event}</code>
                              <span>{l.detail}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <IconEmpty icon={Activity} title="No events recorded">
                          Sign in to DemoDesk, export a report, or run a
                          simulation to create real application events.
                        </IconEmpty>
                      )}
                    </section>
                  </>
                );
              })()}
            </>
          )}

          {tab === "Knowledge" && (
            <>
              <div className="knowledge-intro">
                <Badge tone="teal">
                  <ShieldCheck size={12} /> Verified learning only
                </Badge>
                <label className="search">
                  <Search size={16} />
                  <input
                    placeholder="Search knowledge…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="knowledge-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>
                      <BookOpen size={17} /> Knowledge articles
                    </h2>
                    <span className="mini-label">
                      {data.articles.length} articles
                    </span>
                  </div>
                  {data.articles.length ? (
                    <div className="article-list">
                      {data.articles
                        .filter((a) =>
                          (a.title + a.body)
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                        )
                        .map((a) => (
                          <article key={a.id}>
                            <div className="article-top">
                              <span className="article-icon">
                                <FileText size={18} />
                              </span>
                              <Badge tone="teal">Verified</Badge>
                            </div>
                            <h3>{a.title}</h3>
                            <p>{a.body}</p>
                            <details>
                              <summary>View verified evidence</summary>
                              <pre>
                                {JSON.stringify(
                                  JSON.parse(a.evidence),
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                            <footer>
                              <span>{a.uses} retrievals</span>
                              <button
                                onClick={() => {
                                  setSelectedCall(a.source_call);
                                  go("Live Simulation");
                                }}
                              >
                                Source call <ArrowUpRight size={13} />
                              </button>
                            </footer>
                          </article>
                        ))}
                    </div>
                  ) : (
                    <IconEmpty icon={BookOpen} title="A clean slate, by design">
                      After a verified resolution, the learning agent saves what
                      worked. Your next call can put that knowledge to use.
                    </IconEmpty>
                  )}
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <h2>
                      <Workflow size={17} /> Reusable workflows
                    </h2>
                    <span className="mini-label">
                      {data.workflows.length} workflows
                    </span>
                  </div>
                  {data.workflows.length ? (
                    <div className="article-list">
                      {data.workflows.map((w) => (
                        <article key={w.id}>
                          <div className="article-top">
                            <Workflow size={20} />
                            <Badge tone={w.active ? "teal" : "neutral"}>
                              {w.active ? "Active · validated" : "Inactive"}
                            </Badge>
                          </div>
                          <h3>{w.title}</h3>
                          <ol className="recipe-steps">
                            {JSON.parse(w.recipe).steps.map(
                              (s: { tool: string }, i: number) => (
                                <li key={i}>
                                  <code>{s.tool}</code>
                                </li>
                              ),
                            )}
                          </ol>
                          <details>
                            <summary>Inspect JSON recipe</summary>
                            <pre>
                              {JSON.stringify(JSON.parse(w.recipe), null, 2)}
                            </pre>
                          </details>
                          <footer>
                            <span>{w.uses} successful uses</span>
                            <button
                              disabled={!!active}
                              onClick={() =>
                                void action({
                                  action: "workflow",
                                  id: w.id,
                                  active: !w.active,
                                })
                              }
                            >
                              {w.active ? "Deactivate" : "Activate"}
                            </button>
                          </footer>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <IconEmpty
                      icon={Workflow}
                      title="Fewer steps. More know-how."
                    >
                      Validated recipes combine approved tools. They’re created
                      from successful repairs and checked before activation.
                    </IconEmpty>
                  )}
                </section>
              </div>
            </>
          )}

          {tab === "Results" && (
            <>
              <div className="metrics">
                <Metric
                  label="VERIFIED RESOLUTIONS"
                  value={String(resolved.length)}
                  detail={`${completed.filter((c) => !c.verified).length} unsuccessful calls`}
                  icon={ShieldCheck}
                />
                <Metric
                  label="TOOL EXECUTIONS"
                  value={String(data.activities.length)}
                  detail={`${data.workflows.length} reusable workflows`}
                  icon={Terminal}
                />
                <Metric
                  label="MODEL TOKENS"
                  value={tokens.toLocaleString()}
                  detail="Reported by providers · no cost estimate"
                  icon={Zap}
                />
                <Metric
                  label="ESCALATIONS"
                  value={String(
                    data.calls.reduce((n, c) => n + c.escalations, 0),
                  )}
                  detail="Balanced → Advanced model"
                  icon={TrendingUp}
                />
              </div>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Did learning make a difference?</h2>
                    <p>
                      Compare equivalent scenarios with and without retrieved
                      knowledge.
                    </p>
                  </div>
                  <Badge>Batch {data.batch}</Badge>
                </div>
                <div className="comparison-grid">
                  {scenarios.map((s) => {
                    const cold = completed.filter(
                        (c) => c.scenario === s.id && !c.knowledge_used,
                      ),
                      warm = completed.filter(
                        (c) => c.scenario === s.id && c.knowledge_used,
                      );
                    const avg = (cs: Call[]) =>
                      cs.length
                        ? (
                            cs.reduce((n, c) => n + c.turns, 0) / cs.length
                          ).toFixed(1)
                        : "—";
                    const tools = (cs: Call[]) =>
                      cs.length
                        ? (
                            cs.reduce((n, c) => n + c.tool_calls, 0) / cs.length
                          ).toFixed(1)
                        : "—";
                    return (
                      <div className="comparison" key={s.id}>
                        <s.icon size={20} />
                        <h3>{s.name}</h3>
                        <div className="comparison-row labels">
                          <span />
                          <span>Before</span>
                          <span>With knowledge</span>
                        </div>
                        <div className="comparison-row">
                          <span>Calls</span>
                          <b>{cold.length}</b>
                          <b>{warm.length}</b>
                        </div>
                        <div className="comparison-row">
                          <span>Avg. turns</span>
                          <b>{avg(cold)}</b>
                          <b>{avg(warm)}</b>
                        </div>
                        <div className="comparison-row">
                          <span>Avg. tools</span>
                          <b>{tools(cold)}</b>
                          <b>{tools(warm)}</b>
                        </div>
                        <div className="comparison-row">
                          <span>Resolved</span>
                          <b>
                            {cold.filter((c) => c.verified).length}/
                            {cold.length}
                          </b>
                          <b>
                            {warm.filter((c) => c.verified).length}/
                            {warm.length}
                          </b>
                        </div>
                        <p>
                          {warm.length && cold.length
                            ? "Observed results; persona and model differences may affect outcomes."
                            : "Run the same scenario again after learning to compare."}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="panel recent">
                <div className="section-heading">
                  <h2>Simulation history</h2>
                  <span className="mini-label">
                    {data.calls.length} total calls
                  </span>
                </div>
                {data.calls.length ? (
                  <CallTable
                    calls={data.calls}
                    data={data}
                    open={(id) => {
                      setSelectedCall(id);
                      go("Live Simulation");
                    }}
                  />
                ) : (
                  <IconEmpty
                    icon={TrendingUp}
                    title="An experiment waiting to happen"
                  >
                    Completed calls and their verified outcomes will appear
                    here.
                  </IconEmpty>
                )}
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>Model usage</h2>
                  <span className="mini-label">
                    Customer, support & learning
                  </span>
                </div>
                {data.usage.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Profile</th>
                          <th>Provider / model</th>
                          <th>Input tokens</th>
                          <th>Output tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.usage.map((u) => (
                          <tr key={u.id}>
                            <td>{u.role}</td>
                            <td>{u.profile}</td>
                            <td>
                              {u.provider} / {u.model}
                            </td>
                            <td>{u.input_tokens ?? "Unavailable"}</td>
                            <td>{u.output_tokens ?? "Unavailable"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="panel-note">
                    No model requests yet. Token counts are recorded when a
                    provider reports them.
                  </p>
                )}
              </section>
            </>
          )}

          {tab === "Agent Settings" && (
            <>
              <section className="panel settings-panel">
                <div className="section-heading">
                  <div>
                    <h2>Model routing</h2>
                    <p>
                      One provider interface. Three roles for speed, capability,
                      and cost control.
                    </p>
                  </div>
                  <Badge tone={data.configuration.ready ? "teal" : "amber"}>
                    {data.configuration.ready ? "Configured" : "Setup required"}
                  </Badge>
                </div>
                <div className="key-instructions">
                  <Code2 size={19} />
                  <div>
                    <strong>Keep API keys on your server</strong>
                    <p>
                      Copy <code>.env.example</code> to <code>.env.local</code>,
                      add <code>OPENROUTER_API_KEY</code>,{" "}
                      <code>OPENAI_API_KEY</code>, or{" "}
                      <code>GOOGLE_GENERATIVE_AI_API_KEY</code>, then restart{" "}
                      <code>npm run dev</code>.
                    </p>
                    {data.configuration.missing.length > 0 && (
                      <small>
                        Missing: {data.configuration.missing.join(", ")}
                      </small>
                    )}
                  </div>
                </div>
                <div className="model-profiles">
                  {(["fast", "balanced", "advanced"] as const).map(
                    (profile, i) => {
                      const value = (draft || data.settings).profiles[profile];
                      return (
                        <div className="model-profile" key={profile}>
                          <span className={`profile-icon profile-${i}`}>
                            <Zap size={20} />
                          </span>
                          <h3>{profile}</h3>
                          <p>
                            {i === 0
                              ? "Customer conversations & learning"
                              : i === 1
                                ? "Everyday investigation & tool use"
                                : "Difficult cases after 2 unresolved turns"}
                          </p>
                          <label>
                            Provider
                            <select
                              aria-label={`${profile} provider`}
                              value={value.provider}
                              onChange={(e) => {
                                const next = structuredClone(
                                  draft || data.settings,
                                );
                                next.profiles[profile].provider = e.target
                                  .value as Settings["profiles"]["fast"]["provider"];
                                next.profiles[profile].model = defaultModel(
                                  next.profiles[profile].provider,
                                  profile,
                                );
                                next.profiles[profile].reasoning =
                                  defaultReasoning(
                                    next.profiles[profile].provider,
                                    profile,
                                  );
                                next.profiles[profile].maxOutputTokens ??=
                                  recommendedProfiles[profile].maxOutputTokens;
                                setDraft(next);
                              }}
                            >
                              <option value="google">Google Gemini</option>
                              <option value="openai">OpenAI</option>
                              <option value="openrouter">OpenRouter</option>
                            </select>
                          </label>
                          <label>
                            {value.provider === "openrouter"
                              ? "OpenRouter model ID (provider/model)"
                              : "Model identifier"}
                            <input
                              aria-label={`${profile} model`}
                              value={value.model}
                              onChange={(e) => {
                                const next = structuredClone(
                                  draft || data.settings,
                                );
                                next.profiles[profile].model = e.target.value;
                                if (
                                  !reasoningOptions(e.target.value).includes(
                                    next.profiles[profile].reasoning ||
                                      "default",
                                  )
                                )
                                  next.profiles[profile].reasoning = "default";
                                setDraft(next);
                              }}
                            />
                          </label>
                          <label>
                            Reasoning (OpenRouter)
                            <select
                              aria-label={`${profile} reasoning`}
                              disabled={value.provider !== "openrouter"}
                              value={value.reasoning || "default"}
                              onChange={(e) => {
                                const next = structuredClone(
                                  draft || data.settings,
                                );
                                next.profiles[profile].reasoning = e.target
                                  .value as NonNullable<typeof value.reasoning>;
                                setDraft(next);
                              }}
                            >
                              {reasoningOptions(value.model).map((mode) => (
                                <option key={mode} value={mode}>
                                  {reasoningLabels[mode]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Maximum output tokens
                            <input
                              aria-label={`${profile} output tokens`}
                              type="number"
                              min={256}
                              max={32768}
                              step={1}
                              value={
                                value.maxOutputTokens ??
                                recommendedProfiles[profile].maxOutputTokens
                              }
                              onChange={(e) => {
                                const next = structuredClone(
                                  draft || data.settings,
                                );
                                next.profiles[profile].maxOutputTokens = Number(
                                  e.target.value,
                                );
                                setDraft(next);
                              }}
                            />
                          </label>
                          <small className="model-budget-help">
                            {value.provider === "openrouter"
                              ? "Reasoning and the answer share this token limit. Some models require thinking."
                              : "The token limit applies to each model step. Reasoning controls apply to OpenRouter."}
                          </small>
                        </div>
                      );
                    },
                  )}
                </div>
                <div className="settings-actions">
                  <span>
                    Saved settings override environment model assignments.
                  </span>
                  <button
                    className="button secondary"
                    disabled={!!active}
                    onClick={() => {
                      const next = structuredClone(draft || data.settings);
                      next.profiles = structuredClone(recommendedProfiles);
                      setDraft(next);
                    }}
                  >
                    Use recommended lineup
                  </button>
                  <button
                    className="button primary"
                    disabled={loading || !!active}
                    onClick={async () => {
                      const result = await action({
                        action: "settings",
                        settings: draft || data.settings,
                      });
                      if (result) {
                        setDraft(null);
                        setNotice("Agent configuration saved.");
                      }
                    }}
                  >
                    <Check size={15} /> Save configuration
                  </button>
                </div>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Customer personas & voices</h2>
                    <p>
                      Both agents receive the original text. Voices are played
                      locally in your browser.
                    </p>
                  </div>
                </div>
                <div className="persona-settings">
                  {data.customers.map((c) => (
                    <div key={c.id}>
                      <Avatar customer={c} />
                      <h3>{c.name}</h3>
                      <p>{c.personality}</p>
                      <small>{c.style}</small>
                    </div>
                  ))}
                </div>
                <div className="voice-selects">
                  <label>
                    Customer voice
                    <select
                      value={voice.customerVoice}
                      onChange={(e) => voice.setCustomerVoice(e.target.value)}
                    >
                      <option value="">Automatic · persona voice</option>
                      {voice.voices.map((v) => (
                        <option key={v.name}>{v.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Support voice
                    <select
                      value={voice.supportVoice}
                      onChange={(e) => voice.setSupportVoice(e.target.value)}
                    >
                      <option value="">Automatic · different voice</option>
                      {voice.voices.map((v) => (
                        <option key={v.name}>{v.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="panel-note">
                  Available voices depend on your browser and operating system.
                  Voice choices and playback speed apply to this browser
                  session.
                </p>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Approved agent tools</h2>
                    <p>
                      Tools operate on this call’s test customer. Changes are
                      saved with the configuration above.
                    </p>
                  </div>
                  <span className="mini-label">
                    {data.tools.length} defined tools
                  </span>
                </div>
                <div className="tool-settings">
                  {data.tools.map((t) => (
                    <label key={t.name}>
                      <div className="tool-setting-icon">
                        <Terminal size={17} />
                      </div>
                      <div>
                        <strong>{t.name}</strong>
                        <p>{t.description}</p>
                      </div>
                      <Badge>{t.mutates ? "Write" : "Read"}</Badge>
                      <input
                        aria-label={`Enable ${t.name}`}
                        type="checkbox"
                        checked={
                          !(draft || data.settings).disabledTools.includes(
                            t.name,
                          )
                        }
                        disabled={
                          !!active ||
                          (t.name === "reproduce_export" &&
                            !data.configuration.browserEnabled)
                        }
                        onChange={(e) => {
                          const next = structuredClone(draft || data.settings);
                          next.disabledTools = e.target.checked
                            ? next.disabledTools.filter((n) => n !== t.name)
                            : [...next.disabledTools, t.name];
                          setDraft(next);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <p className="panel-note">
                  Browser reproduction: set{" "}
                  <code>ENABLE_BROWSER_TOOLS=true</code>, install Chromium with{" "}
                  <code>npm run browser:install</code>, and keep{" "}
                  <code>APP_BASE_URL</code> pointed at this local app.
                </p>
              </section>
            </>
          )}
        </div>
      </main>
      {resetOpen && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <span className="modal-icon">
              <RotateCcw size={24} />
            </span>
            <h2 id="reset-title">A fresh experiment.</h2>
            <p>
              Restore all DemoDesk accounts and start batch {data.batch + 1}.
              Calls, tickets, and results stay available for comparison. Select
              the same scenario to inject an equivalent problem again.
            </p>
            <label className="reset-check">
              <input
                type="checkbox"
                checked={preserve}
                onChange={(e) => setPreserve(e.target.checked)}
              />
              <span>
                <strong>Preserve accumulated knowledge</strong>
                <small>
                  {preserve
                    ? "The agent can reuse verified articles and workflows."
                    : "Articles and workflows will be cleared."}
                </small>
              </span>
            </label>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setResetOpen(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={loading}
                onClick={async () => {
                  const result = await action({
                    action: "reset",
                    preserveKnowledge: preserve,
                  });
                  if (result) {
                    setResetOpen(false);
                    setSelectedCall(null);
                    setTab("Overview");
                    setNotice(
                      `Batch ${result.batch} is ready. ${preserve ? "Knowledge preserved." : "Knowledge cleared."}`,
                    );
                  }
                }}
              >
                <RotateCcw size={15} /> Reset environment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BookOpen;
}) {
  return (
    <section className="metric">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}
function CallTable({
  calls,
  data,
  open,
}: {
  calls: Call[];
  data: Snapshot;
  open: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Scenario</th>
            <th>Outcome</th>
            <th>Turns</th>
            <th>Learning</th>
            <th>Batch</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => {
            const person = data.customers.find((p) => p.id === c.customer_id)!;
            return (
              <tr key={c.id} onClick={() => open(c.id)}>
                <td>
                  <span className="table-person">
                    <Avatar customer={person} small />
                    {person.name}
                  </span>
                </td>
                <td>{scenarioName(c.scenario)}</td>
                <td>
                  <Badge
                    tone={
                      c.verified
                        ? "teal"
                        : c.status === "failed"
                          ? "red"
                          : "neutral"
                    }
                  >
                    {c.verified ? "Verified" : c.status}
                  </Badge>
                </td>
                <td>{c.turns}</td>
                <td>
                  {c.workflow_used
                    ? "Workflow used"
                    : c.knowledge_used
                      ? "Knowledge used"
                      : "First principles"}
                </td>
                <td>{c.batch}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`View call with ${person.name}`}
                    onClick={() => open(c.id)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
