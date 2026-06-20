import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { normalizeUsername, usernameToEmail, validateUsername } from "../../../../lib/usernames";

export async function POST(request) {
  const configuredAdminUsername = String(process.env.ADMIN_USERNAME || "").trim();
  const configuredAdminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!configuredAdminUsername || !configuredAdminPassword || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "User creation is not configured" },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const adminUsername = String(body.adminUsername || "").trim();
  const adminPassword = String(body.adminPassword || "").trim();
  const username = String(body.username || "");
  const password = String(body.password || "");
  const normalizedUsername = normalizeUsername(username);
  const usernameError = validateUsername(username);

  if (adminUsername !== configuredAdminUsername || adminPassword !== configuredAdminPassword) {
    return NextResponse.json(
      {
        error: "Admin username or password did not work",
        detail:
          process.env.NODE_ENV === "production"
            ? undefined
            : `Expected ${configuredAdminUsername.length} username chars and ${configuredAdminPassword.length} password chars.`,
      },
      { status: 401 }
    );
  }

  if (usernameError) {
    return NextResponse.json({ error: usernameError }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.admin.createUser({
    email: usernameToEmail(normalizedUsername),
    password,
    email_confirm: true,
    user_metadata: {
      username: normalizedUsername,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    id: data.user.id,
    username: normalizedUsername,
  });
}
