import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { listSessions } from "@/lib/session-store";
import { requireAuth, requireSuperAdmin, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardNav } from "@/components/dashboard-nav";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  let clerkUserId: string;
  let org;
  let memberships;
  let member;
  try {
    ({ org, clerkUserId, memberships, member } = await requireAuth());
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) {
      try { await requireSuperAdmin(); redirect("/admin"); } catch {}
    }
    throw e;
  }

  // Orgs the user belongs to — drives the org switcher in the nav.
  const orgs = memberships.map(m => ({ id: m.org.id, name: m.org.name }));

  // Fetch sessions, org members, and current Clerk profile in parallel
  const [sessions, members, clerkUser] = await Promise.all([
    listSessions(org.id),
    prisma.orgMember.findMany({ where: { orgId: org.id } }),
    currentUser(),
  ]);

  // Build clerkUserId → display name map from OrgMember rows
  const membersMap: Record<string, string> = {};
  for (const m of members) {
    if (m.clerkUserId) {
      membersMap[m.clerkUserId] = m.displayName ?? m.email;
    }
  }

  // Always override the current user's entry with live Clerk profile data
  // so it stays accurate even if displayName hasn't been synced to the DB yet.
  if (clerkUser) {
    const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ');
    const email    = clerkUser.emailAddresses[0]?.emailAddress ?? '';
    membersMap[clerkUserId] = fullName || email || (membersMap[clerkUserId] ?? 'You');
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <DashboardNav orgs={orgs} currentOrgId={org.id} />
      <DashboardShell sessions={sessions} membersMap={membersMap} isAdmin={member.role === 'ORG_ADMIN'} />
    </div>
  );
}
