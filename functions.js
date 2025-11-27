/* ==========================================================================
   ATLAS – Mobile-first logic (programs, schedule, log, history, settings)
   ========================================================================== */
"use strict";

/* ------------------------------ Small utilities --------------------------- */

console.log("Atlas functions.js loaded");

const StorageKeys = {
  settings: "settings",
  selectedProgram: "selectedProgram",
  userScheduleV2: "userSchedule_v2",
  workoutLogs: "workoutLogs",
  profileData: "profileData",
};

const store = {
  get(key, def = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  del(key) { localStorage.removeItem(key); }
};

const deepClone = (x) => JSON.parse(JSON.stringify(x));
const toISO = (d) => d.toLocaleDateString("en-CA");

// Today in local time, YYYY-MM-DD (same format as toISO)
const todayISO = () => toISO(new Date());


/* ----------------------------- Theme / Settings --------------------------- */
function getSettings() {
  return store.get(StorageKeys.settings, { units: "kg", theme: "auto", restTimerSec: 90 });
}
function saveSettings(s) { store.set(StorageKeys.settings, s); applyTheme(s.theme); }
function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === "auto") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", theme);
}
function unit() { return getSettings().units === "lb" ? "lb" : "kg"; }
function toDisplayKg(kg) { return unit() === "lb" ? +(kg * 2.20462).toFixed(1) : kg; }
function fromDisplayKg(v) { return unit() === "lb" ? +(v / 2.20462).toFixed(2) : v; }

/* ----------------------------- Icons / footer ----------------------------- */
function highlightActiveNav() {
  const page = detectPage();
  document.querySelectorAll("[data-page-link]").forEach((a) => {
    const active = a.getAttribute("data-page-link") === page;
    if (active) {
      a.classList.add("active");
      a.setAttribute("aria-current", "page");
      a.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else {
      a.classList.remove("active");
      a.removeAttribute("aria-current");
    }
  });
}
function syncFooterHeightVar() {
  const f = document.querySelector(".app-footer");
  if (!f) return;
  const h = f.getBoundingClientRect().height;
  document.documentElement.style.setProperty("--footer-h", h + "px");
}

/* ------------------------------ Program model ----------------------------- */
const ROTATIONS = {
  ppl: ["Push", "Pull", "Legs"],
  ul: ["Upper", "Lower"],
  fourDay: ["Chest+Shoulders", "Back+Rear Delts", "Arms", "Legs"],
};
const REST_LIMITS = { ppl: 2, ul: 2, fourDay: 3 };

// How many rest days the *default* generated schedule should use
const DEFAULT_REST = { ppl: 1, ul: 2, fourDay: 3 };

// --- Schedule v2 backing model (used by migrations, Programs, Log/History) ---
function buildDefaultScheduleV2(programKey) {
  const rotation = ROTATIONS[programKey] || ROTATIONS.ppl;
  const restLimit = REST_LIMITS[programKey] ?? 2;

  // Evenly distribute rest days across the week
  const restMask = new Array(7).fill(false);
  if (restLimit > 0) {
    const step = 7 / restLimit;
    const used = new Set();
    for (let i = 0; i < restLimit; i++) {
      let idx = Math.round(i * step) % 7;
      while (used.has(idx)) idx = (idx + 1) % 7;
      used.add(idx);
    }
    [...used].forEach((i) => (restMask[i] = true));
  }

  return {
    v: 2,
    meta: { program: programKey, updatedAt: new Date().toISOString() },
    rotation,
    restLimit,
    restMask,
    startOffset: 0,
    completed: [],
  };
}

function getScheduleV2(programKey) {
  let st = store.get(StorageKeys.userScheduleV2);
  if (!st || normalizeProgramKey(st.meta?.program) !== programKey) {
    st = buildDefaultScheduleV2(programKey);
    store.set(StorageKeys.userScheduleV2, st);
  }
  return st;
}

function saveScheduleV2(state) {
  state.meta.updatedAt = new Date().toISOString();
  store.set(StorageKeys.userScheduleV2, state);
}

function deriveWeekLabels(state) {
  const { rotation, restMask, startOffset } = state;
  const labs = new Array(7).fill("Rest");
  let k = 0;
  for (let i = 0; i < 7; i++) {
    if (restMask[i]) {
      labs[i] = "Rest";
    } else {
      labs[i] = rotation[(startOffset + k) % rotation.length];
      k++;
    }
  }
  return labs;
}



function normalizeProgramKey(x) {
  const s = String(x || "").trim().toLowerCase();
  if (s === "ppl" || /push.*pull.*legs/.test(s)) return "ppl";
  if (s === "ul" || /upper.*lower/.test(s)) return "ul";
  if (s === "4day" || s === "fourday" || /four.*day/.test(s)) return "fourDay";
  return s || "ppl";
}
function prettyProgramName(k) {
  return (
    { ppl: "Push • Pull • Legs", ul: "Upper / Lower", fourDay: "4-Day Split" }[k] || k
  );
}
function setSelectedProgram(key) {
  store.set(StorageKeys.selectedProgram, { key: normalizeProgramKey(key) });
}

/* ------------------------------ Snackbar ---------------------------------- */
const snack = (() => {
  let root, stackEl, timer = null;
  function ensureRoot() {
    if (root) return;
    root = document.createElement("div");
    root.className = "snackbar-wrap";
    root.setAttribute("aria-live", "polite");
    root.setAttribute("role", "status");
    stackEl = document.createElement("div");
    stackEl.className = "snackbar-stack";
    root.appendChild(stackEl);
    document.body.appendChild(root);
  }
  function makeNode(text, opts) {
    const tone = opts?.tone;
    const node = document.createElement("div");
    node.className = "snackbar";
    if (tone) node.classList.add(`snackbar--${tone}`);
    node.setAttribute("data-enter", "");

    const msg = document.createElement("div");
    msg.className = "snackbar__msg";
    msg.textContent = text;

    const actions = document.createElement("div");
    actions.className = "snackbar__actions";

    if (opts?.actionLabel && typeof opts.onAction === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "snackbar__btn";
      btn.textContent = opts.actionLabel;
      btn.addEventListener("click", () => {
        try { opts.onAction(); } finally { dismiss(node); }
      });
      actions.appendChild(btn);
    }

    node.appendChild(msg);
    node.appendChild(actions);
    return node;
  }
  function dismiss(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }
  function show(text, opts = {}) {
    ensureRoot();
    stackEl.innerHTML = "";
    const node = makeNode(text, opts);
    stackEl.appendChild(node);
    requestAnimationFrame(() => node.classList.add("is-in"));
    clearTimeout(timer);
    timer = setTimeout(() => dismiss(node), Math.max(1500, opts.ttl || 5000));
    try { navigator.vibrate?.(10); } catch { }
    return () => dismiss(node);
  }
  return { show };
})();
let __snackDispose = null;
function showToast(text, opts) {
  if (__snackDispose) __snackDispose();
  __snackDispose = snack.show(text, opts);
}
function hideToast() {
  if (__snackDispose) { __snackDispose(); __snackDispose = null; }
}

/* ------------------------------- Migrations ------------------------------- */
(function migrate() {
  const sel = store.get(StorageKeys.selectedProgram);
  if (sel?.key) store.set(StorageKeys.selectedProgram, { key: normalizeProgramKey(sel.key) });

  // Ensure schedule v2
  if (!store.get(StorageKeys.userScheduleV2)) {
    const programKey = normalizeProgramKey(
      store.get(StorageKeys.selectedProgram, { key: "ppl" }).key
    );
    store.set(StorageKeys.userScheduleV2, buildDefaultScheduleV2(programKey));
  }
})();

/* --------------------------------- Router -------------------------------- */
function detectPage() {
  if (document.querySelector("#programsRoot")) return "programs";
  if (document.querySelector("#scheduleRoot")) return "schedule";
  if (document.querySelector("#logRoot")) return "log";
  if (document.querySelector("#historyRoot")) return "history";
  if (document.querySelector("#settingsRoot")) return "settings";
  if (document.querySelector("#profileForm")) return "profile";
  if (document.querySelector("#trackerRoot")) return "tracker";
  return "";
}

/* ------------------------------- Programs -------------------------------- */
function initPrograms() {
  const root = document.getElementById("programsRoot"); if (!root) return;

  // Select buttons
  root.querySelectorAll(".program-card .select-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".program-card");
      const key =
        normalizeProgramKey(card?.dataset.programKey || card?.dataset.program);
      if (!ROTATIONS[key]) return;
      setSelectedProgram(key);
      store.set(StorageKeys.userScheduleV2, buildDefaultScheduleV2(key));
      showToast(`Selected ${prettyProgramName(key)}.`, {
        actionLabel: "Open Schedule",
        onAction: () => (location.href = "schedule.html"),
        ttl: 3500
      });
    });
  });

  // Carousel paging (one-swipe)
  const carousel = document.getElementById("programCarousel");
  const track = carousel?.querySelector(".track");
  const cards = track ? Array.from(track.children) : [];
  const dotsWrap = document.getElementById("programDots");

  if (carousel && track && dotsWrap && cards.length) {
    dotsWrap.innerHTML = "";
    cards.forEach((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      if (i === 0) b.classList.add("active");
      b.addEventListener("click", () => {
        carousel.scrollTo({ left: i * carousel.clientWidth, behavior: "smooth" });
        updateDots(i);
      });
      dotsWrap.appendChild(b);
    });

    let snapIndex = 0;
    function updateDots(idx) {
      dotsWrap.querySelectorAll("button")
        .forEach((d, i) => d.classList.toggle("active", i === idx));
    }
    function onScrollEnd() {
      const idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
      if (idx !== snapIndex) { snapIndex = idx; updateDots(idx); }
    }
    let t;
    carousel.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(onScrollEnd, 60); }, { passive: true });
    window.addEventListener("resize", onScrollEnd);
  }
}

