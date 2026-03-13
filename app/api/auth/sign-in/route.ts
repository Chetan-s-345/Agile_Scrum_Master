import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    // Mock validation, replace with real database check
    if (email && password) {
      const response = NextResponse.json(
        { user: { name: "Demo User", email } },
        { status: 200 }
      );
      
      // Set HttpOnly cookie for actual auth 
      response.cookies.set({
        name: "auth_token",
        value: "simulated_jwt_token_12345",
        httpOnly: false, // Using false so middleware can access without complex setup for demo
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 1 week
      });
      
      return response;
    }

    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
