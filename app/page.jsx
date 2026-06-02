import { connection } from "next/server";
import TeamWorkspace from "../components/TeamWorkspace";

export default async function Home() {
  await connection();
  return <TeamWorkspace />;
}
