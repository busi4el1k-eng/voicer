import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { DubsAdmin } from "@/components/DubsAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only dub browser: preview and download finished dubs to make/post social
// clips, without ever opening the R2/Spaces console. Non-admins (and guests) get
// a 404 so the page's existence isn't advertised. The client UI talks to
// /api/admin/dubs, which re-checks admin on every request — the page gate is not
// the only guard.
export default async function AdminDubsPage() {
  if (!(await isAdmin())) notFound();
  return <DubsAdmin />;
}
