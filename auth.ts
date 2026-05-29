import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

// CR-08: admin-managed credentials. Replaces Google OAuth.
//
// Accounts are created by an ADMIN via /admin/users. Users sign in with
// `identifier` (their username OR email) + password. Sessions are JWT-
// backed because the credentials flow does not create OAuth `Account`
// rows — the Prisma session strategy would be a no-op. The JWT carries
// roles + isActive + mustChangePassword so middleware and server actions
// can gate access without an extra DB hop on every request.

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        identifier: { label: "Email or username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const identifier = String(raw?.identifier ?? "").trim().toLowerCase();
        const password = String(raw?.password ?? "");
        if (!identifier || !password) return null;

        const user = await prisma.user.findFirst({
          where: {
            OR: [{ email: identifier }, { username: identifier }],
          },
          include: { roles: true },
        });
        if (!user || !user.isActive || !user.passwordHash) return null;

        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;

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
    signIn: "/login",
    error: "/login",
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

