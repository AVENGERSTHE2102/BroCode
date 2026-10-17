import { Brand } from "@/components/brand";
import { redirect } from "next/navigation";
import { createWorkspace } from "./actions";
import { resolveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const result = await resolveWorkspace();
  if (result.ok) redirect("/");
  if (result.status === 401) redirect("/login");
  const params = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Brand />
        <h1>Create your workspace</h1>
        <p>Give your team a place to connect evidence, investigate questions, and make considered decisions.</p>
        {result.status === 503 && <p className="auth-error" role="alert">{result.error} Configure Supabase and apply the migration in <code>supabase/migrations</code>.</p>}
        {params.error && <p className="auth-error" role="alert">{params.error === "name" ? "Workspace names must be 2–80 characters." : "The workspace could not be created. Try again."}</p>}
        {result.status === 409 && <form action={createWorkspace} className="auth-form">
          <label>Workspace name<input name="name" required minLength={2} maxLength={80} autoComplete="organization" /></label>
          <button type="submit">Create workspace</button>
        </form>}
      </section>
    </main>
  );
}
