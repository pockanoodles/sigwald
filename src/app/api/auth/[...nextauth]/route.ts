import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { getAuthOptions } from "@/lib/auth/auth-options";

declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      name?: string;
      email?: string;
      image?: string;
      role?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
  }
}

// The options are built for each request, not once at import. `next build`
// imports every route to collect its page data, and building them there threw
// wherever NEXTAUTH_SECRET isn't set, so no Docker image ever built.
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ nextauth: string[] }> }
) {
  return NextAuth(req, ctx, await getAuthOptions());
}

export { handler as GET, handler as POST };
