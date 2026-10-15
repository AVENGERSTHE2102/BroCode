"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } finally {
    redirect("/login");
  }
}
