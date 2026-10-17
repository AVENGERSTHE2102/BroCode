"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || email.length > 254 || password.length < 8 || password.length > 128) redirect("/login?error=credentials");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Supabase signin failed", { code: error.code ?? "unknown", status: error.status });
    const reason = error.status === 0 ? "connection"
      : error.code === "email_not_confirmed" ? "email_unconfirmed"
        : "credentials";
    redirect(`/login?error=${reason}`);
  }
  redirect("/");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || email.length > 254 || password.length < 12 || password.length > 128) redirect("/login?error=password");

  const supabase = await createClient();
  // Prefer the address the user is actually on, so the confirmation link returns to this server
  // even when the dev port differs from NEXT_PUBLIC_SITE_URL (e.g. 3000 already taken).
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const siteUrl = host ? `${protocol}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=/setup` },
  });
  if (error) {
    console.error("Supabase signup failed", {
      code: error.code ?? "unknown",
      status: error.status,
    });
    const reason = error.status === 0 ? "connection"
      : error.code === "email_address_not_authorized" ? "signup_email_delivery"
      : error.code === "weak_password" ? "password"
      : error.code === "validation_failed" ? "signup_validation"
      : error.code === "unexpected_failure" ? "signup_service"
      : error.code === "email_address_invalid" ? "signup_email"
      : error.code === "email_exists" || error.code === "user_already_exists" ? "signup_exists"
        : error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" ? "signup_rate"
          : error.code === "email_provider_disabled" || error.code === "signup_disabled" ? "signup_disabled"
            : "signup";
    redirect(`/login?error=${reason}`);
  }
  if (!data.session) redirect("/login?message=confirmation");
  redirect("/setup");
}
