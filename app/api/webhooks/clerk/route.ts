/**
 * POST /api/webhooks/clerk
 *
 * Receives Clerk webhook events and syncs user data into our DB.
 *
 * Events handled:
 *   user.created  → find OrgMember by email, set clerkUserId + status = active
 *   user.updated  → sync displayName changes
 *   user.deleted  → suspend the OrgMember (don't hard-delete — preserves session history)
 *
 * Setup:
 *   Clerk dashboard → Webhooks → Add endpoint
 *   URL: https://your-domain.com/api/webhooks/clerk
 *   Events: user.created, user.updated, user.deleted
 *   Copy signing secret → CLERK_WEBHOOK_SECRET in .env.local
 */
import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { prisma } from '@/lib/prisma';

type ClerkEmailAddress = { email_address: string; id: string };

type ClerkUserPayload = {
  id: string;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string;
  first_name: string | null;
  last_name: string | null;
};

function getPrimaryEmail(payload: ClerkUserPayload): string | null {
  const primary = payload.email_addresses.find(
    e => e.id === payload.primary_email_address_id,
  );
  return primary?.email_address ?? payload.email_addresses[0]?.email_address ?? null;
}

function getDisplayName(payload: ClerkUserPayload): string | null {
  return [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim() || null;
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Verify the webhook signature using svix
  const svix_id = req.headers.get('svix-id');
  const svix_timestamp = req.headers.get('svix-timestamp');
  const svix_signature = req.headers.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(webhookSecret);

  let event: { type: string; data: ClerkUserPayload };
  try {
    event = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  const { type, data } = event;

  // ── user.created ─────────────────────────────────────────────────────────
  if (type === 'user.created') {
    const email = getPrimaryEmail(data);
    if (!email) return NextResponse.json({ ok: true });

    // Find any pending invite for this email across all orgs
    const member = await prisma.orgMember.findFirst({
      where: { email: email.toLowerCase(), status: 'invited' },
    });

    if (member) {
      await prisma.orgMember.update({
        where: { id: member.id },
        data: {
          clerkUserId: data.id,
          displayName: getDisplayName(data),
          status: 'active',
          joinedAt: new Date(),
        },
      });
    }
    // If no invite found — user signed up without an invite. They will have no
    // org access until an admin adds them. That's correct for our provisioned model.
  }

  // ── user.updated ─────────────────────────────────────────────────────────
  if (type === 'user.updated') {
    await prisma.orgMember.updateMany({
      where: { clerkUserId: data.id },
      data: { displayName: getDisplayName(data) },
    });
  }

  // ── user.deleted ─────────────────────────────────────────────────────────
  if (type === 'user.deleted') {
    // Suspend rather than delete — preserves session history
    await prisma.orgMember.updateMany({
      where: { clerkUserId: data.id },
      data: { status: 'suspended' },
    });
  }

  return NextResponse.json({ ok: true });
}
