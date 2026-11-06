import { createPageMetadata } from "@/lib/metadata";
export const metadata = createPageMetadata("Wallet", "Your balances, liquidity positions and locks, and everything you can claim.", "/rewards");
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
