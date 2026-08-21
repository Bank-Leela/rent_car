import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";
import {
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/login-throttle";

// A real bcrypt hash of a value nobody can supply, used only to spend the same
// time on a miss as on a wrong password. Never compared for a truthy result.
//
// The cost factor must match the one real hashes are stored at (BCRYPT_ROUNDS in
// lib/auth/credentials-actions.ts). It was 10 while stored hashes were 12 — four
// times less work — so "no such user" returned measurably faster than "wrong
// password" and the constant-time branch leaked exactly the fact it was written to
// hide. Keep these two in step.
const DUMMY_HASH = "$2b$12$Vfohrlu6Fc0npXsd432fn.fHmmpdPT6WAZNJMky3fMPDr92QoJn7C";

// CR-08: admin-managed credentials. Replaces Google OAuth.
//
// Accounts are created by an ADMIN via /admin/users. Users sign in with
// `identifier` (their username OR email) + password. Sessions are JWT-
// backed because the credentials flow does not create OAuth `Account`
// rows — the Prisma session strategy would be a no-op. The JWT carries
// roles + isActive + mustChangePassword so middleware and server actions
// can gate access without an extra DB hop on every request.

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosted behind nginx, so the request Host is a reverse-proxy header
  // rather than a platform-provided origin Auth.js recognises. Without this it
  // resolves trustHost=false under NODE_ENV=production and answers EVERY
  // /api/auth/* request with UntrustedHost — nobody can sign in at all. The
  // alternative is making the operator set AUTH_TRUST_HOST, which the deploy
  // kit never mentioned; pinning it here cannot be forgotten on a new box.
  // Safe because nginx is the only thing that can reach the app (127.0.0.1:3000)
  // and it sets Host itself.
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        identifier: { label: "Email or username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      // `request` is the second argument so the throttle below can see the client
      // IP. Both entry points — the signInAction server action and a raw POST to
      // /api/auth/callback/credentials — funnel through here, so one guard covers
      // both; putting it in the form would guard neither.
      async authorize(raw, request) {
        const identifier = String(raw?.identifier ?? "").trim().toLowerCase();
        const password = String(raw?.password ?? "");
        if (!identifier || !password) return null;

        // nginx is the only thing that can reach this app (see trustHost above),
        // but that does NOT make the whole X-Forwarded-For header trustworthy.
        // deploy/nginx.conf.sample:34 uses $proxy_add_x_forwarded_for, which
        // APPENDS $remote_addr to whatever the client already sent — so the
        // LEFTMOST segment is attacker-written. Keying the throttle on it meant an
        // attacker sent a fresh X-Forwarded-For on every attempt, landed in a new
        // bucket each time, and the per-IP cap never once fired; worse, they could
        // spend someone else's bucket by forging their address.
        //
        // X-Real-IP is set to $remote_addr by the same config and cannot be
        // influenced by the client. The last XFF segment is nginx's own append and
        // is the fallback for a proxy that omits X-Real-IP.
        const fwd = request?.headers?.get("x-forwarded-for") ?? "";
        const ip =
          request?.headers?.get("x-real-ip")?.trim() ||
          (fwd.split(",").pop() ?? "").trim() ||
          "unknown";
        const idKey = `id:${identifier}`;
        const keys = [idKey, `ip:${ip}`];

        const throttle = checkLoginThrottle(keys);
        if (throttle.blocked) {
          // Refuse before the DB hit and before bcrypt: the point is to stop
          // spending work on a guess, not merely to reject it.
          console.warn(
            `[auth] sign-in throttled for ${identifier} from ${ip}; ${throttle.retryAfterSeconds}s remaining`,
          );
          return null;
        }

        const user = await prisma.user.findFirst({
          where: {
            OR: [{ email: identifier }, { username: identifier }],
          },
          include: { roles: true },
        });

        if (!user || !user.isActive || !user.passwordHash) {
          // Compare against a throwaway hash so a missing or disabled account
          // costs the same time as a wrong password. Returning early here made
          // the response measurably faster, which tells an attacker which
          // identifiers exist — and identifiers are admin-assigned usernames.
          await compare(password, DUMMY_HASH);
          recordLoginFailure(keys);
          return null;
        }

        const ok = await compare(password, user.passwordHash);
        if (!ok) {
          recordLoginFailure(keys);
          return null;
        }
        // Only the identifier is cleared. One user signing in correctly must not
        // reset an address that is part-way through sweeping other accounts.
        clearLoginFailures(idKey);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          roles: user.roles.map((r) => r.role),
          isActive: user.isActive,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  pages: {
    // The sign-in screen is the site root, not /login.
    signIn: "/",
    error: "/",
  },
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: persist what the session callback needs.
      if (user) {
        token.uid = user.id as string;
        token.roles = (user as { roles?: Role[] }).roles ?? [];
        token.isActive = (user as { isActive?: boolean }).isActive ?? true;
        token.mustChangePassword =
          (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
      } else if (token.uid) {
        // Refresh from DB on subsequent requests so role/active changes
        // propagate without forcing a re-login.
        const dbUser = await prisma.user.findUnique({
          where: { id: token.uid as string },
          include: { roles: true },
        });
        if (dbUser) {
          token.roles = dbUser.roles.map((r) => r.role);
          token.isActive = dbUser.isActive;
          token.mustChangePassword = dbUser.mustChangePassword;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.roles = (token.roles as Role[]) ?? [];
        session.user.isActive = (token.isActive as boolean) ?? false;
        session.user.mustChangePassword =
          (token.mustChangePassword as boolean) ?? false;
      }
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      roles: Role[];
      isActive: boolean;
      mustChangePassword: boolean;
    };
  }
}

