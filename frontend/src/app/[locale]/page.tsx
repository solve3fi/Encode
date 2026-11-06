import { redirect } from "next/navigation";
import { ProtocolHome } from "@/components/ProtocolHome";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";

export default function Home() {
	if (GENESIS_PUBLIC_ENABLED) redirect("/genesis");
	return <ProtocolHome />;
}
