import { connection } from "next/server";
import TeamWorkspaceShell from "../components/TeamWorkspaceShell";

export default async function Home() {
  await connection();
  return <TeamWorkspaceShell />;
}
