"use client";

import dynamic from "next/dynamic";

const TeamWorkspace = dynamic(() => import("./TeamWorkspace"), {
  ssr: false,
});

export default function TeamWorkspaceShell() {
  return <TeamWorkspace />;
}
