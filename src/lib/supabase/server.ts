import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function getRequestAccessToken(request?: Request): { ok: true; token?: string } | { ok: false } {
  const authorization = request?.headers.get("authorization");
  if (!authorization) return { ok: true };
  const match = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/i.exec(authorization);
  return match ? { ok: true, token: match[1] } : { ok: false };
}

export async function createClient(accessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase authentication is not configured.");

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) cookieStore.set(name, value, options);
        } catch {
          // Middleware refreshes sessions for Server Components where cookies are read-only.
        }
      },
    },
  });
}
