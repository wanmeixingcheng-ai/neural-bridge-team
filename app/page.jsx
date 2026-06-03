"use client";

import dynamic from "next/dynamic";

const TeamWorkspace = dynamic(() => import("../components/TeamWorkspace"), {
  ssr: false,
});

export default function Home() {
  return <TeamWorkspace />;
}
