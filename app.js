const STORAGE_KEY = "jeffrey-counts:boats:v1";

let counts = loadCounts();

const homeScreen = document.querySelector("#home-screen");
const counterScreen = document.querySelector("#counter-screen");
const boatForm = document.querySelector("#boat-form");
const boatCount = document.querySelector("#boat-count");
const boatNote = document.querySelector("#boat-note");
const historyList = document.querySelector("#history-list");
const savedTotal = document.querySelector("#saved-total");

document.addEventListener("click", handleClick);
boatForm.addEventListener("submit", handleSave);

renderCounter();
registerServiceWorker();

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;

  if (action === "count-boats") showCounter();
  if (action === "home") showHome();
  if (action === "increment") stepCount(1);
  if (action === "decrement") stepCount(-1);
}

function handleSave(event) {
  event.preventDefault();

  const value = Number(boatCount.value);
  if (Number.isNaN(value)) return;

  counts.unshift({
    id: crypto.randomUUID(),
    value: Math.max(0, Math.round(value)),
    note: boatNote.value.trim(),
    timestamp: new Date().toISOString(),
  });

  saveCounts();
  boatNote.value = "";
  renderCounter();
}

function showCounter() {
  homeScreen.classList.remove("active");
  counterScreen.classList.add("active");
  boatCount.focus();
}

function showHome() {
  counterScreen.classList.remove("active");
  homeScreen.classList.add("active");
}

function stepCount(amount) {
  const currentValue = Number(boatCount.value) || 0;
  boatCount.value = Math.max(0, currentValue + amount);
}

function renderCounter() {
  const latest = counts[0];
  boatCount.value = latest ? latest.value : 0;
  savedTotal.textContent = `${counts.length} saved`;

  historyList.innerHTML = counts.length
    ? counts
        .slice(0, 10)
        .map((count) => {
          const note = count.note ? `<p class="history-note">${escapeHtml(count.note)}</p>` : "";

          return `
            <article class="history-row">
              <p class="history-value">${count.value}</p>
              <div>
                <p class="muted">${escapeHtml(formatDate(count.timestamp))}</p>
                ${note}
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state"><p>No boat counts yet.</p></div>`;
}

function loadCounts() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCounts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
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
