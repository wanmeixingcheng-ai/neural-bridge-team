import { isAuthenticated } from "../session.js";

export async function GET(request) {
  return Response.json({ authenticated: isAuthenticated(request) });
}
