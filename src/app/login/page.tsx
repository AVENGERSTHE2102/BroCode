import { redirect } from "next/navigation";
import { signIn, signUp } from "./actions";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { Brand } from "@/components/brand";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const AUTH_ERRORS: Record<string, string> = {
  connection: "The server could not reach the sign-in service. Please try again shortly.",
  credentials: "Sign-in failed. Check your email and password. If you have not registered yet, use Create an account below.",
  email_unconfirmed: "Confirm your email using the signup email before signing in. Check your spam folder too.",
  signup_validation: "The sign-in service rejected the signup details. Enter a valid email address and a password of 12–128 characters.",
  signup_email_delivery: "Confirmation email cannot be sent to this address with the project's current email settings. The project owner needs to configure an email provider in Supabase Authentication → SMTP Settings.",
  signup_service: "The sign-in service could not finish creating the account. The project owner needs to check the Supabase Auth logs for an email-delivery or database error.",
  password: "Use a password with at least 12 characters.",
  signup_email: "Supabase rejected that email address. Use a real deliverable email address.",
  signup_exists: "An account already exists for that email. Sign in or reset its password.",
  signup_rate: "Supabase has temporarily rate-limited confirmation emails. Wait a minute, then try again.",
  signup_disabled: "Email account creation is disabled in Supabase Auth settings.",
  confirmation: "The confirmation link is invalid or expired. Create the account again to request a new email.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  if (!supabaseConfigured()) {
    return <main className="auth-page"><section className="auth-panel"><h1>Waypoint</h1><p>Authentication is not configured. Set the Supabase URL and publishable key in the managed deployment environment.</p></section></main>;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/");
  const params = await searchParams;

  return (
    <main className="auth-page auth-split">
      <aside className="auth-story"><Brand /><div><div className="section-kicker">A LITTLE CONTEXT CHANGES EVERYTHING.</div><h2>Your next<br />clear <em>step.</em></h2><p>Bring your evidence, questions, and decisions together. Make progress with the full picture.</p><div className="auth-thread"><span>Connect</span><i /><span>Understand</span><i /><span>Act</span></div></div><small><ShieldCheck size={15} /> Your workspace. Your judgment.</small></aside>
      <section className="auth-panel">
        <a href="/welcome" className="auth-back">Back to Waypoint <ArrowUpRight size={14} /></a>
        <div className="eyebrow">YOUR WORK STARTS HERE</div>
        <h1>Welcome to Waypoint.</h1>
        <p>Sign in to pick up the thread.</p>
        {params.error && <p className="auth-error" role="alert">{AUTH_ERRORS[params.error] ?? "We could not complete that request. Check your details and try again."}</p>}
        {params.message === "confirmation" && <p className="auth-message">Check your email to confirm your account, then sign in.</p>}
        <form action={signIn} className="auth-form">
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required minLength={8} maxLength={128} /></label>
          <Button type="submit">Sign in <ArrowUpRight size={16} /></Button>
        </form>
        <details open={Boolean(params.error?.startsWith("signup") || params.error === "password")}><summary>Create an account</summary>
          <form action={signUp} className="auth-form">
            <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
            <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
            <Button type="submit">Create account <ArrowUpRight size={16} /></Button>
          </form>
        </details>
        <p className="auth-footnote">Your account connects you to your authorized workspace. Actions always require human approval.</p>
      </section>
    </main>
  );
}
