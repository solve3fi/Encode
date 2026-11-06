import { redirect } from "next/navigation";

/** The Pass now lives on the Quests page as a tab; keep the old route working. */
export default function PassPage() {
	redirect("/quests?tab=pass");
}
