import { redirect } from "next/navigation";

/** Create-lock now lives on /lock; keep the old route working. */
export default function NewLockPage() {
	redirect("/lock");
}
