"use client";
import { useEffect, useState } from "react";
import {
  Boxes,
  Download,
  ExternalLink,
  FileText,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import type { Customer } from "@/lib/types";
import {
  reportRanges,
  reportColumns,
  reportRows,
  type ReportAction,
} from "@/lib/reporting";
type ReportView = {
  range: string;
  columns: string[];
  draftRange: string;
  draftColumns: string[];
  applied: boolean;
  downloaded: boolean;
  rows: typeof reportRows;
};
export default function DemoDesk() {
  const [customers, setCustomers] = useState<Customer[]>([]),
    [selected, setSelected] = useState("maya"),
    [signedIn, setSignedIn] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      ok: boolean;
      error?: string;
      csv?: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const [view, setView] = useState<ReportView | null>(null);
  const [handoff, setHandoff] = useState<{
    id: string;
    ticket_id: string;
    status: string;
  } | null>(null);
  useEffect(() => {
    setSelected(
      new URLSearchParams(window.location.search).get("customer") || "maya",
    );
    fetch("/api/lab")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers))
      .catch(() => setError("Could not load local accounts."));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/demodesk?customerId=${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((value) => {
        if (value.view) setView(value.view);
        setHandoff(value.handoff || null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selected, signedIn]);
  async function act(
    action: "login" | "export" | ReportAction["action"],
    fields: Partial<ReportAction> = {},
  ) {
    const previousView = view;
    setBusy(true);
    setError("");
    if (view && (action === "choose_range" || action === "choose_columns")) {
      setView({
        ...view,
        draftRange: fields.range || view.draftRange,
        draftColumns: fields.columns || view.draftColumns,
        applied: false,
        downloaded: false,
      });
      setResult(null);
    }
    try {
      const response = await fetch("/api/demodesk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, action, customerId: selected }),
      });
      const value = await response.json();
      if (action === "login") {
        if (value.ok) setSignedIn(true);
        else setError(value.error);
      } else if (action === "export" || action === "download_report")
        setResult(value);
      else {
        setResult(null);
        if (!value.ok) {
          setError(value.error);
          setView(previousView);
        }
      }
      if (value.view) setView(value.view);
    } catch {
      setError("Could not reach DemoDesk.");
      setView(previousView);
    } finally {
      setBusy(false);
    }
  }
  const person = customers.find((c) => c.id === selected);
  const visibleRows = view?.rows || reportRows.slice(0, 3);
  return (
    <div className="demo-shell">
      <header className="demo-nav">
        <a className="demo-logo" href="/demodesk">
          <Boxes size={26} />
          DemoDesk
        </a>
        <a href="/">
          Support Lab{" "}
          <ExternalLink
            size={12}
            style={{ display: "inline", marginLeft: 5 }}
          />
        </a>
      </header>
      <main className="demo-content">
        {!signedIn ? (
          <section className="demo-login">
            <ShieldCheck
              size={35}
              style={{ margin: "auto", color: "#8da4c6" }}
            />
            <h2>Your work, all in one place.</h2>
            <p>
              Sign in to your DemoDesk test account.
              <br />
              No password needed in this local sandbox.
            </p>
            <label htmlFor="demo-customer">Test customer</label>
            <select
              id="demo-customer"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setError("");
              }}
            >
              {customers.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name} · {c.company}
                </option>
              ))}
            </select>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void act("login")}
            >
              Sign in to DemoDesk
            </button>
            {error && (
              <div role="alert" className="demo-error">
                {error}
              </div>
            )}
          </section>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span className="eyebrow">
                  {person?.company.toUpperCase()} / WORKSPACE
                </span>
                <h1>Welcome back, {person?.name.split(" ")[0]}.</h1>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  setSignedIn(false);
                  setResult(null);
                }}
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
            <p style={{ marginTop: 10 }}>Here’s your business at a glance.</p>
            <div className="demo-stats">
              <div>
                Quarterly revenue
                <strong>
                  $
                  {visibleRows
                    .reduce((sum, row) => sum + row.revenue, 0)
                    .toLocaleString()}
                </strong>
              </div>
              <div>
                Support tickets
                <strong>
                  {visibleRows.reduce((sum, row) => sum + row.tickets, 0)}
                </strong>
              </div>
              <div>
                Report period
                <strong>{view?.range.toUpperCase() || "Q1"} · Sample</strong>
              </div>
            </div>
            <section className="demo-report">
              <div className="section-heading">
                <div>
                  <h2>Build your performance report</h2>
                  <p>
                    A small sample dataset, exported from your actual account.
                  </p>
                </div>
                <FileText size={27} color="#9bb0cd" />
              </div>
              {view && (
                <div className="report-builder">
                  <label htmlFor="report-range">Date range</label>
                  <select
                    id="report-range"
                    value={view.draftRange}
                    disabled={busy}
                    onChange={(event) =>
                      void act("choose_range", {
                        range: event.target.value as ReportAction["range"],
                      })
                    }
                  >
                    {Object.entries(reportRanges).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <fieldset>
                    <legend>Columns</legend>
                    {Object.entries(reportColumns).map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="checkbox"
                          checked={view.draftColumns.includes(value)}
                          disabled={busy}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...view.draftColumns, value]
                              : view.draftColumns.filter(
                                  (column) => column !== value,
                                );
                            if (!next.length) {
                              setError("Choose at least one column.");
                              return;
                            }
                            void act("choose_columns", {
                              columns: next as ReportAction["columns"],
                            });
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void act("apply_preview")}
                  >
                    Apply preview
                  </button>
                  <p>
                    {view.applied
                      ? `Saved preview: ${view.range.toUpperCase()} · ${view.columns.map((column) => reportColumns[column as keyof typeof reportColumns]).join(", ")}`
                      : "You have unapplied selections. Choose the period and columns, then apply the preview."}
                  </p>
                </div>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    {view?.columns.includes("revenue") && <th>Revenue</th>}
                    {view?.columns.includes("tickets") && (
                      <th>Support tickets</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(view?.rows || reportRows.slice(0, 3)).map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      {view?.columns.includes("revenue") && (
                        <td>${row.revenue.toLocaleString()}</td>
                      )}
                      {view?.columns.includes("tickets") && (
                        <td>{row.tickets}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void act("export")}
              >
                <Download size={14} /> Export report
              </button>
              {result && (
                <div
                  data-testid="export-result"
                  className={result.ok ? "demo-success" : "demo-error"}
                >
                  {result.ok ? (
                    <>
                      Report ready. Your CSV was generated successfully.
                      <a
                        className="button secondary"
                        download="demodesk-report.csv"
                        href={`data:text/csv;charset=utf-8,${encodeURIComponent(result.csv || "")}`}
                      >
                        Download CSV <Download size={13} />
                      </a>
                    </>
                  ) : (
                    result.error
                  )}
                </div>
              )}
              {error && (
                <div role="alert" className="demo-error">
                  {error}
                </div>
              )}
            </section>
            {handoff && (
              <section className="demo-report">
                <h2>Latest engineering case · {handoff.id}</h2>
                <p>
                  Support ticket {handoff.ticket_id} remains open for updates.
                  Status: {handoff.status} · pending engineering triage. No
                  repair time is confirmed.
                </p>
              </section>
            )}
          </>
        )}
        <div className="demo-footnote">
          DemoDesk is the fictional SaaS inside Support Lab. Account access,
          export configuration, jobs, and event logs persist in SQLite.
          <br />
          Use the <a href="/">support workspace</a> to inject a problem, run an
          investigation, and verify a fix. Metrics on this page are labeled
          sample business data.
        </div>
      </main>
    </div>
  );
}
