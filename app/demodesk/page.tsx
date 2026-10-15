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
  useEffect(() => {
    setSelected(
      new URLSearchParams(window.location.search).get("customer") || "maya",
    );
    fetch("/api/lab")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers))
      .catch(() => setError("Could not load local accounts."));
  }, []);
  async function act(action: "login" | "export") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/demodesk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, customerId: selected }),
      });
      const value = await response.json();
      if (action === "login") {
        if (value.ok) setSignedIn(true);
        else setError(value.error);
      } else setResult(value);
    } catch {
      setError("Could not reach DemoDesk.");
    } finally {
      setBusy(false);
    }
  }
  const person = customers.find((c) => c.id === selected);
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
                Quarterly revenue<strong>$46,400</strong>
              </div>
              <div>
                Support tickets<strong>282</strong>
              </div>
              <div>
                Report period<strong>Q1 · Sample</strong>
              </div>
            </div>
            <section className="demo-report">
              <div className="section-heading">
                <div>
                  <h2>Quarterly performance report</h2>
                  <p>
                    A small sample dataset, exported from your actual account.
                  </p>
                </div>
                <FileText size={27} color="#9bb0cd" />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Revenue</th>
                    <th>Support tickets</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>January</td>
                    <td>$12,400</td>
                    <td>86</td>
                  </tr>
                  <tr>
                    <td>February</td>
                    <td>$15,800</td>
                    <td>102</td>
                  </tr>
                  <tr>
                    <td>March</td>
                    <td>$18,200</td>
                    <td>94</td>
                  </tr>
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
