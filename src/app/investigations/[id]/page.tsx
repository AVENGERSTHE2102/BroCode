import { redirect } from "next/navigation";
import { InvestigationDetail } from "@/app/investigation-detail";
import { resolveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export default async function InvestigationPage({ params }: Context) {
  const { id } = await params;
  const access = await resolveWorkspace();
  if (!access.ok && access.status === 401) redirect("/login");
  if (!access.ok && access.status === 409) redirect("/setup");
  if (!access.ok) return <main className="workspace-page"><section className="workspace-card"><h1>Investigation unavailable</h1><p>{access.error}</p></section></main>;
  return <InvestigationDetail id={id} role={access.workspace.role} />;
}
