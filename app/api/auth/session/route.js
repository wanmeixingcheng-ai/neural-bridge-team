import { isAuthenticatedAsync } from "../session.js";

export async function GET(request) {
  return Response.json({ authenticated: await isAuthenticatedAsync(request) });
}
