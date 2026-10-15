"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createWorkspace(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) redirect("/setup?error=name");

  const supabase = await createClient();
  const { data: claimData, error: claimError } = await supabase.auth.getClaims();
  if (claimError || typeof claimData?.claims?.sub !== "string") redirect("/login");

  const { data: workspaceId, error } = await supabase.rpc("create_workspace", { workspace_name: name });
  if (error || typeof workspaceId !== "string") redirect("/setup?error=create");

  (await cookies()).set("waypoint-workspace", workspaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}
