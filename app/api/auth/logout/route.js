import { NextResponse } from "next/server";
import { revokeSessionToken, SESSION_COOKIE } from "../session.js";
import { auditEvent } from "../../../../lib/auditLog.mjs";

export async function POST(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  await revokeSessionToken(token);
  await auditEvent(request, { type:"auth.logout", status:"ok", actor:"owner" });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
