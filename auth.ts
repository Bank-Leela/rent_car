import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

const ALLOWED_DOMAIN = "chula.ac.th";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider !== "google") return false;
      const email = profile?.email?.toLowerCase();
      if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return "/login?error=DomainNotAllowed";
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user && user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          include: { roles: true },
        });
        session.user.id = user.id;
        session.user.roles = dbUser?.roles.map((r) => r.role) ?? [];
        session.user.isActive = dbUser?.isActive ?? true;
      }
      return session;
    },
  },
  events: {
    // First sign-in: give every new chula.ac.th user the REQUESTER role by default.
    async createUser({ user }) {
      if (!user.id) return;
      await prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role: "REQUESTER" } },
        create: { userId: user.id, role: "REQUESTER" },
        update: {},
      });
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
    };
  }
}
