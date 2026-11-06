import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { publicUrl } from "@/lib/public-url";

// List of public routes that don't require authentication
const publicRoutes = [
  "/setup",
  "/api/setup/check",
  "/auth/signin",
  "/auth/reset-password",
  "/auth/error",
  "/api/auth/register",
];

// Routes that only admins can access
const adminRoutes = ["/admin", "/logs", "/settings/system"];

// Static file extensions that should bypass authentication
const staticFileExtensions = [
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".webmanifest",
];

/**
 * Middleware for handling authentication and authorization
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static files to bypass authentication
  const hasStaticExtension = staticFileExtensions.some((ext) =>
    pathname.toLowerCase().endsWith(ext)
  );
  if (hasStaticExtension) {
    return NextResponse.next();
  }

  // Redirect /login to /auth/signin to prevent redirect loops
  if (pathname === "/login") {
    return NextResponse.redirect(publicUrl("/auth/signin", request));
  }

  // Special handling for the setup page to prevent loops with auth
  if (pathname === "/setup") {
    // Check if the route is public (which it is)
    const response = NextResponse.next();
    // Add a header to track that this was a redirect from setup
    response.headers.set("x-redirect-from", "/setup");
    return response;
  }

  // Special handling to prevent redirect loops between /auth/signin and /setup
  if (pathname === "/auth/signin") {
    // Check for redirects from setup in the referer header
    const referer = request.headers.get("referer") || "";
    if (referer.includes("/setup")) {
      // This is a potential redirect loop - just show the signin page
      return NextResponse.next();
    }
  }

  // Root path: authenticated → /today (the command dashboard, the daily driver),
  // unauthenticated → /auth/signin. /focus stays reachable as opt-in focus mode.
  if (pathname === "/") {
    if (request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.next();
    }
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    return token
      ? NextResponse.redirect(publicUrl("/today", request))
      : NextResponse.redirect(publicUrl("/auth/signin", request));
  }

  // Check if the route is public
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check if the route is an API route (we'll handle auth in the API routes themselves)
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Get the token from the request
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // If there's no token, redirect to the sign-in page
  if (!token) {
    const url = publicUrl("/auth/signin", request);
    // A path, not request.url: behind the proxy that names localhost.
    url.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Check if the route is admin-only
  if (adminRoutes.some((route) => pathname.startsWith(route))) {
    // If the user is not an admin, redirect to the home page
    if (token.role !== "admin") {
      return NextResponse.redirect(publicUrl("/", request));
    }
  }

  // Continue with the request
  return NextResponse.next();
}

// Only run middleware on specific paths
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public directory)
     */
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};
