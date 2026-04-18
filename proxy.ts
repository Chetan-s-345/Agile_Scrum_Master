import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const token = request.cookies.get('auth_token');
  const { pathname } = request.nextUrl;

  if (!token && pathname !== '/login' && pathname !== '/register' && !pathname.startsWith('/auth/')) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/board/:path*',
    '/dashboard/:path*',
    '/sprint-plan/:path*',
    '/sprints/:path*',
    '/developers/:path*',
    '/reports/:path*',
    '/settings/:path*',
    '/assignment/:path*',
    '/monitoring/:path*',
    '/webhooks/:path*',

    // Legacy protected paths retained for backward compatibility.
    '/sprint_plan/:path*',
    '/sprint/:path*',
    '/tasks/:path*',
    '/assign/:path*',
    '/auth/sign-in',
    '/auth/sign-up',
  ],
};