/* ------------------------------- Schedule -------------------------------- */
/* ------------------------------- Schedule -------------------------------- */

// LocalStorage key for the flexible, per-day schedule (separate from v2 model)
const SCHEDULE_FLEX_KEY = "userSchedule_flex";

function initSchedule() {
  const root = document.getElementById("scheduleRoot");
  if (!root) return;

  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // --- Wire to *existing* selected program from Programs page ---
  const sel = store.get(StorageKeys.selectedProgram, { key: "ppl" });
  const programKey = normalizeProgramKey(sel?.key ?? sel ?? "ppl");
  const pattern = ROTATIONS[programKey] || ROTATIONS.ppl;
  const restLimit = REST_LIMITS[programKey] ?? 2;
  const defaultRestCount = DEFAULT_REST[programKey] ?? Math.min(restLimit, 2);

  const programInfo = document.getElementById("programInfo");
  const restCounter = document.getElementById("restCounter");
  const weekContainer = document.getElementById("weekContainer");
  const editProgramBtn = document.getElementById("editProgramBtn");
  const saveProgramBtn = document.getElementById("saveProgramBtn");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const resetDefaultBtn = document.getElementById("resetDefaultBtn");
  const resetProgressBtn = document.getElementById("resetProgressBtn");
  const modeBadge = document.getElementById("modeBadge");

  programInfo.textContent = `Program: ${prettyProgramName(programKey)}`;

  // ---------- helpers ----------
  function buildDefaultSlots(pat, restCount) {
    const slots = new Array(7);
    const restMask = new Array(7).fill(false);

    const rc = Math.max(0, Math.min(7, restCount || 0));
    if (rc > 0) {
      const used = new Set();
      const step = 7 / rc;
      for (let i = 0; i < rc; i++) {
        let idx = Math.round(i * step) % 7;
        while (used.has(idx)) idx = (idx + 1) % 7;
        used.add(idx);
      }
      [...used].forEach(i => (restMask[i] = true));
    }

    let k = 0;
    for (let i = 0; i < 7; i++) {
      if (restMask[i]) slots[i] = "Rest";
      else {
        slots[i] = pat[k % pat.length];
        k++;
      }
    }
    return slots;
  }

  function restIndicesFromSlots(slots) {
    const idxs = [];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === "Rest") idxs.push(i);
    }
    return idxs;
  }

  function countRests(slots) {
    return restIndicesFromSlots(slots).length;
  }

  function updateRestCounter() {
    restCounter.textContent = `Rest days: ${countRests(currentSlots)} / ${restLimit}`;
  }

  function loadSchedule() {
    const raw = store.get(SCHEDULE_FLEX_KEY, null);
    if (!raw || !raw.meta || normalizeProgramKey(raw.meta.program) !== programKey) {
      return {
        meta: { program: programKey, createdAt: new Date().toISOString() },
        slots: buildDefaultSlots(pattern, defaultRestCount),
        completed: new Array(7).fill(false),
      };
    }
    const slots = Array.isArray(raw.slots) && raw.slots.length === 7
      ? raw.slots.slice()
      : buildDefaultSlots(pattern, defaultRestCount);
    const completed = Array.isArray(raw.completed) && raw.completed.length === 7
      ? raw.completed.slice()
      : new Array(7).fill(false);

    return {
      meta: { program: programKey, createdAt: raw.meta.createdAt || new Date().toISOString() },
      slots, completed
    };
  }

  function saveSchedule() {
    const payload = {
      meta: { program: programKey, createdAt: scheduleState.meta.createdAt },
      slots: currentSlots.slice(),
      completed: completedFlags.slice(),
    };
    store.set(SCHEDULE_FLEX_KEY, payload);
  }

  // ---------- state ----------
  let scheduleState = loadSchedule();
  let currentSlots = scheduleState.slots.slice();
  let completedFlags = scheduleState.completed.slice();
  let isEditMode = false;

  // ---------- edit mode ----------
  function enterEditMode() {
    isEditMode = true;
    modeBadge?.classList.remove("hidden");
    editProgramBtn?.classList.add("hidden");
    saveProgramBtn?.classList.remove("hidden");
    cancelEditBtn?.classList.remove("hidden");
    renderWeek();
  }

  function exitEditMode(saveChanges = false) {
    if (saveChanges) {
      saveSchedule();
      scheduleState = loadSchedule(); // reload normalized
      currentSlots = scheduleState.slots.slice();
      completedFlags = scheduleState.completed.slice();
    } else {
      // discard changes – reload from storage
      scheduleState = loadSchedule();
      currentSlots = scheduleState.slots.slice();
      completedFlags = scheduleState.completed.slice();
    }
    isEditMode = false;
    modeBadge?.classList.add("hidden");
    editProgramBtn?.classList.remove("hidden");
    saveProgramBtn?.classList.add("hidden");
    cancelEditBtn?.classList.add("hidden");
    renderWeek();
    updateRestCounter();
  }

  // ---------- per-day actions ----------
  function toggleRestDay(index) {
    const isRest = currentSlots[index] === "Rest";
    let restIdx = restIndicesFromSlots(currentSlots);

    if (isRest) {
      // turn Rest -> pattern slot (keep sequence simple: based on index)
      currentSlots[index] = pattern[index % pattern.length];
    } else {
      // try to add a rest day, respect restLimit by kicking out oldest
      if (restIdx.length >= restLimit) {
        const oldest = restIdx.shift();
        currentSlots[oldest] = pattern[oldest % pattern.length];
      }
      currentSlots[index] = "Rest";
    }

    updateRestCounter();
    renderWeek();
  }

  function openSlotDropdown(cardEl, index) {
    const select = document.createElement("select");
    select.className = "dropdown-inline";

    const uniqueOpts = Array.from(new Set([...pattern, "Rest"]));
    uniqueOpts.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (currentSlots[index] === opt) o.selected = true;
      select.appendChild(o);
    });

    const slotLabelEl = cardEl.querySelector(".slot-label");
    const originalText = slotLabelEl?.textContent || "";
    slotLabelEl?.replaceWith(select);
    select.focus();

    function closeAndApply(apply = true) {
      if (apply) {
        const chosen = select.value;
        if (chosen === "Rest") {
          if (currentSlots[index] !== "Rest") {
            let restIdx = restIndicesFromSlots(currentSlots);
            if (restIdx.length >= restLimit) {
              const oldest = restIdx.shift();
              currentSlots[oldest] = pattern[oldest % pattern.length];
            }
            currentSlots[index] = "Rest";
          }
        } else {
          currentSlots[index] = chosen;
        }
      }

      const parent = select.parentNode;
      if (parent) {
        const label = document.createElement("div");
        label.className = "slot-label";
        label.textContent = apply ? currentSlots[index] : originalText;
        select.replaceWith(label);
      }

      updateRestCounter();
      renderWeek();
    }

    select.addEventListener("change", () => closeAndApply(true));
    select.addEventListener("blur", () => closeAndApply(true));
    select.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        closeAndApply(false);
      }
    });
  }

  function toggleComplete(index) {
    completedFlags[index] = !completedFlags[index];
    saveSchedule();
    renderWeek();
  }

  // ---------- drag & drop ----------
  function enableDragAndDrop() {
    const cards = weekContainer.querySelectorAll(".day-card");
    let draggedEl = null;
    let draggedIndex = null;

    cards.forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        if (!isEditMode) { e.preventDefault(); return; }
        draggedEl = card;
        draggedIndex = Number(card.dataset.index);
        card.classList.add("dragging");
        try { e.dataTransfer.setData("text/plain", String(draggedIndex)); } catch (err) { }
        e.dataTransfer.effectAllowed = "move";
      });

      card.addEventListener("dragover", (e) => {
        if (!isEditMode) return;
        e.preventDefault();
        if (!draggedEl || draggedEl === card) return;
        const bounding = card.getBoundingClientRect();
        const offset = bounding.y + bounding.height / 2;
        const after = (e.clientY - offset) > 0;
        if (after) card.parentNode.insertBefore(draggedEl, card.nextSibling);
        else card.parentNode.insertBefore(draggedEl, card);
      });

      card.addEventListener("dragend", () => {
        if (!draggedEl) return;
        draggedEl.classList.remove("dragging");
        const newOrderIndices = Array.from(
          weekContainer.querySelectorAll(".day-card")
        ).map((c) => Number(c.dataset.index));

        currentSlots = newOrderIndices.map((i) => currentSlots[i]);
        completedFlags = newOrderIndices.map((i) => completedFlags[i]);

        const cardsNow = weekContainer.querySelectorAll(".day-card");
        cardsNow.forEach((c, pos) => (c.dataset.index = String(pos)));

        draggedEl = null;
        draggedIndex = null;
        renderWeek();
      });
    });
  }


  // (Optional) touch drag similar to example – can be wired if you want later.

  // ---------- render ----------
  function renderWeek() {
    weekContainer.innerHTML = "";
    updateRestCounter();

    for (let i = 0; i < 7; i++) {
      const name = DAY_NAMES[i];
      const slot = currentSlots[i];

      const card = document.createElement("div");
      card.className = "day-card";
      card.dataset.index = String(i);
      card.setAttribute("draggable", isEditMode ? "true" : "false");
      if (slot === "Rest") card.classList.add("rest-style");
      if (completedFlags[i]) card.classList.add("complete");

      // LEFT SIDE: drag handle + day name
      const left = document.createElement("div");
      left.className = "day-left";

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      handle.style.display = isEditMode ? "inline-block" : "none";

      const dayName = document.createElement("div");
      dayName.className = "day-name";
      dayName.textContent = name;

      left.appendChild(handle);
      left.appendChild(dayName);

      // RIGHT SIDE: specific workout (Push/Pull/Legs/Rest) + check icon
      const right = document.createElement("div");
      right.className = "day-right";

      const slotLabel = document.createElement("div");
      slotLabel.className = "slot-label";
      slotLabel.textContent = slot; // show the actual plan for that day

      const statusIcon = document.createElement("div");
      statusIcon.className = "status-icon"; // styled via CSS; ✓ shown when .complete

      right.appendChild(slotLabel);
      right.appendChild(statusIcon);

      card.appendChild(left);
      card.appendChild(right);

      // Click / tap behaviour
      card.addEventListener("click", (ev) => {
        const idx = Number(card.dataset.index);
        if (isEditMode) {
          const target = ev.target;
          if (
            target.classList.contains("slot-label") ||
            target.classList.contains("day-name") ||
            target === handle
          ) {
            openSlotDropdown(card, idx);
          }
        } else {
          // normal mode: toggle completion -> adds/removes .complete
          toggleComplete(idx);
        }
      });

      // Double-click: toggle rest (only in edit)
      card.addEventListener("dblclick", () => {
        if (!isEditMode) return;
        const idx = Number(card.dataset.index);
        toggleRestDay(idx);
      });

      // Double-tap on touch: toggle rest (only in edit)
      let lastTap = 0;
      card.addEventListener("touchend", (e) => {
        if (!isEditMode) return;
        const now = Date.now();
        const tapLength = now - lastTap;
        if (tapLength > 0 && tapLength < 400) {
          const idx = Number(card.dataset.index);
          toggleRestDay(idx);
          e.preventDefault();
        }
        lastTap = now;
      });

      weekContainer.appendChild(card);
    }

    if (isEditMode) {
      // desktop drag
      enableDragAndDrop();
      // if you later add a touch-drag helper, call it here too
      // enableMobileDragAndDrop();
    }
  }


  // ---------- buttons ----------
  editProgramBtn?.addEventListener("click", () => enterEditMode());

  cancelEditBtn?.addEventListener("click", () => {
    if (confirm("Discard changes since entering edit mode?")) {
      exitEditMode(false);
    }
  });

  saveProgramBtn?.addEventListener("click", () => {
    saveSchedule();
    exitEditMode(true);
    showToast("Schedule saved.");
  });

  resetDefaultBtn?.addEventListener("click", () => {
    if (!confirm("Reset schedule to default for this program? This also clears progress.")) return;
    currentSlots = buildDefaultSlots(pattern, defaultRestCount);
    completedFlags = new Array(7).fill(false);
    saveSchedule();
    renderWeek();
    updateRestCounter();
  });

  resetProgressBtn?.addEventListener("click", () => {
    if (!confirm("Reset this week’s workout progress?")) return;
    completedFlags = new Array(7).fill(false);
    saveSchedule();
    renderWeek();
  });

  // ---------- initial render ----------
  renderWeek();
  updateRestCounter();
}


