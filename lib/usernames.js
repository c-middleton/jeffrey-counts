export const USERNAME_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_USERNAME_EMAIL_DOMAIN || "users.jeffrey-counts.app";

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function validateUsername(username) {
  const normalizedUsername = normalizeUsername(username);

  if (normalizedUsername.length < 3) {
    return "Username must be at least 3 characters";
  }

  if (normalizedUsername.length > 32) {
    return "Username must be 32 characters or less";
  }

  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(normalizedUsername)) {
    return "Use letters, numbers, dots, dashes, or underscores";
  }

  return "";
}

export function usernameToEmail(username, domain = USERNAME_EMAIL_DOMAIN) {
  return `${normalizeUsername(username)}@${domain}`;
}

export function userDisplayName(user) {
  return user?.user_metadata?.username || user?.email?.split("@")[0] || "Signed in";
}
