"use client";

import { useState } from "react";

export default function AdminPage() {
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  async function createUser(event) {
    event.preventDefault();
    if (!adminUsername.trim() || !adminPassword || !username.trim() || !password) return;

    setIsCreating(true);
    setMessage("");

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        adminUsername: adminUsername.trim(),
        adminPassword,
        username: username.trim(),
        password,
      }),
    });

    const result = await response.json().catch(() => ({}));
    setIsCreating(false);

    if (!response.ok) {
      setMessage(result.error || "User was not created");
      return;
    }

    setUsername("");
    setPassword("");
    setMessage(`Created ${result.username}`);
  }

  return (
    <main className="admin-shell">
      <section className="admin-panel" aria-labelledby="admin-title">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Admin</p>
            <h1 id="admin-title">Create User</h1>
          </div>
        </div>

        <form className="admin-form" onSubmit={createUser}>
          <label>
            Admin Username
            <input
              type="text"
              autoComplete="username"
              value={adminUsername}
              onChange={(event) => setAdminUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Admin Password
            <span className="password-control">
              <input
                type={showAdminPassword ? "text" : "password"}
                autoComplete="current-password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowAdminPassword((isShowing) => !isShowing)}
                aria-label={showAdminPassword ? "Hide admin password" : "Show admin password"}
                aria-pressed={showAdminPassword}
              >
                <span className="eye-icon" aria-hidden="true" />
              </button>
            </span>
          </label>
          <label>
            New Username
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <span className="password-control">
              <input
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowNewPassword((isShowing) => !isShowing)}
                aria-label={showNewPassword ? "Hide new user password" : "Show new user password"}
                aria-pressed={showNewPassword}
              >
                <span className="eye-icon" aria-hidden="true" />
              </button>
            </span>
          </label>
          <button className="primary-button full" type="submit" disabled={isCreating}>
            {isCreating ? "Creating" : "Create User"}
          </button>
        </form>

        {message ? <p className="auth-message">{message}</p> : null}
      </section>
    </main>
  );
}
