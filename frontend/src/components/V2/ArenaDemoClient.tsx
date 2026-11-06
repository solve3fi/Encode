"use client";

import dynamic from "next/dynamic";

// Client-only: the demo has no server data, and rendering it on the server left a hidden streamed copy in the page.
const ArenaDemo = dynamic(() => import("./ArenaDemo").then((m) => m.ArenaDemo), { ssr: false });

export const ArenaDemoClient: React.FC = () => <ArenaDemo />;
