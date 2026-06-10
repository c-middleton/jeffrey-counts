"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "jeffrey-counts:boats:v2";
const LEGACY_STORAGE_KEY = "jeffrey-counts:boats:v1";
const SOUND_STORAGE_KEY = "jeffrey-counts:sound-enabled";

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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef({
    context: null,
    unlocked: false,
    unlockPromise: null,
  });

  useEffect(() => {
    setCounts(loadCounts());
    setSoundEnabled(loadSoundPreference());
    registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!soundEnabled) return undefined;

    const unlock = () => {
      unlockAudio(audioRef, soundEnabled);
    };

    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("touchstart", unlock, { passive: true });
    document.addEventListener("touchend", unlock, { passive: true });

    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("touchend", unlock);
    };
  }, [soundEnabled]);

  const totals = useMemo(() => {
    return counts.reduce((currentTotals, count) => {
      currentTotals[count.category] = (currentTotals[count.category] || 0) + 1;
      return currentTotals;
    }, {});
  }, [counts]);

  function changeBoatCount(category, amount) {
    if (amount > 0) {
      const nextCount = {
        id: crypto.randomUUID(),
        category,
        timestamp: new Date().toISOString(),
      };

      setCounts((currentCounts) => {
        const nextCounts = [nextCount, ...currentCounts];
        saveCounts(nextCounts);
        return nextCounts;
      });
      playFeedbackSound(audioRef, soundEnabled, "add");
      return;
    }

    setCounts((currentCounts) => {
      const index = currentCounts.findIndex((count) => count.category === category);
      if (index === -1) return currentCounts;

      const nextCounts = [...currentCounts];
      nextCounts.splice(index, 1);
      saveCounts(nextCounts);
      playFeedbackSound(audioRef, soundEnabled, "subtract");
      return nextCounts;
    });
  }

  function toggleSound() {
    setSoundEnabled((currentSoundEnabled) => {
      const nextSoundEnabled = !currentSoundEnabled;
      localStorage.setItem(SOUND_STORAGE_KEY, String(nextSoundEnabled));

      if (nextSoundEnabled) {
        unlockAudio(audioRef, nextSoundEnabled)
          .then(() => playTone(audioRef, "add"))
          .catch(() => {});
      }

      return nextSoundEnabled;
    });
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
            <span aria-hidden="true">&lt;</span>
          </button>
          <div>
            <p className="eyebrow">Jeffrey Counts</p>
            <h1 id="counter-title">Count Boats</h1>
          </div>
          <button
            className="sound-toggle"
            type="button"
            onClick={toggleSound}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? "Sound On" : "Muted"}
          </button>
        </header>

        <section className="counter-panel" aria-labelledby="category-title">
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

        <section className="history-section" aria-labelledby="history-title">
          <div className="section-heading">
            <h2 id="history-title">Recent Counts</h2>
          </div>
          <div className="history-list">
            {counts.length ? (
              counts.slice(0, 12).map((count) => (
                <article className="history-row" key={count.id}>
                  <p className="history-value">+1</p>
                  <div>
                    <p className="history-category">{count.category}</p>
                    <p className="muted">{formatDate(count.timestamp)}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <p>No boat counts yet.</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
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

function loadSoundPreference() {
  return localStorage.getItem(SOUND_STORAGE_KEY) !== "false";
}

function playFeedbackSound(audioRef, soundEnabled, type) {
  if (!soundEnabled) return;

  const context = getAudioContext(audioRef);
  if (!context) return;

  if (context.state !== "running" || !audioRef.current.unlocked) {
    unlockAudio(audioRef, soundEnabled)
      .then(() => {
        if (context.state === "running") playTone(audioRef, type);
      })
      .catch(() => {});
    return;
  }

  playTone(audioRef, type);
}

function unlockAudio(audioRef, soundEnabled) {
  if (!soundEnabled) return Promise.resolve(false);

  const context = getAudioContext(audioRef);
  if (!context) return Promise.resolve(false);
  if (audioRef.current.unlocked && context.state === "running") return Promise.resolve(true);
  if (audioRef.current.unlockPromise) return audioRef.current.unlockPromise;

  const resumeAudio = context.state === "running" ? Promise.resolve() : context.resume();

  audioRef.current.unlockPromise = resumeAudio
    .then(() => {
      const buffer = context.createBuffer(1, 1, 22050);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);

      audioRef.current.unlocked = context.state === "running";
      return audioRef.current.unlocked;
    })
    .catch(() => false)
    .finally(() => {
      audioRef.current.unlockPromise = null;
    });

  return audioRef.current.unlockPromise;
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

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
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