/* ---------------------------------- Log ---------------------------------- */
function initLog() {
  const root = document.getElementById("logRoot"); if (!root) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const programBadge = $("#programBadge");
  const dateInput = $("#logDate");
  const planSelect = $("#planSelect");
  const exerciseList = $("#exerciseList");
  const tplExercise = $("#exercise-template");
  const tplSet = $("#set-row-template");
  const loadPlanBtn = $("#loadPlanBtn");
  const addExerciseBtn = $("#addExerciseBtn");
  const saveBtn = $("#saveLogBtn");
  const clearBtn = $("#clearLogBtn");
  const msg = $("#logMessage");
  const volumeTotal = $("#volumeTotal");
  const restBanner = $("#restBanner");

  const sel = store.get(StorageKeys.selectedProgram, { key: "ppl" });
  const programKey = normalizeProgramKey(sel?.key ?? sel);
  programBadge.textContent = `Program: ${prettyProgramName(programKey)}`;
  root.querySelectorAll(".unit-weight").forEach((s) => (s.textContent = unit()));

  const pattern = ROTATIONS[programKey] || [];
  planSelect.innerHTML =
    '<option value="">(from schedule)</option>' +
    pattern.map((p) => `<option value="${p}">${p}</option>`).join("");
  dateInput.value = todayISO();

  const PROGRAM_TEMPLATES = {
    ppl: {
      Push: [
        { name: "Barbell Bench Press", sets: 3, reps: 8 },
        { name: "Overhead Press", sets: 3, reps: 8 },
        { name: "Incline DB Press", sets: 3, reps: 10 },
        { name: "Triceps Pushdown", sets: 3, reps: 12 }
      ],
      Pull: [
        { name: "Deadlift", sets: 3, reps: 5 },
        { name: "Barbell Row", sets: 3, reps: 8 },
        { name: "Lat Pulldown", sets: 3, reps: 10 },
        { name: "DB Curl", sets: 3, reps: 12 }
      ],
      Legs: [
        { name: "Back Squat", sets: 3, reps: 5 },
        { name: "Leg Press", sets: 3, reps: 10 },
        { name: "Leg Curl", sets: 3, reps: 12 },
        { name: "Calf Raise", sets: 3, reps: 15 }
      ]
    },
    ul: {
      Upper: [
        { name: "Bench Press", sets: 3, reps: 8 },
        { name: "Row", sets: 3, reps: 8 },
        { name: "Shoulder Press", sets: 3, reps: 10 },
        { name: "Lat Pulldown", sets: 3, reps: 10 }
      ],
      Lower: [
        { name: "Squat", sets: 3, reps: 5 },
        { name: "Romanian Deadlift", sets: 3, reps: 8 },
        { name: "Leg Press", sets: 3, reps: 10 },
        { name: "Calf Raise", sets: 3, reps: 15 }
      ]
    },
    fourDay: {
      "Chest+Shoulders": [
        { name: "Bench Press", sets: 3, reps: 8 },
        { name: "Incline DB Press", sets: 3, reps: 10 },
        { name: "Overhead Press", sets: 3, reps: 8 }
      ],
      "Back+Rear Delts": [
        { name: "Barbell Row", sets: 3, reps: 8 },
        { name: "Lat Pulldown", sets: 3, reps: 10 },
        { name: "Face Pull", sets: 3, reps: 12 }
      ],
      Arms: [
        { name: "Barbell Curl", sets: 3, reps: 10 },
        { name: "Triceps Pushdown", sets: 3, reps: 12 },
        { name: "Hammer Curl", sets: 3, reps: 10 }
      ],
      Legs: [
        { name: "Back Squat", sets: 3, reps: 5 },
        { name: "Leg Press", sets: 3, reps: 10 },
        { name: "Leg Curl", sets: 3, reps: 12 }
      ]
    }
  };

  function toast(t) { msg.textContent = t; setTimeout(() => { if (msg.textContent === t) msg.textContent = ""; }, 2000); }

  function mondayIndex(dstr) {
    const d = new Date(dstr + "T00:00:00");
    return (d.getDay() + 6) % 7;
  }
  function inferPlanFromSchedule(dateStr) {
    const st = store.get(StorageKeys.userScheduleV2, null);
    if (!st || normalizeProgramKey(st.meta?.program) !== programKey) return "";
    const idx = mondayIndex(dateStr);
    const labs = deriveWeekLabels(st);
    const lab = labs[idx];
    return !lab || lab === "Rest" ? "" : lab;
  }

  function hasContent() {
    if (!exerciseList.firstElementChild) return false;
    return $$(".exercise-card").some((card) => {
      if ($(".exercise-name", card).value.trim()) return true;
      return $$(".set-row", card).some((row) => {
        const w = parseFloat($(".set-weight", row).value) || 0;
        const r = parseInt($(".set-reps", row).value, 10) || 0;
        return w > 0 || r > 0;
      });
    });
  }
  function updateSaveEnabled() {
    const inferred = planSelect.value || inferPlanFromSchedule(dateInput.value) || "";
    saveBtn.disabled = (!hasContent() && !inferred);
  }

  function buildFromTemplate(plan) {
    exerciseList.innerHTML = "";
    const templ = (PROGRAM_TEMPLATES[programKey] || {})[plan] || [];
    templ.forEach((ex) => addExercise(ex));
    updateTotals();
  }
  function addExercise(ex) {
    const node = tplExercise.content.firstElementChild.cloneNode(true);
    const nameInput = node.querySelector(".exercise-name");
    const setTBody = node.querySelector(".set-list");
    const addBtn = node.querySelector(".add-set-btn");
    const rmExBtn = node.querySelector(".remove-exercise-btn");

    nameInput.value = ex.name || "";
    const setCount = Math.max(1, ex.sets || 1);
    for (let i = 0; i < setCount; i++) addSetRow(setTBody, ex.reps || 0, 0);
    renumber(setTBody);

    addBtn.addEventListener("click", () => { addSetRow(setTBody, 0, 0); renumber(setTBody); updateTotals(); updateSaveEnabled(); });
    rmExBtn.addEventListener("click", () => { node.remove(); updateTotals(); updateSaveEnabled(); });

    exerciseList.appendChild(node);
  }
  function addSetRow(tbody, repsVal, weightKg) {
    const row = tplSet.content.firstElementChild.cloneNode(true);
    const reps = row.querySelector(".set-reps");
    const weight = row.querySelector(".set-weight");
    const rmBtn = row.querySelector(".remove-set-btn");

    reps.value = repsVal ?? 0;
    weight.value = toDisplayKg(weightKg ?? 0);
    rmBtn.addEventListener("click", () => { row.remove(); renumber(tbody); updateTotals(); updateSaveEnabled(); });

    tbody.appendChild(row);
  }
  function renumber(tbody) {
    [...tbody.querySelectorAll(".set-index")].forEach((td, i) => (td.textContent = i + 1));
  }
  function updateTotals() {
    let volKg = 0;
    $$(".exercise-card").forEach((card) =>
      $$(".set-row", card).forEach((row) => {
        const wDisp = parseFloat(row.querySelector(".set-weight").value) || 0;
        const wKg = fromDisplayKg(wDisp);
        const r = parseInt(row.querySelector(".set-reps").value, 10) || 0;
        volKg += wKg * r;
      })
    );
    volumeTotal.textContent = Math.round(toDisplayKg(volKg));
  }
  function collectCurrent() {
    const date = dateInput.value;
    const plan = (planSelect.value || inferPlanFromSchedule(date) || "").trim();
    const exercises = $$(".exercise-card").map((card) => {
      const name = card.querySelector(".exercise-name").value.trim();
      const sets = $$(".set-row", card).map((row) => ({
        weight: fromDisplayKg(parseFloat(row.querySelector(".set-weight").value) || 0),
        reps: parseInt(row.querySelector(".set-reps").value, 10) || 0
      }));
      return { name, sets };
    });
    const volume = exercises.reduce(
      (acc, ex) => acc + ex.sets.reduce((s, st) => s + st.weight * st.reps, 0),
      0
    );
    return { date, program: programKey, plan: plan || null, exercises, volume };
  }
  function saveCurrentLog() {
    const logs = store.get(StorageKeys.workoutLogs, {});
    const cur = collectCurrent();
    logs[cur.date] = cur;
    store.set(StorageKeys.workoutLogs, logs);
    updateTotals();
    toast("Saved.");
  }
  function loadLogForDate(dstr) {
    const logs = store.get(StorageKeys.workoutLogs, {});
    const ex = logs[dstr];
    exerciseList.innerHTML = "";
    restBanner?.classList.add("hidden");

    if (ex && normalizeProgramKey(ex.program) === programKey) {
      (ex.exercises || [{ name: "", sets: [{ reps: 0, weight: 0 }] }]).forEach((e) => {
        const node = tplExercise.content.firstElementChild.cloneNode(true);
        const nameInput = node.querySelector(".exercise-name");
        const setTBody = node.querySelector(".set-list");
        const addBtn = node.querySelector(".add-set-btn");
        const rmExBtn = node.querySelector(".remove-exercise-btn");

        nameInput.value = e.name || "";
        (e.sets || [{ reps: 0, weight: 0 }]).forEach((st) => addSetRow(setTBody, st.reps || 0, st.weight || 0));
        renumber(setTBody);

        addBtn.addEventListener("click", () => { addSetRow(setTBody, 0, 0); renumber(setTBody); updateTotals(); updateSaveEnabled(); });
        rmExBtn.addEventListener("click", () => { node.remove(); updateTotals(); updateSaveEnabled(); });

        exerciseList.appendChild(node);
      });
      planSelect.value = ex.plan && pattern.includes(ex.plan) ? ex.plan : "";
      updateTotals(); toast("Loaded saved log."); updateSaveEnabled(); return;
    }

    const inferred = inferPlanFromSchedule(dstr);
    planSelect.value = pattern.includes(inferred) ? inferred : "";
    exerciseList.innerHTML = "";
    updateTotals();
    if (!planSelect.value) restBanner?.classList.remove("hidden");
    else buildFromTemplate(planSelect.value);
    updateSaveEnabled();
  }

  dateInput.addEventListener("change", () => loadLogForDate(dateInput.value));
  planSelect.addEventListener("change", () => {
    if (planSelect.value) {
      restBanner?.classList.add("hidden");
      if (hasContent() && !confirm("Replace current entries with the selected plan? Unsaved inputs will be lost.")) return;
      buildFromTemplate(planSelect.value); toast(`Loaded plan: ${planSelect.value}`);
    }
    updateSaveEnabled();
  });
  loadPlanBtn.addEventListener("click", () => {
    const pl = planSelect.value || inferPlanFromSchedule(dateInput.value);
    if (!pl) { toast("No plan for this date. Add exercises manually."); return; }
    if (hasContent() && !confirm("Replace current entries with the selected plan? Unsaved inputs will be lost.")) return;
    restBanner?.classList.add("hidden");
    buildFromTemplate(pl);
    toast(`Loaded plan: ${pl}`);
    updateSaveEnabled();
  });
  addExerciseBtn.addEventListener("click", () => { addExercise({ name: "", sets: 1, reps: 0 }); toast("Exercise added."); updateSaveEnabled(); });
  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear current log on screen?")) return;
    exerciseList.innerHTML = ""; updateTotals(); updateSaveEnabled(); toast("Cleared (unsaved).");
  });
  saveBtn.addEventListener("click", saveCurrentLog);
  exerciseList.addEventListener("input", () => { updateTotals(); updateSaveEnabled(); });

  loadLogForDate(dateInput.value);
}

