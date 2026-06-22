"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabaseClient";
import { userDisplayName, usernameToEmail, validateUsername } from "../lib/usernames";

const STORAGE_KEY = "jeffrey-counts:boats:v2";
const SAVED_COUNTS_STORAGE_KEY = "jeffrey-counts:saved-counts:v1";
const LEGACY_STORAGE_KEY = "jeffrey-counts:boats:v1";
const SOUND_STORAGE_KEY = "jeffrey-counts:sound-enabled:v3";
const MIGRATION_STORAGE_KEY = "jeffrey-counts:supabase-migrated";

const categories = [
  "Powerboats",
  "Pontoons",
  "Fishing Boats",
  "Sailboats",
  "Canoes, Etc",
  "Rafts",
];

export default function BoatCounter() {
  const [screen, setScreen] = useState("home");
  const [counts, setCounts] = useState([]);
  const [savedCounts, setSavedCounts] = useState([]);
  const [saveName, setSaveName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaveFormOpen, setIsSaveFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [syncState, setSyncState] = useState("Local");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [expandedSavedCountId, setExpandedSavedCountId] = useState(null);
  const [editingSavedCountId, setEditingSavedCountId] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSavingCount, setIsSavingCount] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const supabaseRef = useRef(null);
  const pendingHistoryScrollRef = useRef(null);
  const audioRef = useRef({
    context: null,
    media: {},
    unlocked: false,
    unlockPromise: null,
  });

  useEffect(() => {
    setCounts(loadCounts());
    setSavedCounts(loadSavedCounts());
    setSoundEnabled(loadSoundPreference());
    registerServiceWorker();
  }, []);

  useEffect(() => {
    try {
      const supabase = createSupabaseBrowserClient();
      supabaseRef.current = supabase;

      supabase.auth.getSession().then(({ data }) => {
        setUser(data.session?.user ?? null);
        setIsSignInOpen(false);
        setAuthReady(true);
      });

      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) setIsSignInOpen(false);
        setAuthReady(true);
      });

      return () => {
        authListener.subscription.unsubscribe();
      };
    } catch {
      setAuthReady(true);
      setSyncState("Local");
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      setCounts(loadCounts());
      setSavedCounts(loadSavedCounts());
      setEditingSavedCountId(null);
      setSyncState("Local");
      return;
    }

    loadRemoteCounts(user);
    loadRemoteSavedCounts(user);
  }, [authReady, user]);

  useEffect(() => {
    if (pendingHistoryScrollRef.current === null) return;

    const previousScrollY = pendingHistoryScrollRef.current;
    pendingHistoryScrollRef.current = null;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, previousScrollY);
      const timeout = setTimeout(() => {
        window.scrollTo(0, previousScrollY);
      }, 60);

      pendingHistoryScrollRef.current = { timeout };
    });

    return () => {
      cancelAnimationFrame(frame);
      if (pendingHistoryScrollRef.current?.timeout) {
        clearTimeout(pendingHistoryScrollRef.current.timeout);
        pendingHistoryScrollRef.current = null;
      }
    };
  }, [isHistoryOpen]);

  const totals = useMemo(() => {
    return counts.reduce((currentTotals, count) => {
      currentTotals[count.category] = (currentTotals[count.category] || 0) + 1;
      return currentTotals;
    }, {});
  }, [counts]);

  const editingSavedCount = useMemo(() => {
    if (!editingSavedCountId) return null;
    return savedCounts.find((savedCount) => savedCount.id === editingSavedCountId) || null;
  }, [editingSavedCountId, savedCounts]);

  async function loadRemoteCounts(currentUser) {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    setIsSyncing(true);
    setSyncState("Syncing");

    const { data, error } = await supabase
      .from("count_events")
      .select("id, category, observed_at")
      .eq("user_id", currentUser.id)
      .order("observed_at", { ascending: false });

    if (error) {
      setSyncState("Local");
      setAuthMessage("Sync unavailable");
      setIsSyncing(false);
      return;
    }

    const remoteCounts = mapRemoteCounts(data);
    const localCounts = loadCounts();
    const migrationKey = `${MIGRATION_STORAGE_KEY}:${currentUser.id}`;
    const shouldMigrateLocalCounts =
      remoteCounts.length === 0 &&
      localCounts.length > 0 &&
      localStorage.getItem(migrationKey) !== "true";

    if (shouldMigrateLocalCounts) {
      const migratedCounts = await migrateLocalCounts(supabase, currentUser, localCounts);
      if (migratedCounts) {
        setCounts(migratedCounts);
        saveCounts(migratedCounts);
        localStorage.setItem(migrationKey, "true");
        setSyncState("Saved");
        setIsSyncing(false);
        return;
      }
    }

    setCounts(remoteCounts);
    saveCounts(remoteCounts);
    setSyncState("Saved");
    setIsSyncing(false);
  }

  async function loadRemoteSavedCounts(currentUser) {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    const { data, error } = await supabase
      .from("count_sessions")
      .select("id, name, total_count, category_totals, events, saved_at")
      .eq("user_id", currentUser.id)
      .order("saved_at", { ascending: false });

    if (error) {
      setSaveMessage("Saved counts unavailable");
      return;
    }

    const remoteSavedCounts = data.map(mapRemoteSavedCount);
    setSavedCounts(remoteSavedCounts);
    saveSavedCounts(remoteSavedCounts);
  }

  async function changeBoatCount(category, amount) {
    if (amount > 0) {
      const nextCount = {
        id: `local-${crypto.randomUUID()}`,
        category,
        timestamp: new Date().toISOString(),
      };

      setCounts((currentCounts) => {
        const nextCounts = [nextCount, ...currentCounts];
        saveCounts(nextCounts);
        return nextCounts;
      });
      playFeedbackSound(audioRef, soundEnabled, "add");

      if (user) {
        await saveRemoteCount(nextCount);
      }

      return;
    }

    const index = counts.findIndex((count) => count.category === category);
    if (index === -1) return;

    const removedCount = counts[index];
    const nextCounts = [...counts];
    nextCounts.splice(index, 1);
    setCounts(nextCounts);
    saveCounts(nextCounts);
    playFeedbackSound(audioRef, soundEnabled, "subtract");

    if (user && !removedCount.id.startsWith("local-")) {
      await deleteRemoteCount(removedCount, counts);
    }
  }

  async function saveRemoteCount(localCount) {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return;

    setSyncState("Syncing");
    const { data, error } = await supabase
      .from("count_events")
      .insert({
        user_id: user.id,
        category: localCount.category,
        observed_at: localCount.timestamp,
      })
      .select("id, category, observed_at")
      .single();

    if (error) {
      setSyncState("Local");
      setAuthMessage("Count saved locally");
      return;
    }

    setCounts((currentCounts) => {
      const nextCounts = currentCounts.map((count) => {
        if (count.id !== localCount.id) return count;
        return mapRemoteCount(data);
      });
      saveCounts(nextCounts);
      return nextCounts;
    });
    setSyncState("Saved");
  }

  async function deleteRemoteCount(removedCount, previousCounts) {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    setSyncState("Syncing");
    const { error } = await supabase.from("count_events").delete().eq("id", removedCount.id);

    if (error) {
      setCounts(previousCounts);
      saveCounts(previousCounts);
      setSyncState("Local");
      setAuthMessage("Delete did not sync");
      return;
    }

    setSyncState("Saved");
  }

  async function saveCurrentCount(event) {
    event.preventDefault();

    const name = saveName.trim();
    if (!name) {
      setSaveMessage("Name this count before saving");
      return;
    }

    if (!counts.length) {
      setSaveMessage("Add at least one count before saving");
      return;
    }

    const snapshot = buildSavedCountSnapshot(name, counts);
    const isEditingSavedCount = Boolean(editingSavedCountId);
    setIsSavingCount(true);
    setSaveMessage("");

    let savedSnapshot = snapshot;
    let saveStatus = isEditingSavedCount ? `Updated ${name}` : `Saved ${name}`;
    let canStartNewCount = true;

    if (user) {
      const remoteSnapshot = isEditingSavedCount
        ? await updateRemoteSavedCount(editingSavedCountId, snapshot)
        : await saveRemoteSavedCount(snapshot);
      if (remoteSnapshot) {
        savedSnapshot = remoteSnapshot;
      } else {
        savedSnapshot = { ...snapshot, id: editingSavedCountId || snapshot.id };
        saveStatus = isEditingSavedCount ? `Updated ${name} locally` : `Saved ${name} locally`;
      }

      canStartNewCount = await clearRemoteCurrentCounts();
      setIsSavingCount(false);

      setSavedCounts((currentSavedCounts) => {
        const nextSavedCounts = upsertSavedCount(currentSavedCounts, savedSnapshot, editingSavedCountId);
        saveSavedCounts(nextSavedCounts);
        return nextSavedCounts;
      });
    } else {
      savedSnapshot = isEditingSavedCount ? { ...snapshot, id: editingSavedCountId } : snapshot;
      setSavedCounts((currentSavedCounts) => {
        const nextSavedCounts = upsertSavedCount(currentSavedCounts, savedSnapshot, editingSavedCountId);
        saveSavedCounts(nextSavedCounts);
        return nextSavedCounts;
      });
      setIsSavingCount(false);
    }

    if (!canStartNewCount) {
      setSaveMessage("Saved, but could not start a new cloud count");
      setExpandedSavedCountId(savedSnapshot.id);
      return;
    }

    setCounts([]);
    saveCounts([]);
    setSaveName("");
    setIsSaveFormOpen(false);
    setEditingSavedCountId(null);
    setSaveMessage(saveStatus);
    setExpandedSavedCountId(savedSnapshot.id);
  }

  async function saveRemoteSavedCount(snapshot) {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return null;

    const { data, error } = await supabase
      .from("count_sessions")
      .insert({
        user_id: user.id,
        name: snapshot.name,
        total_count: snapshot.totalCount,
        category_totals: snapshot.categoryTotals,
        events: snapshot.events,
        saved_at: snapshot.savedAt,
      })
      .select("id, name, total_count, category_totals, events, saved_at")
      .single();

    if (error) {
      return null;
    }

    return mapRemoteSavedCount(data);
  }

  async function updateRemoteSavedCount(savedCountId, snapshot) {
    const supabase = supabaseRef.current;
    if (!supabase || !user || !savedCountId) return null;

    const { data, error } = await supabase
      .from("count_sessions")
      .update({
        name: snapshot.name,
        total_count: snapshot.totalCount,
        category_totals: snapshot.categoryTotals,
        events: snapshot.events,
        saved_at: snapshot.savedAt,
      })
      .eq("id", savedCountId)
      .select("id, name, total_count, category_totals, events, saved_at")
      .single();

    if (error) {
      return null;
    }

    return mapRemoteSavedCount(data);
  }

  async function clearRemoteCurrentCounts() {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return true;

    const { error: deleteError } = await supabase
      .from("count_events")
      .delete()
      .eq("user_id", user.id);

    return !deleteError;
  }

  async function signIn(event) {
    event.preventDefault();

    const supabase = supabaseRef.current;
    const usernameError = validateUsername(username);
    if (!supabase || usernameError || !password) {
      setAuthMessage(usernameError || "Password is required");
      return;
    }

    setIsSigningIn(true);
    setAuthMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });

    setIsSigningIn(false);
    setAuthMessage(error ? "Username or password did not work" : "");
  }

  async function signOut() {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    await supabase.auth.signOut();
    setAuthMessage("");
  }

  function toggleSound() {
    if (soundEnabled) {
      localStorage.setItem(SOUND_STORAGE_KEY, "false");
      setSoundEnabled(false);
      audioRef.current.unlocked = false;
      return;
    }

    localStorage.setItem(SOUND_STORAGE_KEY, "true");
    setSoundEnabled(true);
    enableAudio(audioRef, "add");
  }

  function toggleHistory() {
    pendingHistoryScrollRef.current = window.scrollY;
    setIsHistoryOpen((isOpen) => !isOpen);
  }

  function editSavedCount(savedCount) {
    const editableCounts = savedCount.events.map((count) => ({
      id: `local-edit-${crypto.randomUUID()}`,
      category: count.category,
      timestamp: count.timestamp || new Date().toISOString(),
    }));

    setCounts(editableCounts);
    saveCounts(editableCounts);
    setSaveName(savedCount.name);
    setSaveMessage(`Editing ${savedCount.name}`);
    setIsSaveFormOpen(true);
    setEditingSavedCountId(savedCount.id);
    setExpandedSavedCountId(savedCount.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="app-shell">
      <section
        className={`home-screen ${screen === "home" ? "active" : ""}`}
        aria-label="Jeffrey Counts boat counter"
      >
        <div className="hero">
          <div className="art-wrap">
            <picture>
              <source
                srcSet="/assets/jeffrey-counts-landing-mobile.jpg"
                media="(max-width: 760px)"
              />
              <img
                className="brand-art"
                src="/assets/jeffrey-counts-landing-desktop.jpg"
                alt="Illustration of Jeffrey Counts driving a pontoon boat on a lake"
              />
            </picture>
          </div>

          <div className="intro">
            <button className="primary-button" type="button" onClick={() => setScreen("counter")}>
              Count Boats
            </button>
          </div>
        </div>
      </section>

      <section
        className={`counter-screen ${screen === "counter" ? "active" : ""}`}
        aria-labelledby="counter-title"
      >
        <header className="counter-header">
          <button className="icon-button" type="button" onClick={() => setScreen("home")} aria-label="Back">
            <span aria-hidden="true">←</span>
          </button>
          <div>
            <p className="eyebrow">Jeffrey Counts</p>
            <div className="counter-title-row">
              <h1 id="counter-title">Count Boats</h1>
              {!user && !isSignInOpen ? (
                <button
                  className="auth-link"
                  type="button"
                  onClick={() => {
                    setAuthMessage("");
                    setIsSignInOpen(true);
                  }}
                >
                  Sign in to save your count
                </button>
              ) : null}
            </div>
          </div>
          <div className="header-actions">
            {user ? (
              <div className="header-user">
                <p>{userDisplayName(user)}</p>
              </div>
            ) : null}
            <button
              className="sound-toggle"
              type="button"
              onClick={toggleSound}
              aria-pressed={soundEnabled}
              aria-label={soundEnabled ? "Turn sound off" : "Turn sound on"}
            >
              <img
                className="sound-icon"
                src={soundEnabled ? "/assets/sound-on-icon.png" : "/assets/sound-off-icon.png"}
                alt=""
                aria-hidden="true"
              />
            </button>
          </div>
        </header>

        {editingSavedCount ? (
          <div className="editing-banner">
            <p>Editing {editingSavedCount.name}</p>
          </div>
        ) : null}

        <section className="counter-panel" aria-labelledby="category-title">
          {!user || authMessage ? (
            <div className="auth-panel">
              {!user ? (
                <form className="auth-form" onSubmit={signIn}>
                  {isSignInOpen ? (
                    <>
                      <div className="auth-form-header">
                        <p>Sign in to save your count</p>
                        <button
                          className="auth-close"
                          type="button"
                          onClick={() => {
                            setAuthMessage("");
                            setIsSignInOpen(false);
                            setShowPassword(false);
                          }}
                          aria-label="Close sign in"
                        >
                          <span aria-hidden="true">x</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        inputMode="text"
                        autoComplete="username"
                        placeholder="Username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        aria-label="Username"
                      />
                      <span className="password-control">
                        <input
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="Password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          aria-label="Password"
                        />
                        <button
                          className="password-toggle"
                          type="button"
                          onClick={() => setShowPassword((isShowing) => !isShowing)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          aria-pressed={showPassword}
                        >
                          <span className="eye-icon" aria-hidden="true" />
                        </button>
                      </span>
                      <button className="secondary-button" type="submit" disabled={!authReady || isSigningIn}>
                        {isSigningIn ? "Signing In" : "Sign In"}
                      </button>
                    </>
                  ) : null}
                </form>
              ) : null}
              {authMessage ? <p className="auth-message">{authMessage}</p> : null}
            </div>
          ) : null}

          <div className="section-heading compact">
            <h2 id="category-title">Tap a Boat</h2>
            <p className="muted">{counts.length} total</p>
          </div>
          <div className="category-grid">
            {categories.map((category) => {
              const total = totals[category] || 0;

              return (
                <div className="category-control" key={category}>
                  <button
                    className="category-add"
                    type="button"
                    onClick={() => changeBoatCount(category, 1)}
                  >
                    <span className="category-name">{category}</span>
                    <span className="category-count">{total}</span>
                    <span className="category-add-icon" aria-hidden="true">+</span>
                  </button>
                  <button
                    className="category-subtract"
                    type="button"
                    onClick={() => changeBoatCount(category, -1)}
                    aria-label={`Subtract one ${category}`}
                    disabled={total === 0}
                  >
                    -
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section
          className={`save-panel ${isSaveFormOpen || editingSavedCountId ? "counter-panel" : "save-panel-collapsed"}`}
          aria-label={editingSavedCountId ? "Update count" : "Save count"}
        >
          {isSaveFormOpen || editingSavedCountId ? (
            <>
              <div className="section-heading compact">
                <h2 id="save-title">{editingSavedCountId ? "Update Count" : "Save Count"}</h2>
                <p className="muted">{counts.length} current</p>
              </div>
              <form className="save-form" onSubmit={saveCurrentCount}>
                <input
                  type="text"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Count name"
                  aria-label="Count name"
                  maxLength={60}
                />
                <button className="secondary-button" type="submit" disabled={isSavingCount}>
                  {isSavingCount ? "Saving" : editingSavedCountId ? "Update & New" : "Save & New"}
                </button>
              </form>
            </>
          ) : (
            <button
              className="primary-button full"
              type="button"
              onClick={() => {
                setSaveMessage("");
                setIsSaveFormOpen(true);
              }}
            >
              Save Count
            </button>
          )}
          {editingSavedCountId ? (
            <button
              className="auth-link"
              type="button"
              onClick={() => {
                setEditingSavedCountId(null);
                setSaveName("");
                setSaveMessage("");
                setIsSaveFormOpen(false);
              }}
            >
              Cancel edit
            </button>
          ) : null}
          {saveMessage ? <p className="auth-message">{saveMessage}</p> : null}
        </section>

        {user ? (
          <div className="signout-row">
            <button className="signout-link" type="button" onClick={signOut}>
              Sign Out
            </button>
          </div>
        ) : null}

        <section className="history-section" aria-labelledby="history-title">
          <div className="section-heading history-heading">
            <h2 id="history-title">Count History</h2>
            <button
              className="history-toggle"
              type="button"
              onClick={toggleHistory}
              aria-expanded={isHistoryOpen}
              aria-controls="history-list"
            >
              {isHistoryOpen ? "Hide" : "Show"}
            </button>
          </div>
          {isHistoryOpen ? (
            <div className="history-list" id="history-list">
              {counts.length ? (
                counts.slice(0, 12).map((count) => (
                  <article className="history-row" key={count.id}>
                    <p className="history-value">+1</p>
                    <div>
                      <p className="history-category">{count.category}</p>
                      <p className="muted">
                        <time dateTime={count.timestamp}>{formatTimestamp(count.timestamp)}</time>
                      </p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <p>No boat counts yet.</p>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="history-section" aria-labelledby="saved-counts-title">
          <div className="section-heading history-heading">
            <h2 id="saved-counts-title">Saved Counts</h2>
          </div>
          <div className="saved-count-list">
            {savedCounts.length ? (
              savedCounts.map((savedCount) => {
                const isExpanded = expandedSavedCountId === savedCount.id;

                return (
                  <article className="saved-count-row" key={savedCount.id}>
                    <button
                      className="saved-count-toggle"
                      type="button"
                      onClick={() => setExpandedSavedCountId(isExpanded ? null : savedCount.id)}
                      aria-expanded={isExpanded}
                    >
                      <span>
                        <strong>{savedCount.name}</strong>
                        <span>{savedCount.totalCount} total</span>
                      </span>
                      <time dateTime={savedCount.savedAt}>{formatTimestamp(savedCount.savedAt)}</time>
                    </button>
                    {isExpanded ? (
                      <div className="saved-count-detail">
                        <div className="saved-total-grid">
                          {categories.map((category) => (
                            <p key={category}>
                              <span>{category}</span>
                              <strong>{savedCount.categoryTotals[category] || 0}</strong>
                            </p>
                          ))}
                        </div>
                        <div className="saved-count-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => editSavedCount(savedCount)}
                          >
                            Edit This Count
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <div className="empty-state">
                <p>No saved counts yet.</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function buildSavedCountSnapshot(name, counts) {
  const events = counts.map((count) => ({
    id: count.id || `local-${crypto.randomUUID()}`,
    category: count.category,
    timestamp: count.timestamp || new Date().toISOString(),
  }));

  return {
    id: `saved-${crypto.randomUUID()}`,
    name,
    totalCount: events.length,
    categoryTotals: getCategoryTotals(events),
    events,
    savedAt: new Date().toISOString(),
  };
}

function upsertSavedCount(savedCounts, savedSnapshot, editingSavedCountId) {
  if (!editingSavedCountId) return [savedSnapshot, ...savedCounts];

  const nextSavedCounts = savedCounts.map((savedCount) => {
    if (savedCount.id !== editingSavedCountId) return savedCount;
    return savedSnapshot;
  });

  return nextSavedCounts.some((savedCount) => savedCount.id === savedSnapshot.id)
    ? nextSavedCounts
    : [savedSnapshot, ...nextSavedCounts];
}

function getCategoryTotals(counts) {
  return counts.reduce((currentTotals, count) => {
    currentTotals[count.category] = (currentTotals[count.category] || 0) + 1;
    return currentTotals;
  }, {});
}

async function migrateLocalCounts(supabase, user, localCounts) {
  const { data, error } = await supabase
    .from("count_events")
    .insert(
      localCounts.map((count) => ({
        user_id: user.id,
        category: count.category,
        observed_at: count.timestamp,
      }))
    )
    .select("id, category, observed_at")
    .order("observed_at", { ascending: false });

  if (error) return null;
  return mapRemoteCounts(data);
}

function mapRemoteCounts(counts) {
  return counts.map(mapRemoteCount);
}

function mapRemoteCount(count) {
  return {
    id: count.id,
    category: count.category,
    timestamp: count.observed_at,
  };
}

function mapRemoteSavedCount(count) {
  return {
    id: count.id,
    name: count.name,
    totalCount: count.total_count,
    categoryTotals: count.category_totals || {},
    events: Array.isArray(count.events) ? count.events : [],
    savedAt: count.saved_at,
  };
}

function loadCounts() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((count) => count.category) : [];
    } catch {
      return [];
    }
  }

  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacy) return [];

  try {
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((count) => {
      const value = Math.max(0, Math.round(Number(count.value) || 0));
      return Array.from({ length: value }, () => ({
        id: crypto.randomUUID(),
        category: "Powerboats",
        timestamp: count.timestamp || new Date().toISOString(),
      }));
    });
  } catch {
    return [];
  }
}

function saveCounts(counts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
}

function loadSavedCounts() {
  const stored = localStorage.getItem(SAVED_COUNTS_STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(normalizeSavedCount).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeSavedCount(count) {
  if (!count || !count.name || !Array.isArray(count.events)) return null;

  const events = count.events.filter((event) => event.category);
  return {
    id: count.id || `saved-${crypto.randomUUID()}`,
    name: String(count.name),
    totalCount: Number(count.totalCount) || events.length,
    categoryTotals: count.categoryTotals || getCategoryTotals(events),
    events,
    savedAt: count.savedAt || new Date().toISOString(),
  };
}

function saveSavedCounts(savedCounts) {
  localStorage.setItem(SAVED_COUNTS_STORAGE_KEY, JSON.stringify(savedCounts));
}

function loadSoundPreference() {
  return localStorage.getItem(SOUND_STORAGE_KEY) === "true";
}

function playFeedbackSound(audioRef, soundEnabled, type) {
  if (!soundEnabled) return;

  const context = getAudioContext(audioRef);
  if (!context || context.state !== "running" || !audioRef.current.unlocked) {
    enableAudio(audioRef, type);
    return;
  }

  playMediaTone(audioRef, type).catch(() => playTone(audioRef, type));
}

function enableAudio(audioRef, type) {
  const context = getAudioContext(audioRef);
  if (!context) return playMediaTone(audioRef, type).catch(() => false);
  if (audioRef.current.unlocked && context.state === "running") {
    return playMediaTone(audioRef, type).catch(() => {
      playTone(audioRef, type);
      return false;
    });
  }
  if (audioRef.current.unlockPromise) return audioRef.current.unlockPromise;

  const resumeAudio = context.state === "running" ? Promise.resolve() : context.resume();
  const mediaAudio = playMediaTone(audioRef, type).then(() => true).catch(() => false);

  audioRef.current.unlockPromise = Promise.all([resumeAudio.catch(() => null), mediaAudio])
    .then(([, mediaPlayed]) => {
      const buffer = context.createBuffer(1, 1, 22050);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);

      audioRef.current.unlocked = context.state === "running";
      if (!mediaPlayed && audioRef.current.unlocked) playTone(audioRef, type);
      return audioRef.current.unlocked;
    })
    .catch(() => false)
    .finally(() => {
      audioRef.current.unlockPromise = null;
    });

  return audioRef.current.unlockPromise;
}

function playMediaTone(audioRef, type) {
  const tone = getMediaTone(audioRef, type);
  if (!tone) return Promise.reject(new Error("Audio element unavailable"));

  tone.pause();
  tone.currentTime = 0;
  return Promise.resolve(tone.play());
}

function getMediaTone(audioRef, type) {
  if (typeof Audio === "undefined") return null;

  audioRef.current.media[type] ||= createMediaTone(type);
  return audioRef.current.media[type];
}

function createMediaTone(type) {
  const isAdd = type === "add";
  const audio = new Audio(createToneDataUri({
    duration: isAdd ? 0.12 : 0.17,
    endFrequency: isAdd ? 980 : 220,
    startFrequency: isAdd ? 720 : 320,
    volume: isAdd ? 0.18 : 0.12,
  }));

  audio.preload = "auto";
  audio.playsInline = true;
  return audio;
}

function createToneDataUri({ duration, endFrequency, startFrequency, volume }) {
  const sampleRate = 44100;
  const sampleCount = Math.floor(sampleRate * duration);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const elapsed = index / sampleRate;
    const rampProgress = Math.min(elapsed / 0.08, 1);
    const frequency = startFrequency * ((endFrequency / startFrequency) ** rampProgress);
    const envelope = getToneEnvelope(elapsed, duration);
    const sample = Math.sin(2 * Math.PI * frequency * elapsed) * envelope * volume;
    view.setInt16(44 + index * 2, sample * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function getToneEnvelope(elapsed, duration) {
  const attackDuration = 0.01;
  const floor = 0.0001;

  if (elapsed <= attackDuration) {
    const progress = Math.max(elapsed / attackDuration, 0.001);
    return floor * ((1 / floor) ** progress);
  }

  const decayProgress = Math.min((elapsed - attackDuration) / Math.max(duration - attackDuration, 0.001), 1);
  return floor ** decayProgress;
}

function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function getAudioContext(audioRef) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;

  audioRef.current.context ||= new AudioContext();
  return audioRef.current.context;
}

function playTone(audioRef, type) {
  const context = getAudioContext(audioRef);
  if (!context) return;

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const isAdd = type === "add";

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(isAdd ? 720 : 320, now);
  oscillator.frequency.exponentialRampToValueAtTime(isAdd ? 980 : 220, now + 0.08);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(isAdd ? 0.18 : 0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (isAdd ? 0.11 : 0.16));

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (isAdd ? 0.12 : 0.17));
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  };

  if (document.readyState === "complete") {
    register();
    return;
  }

  window.addEventListener("load", register, { once: true });
}
