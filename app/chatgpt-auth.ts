import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

type SupabaseBindings = { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string };

export function getSupabasePublicConfig() {
  const bindings = process.env as SupabaseBindings & NodeJS.ProcessEnv;
  const url = bindings.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishableKey = bindings.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return { url, publishableKey, configured: Boolean(url && publishableKey) };
}

export async function getSupabaseServerClient() {
  const config = getSupabasePublicConfig();
  if (!config.configured) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, { cookies: {
    getAll: () => cookieStore.getAll(),
    setAll: (values) => { try { values.forEach(({name,value,options}) => cookieStore.set(name,value,options)); } catch {} },
  }});
}

// Wrapped in React's per-request cache: the layout, header, onboarding gate,
// isAdmin() and the page itself all ask for the user during one render, and
// getUser() is a network round trip to Supabase Auth. With the cache they share
// a single call per request. Authorization still uses the strict getUser() check.
export const getChatGPTUser = cache(async (): Promise<ChatGPTUser | null> => {
  const client = await getSupabaseServerClient();
  if (!client) return null;
  const {data,error} = await client.auth.getUser();
  const user = error ? null : data.user;
  if (!user?.id || !user.email) return null;
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null;

  return {
    userId: user.id,
    displayName: fullName ?? user.email,
    email: user.email,
    fullName,
  };
});

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/login?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/auth/signout?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/") || pathname === "/login" || pathname === "/register"
  );
}
