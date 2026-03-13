import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token');
  const { pathname } = request.nextUrl;

  // Redirect authenticated users away from auth pages
  if (token && (pathname === '/auth/sign-in' || pathname === '/auth/sign-up')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirect unauthenticated users to sign-in page
  // The matcher ensures this only runs on protected routes
  if (!token && !pathname.startsWith('/auth/')) {
    const loginUrl = new URL('/auth/sign-in', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/developers/:path*',
    '/reports/:path*',
    '/settings/:path*',
    '/sprint_plan/:path*',
    '/tasks/:path*',
    '/assign/:path*',
    '/auth/sign-in',
    '/auth/sign-up', 
  ],
};