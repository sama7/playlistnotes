import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Liveness plus database reachability, for nginx/pm2 and deploy smoke tests.
 *
 * It deliberately reports nothing an anonymous caller could not already infer
 * from the site being up: no version, no host, no connection string, no counts.
 * `SELECT 1` proves the pool can actually reach PostgreSQL, which is the
 * failure this endpoint exists to catch — the process staying alive while every
 * page 500s is precisely the state a bare 200 would hide.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
  return NextResponse.json({ status: "ok" });
}
