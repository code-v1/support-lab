import { NextResponse } from "next/server";
import { z } from "zod";
import { exportReport, login } from "@/lib/demodesk";
import { safeError } from "@/lib/simulation/orchestrator";
import { isSameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request))
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const input = z
      .object({ action: z.enum(["login", "export"]), customerId: z.string() })
      .parse(await request.json());
    const result =
      input.action === "login"
        ? login(input.customerId)
        : exportReport(input.customerId);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: safeError(error) },
      { status: 400 },
    );
  }
}
