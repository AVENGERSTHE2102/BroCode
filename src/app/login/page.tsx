import { redirect } from "next/navigation";
import { signIn, signUp } from "./actions";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  if (!supabaseConfigured()) {
    return <main className="auth-page"><section className="auth-panel"><h1>Waypoint</h1><p>Authentication is not configured. Set the Supabase URL and publishable key in the managed deployment environment.</p></section></main>;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/");
  const params = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand"><span className="brand-mark">w</span><span>waypoint<span className="brand-dot">.</span></span></div>
        <h1>Sign in to Waypoint</h1>
        <p>Use your account to access an authorized engineering workspace.</p>
        {params.error && <p className="auth-error" role="alert">{params.error === "password" ? "Use a password with at least 12 characters." : "We could not complete that request. Check your details and try again."}</p>}
        {params.message === "confirmation" && <p className="auth-message">Check your email to confirm your account, then sign in.</p>}
        <form action={signIn} className="auth-form">
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required minLength={8} maxLength={128} /></label>
          <button type="submit">Sign in</button>
        </form>
        <details><summary>Create an account</summary>
          <form action={signUp} className="auth-form">
            <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
            <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
            <button type="submit">Create account</button>
          </form>
        </details>
      </section>
    </main>
  );
}
