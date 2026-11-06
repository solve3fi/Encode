import { createPageMetadata } from "@/lib/metadata";
export const metadata = createPageMetadata("Bribes", "Add a bribe to any gauge to incentivize votes toward it.", "/bribes");
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
