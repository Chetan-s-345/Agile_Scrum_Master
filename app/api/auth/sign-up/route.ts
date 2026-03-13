import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    // Mock DB insert
    if (name && email && password) {
      const response = NextResponse.json(
        { user: { name, email } },
        { status: 201 }
      );
      
      response.cookies.set({
        name: "auth_token",
        value: "simulated_jwt_token_12345",
        httpOnly: false,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
      
      return response;
    }

    return NextResponse.json(
      { error: "Invalid data provide" },
      { status: 400 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
