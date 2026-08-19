import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { CreatorsAdmin } from "@/components/CreatorsAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only creator management. Non-admins (and guests) get a 404 so the page's
// existence isn't advertised. The client UI talks to /api/admin/creators, which
// re-checks admin on every mutation — the page gate is not the only guard.
export default async function AdminCreatorsPage() {
  if (!(await isAdmin())) notFound();
  return <CreatorsAdmin />;
}
