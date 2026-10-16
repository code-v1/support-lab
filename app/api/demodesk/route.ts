import { NextResponse } from "next/server";
import { z } from "zod";
import { login, reportView, useReportControls } from "@/lib/demodesk";
import { reportActionSchema } from "@/lib/reporting";
import { customer, one } from "@/lib/db";
import { safeError } from "@/lib/simulation/orchestrator";
import { isSameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("customerId") || "maya";
    customer(id);
    return NextResponse.json({
      view: reportView(id),
      handoff:
        one(
          "SELECT id,ticket_id,status FROM engineering_handoffs WHERE customer_id=? ORDER BY created_at DESC LIMIT 1",
          id,
        ) || null,
    });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request))
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const raw = await request.json();
    const customerId = z.string().parse(raw.customerId);
    const action = raw.action === "export" ? "download_report" : raw.action;
    const result =
      action === "login"
        ? login(customerId)
        : useReportControls(
            customerId,
            reportActionSchema.parse({
              action,
              ...(raw.range ? { range: raw.range } : {}),
              ...(raw.columns ? { columns: raw.columns } : {}),
            }),
          );
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: safeError(error) },
      { status: 400 },
    );
  }
}