/* -------------------------------- History -------------------------------- */
function initHistory() {
  const root = document.getElementById("historyRoot"); if (!root) return;
  const $ = (s, r = document) => r.querySelector(s);

  const weekStart = $("#weekStart");
  const prevWeekBtn = $("#prevWeekBtn");
  const nextWeekBtn = $("#nextWeekBtn");
  const exportWeekBtn = $("#exportWeekBtn");
  const exportAllBtn = $("#exportAllBtn");
  const kpiSessions = $("#kpiSessions");
  const kpiVolume = $("#kpiVolume");
  const kpiAvgSets = $("#kpiAvgSets");
  const weekTBody = $("#weekTableBody");
  const tplRow = $("#week-row-template");
  const prList = $("#prList");
  const prTpl = $("#pr-item-template");
  const msg = $("#historyMsg");

  // en-CA = "YYYY-MM-DD" in your *local* timezone
  const toISO = (d) => d.toLocaleDateString("en-CA");




  const startOfWeek = (d) => {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const wd = (c.getDay() + 6) % 7; c.setDate(c.getDate() - wd); return c;
  };
  const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };

  weekStart.value = toISO(startOfWeek(new Date()));
  weekStart.addEventListener("change", renderWeek);
  prevWeekBtn.addEventListener("click", () => { weekStart.value = toISO(addDays(new Date(weekStart.value), -7)); renderWeek(); });
  nextWeekBtn.addEventListener("click", () => { weekStart.value = toISO(addDays(new Date(weekStart.value), 7)); renderWeek(); });

  exportWeekBtn.addEventListener("click", () => { const csv = buildCSV(getWeekLogs()); downloadCSV(csv, `atlas_week_${weekStart.value}.csv`); });
  exportAllBtn.addEventListener("click", () => {
    const logs = store.get(StorageKeys.workoutLogs, {});
    const all = Object.keys(logs).sort().map((k) => logs[k]);
    const csv = buildCSV(all);
    downloadCSV(csv, "atlas_all_history.csv");
  });

  function getWeekLogs() {
    const logs = store.get(StorageKeys.workoutLogs, {});
    const start = new Date(weekStart.value + "T00:00:00");
    const days = [...Array(7)].map((_, i) => toISO(addDays(start, i)));
    return days.map((d) => logs[d]).filter((v) => v && v.exercises && Array.isArray(v.exercises));
  }

  function renderWeek() {
    const weekLogs = getWeekLogs(); weekTBody.innerHTML = ""; prList.innerHTML = "";
    const sessions = weekLogs.length;
    const volumeKg = weekLogs.reduce((s, l) => s + (l.volume || 0), 0);
    const totalSets = weekLogs.reduce((s, l) => s + l.exercises.reduce((a, e) => a + e.sets.length, 0), 0);
    const avgSets = sessions ? totalSets / sessions : 0;

    kpiSessions.textContent = sessions;
    kpiVolume.textContent = Math.round(toDisplayKg(volumeKg));
    kpiAvgSets.textContent = avgSets.toFixed(1);

    for (const sess of weekLogs.sort((a, b) => a.date.localeCompare(b.date))) {
      const tr = tplRow.content.firstElementChild.cloneNode(true);
      tr.querySelector(".sess-date").textContent = sess.date.slice(5);
      tr.querySelector(".sess-plan").textContent = sess.plan || "—";
      tr.querySelector(".sess-vol").textContent = Math.round(toDisplayKg(sess.volume || 0)).toString();
      weekTBody.appendChild(tr);
    }

    const allLogs = store.get(StorageKeys.workoutLogs, {});
    const bests = computePRs(Object.values(allLogs));
    const prsThisWeek = [];

    for (const l of weekLogs) {
      for (const e of l.exercises) {
        const exBest = bests[e.name]; if (!exBest) continue;
        const sessBest = bestOfExercise([l], e.name);
        if (sessBest && Math.abs(sessBest.score - exBest.score) < 1e-6) {
          prsThisWeek.push({ name: e.name, label: exBest.label });
        }
      }
    }

    if (prsThisWeek.length) {
      prsThisWeek.forEach((pr) => {
        const node = prTpl.content.firstElementChild.cloneNode(true);
        node.querySelector(".pr-exercise").textContent = pr.name;
        node.querySelector(".pr-metric").textContent = pr.label;
        prList.appendChild(node);
      });
    } else {
      prList.textContent = "No new records this week.";
    }

    msg.textContent = weekLogs.length ? "" : "No sessions logged for this week.";
  }

  const epley1RM = (w, r) => w * (1 + r / 30);
  function bestOfExercise(logsArr, name) {
    let best = null;
    for (const l of logsArr) {
      for (const e of (l?.exercises || [])) {
        if (e.name !== name) continue;
        for (const s of (e.sets || [])) {
          const wt = +s.weight || 0; const rp = +s.reps || 0;
          if (wt <= 0 || rp <= 0) continue;
          const score = epley1RM(wt, rp);
          if (!best || score > best.score) best = { score, weight: wt, reps: rp, date: l.date };
        }
      }
    }
    if (!best) return null;
    // Display label in current unit
    const display1RM = Math.round(toDisplayKg(best.score));
    const displayWeight = Math.round(toDisplayKg(best.weight));
    const u = unit();
    const label = `1RM≈ ${display1RM} ${u} (best set ${displayWeight}×${best.reps})`;
    return { ...best, label };
  }
  function computePRs(all) {
    const map = {};
    for (const l of all) {
      for (const e of (l?.exercises || [])) {
        const cur = bestOfExercise([l], e.name);
        if (!cur) continue;
        if (!map[e.name] || cur.score > map[e.name].score) map[e.name] = cur;
      }
    }
    return map;
  }
  function buildCSV(arr) {
    const rows = [["date", "program", "plan", "exercise", "set_index", "weight_kg", "reps", "session_volume_kg"]];
    for (const l of arr) {
      const vol = Math.round(l.volume || 0);
      for (const e of l.exercises) {
        (e.sets || []).forEach((s, i) =>
          rows.push([l.date, l.program, l.plan || "", e.name, i + 1, Number(s.weight) || 0, Number(s.reps) || 0, vol])
        );
      }
      if (!l.exercises.length) rows.push([l.date, l.program, l.plan || "", "", "", "", "", vol]);
    }
    return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  }
  function downloadCSV(csv, name) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  renderWeek();
}

