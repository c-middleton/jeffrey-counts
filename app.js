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

let counts = loadCounts();
let soundEnabled = loadSoundPreference();
let audioContext;

const homeScreen = document.querySelector("#home-screen");
const counterScreen = document.querySelector("#counter-screen");
const categoryGrid = document.querySelector("#category-grid");
const historyList = document.querySelector("#history-list");
const savedTotal = document.querySelector("#saved-total");
const soundToggle = document.querySelector("[data-action='toggle-sound']");

document.addEventListener("click", handleClick);

renderCounter();
renderSoundToggle();
registerServiceWorker();

function handleClick(event) {
  const button = event.target.closest("[data-action], [data-increment], [data-decrement]");
  if (!button) return;

  if (button.dataset.increment) {
    changeBoatCount(button.dataset.increment, 1);
    return;
  }

  if (button.dataset.decrement) {
    changeBoatCount(button.dataset.decrement, -1);
    return;
  }

  const action = button.dataset.action;

  if (action === "count-boats") showCounter();
  if (action === "home") showHome();
  if (action === "toggle-sound") toggleSound();
}

function changeBoatCount(category, amount) {
  if (amount > 0) {
    counts.unshift({
      id: crypto.randomUUID(),
      category,
      timestamp: new Date().toISOString(),
    });

    playFeedbackSound("add");
  } else {
    const index = counts.findIndex((count) => count.category === category);
    if (index === -1) return;
    counts.splice(index, 1);

    playFeedbackSound("subtract");
  }

  saveCounts();
  renderCounter();
}

function showCounter() {
  homeScreen.classList.remove("active");
  counterScreen.classList.add("active");
}

function showHome() {
  counterScreen.classList.remove("active");
  homeScreen.classList.add("active");
}

function renderCounter() {
  const totals = getTotals();
  savedTotal.textContent = `${counts.length} total`;

  categoryGrid.innerHTML = categories
    .map((category) => {
      const total = totals[category] || 0;

      return `
        <div class="category-control">
          <button class="category-add" type="button" data-increment="${escapeHtml(category)}">
            <span class="category-name">${escapeHtml(category)}</span>
            <span class="category-count">${total}</span>
            <span class="category-add-icon" aria-hidden="true">+</span>
          </button>
          <button
            class="category-subtract"
            type="button"
            data-decrement="${escapeHtml(category)}"
            aria-label="Subtract one ${escapeHtml(category)}"
            ${total === 0 ? "disabled" : ""}
          >-</button>
        </div>
      `;
    })
    .join("");

  historyList.innerHTML = counts.length
    ? counts
        .slice(0, 12)
        .map((count) => {
          return `
            <article class="history-row">
              <p class="history-value">+1</p>
              <div>
                <p class="history-category">${escapeHtml(count.category)}</p>
                <p class="muted">${escapeHtml(formatDate(count.timestamp))}</p>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state"><p>No boat counts yet.</p></div>`;
}

function getTotals() {
  return counts.reduce((totals, count) => {
    totals[count.category] = (totals[count.category] || 0) + 1;
    return totals;
  }, {});
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

function saveCounts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
}

function loadSoundPreference() {
  return localStorage.getItem(SOUND_STORAGE_KEY) !== "false";
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_STORAGE_KEY, String(soundEnabled));
  renderSoundToggle();
}

function renderSoundToggle() {
  if (!soundToggle) return;

  soundToggle.textContent = soundEnabled ? "Sound On" : "Muted";
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
}

function playFeedbackSound(type) {
  if (!soundEnabled) return;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioContext ||= new AudioContext();

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const isAdd = type === "add";

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(isAdd ? 720 : 320, now);
  oscillator.frequency.exponentialRampToValueAtTime(isAdd ? 980 : 220, now + 0.08);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(isAdd ? 0.18 : 0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (isAdd ? 0.11 : 0.16));

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
