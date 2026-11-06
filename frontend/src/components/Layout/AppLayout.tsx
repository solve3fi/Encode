"use client";

import type { PropsWithChildren } from "react";
import { V2Shell } from "@/components/V2/V2Shell";

/** Every app page now uses the v2 chrome (header, wave background, footer, mobile bar). The old chrome lives in LegacyAppLayout, used under /v1. */
export const AppLayout: React.FC<PropsWithChildren> = ({ children }) => <V2Shell>{children}</V2Shell>;