/* -------------------------------- Settings -------------------------------- */
function initSettings() {
  const root = document.getElementById("settingsRoot"); if (!root) return;
  const $ = (s) => root.querySelector(s), msg = document.getElementById("settingsMsg");

  const unitsSelect = $("#unitsSelect");
  const themeSelect = $("#themeSelect");
  const timerInput = $("#timerInput");
  const saveBtn = $("#saveSettingsBtn");
  const resetBtn = $("#resetSettingsBtn");
  const exportBtn = $("#exportJsonBtn");
  const importInput = $("#importJsonInput");
  const clearBtn = $("#clearDataBtn");

  const s = getSettings();
  unitsSelect.value = s.units || "kg";
  themeSelect.value = s.theme || "auto";
  timerInput.value = s.restTimerSec ?? 90;
  applyTheme(s.theme);

  saveBtn.addEventListener("click", () => {
    const next = {
      units: (unitsSelect.value === "lb") ? "lb" : "kg",
      theme: (["auto", "light", "dark"].includes(themeSelect.value) ? themeSelect.value : "auto"),
      restTimerSec: Math.max(10, parseInt(timerInput.value, 10) || 90)
    };
    saveSettings(next); toast("Settings saved.");
  });
  resetBtn.addEventListener("click", () => {
    unitsSelect.value = "kg"; themeSelect.value = "auto"; timerInput.value = 90;
    saveSettings({ units: "kg", theme: "auto", restTimerSec: 90 }); toast("Settings reset.");
  });
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportBackup(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "atlas-backup.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      importBackup(data);
      const s2 = getSettings();
      unitsSelect.value = s2.units || "kg";
      themeSelect.value = s2.theme || "auto";
      timerInput.value = s2.restTimerSec ?? 90;
      toast("Backup imported.");
    } catch {
      toast("Import failed.");
    } finally {
      importInput.value = "";
    }
  });
  clearBtn.addEventListener("click", () => {
    if (!confirm("This will delete your profile, schedule, logs, and settings. Continue?")) return;
    [StorageKeys.profileData, StorageKeys.selectedProgram, "userSchedule", StorageKeys.userScheduleV2, StorageKeys.workoutLogs, StorageKeys.settings].forEach((k) => store.del(k));
    toast("All data cleared.");
  });

  function toast(t) { msg.textContent = t; setTimeout(() => { if (msg.textContent === t) msg.textContent = ""; }, 2000); }
}
function exportBackup() {
  const safe = (k) => store.get(k, null);
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    profileData: safe(StorageKeys.profileData),
    selectedProgram: safe(StorageKeys.selectedProgram),
    userSchedule_v2: safe(StorageKeys.userScheduleV2),
    workoutLogs: safe(StorageKeys.workoutLogs),
    settings: safe(StorageKeys.settings)
  };
}
function importBackup(d) {
  if (!d || typeof d !== "object") throw new Error("bad data");
  const set = (k, v) => store.set(k, v);
  if ("profileData" in d) set(StorageKeys.profileData, d.profileData);
  if ("selectedProgram" in d) set(StorageKeys.selectedProgram, d.selectedProgram);
  if ("userSchedule_v2" in d) set(StorageKeys.userScheduleV2, d.userSchedule_v2);
  else if ("userSchedule" in d) set("userSchedule", d.userSchedule);
  if ("workoutLogs" in d) set(StorageKeys.workoutLogs, d.workoutLogs);
  if ("settings" in d) set(StorageKeys.settings, d.settings);
  if (d.settings?.theme) applyTheme(d.settings.theme);
}

