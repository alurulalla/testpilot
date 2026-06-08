import { NextResponse } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',              // public landing page
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)', // Clerk webhooks must be public
]);

export default clerkMiddleware(async (auth, req) => {
  // Landing page: redirect authenticated users straight to the dashboard.
  // We do this here rather than in the page's Server Component because
  // calling auth() in the middleware is the only reliable way to access
  // the session for public routes — the auth context is NOT automatically
  // forwarded to Server Components unless auth() is called at least once
  // during the middleware pass.
  if (req.nextUrl.pathname === '/') {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
    // Not signed in — let the public landing page render normally
    return;
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
