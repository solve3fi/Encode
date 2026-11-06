import { redirect } from "next/navigation";

/** `/partner` is not a page; the launch-partners pages live under `/partners`. */
export default function PartnerIndex() {
	redirect("/partners");
}
