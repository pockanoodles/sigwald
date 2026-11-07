import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { authenticateUser } from "@/lib/auth/credentials-provider";
import { logger } from "@/lib/logger";

// Define a type for our user with role
interface UserWithRole {
  id: string;
  name?: string;
  email?: string;
  image?: string;
  role?: string;
}

const LOG_SOURCE = "AuthOptions";

// Create a function to get the auth options with the credentials
export async function getAuthOptions(): Promise<NextAuthOptions> {
  // Sessions are JWTs signed with this key, so anyone who knows it can mint a
  // valid session for any user. Upstream shipped a hardcoded fallback here,
  // which meant an install that forgot the variable silently signed sessions
  // with a key published in a public repository. Refuse to start instead.
  //
  // Nothing is lost by failing: every verifier (`getToken` in api-auth.ts and
  // middleware.ts) already reads the bare variable with no fallback, so a
  // missing key never produced a working install — only one where sign-in
  // appeared to succeed and every subsequent request read as unauthenticated.
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is not set. Generate one with `openssl rand -base64 32` " +
        "and add it to .env."
    );
  }

  return {
    secret,

    providers: [
      // Email + password is the only way in. Google and Microsoft are
      // calendar connections (api/calendar/google, api/calendar/outlook), not
      // sign-in: there is no adapter, so an OAuth sign-in here would mint a
      // session for any Google or Microsoft account, whose subject matches no
      // user (2026-11-07).
      // Add credentials provider for email/password authentication
      CredentialsProvider({
        name: "Credentials",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) {
            logger.warn("Missing credentials", {}, LOG_SOURCE);
            return null;
          }

          try {
            const user = await authenticateUser(
              credentials.email,
              credentials.password
            );
            return user;
          } catch (error) {
            logger.error(
              "Error in credentials authorization",
              {
                error: error instanceof Error ? error.message : "Unknown error",
              },
              LOG_SOURCE
            );
            return null;
          }
        },
      }),
    ],
    callbacks: {
      async jwt({ token, user }) {
        // Include user role in the token if available
        if (user) {
          // Add role from user object to token
          // TypeScript doesn't know about our custom role property
          token.role = (user as UserWithRole).role;
        }

        return token;
      },
      async session({ session, token }) {
        // Add user role to the session
        if (session.user) {
          session.user.role = token.role;
        }

        return session;
      },
    },
    pages: {
      signIn: "/auth/signin",
      error: "/auth/error",
    },
    debug: process.env.NODE_ENV === "development",
    session: {
      strategy: "jwt",
      // Set a very long maxAge to keep users logged in indefinitely
      // They will only be logged out if they click the logout button
      maxAge: 365 * 24 * 60 * 60, // 1 year
    },
  };
}