/* ----------------------------- Profile / Tracker -------------------------- */
function initProfile() {
  const form = document.getElementById("profileForm"); if (!form) return;
  const msg = document.getElementById("profileMsg");
  const data = store.get(StorageKeys.profileData, {});

  [...form.elements].forEach((el) => {
    if (!el.name) return;
    if (el.type === "checkbox") el.checked = !!data[el.name];
    else if (el.type === "radio") el.checked = data[el.name] === el.value;
    else el.value = data[el.name] ?? "";
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const out = {};
    [...form.elements].forEach((el) => {
      if (!el.name) return;
      if (el.type === "checkbox") out[el.name] = el.checked;
      else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    store.set(StorageKeys.profileData, out);
    msg.textContent = "Saved.";
    setTimeout(() => (msg.textContent = ""), 1500);
  });
}

function initTracker() {
  const root = document.getElementById("trackerRoot"); if (!root) return;
  const $ = (s) => root.querySelector(s);

  const dateIn = $("#trkDate");
  const goalTop = $("#goalKcal"); const goalInline = $("#calGoalInline");
  const ringCal = $("#ringCal"), ringP = $("#ringP"), ringF = $("#ringF"), ringC = $("#ringC");
  const calTotal = $("#calTotal"), kcalTotalCell = $("#kcalTotalCell");
  const pNowEl = $("#pNow"), fNowEl = $("#fNow"), cNowEl = $("#cNow");
  const pGoalEl = $("#pGoal"), fGoalEl = $("#fGoal"), cGoalEl = $("#cGoal");
  const pTotCell = $("#pTotalCell"), fTotCell = $("#fTotalCell"), cTotCell = $("#cTotalCell");
  const foodInput = $("#foodInput"), gramsInput = $("#gramsInput"), hint = $("#foodHint");
  const addBtn = $("#addCaloriesBtn"), undoBtn = $("#undoCaloriesBtn");
  const listTBody = $("#foodList"); const rowTpl = document.getElementById("food-row-template");
  const datalist = root.querySelector("#foodDatalist");

  /* ---------- Helpers ---------- */
  dateIn.value = todayISO();
  const key = (d) => `calorie_${d}`;
  const getDay = (d) => store.get(key(d), { items: [] });
  const saveDay = (d, x) => store.set(key(d), x);

  const prof = store.get(StorageKeys.profileData, {});
  const kg = parseFloat(prof.bodyweight) || 0;
  const cm = parseFloat(prof.height) || 0;
  const age = parseInt(prof.age, 10) || 0;
  const sex = (prof.gender || "").toLowerCase();
  const goal = (prof.goal || "").toLowerCase();

  // Maintenance (profile-only): Mifflin-St Jeor BMR × 1.2 (sedentary baseline)
  function bmr() {
    if (!kg || !cm || !age || !sex) return null;
    const base = (sex === "male")
      ? (10 * kg + 6.25 * cm - 5 * age + 5)
      : (10 * kg + 6.25 * cm - 5 * age - 161);
    return base * 1.2;
  }
  function calorieGoal() {
    const maint = bmr();
    let tgt = maint ? Math.round(maint) : 2500;
    if (goal === "weight_loss") tgt = Math.round(tgt * 0.85);
    else if (goal === "strength_gain") tgt = Math.round(tgt * 1.15);
    return Math.max(1000, tgt);
  }
  function macroTargets(kcalTarget) {
    const proteinG = kg ? Math.max(0, +(1.8 * kg).toFixed(0)) : 0;
    const fatG = kg ? Math.max(0, +(0.8 * kg).toFixed(0)) : 0;
    const kcalFromPF = proteinG * 4 + fatG * 9;
    const carbsG = Math.max(0, Math.round((kcalTarget - kcalFromPF) / 4));
    return { proteinG, fatG, carbsG };
  }
  function ringColor(frac) {
    if (frac <= 0.70) return "var(--success)";
    if (frac <= 0.90) return "var(--warn)";
    return "var(--danger)";
  }
  function setRing(node, now, goalVal) {
    const pct = goalVal > 0 ? Math.min(100, (now / goalVal) * 100) : 0;
    node.style.setProperty("--pct", pct.toFixed(2));
    node.style.setProperty("--col", ringColor(pct / 100));
  }

  /* ---------- Food DB (per 100g) ---------- */
  const FOOD = [
    { n: "Banana", kcal: 89, p: 1.1, f: 0.3, c: 23 },
    { n: "Apple", kcal: 52, p: 0.3, f: 0.2, c: 14 },
    { n: "Oats", kcal: 389, p: 16.9, f: 6.9, c: 66.3 },
    { n: "White Rice (cooked)", kcal: 130, p: 2.4, f: 0.3, c: 28.2 },
    { n: "Pasta (cooked)", kcal: 155, p: 5.8, f: 0.9, c: 30.9 },
    { n: "Chicken Breast (raw)", kcal: 165, p: 31, f: 3.6, c: 0 },
    { n: "Salmon (raw)", kcal: 208, p: 20, f: 13, c: 0 },
    { n: "Beef 10% (raw)", kcal: 217, p: 26, f: 12, c: 0 },
    { n: "Egg", kcal: 155, p: 13, f: 11, c: 1.1 },
    { n: "Milk (1.5%)", kcal: 46, p: 3.3, f: 1.5, c: 4.8 },
    { n: "Greek Yogurt (2%)", kcal: 73, p: 9.9, f: 2, c: 3.9 },
    { n: "Olive Oil", kcal: 884, p: 0, f: 100, c: 0 },
    { n: "Butter", kcal: 717, p: 0.9, f: 81, c: 0.1 },
    { n: "Peanut Butter", kcal: 588, p: 25, f: 50, c: 20 },
    { n: "Broccoli", kcal: 34, p: 2.8, f: 0.4, c: 7 }
  ];
  function matchFoods(q) {
    const s = (q || "").trim().toLowerCase();
    if (!s) return FOOD.slice(0, 10);
    return FOOD
      .filter((x) => {
        const name = x.n.toLowerCase();
        return name.startsWith(s) || name.includes(s);
      })
      .slice(0, 10);
  }
  function refreshDatalist() {
    const opts = matchFoods(foodInput.value);
    datalist.innerHTML = opts.map((x) => `<option value="${x.n}">${x.n}</option>`).join("");
    // hint line for exact hit
    const exact = FOOD.find((f) => f.n.toLowerCase() === foodInput.value.trim().toLowerCase());
    if (exact) {
      hint.textContent = `Selected: ${exact.n} – ${exact.kcal} kcal / 100g  (P:${exact.p} F:${exact.f} C:${exact.c})`;
    } else {
      hint.textContent = "No food selected";
    }
  }

  /* ---------- Render ---------- */
  let goalKcal = calorieGoal();
  let targets = macroTargets(goalKcal);

  function totalsOf(day) {
    let kc = 0, p = 0, f = 0, c = 0;
    for (const it of (day.items || [])) {
      kc += it.kcal || 0; p += it.p || 0; f += it.f || 0; c += it.c || 0;
    }
    return { kc: Math.round(kc), p: Math.round(p), f: Math.round(f), c: Math.round(c) };
  }
  function gramsToMacros(food, g) {
    const x = Math.max(0, g) / 100;
    return { kcal: food.kcal * x, p: food.p * x, f: food.f * x, c: food.c * x };
  }
  function renderDay() {
    const day = getDay(dateIn.value);
    const t = totalsOf(day);

    // text totals
    calTotal.textContent = String(t.kc);
    kcalTotalCell.textContent = String(t.kc);
    pTotCell.textContent = String(t.p); fTotCell.textContent = String(t.f); cTotCell.textContent = String(t.c);
    pNowEl.textContent = String(t.p); fNowEl.textContent = String(t.f); cNowEl.textContent = String(t.c);

    // goals
    goalTop.textContent = String(goalKcal);
    goalInline.textContent = String(goalKcal);
    pGoalEl.textContent = String(targets.proteinG);
    fGoalEl.textContent = String(targets.fatG);
    cGoalEl.textContent = String(targets.carbsG);

    // rings
    setRing(ringCal, t.kc, goalKcal);
    setRing(ringP, t.p, targets.proteinG || 1);
    setRing(ringF, t.f, targets.fatG || 1);
    setRing(ringC, t.c, targets.carbsG || 1);

    // table
    listTBody.innerHTML = "";
    for (const it of (day.items || [])) {
      const tr = rowTpl.content.firstElementChild.cloneNode(true);
      tr.querySelector(".r-name").textContent = it.name || "—";
      tr.querySelector(".r-g").textContent = String(it.g);
      tr.querySelector(".r-k").textContent = String(Math.round(it.kcal));
      tr.querySelector(".r-p").textContent = String(Math.round(it.p));
      tr.querySelector(".r-f").textContent = String(Math.round(it.f));
      tr.querySelector(".r-c").textContent = String(Math.round(it.c));
      tr.querySelector(".r-del").addEventListener("click", () => {
        const d = getDay(dateIn.value); const idx = d.items.indexOf(it);
        if (idx > -1) { d.items.splice(idx, 1); saveDay(dateIn.value, d); renderDay(); }
      });
      listTBody.appendChild(tr);
    }
  }

  /* ---------- Events ---------- */
  dateIn.addEventListener("change", () => { renderDay(); });
  foodInput.addEventListener("input", refreshDatalist);
  foodInput.addEventListener("focus", refreshDatalist);

  addBtn.addEventListener("click", () => {
    const name = foodInput.value.trim();
    const grams = Math.max(0, parseFloat(gramsInput.value) || 0);
    const food = FOOD.find((f) => f.n.toLowerCase() === name.toLowerCase());
    if (!food || grams <= 0) { showToast("Select a food and grams", { tone: "warn" }); return; }
    const m = gramsToMacros(food, grams);
    const d = getDay(dateIn.value); d.items.push({ name, g: grams, ...m }); saveDay(dateIn.value, d);
    foodInput.value = ""; gramsInput.value = ""; refreshDatalist(); renderDay();
    showToast(`Added ${Math.round(m.kcal)} kcal from ${grams}g of ${name}`, { tone: "ok" });
  });

  undoBtn.addEventListener("click", () => {
    const d = getDay(dateIn.value);
    if (!d.items.length) { showToast("Nothing to undo"); return; }
    d.items.pop(); saveDay(dateIn.value, d); renderDay();
  });

  // Initial
  goalKcal = calorieGoal();
  targets = macroTargets(goalKcal);
  goalTop.textContent = goalKcal; goalInline.textContent = goalKcal;
  renderDay();
}

/* --------------------------------- SW ------------------------------------ */
// Register SW in production only (keeps Live Server fresh on localhost)
(function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const isSecure = location.protocol === "https:";
  try {
    if (!isLocal && isSecure) {
      navigator.serviceWorker.register("sw.js");
    } else {
      // Ensure old SWs are gone while developing
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    }
  } catch { }
})();

/* -------------------------------- Start ---------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getSettings().theme);
  switch (detectPage()) {
    case "programs": initPrograms(); break;
    case "schedule": initSchedule(); break;
    case "log": initLog(); break;
    case "history": initHistory(); break;
    case "settings": initSettings(); break;
    case "profile": initProfile(); break;
    case "tracker": initTracker(); break;
  }
  highlightActiveNav();
  syncFooterHeightVar();
  window.addEventListener("resize", syncFooterHeightVar);
});
