import "server-only";

import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readSupabasePublicConfig, SupabaseConfigurationError } from "./config";
import type { PandoDatabase } from "./database";

interface ClaimsClient {
  readonly auth: {
    getClaims(): PromiseLike<{
      readonly data: { readonly claims?: { readonly sub?: unknown } } | null;
      readonly error: unknown | null;
    }>;
  };
}

type ProxyClientFactory = (cookies: CookieMethodsServer) => ClaimsClient;

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function redirectWithSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  pathname: string,
  status?: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = status === undefined ? "" : `?status=${encodeURIComponent(status)}`;
  const redirect = NextResponse.redirect(url);
  for (const cookie of sessionResponse.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"] as const) {
    const value = sessionResponse.headers.get(header);
    if (value !== null) redirect.headers.set(header, value);
  }
  return noStore(redirect);
}

function defaultClientFactory(cookiesAdapter: CookieMethodsServer): ClaimsClient {
  const config = readSupabasePublicConfig();
  return createServerClient<PandoDatabase, "api">(config.url, config.publishableKey, {
    db: { schema: "api" },
    cookieOptions: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: cookiesAdapter,
  });
}

export async function updatePandoSession(
  request: NextRequest,
  createClient: ProxyClientFactory = defaultClientFactory,
): Promise<NextResponse> {
  let response = noStore(NextResponse.next({ request }));
  const cookieAdapter: CookieMethodsServer = {
    getAll: () => request.cookies.getAll(),
    setAll(cookiesToSet, responseHeaders) {
      for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
      for (const [name, value] of Object.entries(responseHeaders)) {
        response.headers.set(name, value);
      }
      noStore(response);
    },
  };

  let result: Awaited<ReturnType<ClaimsClient["auth"]["getClaims"]>>;
  try {
    const client = createClient(cookieAdapter);
    result = await client.auth.getClaims();
  } catch (error) {
    const status = error instanceof SupabaseConfigurationError ? "unavailable" : "session-required";
    return redirectWithSession(request, response, "/sign-in", status);
  }

  if (result.error !== null || typeof result.data?.claims?.sub !== "string") {
    return redirectWithSession(request, response, "/sign-in", "session-required");
  }
  return noStore(response);
}
