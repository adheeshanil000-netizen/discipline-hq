/* ============================================================
   DISCIPLINE HQ — APPLICATION ENGINE
   Initial frontend implementation

   IMPORTANT:
   This version uses browser localStorage.
   It is a frontend prototype, not cloud-synchronized storage.
   ============================================================ */

(() => {
    "use strict";

    const APP_KEY = "discipline-hq-v1";
    const CLOUD_API = "https://discipline-hq-api.adheeshanil000.workers.dev";
    const CLOUD_TOKEN_KEY = "discipline-hq-cloud-token-v1";
    const CLOUD_EMAIL_KEY = "discipline-hq-cloud-email-v1";
    const THEME_KEY = "discipline-hq-theme";
    let cloudSyncTimer = null;
    let cloudSyncChain = Promise.resolve();
    let cloudLastUpdatedAt = null;
    let cloudSyncPaused = false;
    let cloudPollingTimer = null;
    let cloudUiReady = false;

    const STAGES = {
        premarket: {
            label: "Pre-market",
            checklistId: "premarket-checklist",
            progressId: "premarket-progress",
            percentageId: "premarket-percentage",
            summaryId: "premarket-stage-summary"
        },
        intramarket: {
            label: "Intra-market",
            checklistId: "intramarket-checklist",
            progressId: "intramarket-progress",
            percentageId: "intramarket-percentage",
            summaryId: "intramarket-stage-summary"
        },
        postmarket: {
            label: "Post-market",
            checklistId: "postmarket-checklist",
            progressId: "postmarket-progress",
            percentageId: "postmarket-percentage",
            summaryId: "postmarket-stage-summary"
        }
    };

    const DEFAULT_CHECKLISTS = {
        premarket: [
            { id: "pre-1", text: "Review higher-timeframe market bias", required: true },
            { id: "pre-2", text: "Identify important liquidity levels", required: true },
            { id: "pre-3", text: "Mark relevant support and resistance", required: true },
            { id: "pre-4", text: "Check the economic calendar", required: true },
            { id: "pre-5", text: "Define valid trading scenarios", required: true },
            { id: "pre-6", text: "Set maximum risk for the day", required: true },
            { id: "pre-7", text: "Confirm mental and emotional readiness", required: true }
        ],

        intramarket: [
            { id: "intra-1", text: "Wait for my predefined trading setup", required: true },
            { id: "intra-2", text: "Confirm all required entry conditions", required: true },
            { id: "intra-3", text: "Calculate position size before entry", required: true },
            { id: "intra-4", text: "Respect my stop loss", required: true },
            { id: "intra-5", text: "Avoid revenge trading", required: true },
            { id: "intra-6", text: "Respect my daily trade limit", required: true },
            { id: "intra-7", text: "Avoid chasing missed opportunities", required: true }
        ],

        postmarket: [
            { id: "post-1", text: "Review execution against my plan", required: true },
            { id: "post-2", text: "Record any rule violations", required: true },
            { id: "post-3", text: "Identify emotional decisions", required: true },
            { id: "post-4", text: "Write down today's key lesson", required: true },
            { id: "post-5", text: "Choose one improvement for tomorrow", required: true }
        ]
    };

    const DEFAULT_SETTINGS = {
        disciplineTarget: 85,
        scoringMethod: "equal-sections",
        weekStart: "monday",
        motionPreference: "subtle"
    };

    let state;
    let selectedStage = "premarket";
    let editorStage = "premarket";
    let calendarDate = new Date();
    let analyticsPeriod = "weekly";
    let historyQuery = "";
    let reflectionQuery = "";
    let toastTimeouts = new Set();


    /* ========================================================
       DATE HELPERS
       Use local calendar dates rather than UTC ISO dates.
       ======================================================== */

    function localDateKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function todayKey() {
        return localDateKey(new Date());
    }

    function parseDateKey(key) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");

        if (!match) {
            return null;
        }

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);

        const date = new Date(year, month - 1, day);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month - 1 ||
            date.getDate() !== day
        ) {
            return null;
        }

        return date;
    }

    function formatDate(date, options = {}) {
        return new Intl.DateTimeFormat("en-IN", options).format(date);
    }

    function formatDateKey(key, options = {
        day: "numeric",
        month: "short",
        year: "numeric"
    }) {
        const date = parseDateKey(key);

        return date ? formatDate(date, options) : key;
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function createId(prefix = "item") {
        if (globalThis.crypto && typeof crypto.randomUUID === "function") {
            return `${prefix}-${crypto.randomUUID()}`;
        }

        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }


    /* ========================================================
       STATE AND STORAGE
       ======================================================== */

    function createDefaultState() {
        return {
            version: 1,
            checklists: structuredClone(DEFAULT_CHECKLISTS),
            settings: { ...DEFAULT_SETTINGS },
            records: {},
            reflections: {},
            createdAt: new Date().toISOString()
        };
    }

    function normalizeState(raw) {
        const defaults = createDefaultState();

        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return defaults;
        }

        const normalized = {
            ...defaults,
            ...raw,
            version: 1,
            settings: {
                ...defaults.settings,
                ...(raw.settings && typeof raw.settings === "object"
                    ? raw.settings
                    : {})
            },
            checklists: {},
            records: raw.records && typeof raw.records === "object"
                ? raw.records
                : {},
            reflections: raw.reflections && typeof raw.reflections === "object"
                ? raw.reflections
                : {}
        };

        for (const stage of Object.keys(STAGES)) {
            const supplied = raw.checklists?.[stage];

            normalized.checklists[stage] = Array.isArray(supplied)
                ? supplied
                    .filter(item => item && typeof item.text === "string")
                    .map(item => ({
                        id: String(item.id || createId(stage)),
                        text: item.text.slice(0, 200),
                        required: item.required !== false
                    }))
                : structuredClone(defaults.checklists[stage]);
        }

        normalized.settings.disciplineTarget = clamp(
            Number(normalized.settings.disciplineTarget) || 85,
            1,
            100
        );

        normalized.settings.scoringMethod =
            normalized.settings.scoringMethod === "all-items"
                ? "all-items"
                : "equal-sections";

        normalized.settings.weekStart =
            normalized.settings.weekStart === "sunday"
                ? "sunday"
                : "monday";

        normalized.settings.motionPreference =
            ["full", "subtle", "off"].includes(
                normalized.settings.motionPreference
            )
                ? normalized.settings.motionPreference
                : "subtle";

        normalized.settings.fontFamily = ["dm-sans", "inter", "system"].includes(normalized.settings.fontFamily)
            ? normalized.settings.fontFamily : "dm-sans";
        normalized.settings.fontSize = ["small", "medium", "large"].includes(normalized.settings.fontSize)
            ? normalized.settings.fontSize : "medium";

        return normalized;
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(APP_KEY);

            if (!raw) {
                return createDefaultState();
            }

            return normalizeState(JSON.parse(raw));
        } catch (error) {
            console.error("Could not load Discipline HQ data:", error);

            return createDefaultState();
        }
    }

    function saveState() {
        try {
            localStorage.setItem(APP_KEY, JSON.stringify(state));
            if (!cloudSyncPaused && getCloudToken()) scheduleCloudSync();
            return true;
        } catch (error) {
            console.error("Could not save Discipline HQ data:", error);

            showToast(
                "Could not save your data in this browser. Export a backup and check available storage.",
                "error"
            );

            return false;
        }
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function createEmptyRecord(key) {
        return {
            date: key,
            checklistVersion: 1,
            checklistSnapshot: structuredClone(state.checklists),
            answers: { premarket: {}, intramarket: {}, postmarket: {} },
            notApplicable: { premarket: false, intramarket: false, postmarket: false },
            sessionStatus: "not-started",
            compliance: "unreviewed",
            violationNotes: "",
            reflections: { wins: "", mistakes: "", lessons: "", tomorrow: "" },
            updatedAt: null
        };
    }

    function ensureRecord(key) {
        if (!parseDateKey(key)) {
            throw new Error("Invalid session date.");
        }

        if (!state.records[key]) {
            state.records[key] = createEmptyRecord(key);
        }

        const record = state.records[key];

        record.answers ||= {};
        record.notApplicable ||= {};
        record.reflections ||= {};

        for (const stage of Object.keys(STAGES)) {
            record.answers[stage] ||= {};
            record.notApplicable[stage] ??= false;
        }

        record.compliance ||= "unreviewed";
        record.violationNotes ||= "";

        if (!record.checklistSnapshot) {
            record.checklistSnapshot = structuredClone(state.checklists);
        }

        return record;
    }

    function getCurrentRecord() {
        const dateInput = document.getElementById("session-date");

        const key = dateInput?.value || todayKey();

        return ensureRecord(key);
    }


    /* ========================================================
       SCORE CALCULATIONS
       ======================================================== */

    function getChecklistForRecord(record, stage) {
        const snapshot = record.checklistSnapshot?.[stage];

        return Array.isArray(snapshot)
            ? snapshot
            : state.checklists[stage];
    }

    function getStageScore(record, stage) {
        const items = getChecklistForRecord(record, stage);

        if (record.notApplicable[stage]) {
            return {
                applicable: false,
                completed: 0,
                total: 0,
                score: null
            };
        }

        const applicableItems = items.filter(item => item.required !== false);

        const completed = applicableItems.filter(
            item => record.answers[stage]?.[item.id] === true
        ).length;

        const total = applicableItems.length;

        return {
            applicable: true,
            completed,
            total,
            score: total === 0 ? null : (completed / total) * 100
        };
    }

    function getRecordScore(record) {
        const scores = Object.keys(STAGES)
            .map(stage => getStageScore(record, stage))
            .filter(result => result.applicable && result.score !== null);

        if (scores.length === 0) {
            return {
                score: null,
                completed: 0,
                total: 0,
                applicableSections: 0,
                completedSections: 0
            };
        }

        let score;

        if (state.settings.scoringMethod === "all-items") {
            const completed = scores.reduce(
                (sum, result) => sum + result.completed,
                0
            );

            const total = scores.reduce(
                (sum, result) => sum + result.total,
                0
            );

            score = total === 0 ? null : completed / total * 100;
        } else {
            score = scores.reduce(
                (sum, result) => sum + result.score,
                0
            ) / scores.length;
        }

        return {
            score,
            completed: scores.reduce(
                (sum, result) => sum + result.completed,
                0
            ),
            total: scores.reduce(
                (sum, result) => sum + result.total,
                0
            ),
            applicableSections: scores.length,
            completedSections: scores.filter(
                result => result.score === 100
            ).length
        };
    }

    function getEligibleRecords(keys) {
        return keys
            .map(key => state.records[key])
            .filter(Boolean)
            .map(record => ({
                record,
                result: getRecordScore(record)
            }))
            .filter(entry => entry.result.score !== null);
    }

    function averageScore(entries) {
        if (!entries.length) {
            return null;
        }

        return entries.reduce(
            (sum, entry) => sum + entry.result.score,
            0
        ) / entries.length;
    }

    function percentage(value) {
        return value === null || value === undefined
            ? "—"
            : `${Math.round(value)}%`;
    }


    /* ========================================================
       NAVIGATION
       ======================================================== */

    const VIEW_NAMES = {
        dashboard: "Overview",
        daily: "Daily session",
        history: "History",
        analytics: "Analytics",
        reflections: "Reflections",
        checklists: "Checklist editor",
        nurse: "AI Discipline Nurse",
        settings: "Settings"
    };

    function showView(viewName) {
        if (!VIEW_NAMES[viewName]) {
            return;
        }

        document.querySelectorAll(".page-view").forEach(view => {
            view.classList.toggle(
                "active-view",
                view.id === `view-${viewName}`
            );
        });

        document.querySelectorAll(".nav-item").forEach(button => {
            const active = button.dataset.view === viewName;

            button.classList.toggle("active", active);

            if (active) {
                button.setAttribute("aria-current", "page");
            } else {
                button.removeAttribute("aria-current");
            }
        });

        const breadcrumb = document.getElementById("breadcrumb-current");

        if (breadcrumb) {
            breadcrumb.textContent = VIEW_NAMES[viewName];
        }

        closeMobileMenu();

        if (viewName === "daily") {
            renderDailySession();
        } else if (viewName === "history") {
            renderHistory();
        } else if (viewName === "analytics") {
            renderAnalytics();
        } else if (viewName === "reflections") {
            renderReflections();
        } else if (viewName === "checklists") {
            renderChecklistEditor();
        } else if (viewName === "dashboard") {
            renderDashboard();
        } else if (viewName === "nurse") {
            renderNurseHistory();
        }
    }

    function closeMobileMenu() {
        const sidebar = document.getElementById("sidebar");
        const button = document.getElementById("mobile-menu-button");

        sidebar?.classList.remove("is-open");
        button?.setAttribute("aria-expanded", "false");
    }

    function toggleMobileMenu() {
        const sidebar = document.getElementById("sidebar");
        const button = document.getElementById("mobile-menu-button");

        if (!sidebar || !button) {
            return;
        }

        const isOpen = sidebar.classList.toggle("is-open");

        button.setAttribute("aria-expanded", String(isOpen));
    }


    /* ========================================================
       TOAST NOTIFICATIONS
       ======================================================== */

    function showToast(message, type = "success") {
        const container = document.getElementById("toast-container");

        if (!container) {
            return;
        }

        const toast = document.createElement("div");

        toast.className = `toast ${type}`;
        toast.setAttribute("role", "status");
        toast.textContent = message;

        container.appendChild(toast);

        const timeout = window.setTimeout(() => {
            toast.remove();
            toastTimeouts.delete(timeout);
        }, 3500);

        toastTimeouts.add(timeout);
    }


    /* ========================================================
       DAILY SESSION
       ======================================================== */

    function renderDailySession() {
        const dateInput = document.getElementById("session-date");

        if (!dateInput.value) {
            dateInput.value = todayKey();
        }

        const selectedKey = dateInput.value;
        const record = state.records[selectedKey] || createEmptyRecord(selectedKey);

        document.getElementById("compliance-review").value =
            record.compliance;

        document.getElementById("violation-notes").value =
            record.violationNotes || "";

        document.getElementById("reflection-wins").value =
            record.reflections.wins || "";

        document.getElementById("reflection-mistakes").value =
            record.reflections.mistakes || "";

        document.getElementById("reflection-lessons").value =
            record.reflections.lessons || "";

        document.getElementById("reflection-tomorrow").value =
            record.reflections.tomorrow || "";

        for (const stage of Object.keys(STAGES)) {
            renderStageChecklist(record, stage);
        }

        updateDailySummary(record);
        updateSaveStatus(record);
    }

    function renderStageChecklist(record, stage) {
        const container = document.getElementById(
            STAGES[stage].checklistId
        );

        if (!container) {
            return;
        }

        const items = getChecklistForRecord(record, stage);
        const notApplicable = record.notApplicable[stage];

        if (items.length === 0) {
            container.innerHTML = `
                <p class="empty-state">
                    No checklist items yet. Add items in Checklist editor.
                </p>
            `;

            return;
        }

        const applicableItems = items.filter(
            item => item.required !== false
        );

        const optionalItems = items.filter(
            item => item.required === false
        );

        const orderedItems = [...applicableItems, ...optionalItems];

        container.innerHTML = orderedItems.map(item => {
            const checked = record.answers[stage]?.[item.id] === true;

            return `
                <label class="checklist-row ${checked ? "is-complete" : ""}">
                    <input
                        type="checkbox"
                        data-stage="${stage}"
                        data-item-id="${escapeHTML(item.id)}"
                        ${checked ? "checked" : ""}
                        ${notApplicable ? "disabled" : ""}
                    >

                    <span>${escapeHTML(item.text)}</span>
                </label>
            `;
        }).join("");

        const existing = container.querySelector(".not-applicable-control");

        if (existing) {
            existing.remove();
        }

        const notApplicableLabel = document.createElement("label");

        notApplicableLabel.className =
            "checklist-row not-applicable-control";

        notApplicableLabel.innerHTML = `
            <input
                type="checkbox"
                data-not-applicable="${stage}"
                ${notApplicable ? "checked" : ""}
            >
            <span>Mark this section as not applicable today</span>
        `;

        container.appendChild(notApplicableLabel);
    }

    function updateDailySummary(record) {
        const score = getRecordScore(record);

        const scoreElement = document.getElementById(
            "daily-session-score"
        );

        scoreElement.textContent = percentage(score.score);

        document.getElementById("daily-session-summary").textContent =
            score.score === null
                ? "Mark applicable sections to calculate a score."
                : score.score >= state.settings.disciplineTarget
                    ? "You're meeting your current discipline target."
                    : "Identify incomplete items and focus on the process.";

        document.getElementById("daily-progress-bar").style.width =
            `${score.score ?? 0}%`;

        document.getElementById("daily-progress-copy").textContent =
            `${score.completed} of ${score.total} applicable items completed`;

        for (const stage of Object.keys(STAGES)) {
            const result = getStageScore(record, stage);
            const stageName = STAGES[stage].label;

            document.getElementById(
                STAGES[stage].summaryId
            ).textContent = result.applicable
                ? `${result.completed} of ${result.total} completed`
                : `${stageName} marked not applicable`;

            const tab = document.querySelector(
                `.stage-tab[data-stage="${stage}"]`
            );

            if (tab) {
                tab.setAttribute(
                    "aria-label",
                    `${stageName}: ${result.score === null
                        ? "not applicable or no items"
                        : percentage(result.score)}`
                );
            }
        }

        if (record.sessionStatus === "not-started") {
            record.sessionStatus = "in-progress";
        }
    }

    function updateSaveStatus(record) {
        const element = document.getElementById("daily-save-status");

        if (element) {
            element.textContent = !state.records[record.date]
                ? "No saved session for this date"
                : record.updatedAt
                    ? `Last saved ${formatDate(new Date(record.updatedAt), {
                        hour: "2-digit",
                        minute: "2-digit"
                    })}`
                    : "Not saved yet";
        }
    }

    function saveDailySession() {
        const record = getCurrentRecord();

        record.compliance =
            document.getElementById("compliance-review").value;

        record.violationNotes =
            document.getElementById("violation-notes").value.trim();

        record.reflections = {
            wins: document.getElementById("reflection-wins").value.trim(),
            mistakes: document.getElementById("reflection-mistakes").value.trim(),
            lessons: document.getElementById("reflection-lessons").value.trim(),
            tomorrow: document.getElementById("reflection-tomorrow").value.trim()
        };

        const score = getRecordScore(record);

        record.sessionStatus = score.score === null
            ? "in-progress"
            : "reviewed";

        record.updatedAt = new Date().toISOString();

        if (!saveState()) {
            return;
        }

        renderDailySession();
        renderDashboard();
        renderHistory();
        renderAnalytics();
        renderReflections();
        renderCalendar();
        showToast("Daily session saved.");
    }

    function handleChecklistChange(event) {
        const input = event.target;

        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const record = getCurrentRecord();

        if (input.dataset.notApplicable) {
            const stage = input.dataset.notApplicable;

            record.notApplicable[stage] = input.checked;

            if (input.checked) {
                record.sessionStatus = "in-progress";
            }

            record.updatedAt = new Date().toISOString();

            saveState();
            renderDailySession();
            renderDashboard();

            return;
        }

        const stage = input.dataset.stage;
        const itemId = input.dataset.itemId;

        if (!stage || !itemId || !STAGES[stage]) {
            return;
        }

        record.answers[stage][itemId] = input.checked;
        record.updatedAt = new Date().toISOString();
        record.sessionStatus = "in-progress";

        saveState();
        renderDailySession();
        renderDashboard();
    }

    function selectStage(stage) {
        if (!STAGES[stage]) {
            return;
        }

        selectedStage = stage;

        document.querySelectorAll(".stage-tab").forEach(tab => {
            tab.classList.toggle(
                "active",
                tab.dataset.stage === stage
            );
        });

        document.querySelectorAll(".stage-content").forEach(section => {
            const active = section.id === `stage-${stage}`;

            section.classList.toggle("active-stage", active);
            section.hidden = !active;
        });
    }


    /* ========================================================
       DASHBOARD
       ======================================================== */

    function renderDashboard() {
        const now = new Date();

        document.getElementById("current-date").textContent =
            formatDate(now, {
                weekday: "short",
                day: "numeric",
                month: "short"
            });

        document.getElementById("footer-current-date").textContent =
            formatDate(now, {
                day: "numeric",
                month: "long",
                year: "numeric"
            });

        const record = state.records[todayKey()] || null;
        const score = record ? getRecordScore(record) : {
            score: null,
            completed: 0,
            total: 0
        };

        document.getElementById("discipline-score").textContent =
            score.score === null ? "—" : String(Math.round(score.score));

        document.getElementById("score-ring").style.setProperty(
            "--score",
            `${score.score ?? 0}%`
        );

        document.getElementById("score-status").textContent =
            score.score === null
                ? "Ready when you are"
                : score.score >= state.settings.disciplineTarget
                    ? "Target achieved"
                    : "Keep building consistency";

        document.getElementById("score-description").textContent =
            score.score === null
                ? "Complete your session to establish your first score."
                : `${score.completed} of ${score.total} applicable checklist items completed.`;

        document.getElementById("score-period-label").textContent =
            "TODAY'S SCORE";

        const weeklyKeys = getPeriodKeys("weekly", now);
        const monthlyKeys = getPeriodKeys("monthly", now);

        const weeklyEntries = getEligibleRecords(weeklyKeys);
        const monthlyEntries = getEligibleRecords(monthlyKeys);

        document.getElementById("weekly-average").textContent =
            percentage(averageScore(weeklyEntries));

        document.getElementById("monthly-average").textContent =
            percentage(averageScore(monthlyEntries));

        document.getElementById("weekly-days").textContent =
            `${weeklyEntries.length} sessions`;

        document.getElementById("monthly-days").textContent =
            `${monthlyEntries.length} sessions`;

        updateComplianceCard(record);

        const currentRecord = state.records[todayKey()] || null;

        for (const stage of Object.keys(STAGES)) {
            const result = currentRecord
                ? getStageScore(currentRecord, stage)
                : {
                    completed: 0,
                    total: state.checklists[stage].filter(
                        item => item.required !== false
                    ).length,
                    score: null,
                    applicable: true
                };

            document.getElementById(
                STAGES[stage].progressId
            ).textContent = result.applicable
                ? `${result.completed} of ${result.total} completed`
                : "Not applicable";

            document.getElementById(
                STAGES[stage].percentageId
            ).textContent = percentage(result.score);
        }

        document.getElementById("session-status").textContent =
            !currentRecord
                ? "Not started"
                : currentRecord.sessionStatus === "reviewed"
                    ? "Review saved"
                    : currentRecord.sessionStatus === "in-progress"
                        ? "In progress"
                        : "Not started";

        const reflection = document.getElementById(
            "dashboard-reflection"
        );

        if (document.activeElement !== reflection) {
            reflection.value =
                currentRecord?.reflections?.lessons || "";
        }

        document.getElementById("reflection-save-status").textContent =
            currentRecord?.updatedAt ? "Saved in this browser" : "Not saved";

        renderCalendar();
        renderTrendChart();
    }

    function updateComplianceCard(record) {
        const statusElement = document.getElementById("compliance-status");
        const violationElement = document.getElementById("violation-count");

        if (!record || record.compliance === "unreviewed") {
            statusElement.textContent = "—";
            violationElement.textContent = "Not reviewed";
            return;
        }

        if (record.compliance === "compliant") {
            statusElement.textContent = "Compliant";
            violationElement.textContent = "No violations recorded";
        } else {
            statusElement.textContent = "Violation";
            violationElement.textContent = "Review recorded";
        }
    }


    /* ========================================================
       PERIOD CALCULATIONS
       ======================================================== */

    function getPeriodKeys(period, referenceDate = new Date()) {
        const date = new Date(
            referenceDate.getFullYear(),
            referenceDate.getMonth(),
            referenceDate.getDate()
        );

        let start;
        let end;

        if (period === "weekly") {
            const offset = state.settings.weekStart === "sunday"
                ? date.getDay()
                : (date.getDay() + 6) % 7;

            start = new Date(date);
            start.setDate(date.getDate() - offset);

            end = new Date(start);
            end.setDate(start.getDate() + 6);
        } else if (period === "monthly") {
            start = new Date(date.getFullYear(), date.getMonth(), 1);
            end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        } else {
            return [];
        }

        const keys = [];

        for (
            const cursor = new Date(start);
            cursor <= end;
            cursor.setDate(cursor.getDate() + 1)
        ) {
            keys.push(localDateKey(cursor));
        }

        return keys;
    }

    function getAnalyticsKeys(period) {
        const now = new Date();

        if (period === "weekly") {
            return getPeriodKeys("weekly", now);
        }

        if (period === "monthly") {
            return getPeriodKeys("monthly", now);
        }

        const days = period === "90days" ? 90 : null;

        if (days) {
            const keys = [];

            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(date.getDate() - i);
                keys.push(localDateKey(date));
            }

            return keys;
        }

        return Object.keys(state.records).sort();
    }


    /* ========================================================
       TREND CHART
       ======================================================== */

    function renderTrendChart() {
        const container = document.getElementById(
            "discipline-chart-container"
        );

        const svg = document.getElementById("discipline-chart");
        const placeholder = document.getElementById(
            "discipline-chart-placeholder"
        );

        const periodButton = document.querySelector(
            ".period-button.active"
        );

        const period = periodButton?.dataset.period || "daily";

        let keys;

        if (period === "daily") {
            keys = getPeriodKeys("weekly", new Date());
        } else if (period === "weekly") {
            keys = getRecentKeys(8 * 7);
        } else {
            keys = getRecentKeys(30);
        }

        const data = keys.map(key => {
            const record = state.records[key];

            return {
                key,
                score: record ? getRecordScore(record).score : null
            };
        });

        const valid = data.filter(item => item.score !== null);

        const axis = document.getElementById("chart-axis");

        axis.innerHTML = data.length
            ? data.filter((item, index) =>
                index === 0 ||
                index === data.length - 1 ||
                index === Math.floor(data.length / 2)
            ).map(item => `
                <span>${escapeHTML(formatDateKey(item.key, {
                    day: "numeric",
                    month: "short"
                }))}</span>
            `).join("")
            : "";

        if (!valid.length) {
            svg.classList.remove("has-data");
            placeholder.hidden = false;
            return;
        }

        placeholder.hidden = true;
        svg.classList.add("has-data");

        const width = 700;
        const height = 240;
        const padding = { left: 25, right: 20, top: 22, bottom: 20 };

        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;

        const points = valid.map((item, index) => ({
            ...item,
            x: valid.length === 1
                ? width / 2
                : padding.left + index / (valid.length - 1) * plotWidth,
            y: padding.top + (100 - item.score) / 100 * plotHeight
        }));

        const linePath = points.map((point, index) =>
            `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
        ).join(" ");

        const bottom = height - padding.bottom;

        const areaPath =
            `${linePath} L ${points[points.length - 1].x} ${bottom}` +
            ` L ${points[0].x} ${bottom} Z`;

        document.getElementById("chart-line").setAttribute(
            "d",
            linePath
        );

        document.getElementById("chart-area").setAttribute(
            "d",
            areaPath
        );

        document.getElementById("chart-points").innerHTML =
            points.map(point => `
                <circle
                    cx="${point.x}"
                    cy="${point.y}"
                    r="4"
                    fill="#74e5a0"
                    stroke="#101613"
                    stroke-width="2">
                    <title>
                        ${escapeHTML(formatDateKey(point.key))}:
                        ${Math.round(point.score)}%
                    </title>
                </circle>
            `).join("");

        document.getElementById("chart-grid-lines").innerHTML =
            [0, 25, 50, 75, 100].map(value => {
                const y = padding.top + (100 - value) / 100 * plotHeight;

                return `
                    <line
                        x1="${padding.left}"
                        y1="${y}"
                        x2="${width - padding.right}"
                        y2="${y}"
                        stroke="rgba(255,255,255,0.055)"
                        stroke-dasharray="3 5">
                    </line>
                `;
            }).join("");
    }

    function getRecentKeys(days) {
        const keys = [];

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            keys.push(localDateKey(date));
        }

        return keys;
    }


    /* ========================================================
       CALENDAR
       ======================================================== */

    function renderCalendar() {
        const year = calendarDate.getFullYear();
        const month = calendarDate.getMonth();

        document.getElementById("calendar-heading").textContent =
            formatDate(calendarDate, {
                month: "long",
                year: "numeric"
            });

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        const mondayOffset = state.settings.weekStart === "sunday"
            ? firstDay.getDay()
            : (firstDay.getDay() + 6) % 7;

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < mondayOffset; i++) {
            const empty = document.createElement("span");
            empty.className = "calendar-day is-empty";
            fragment.appendChild(empty);
        }

        for (let day = 1; day <= lastDay.getDate(); day++) {
            const date = new Date(year, month, day);
            const key = localDateKey(date);
            const record = state.records[key];

            const button = document.createElement("button");

            button.type = "button";
            button.className = "calendar-day";
            button.textContent = String(day);
            button.dataset.date = key;

            button.setAttribute(
                "aria-label",
                `${formatDate(date, {
                    day: "numeric",
                    month: "long",
                    year: "numeric"
                })}${record ? `, score ${percentage(getRecordScore(record).score)}` : ""}`
            );

            if (key === todayKey()) {
                button.classList.add("is-today");
            }

            if (
                document.getElementById("session-date")?.value === key
            ) {
                button.classList.add("is-selected");
            }

            if (record) {
                const score = getRecordScore(record).score;

                if (score !== null) {
                    if (score >= 85) {
                        button.classList.add("score-high");
                    } else if (score >= 65) {
                        button.classList.add("score-medium");
                    } else {
                        button.classList.add("score-low");
                    }
                }
            }

            fragment.appendChild(button);
        }

        const grid = document.getElementById("calendar-grid");

        grid.replaceChildren(fragment);
    }

    function moveCalendar(months) {
        calendarDate = new Date(
            calendarDate.getFullYear(),
            calendarDate.getMonth() + months,
            1
        );

        renderCalendar();
    }

    function openSessionDate(key) {
        if (!parseDateKey(key)) {
            showToast("Invalid session date.", "error");
            return;
        }

        document.getElementById("session-date").value = key;

        renderDailySession();
        renderCalendar();
        showView("daily");
    }


    /* ========================================================
       HISTORY
       ======================================================== */

    function renderHistory() {
        const tbody = document.getElementById("history-table-body");

        const entries = Object.keys(state.records)
            .filter(key => !historyQuery || historyMatches(key))
            .sort((a, b) => b.localeCompare(a));

        if (!entries.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-table-message">
                        No saved sessions match this search.
                    </td>
                </tr>
            `;

            return;
        }

        tbody.innerHTML = entries.map(key => {
            const record = state.records[key];
            const score = getRecordScore(record);

            const stageScores = Object.keys(STAGES).map(stage => {
                const result = getStageScore(record, stage);
                return result.score === null
                    ? "—"
                    : percentage(result.score);
            });

            const compliance = record.compliance === "compliant"
                ? "Compliant"
                : record.compliance === "violations"
                    ? "Violation"
                    : "Not reviewed";

            const status = record.sessionStatus === "reviewed"
                ? "Reviewed"
                : "In progress";

            return `
                <tr data-open-date="${escapeHTML(key)}">
                    <td class="history-date-cell">
                        <button class="history-open-button" type="button" data-open-date="${escapeHTML(key)}">${escapeHTML(formatDateKey(key))}</button>
                        <button class="history-delete-button" type="button" data-delete-session="${escapeHTML(key)}" aria-label="Delete session for ${escapeHTML(formatDateKey(key))}" title="Delete this session">Delete</button>
                    </td>
                    <td>${percentage(score.score)}</td>
                    <td>${stageScores[0]}</td>
                    <td>${stageScores[1]}</td>
                    <td>${stageScores[2]}</td>
                    <td>${compliance}</td>
                    <td>${status}</td>
                </tr>
            `;
        }).join("");
    }

    function historyMatches(key) {
        const record = state.records[key];

        const content = [
            key,
            record.compliance,
            record.violationNotes,
            ...Object.values(record.reflections || {})
        ].join(" ").toLowerCase();

        return content.includes(historyQuery.toLowerCase());
    }


    /* ========================================================
       ANALYTICS
       ======================================================== */

    function renderAnalytics() {
        const keys = getAnalyticsKeys(analyticsPeriod);
        const entries = getEligibleRecords(keys);

        document.getElementById("analytics-average").textContent =
            percentage(averageScore(entries));

        document.getElementById("analytics-sessions").textContent =
            String(entries.length);

        const sectionScores = Object.keys(STAGES).map(stage => {
            const results = entries.map(entry =>
                getStageScore(entry.record, stage)
            ).filter(result => result.score !== null);

            return {
                stage,
                label: STAGES[stage].label,
                score: results.length
                    ? results.reduce((sum, result) => sum + result.score, 0)
                        / results.length
                    : null
            };
        }).filter(entry => entry.score !== null);

        sectionScores.sort((a, b) => b.score - a.score);

        document.getElementById("analytics-best-section").textContent =
            sectionScores[0]?.label || "—";

        renderAnalyticsChart(entries);
        renderSectionAnalysis(sectionScores);
    }

    function renderAnalyticsChart(entries) {
        const container = document.getElementById(
            "analytics-chart-container"
        );

        if (!entries.length) {
            container.innerHTML = `
                <p class="empty-state">
                    Save some sessions to see your discipline trend.
                </p>
            `;

            return;
        }

        const rows = entries.map(entry => ({
            date: entry.record.date,
            score: entry.result.score
        }));

        container.innerHTML = `
            <div class="analytics-score-list">
                ${rows.map(row => `
                    <button
                        class="analytics-score-row"
                        data-open-date="${escapeHTML(row.date)}"
                        type="button">

                        <span>
                            ${escapeHTML(formatDateKey(row.date))}
                        </span>

                        <span class="progress-track">
                            <span
                                class="progress-fill"
                                style="display:block;width:${clamp(row.score, 0, 100)}%">
                            </span>
                        </span>

                        <strong>${percentage(row.score)}</strong>
                    </button>
                `).join("")}
            </div>
        `;
    }

    function renderSectionAnalysis(sectionScores) {
        const container = document.getElementById("section-analysis");

        if (!sectionScores.length) {
            container.innerHTML = `
                <p class="empty-state">
                    No applicable checklist scores in this period.
                </p>
            `;

            return;
        }

        container.innerHTML = sectionScores.map(entry => `
            <div class="section-analysis-row">

                <div>
                    <strong>${escapeHTML(entry.label)}</strong>
                    <span>${percentage(entry.score)}</span>
                </div>

                <div class="progress-track">
                    <div
                        class="progress-fill"
                        style="width:${clamp(entry.score, 0, 100)}%">
                    </div>
                </div>

            </div>
        `).join("");
    }


    /* ========================================================
       REFLECTIONS
       ======================================================== */

    function saveDashboardReflection() {
        const record = ensureRecord(todayKey());

        record.reflections.lessons =
            document.getElementById("dashboard-reflection").value.trim();

        record.updatedAt = new Date().toISOString();

        if (!saveState()) {
            return;
        }

        document.getElementById("reflection-save-status").textContent =
            "Saved in this browser";

        renderReflections();
        showToast("Reflection saved.");
    }

    function renderReflections() {
        const container = document.getElementById("reflection-list");

        const entries = Object.entries(state.records)
            .map(([date, record]) => ({
                date,
                reflections: record.reflections || {}
            }))
            .filter(entry => {
                const values = Object.values(entry.reflections);

                return values.some(value => String(value || "").trim());
            })
            .sort((a, b) => b.date.localeCompare(a.date))
            .filter(entry => {
                const text = [
                    entry.date,
                    ...Object.values(entry.reflections)
                ].join(" ").toLowerCase();

                return text.includes(reflectionQuery.toLowerCase());
            });

        if (!entries.length) {
            container.innerHTML = `
                <p class="empty-state">
                    No reflections found. Save a daily session
                    to start building your reflection library.
                </p>
            `;

            return;
        }

        container.innerHTML = entries.map(entry => {
            const fields = [
                ["What went well", entry.reflections.wins],
                ["What needs improvement", entry.reflections.mistakes],
                ["Key lesson", entry.reflections.lessons],
                ["Tomorrow's improvement", entry.reflections.tomorrow]
            ].filter(([, value]) => String(value || "").trim());

            return `
                <article class="reflection-entry"
                         data-open-date="${escapeHTML(entry.date)}">

                    <h3>${escapeHTML(formatDateKey(entry.date))}</h3>

                    ${fields.map(([label, value]) => `
                        <p>
                            <strong>${escapeHTML(label)}:</strong><br>
                            ${escapeHTML(value)}
                        </p>
                    `).join("")}

                    <button
                        class="text-button"
                        data-open-date="${escapeHTML(entry.date)}"
                        type="button">
                        Open session →
                    </button>

                </article>
            `;
        }).join("");
    }


    /* ========================================================
       CHECKLIST EDITOR
       ======================================================== */

    function renderChecklistEditor() {
        const container = document.getElementById(
            "checklist-editor-items"
        );

        const items = state.checklists[editorStage];

        document.querySelectorAll(".editor-stage-button").forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.editorStage === editorStage
            );
        });

        if (!items.length) {
            container.innerHTML = `
                <p class="empty-state">
                    No items in this section yet. Add one below.
                </p>
            `;

            return;
        }

        container.innerHTML = items.map((item, index) => `
            <div class="editor-item"
                 data-editor-item-id="${escapeHTML(item.id)}">

                <input
                    type="text"
                    maxlength="200"
                    value="${escapeHTML(item.text)}"
                    aria-label="Checklist item text">

                <label class="editor-required-control">
                    <input
                        type="checkbox"
                        data-required-id="${escapeHTML(item.id)}"
                        ${item.required !== false ? "checked" : ""}>
                    Required
                </label>

                <div class="editor-item-actions">

                    <button
                        type="button"
                        data-move-item="-1"
                        data-item-id="${escapeHTML(item.id)}"
                        aria-label="Move item up"
                        ${index === 0 ? "disabled" : ""}>
                        ↑
                    </button>

                    <button
                        type="button"
                        data-move-item="1"
                        data-item-id="${escapeHTML(item.id)}"
                        aria-label="Move item down"
                        ${index === items.length - 1 ? "disabled" : ""}>
                        ↓
                    </button>

                    <button
                        class="delete-item"
                        type="button"
                        data-delete-item="${escapeHTML(item.id)}"
                        aria-label="Delete checklist item">
                        ×
                    </button>

                </div>

            </div>
        `).join("");
    }

    function addChecklistItem(event) {
        event.preventDefault();

        const input = document.getElementById("new-checklist-item");
        const text = input.value.trim();

        if (!text) {
            showToast("Enter a checklist item first.", "error");
            input.focus();
            return;
        }

        if (state.checklists[editorStage].length >= 100) {
            showToast("This section has reached the 100-item limit.", "error");
            return;
        }

        state.checklists[editorStage].push({
            id: createId(editorStage),
            text: text.slice(0, 200),
            required: true
        });

        input.value = "";

        saveState();
        renderChecklistEditor();
        renderDashboard();

        showToast("Checklist item added.");
    }

    function editChecklistItem(event) {
        const input = event.target;

        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const row = input.closest("[data-editor-item-id]");

        if (!row) {
            return;
        }

        const id = row.dataset.editorItemId;
        const item = state.checklists[editorStage].find(
            candidate => candidate.id === id
        );

        if (!item) {
            return;
        }

        if (input.dataset.requiredId) {
            item.required = input.checked;
        } else if (input.type === "text") {
            const text = input.value.trim();

            if (!text) {
                input.value = item.text;
                showToast("Checklist item cannot be empty.", "error");
                return;
            }

            item.text = text.slice(0, 200);
        } else {
            return;
        }

        saveState();
        renderDashboard();
    }

    function moveChecklistItem(id, direction) {
        const items = state.checklists[editorStage];
        const index = items.findIndex(item => item.id === id);

        if (index < 0) {
            return;
        }

        const target = index + direction;

        if (target < 0 || target >= items.length) {
            return;
        }

        [items[index], items[target]] = [items[target], items[index]];

        saveState();
        renderChecklistEditor();
        renderDashboard();
    }

    function deleteChecklistItem(id) {
        const items = state.checklists[editorStage];
        const index = items.findIndex(item => item.id === id);

        if (index < 0) {
            return;
        }

        const confirmed = window.confirm(
            "Remove this item from future checklist templates? Existing saved sessions keep their checklist snapshots."
        );

        if (!confirmed) {
            return;
        }

        items.splice(index, 1);

        saveState();
        renderChecklistEditor();
        renderDashboard();

        showToast("Item removed from the current template.");
    }


    /* ========================================================
       SETTINGS
       ======================================================== */

    function loadSettingsForm() {
        document.getElementById("discipline-target").value =
            state.settings.disciplineTarget;

        document.getElementById("scoring-method").value =
            state.settings.scoringMethod;

        document.getElementById("week-start").value =
            state.settings.weekStart;

        document.getElementById("motion-preference").value =
            state.settings.motionPreference;

        const fontFamily = document.getElementById("font-family-setting");
        const fontSize = document.getElementById("font-size-setting");
        if (fontFamily) fontFamily.value = state.settings.fontFamily || "dm-sans";
        if (fontSize) fontSize.value = state.settings.fontSize || "medium";
        applyAppearancePreferences();
        applyMotionPreference();
    }

    function saveSettings() {
        const targetInput = document.getElementById("discipline-target");

        const target = Number(targetInput.value);

        if (
            !Number.isFinite(target) ||
            target < 1 ||
            target > 100
        ) {
            showToast("Daily target must be between 1 and 100.", "error");
            targetInput.focus();
            return;
        }

        state.settings.disciplineTarget = target;
        state.settings.scoringMethod =
            document.getElementById("scoring-method").value;
        state.settings.weekStart =
            document.getElementById("week-start").value;
        state.settings.motionPreference =
            document.getElementById("motion-preference").value;
        state.settings.fontFamily = document.getElementById("font-family-setting")?.value || "dm-sans";
        state.settings.fontSize = document.getElementById("font-size-setting")?.value || "medium";

        applyAppearancePreferences();
        applyMotionPreference();

        if (!saveState()) {
            return;
        }

        renderDashboard();
        renderDailySession();
        renderAnalytics();
        renderCalendar();

        document.getElementById("settings-save-status").textContent =
            "Settings saved locally — cloud sync will be added later";

        showToast("Settings saved.");
    }

    function applyMotionPreference() {
        document.documentElement.dataset.motion =
            state.settings.motionPreference;
    }


    /* ========================================================
       BACKUP AND RESTORE
       ======================================================== */

    function exportData() {
        const payload = {
            format: "discipline-hq-backup",
            version: 1,
            exportedAt: new Date().toISOString(),
            data: state
        };

        const blob = new Blob(
            [JSON.stringify(payload, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = `discipline-hq-backup-${todayKey()}.json`;

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        URL.revokeObjectURL(url);

        showToast("Backup export started.");
    }

    async function restoreData(event) {
        const input = event.target;
        const file = input.files?.[0];

        if (!file) {
            return;
        }

        try {
            if (file.size > 10 * 1024 * 1024) {
                throw new Error("Backup file exceeds the 10 MB limit.");
            }

            const text = await file.text();
            const parsed = JSON.parse(text);

            const raw = parsed?.format === "discipline-hq-backup"
                ? parsed.data
                : parsed;

            if (
                !raw ||
                typeof raw !== "object" ||
                !raw.checklists ||
                !raw.settings ||
                !raw.records ||
                typeof raw.records !== "object"
            ) {
                throw new Error("This does not look like a valid Discipline HQ backup.");
            }

            const confirmed = window.confirm(
                "Restoring this backup will replace the data currently stored in this browser. Export your current data first if you want to keep it. Continue?"
            );

            if (!confirmed) {
                input.value = "";
                return;
            }

            const restored = normalizeState(raw);

            const previousState = state;
            state = restored;

            if (!saveState()) {
                state = previousState;
                throw new Error("Could not save the restored data.");
            }

            loadSettingsForm();
            renderDailySession();
            renderDashboard();
            renderHistory();
            renderAnalytics();
            renderReflections();
            renderChecklistEditor();

            showToast("Backup restored successfully.");
        } catch (error) {
            console.error("Backup restore failed:", error);
            showToast(error.message || "Could not restore this backup.", "error");
        } finally {
            input.value = "";
        }
    }


    /* ========================================================
       EVENT LISTENERS
       ======================================================== */


    function applyAppearancePreferences() {
        const family = state?.settings?.fontFamily || "dm-sans";
        const size = state?.settings?.fontSize || "medium";
        document.documentElement.dataset.fontFamily = family;
        document.documentElement.dataset.fontSize = size;
    }

    function deleteSessionRecord(key) {
        const record = state.records[key];
        if (!record) {
            showToast("There is no saved session for that date.", "error");
            return;
        }
        const confirmed = window.confirm(
            `Delete the session for ${formatDateKey(key)}?\n\nThis permanently removes that date's checklist responses, session review, and associated reflection. Other dates and checklist templates will remain.`
        );
        if (!confirmed) return;

        delete state.records[key];
        delete state.reflections[key];
        if (!saveState()) return;

        if ((document.getElementById("session-date")?.value || "") === key) {
            renderDailySession();
        }
        renderDashboard();
        renderHistory();
        renderAnalytics();
        renderReflections();
        renderCalendar();
        renderDailySession();
        showToast(`Session for ${formatDateKey(key)} deleted.`);
    }

    function renderNurseHistory() {
        const host = document.getElementById("nurse-history-list");
        if (!host) return;
        let notes = [];
        try { notes = JSON.parse(localStorage.getItem("discipline-hq-nurse-notes-v1") || "[]"); }
        catch (_) { notes = []; }
        if (!notes.length) {
            host.innerHTML = "<p>No saved coaching notes yet.</p>";
            return;
        }
        host.replaceChildren();
        notes.slice().reverse().forEach(note => {
            const card = document.createElement("article");
            card.className = "nurse-note-card";
            const title = document.createElement("strong");
            title.textContent = new Date(note.createdAt).toLocaleString();
            const body = document.createElement("p");
            body.textContent = note.text;
            card.append(title, body);
            host.appendChild(card);
        });
    }

    function saveNurseNote(text) {
        const clean = String(text || "").trim();
        if (!clean) {
            showToast("Write a note first.", "error");
            return;
        }
        let notes = [];
        try { notes = JSON.parse(localStorage.getItem("discipline-hq-nurse-notes-v1") || "[]"); }
        catch (_) { notes = []; }
        notes.push({ text: clean, createdAt: new Date().toISOString() });
        try { localStorage.setItem("discipline-hq-nurse-notes-v1", JSON.stringify(notes.slice(-100))); }
        catch (_) { showToast("Could not save coaching note in this browser.", "error"); return; }
        renderNurseHistory();
        if (getCloudToken()) scheduleCloudSync();
        showToast("Coaching note saved.");
    }

    function reviewNurseNote() {
        const text = document.getElementById("nurse-entry")?.value.trim() || "";
        const output = document.getElementById("nurse-response");
        if (!text) {
            showToast("Describe a session or mistake first.", "error");
            return;
        }
        const lower = text.toLowerCase();
        const points = [];
        if (/revenge|win it back|recover loss/.test(lower)) points.push("Potential pattern: revenge trading. Consider a mandatory pause after a loss and stop if your written daily limit is reached.");
        if (/early|before confirmation|fomo|miss the move|chase/.test(lower)) points.push("Potential pattern: fear of missing out or premature entry. Require every predefined confirmation before entry.");
        if (/stop.?loss|moved my stop|widened/.test(lower)) points.push("Potential risk-control issue: define invalidation before entry and do not widen a stop to avoid a planned loss.");
        if (/oversiz|lot size|risk too much|risk limit/.test(lower)) points.push("Potential position-sizing issue: calculate risk from the stop distance before entering and respect the written risk cap.");
        if (!points.length) points.push("Separate the facts from the emotion: what was your plan, what did you actually do, which rule applied, and what single action will prevent a repeat?");
        output.replaceChildren();
        const heading = document.createElement("h2");
        heading.textContent = "Structured review (preview)";
        const paragraph = document.createElement("p");
        paragraph.textContent = "This is a rule-based preview, not AI analysis. " + points.join(" ");
        const next = document.createElement("p");
        next.textContent = "Next step: write one specific rule for your next session and check whether you followed it in your post-market review.";
        output.append(heading, paragraph, next);
    }

    function bindEvents() {
        document.addEventListener("click", event => {
            const viewButton = event.target.closest("[data-view]");

            if (viewButton) {
                showView(viewButton.dataset.view);
                return;
            }

            const stageProgressButton = event.target.closest(
                ".stage-progress-item"
            );

            if (stageProgressButton) {
                showView("daily");
                selectStage(stageProgressButton.dataset.stage);
                return;
            }

            const stageTab = event.target.closest(".stage-tab");

            if (stageTab) {
                selectStage(stageTab.dataset.stage);
                return;
            }

            const nextButton = event.target.closest("[data-stage-next]");

            if (nextButton) {
                selectStage(nextButton.dataset.stageNext);
                return;
            }

            const editorTab = event.target.closest(
                ".editor-stage-button"
            );

            if (editorTab) {
                editorStage = editorTab.dataset.editorStage;
                renderChecklistEditor();
                return;
            }

            const moveButton = event.target.closest("[data-move-item]");

            if (moveButton) {
                moveChecklistItem(
                    moveButton.dataset.itemId,
                    Number(moveButton.dataset.moveItem)
                );

                return;
            }

            const deleteButton = event.target.closest(
                "[data-delete-item]"
            );

            if (deleteButton) {
                deleteChecklistItem(deleteButton.dataset.deleteItem);
                return;
            }

            const deleteSessionButton = event.target.closest("[data-delete-session]");
            if (deleteSessionButton) {
                event.stopPropagation();
                deleteSessionRecord(deleteSessionButton.dataset.deleteSession);
                return;
            }

            const dateButton = event.target.closest("[data-open-date]");

            if (dateButton) {
                openSessionDate(dateButton.dataset.openDate);
                return;
            }

            const calendarDay = event.target.closest(".calendar-day");

            if (calendarDay?.dataset.date) {
                openSessionDate(calendarDay.dataset.date);
                return;
            }

            const periodButton = event.target.closest(".period-button");

            if (periodButton) {
                document.querySelectorAll(".period-button").forEach(button => {
                    button.classList.toggle(
                        "active",
                        button === periodButton
                    );
                });

                renderTrendChart();
                return;
            }
        });

        document.getElementById("mobile-menu-button")
            .addEventListener("click", toggleMobileMenu);

        document.getElementById("open-settings-button")
            .addEventListener("click", () => showView("settings"));

        document.getElementById("start-session-button")
            .addEventListener("click", () => {
                document.getElementById("session-date").value = todayKey();

                ensureRecord(todayKey());

                renderDailySession();
                showView("daily");
            });

        document.getElementById("continue-session-button")
            .addEventListener("click", () => {
                document.getElementById("session-date").value = todayKey();
                renderDailySession();
                showView("daily");
            });

        document.getElementById("history-today-button")
            .addEventListener("click", () => {
                openSessionDate(todayKey());
            });

        document.getElementById("calendar-previous")
            .addEventListener("click", () => moveCalendar(-1));

        document.getElementById("calendar-next")
            .addEventListener("click", () => moveCalendar(1));

        document.getElementById("session-date")
            .addEventListener("change", () => {
                const input = document.getElementById("session-date");

                if (!parseDateKey(input.value)) {
                    input.value = todayKey();
                    showToast("Please select a valid date.", "error");
                }

                renderDailySession();
                renderCalendar();
                renderDashboard();
            });

        document.getElementById("save-daily-session")
            .addEventListener("click", saveDailySession);

        document.getElementById("delete-daily-session")
            ?.addEventListener("click", () => {
                const key = document.getElementById("session-date")?.value || todayKey();
                deleteSessionRecord(key);
            });

        document.querySelectorAll(".checklist-items").forEach(container => {
            container.addEventListener("change", handleChecklistChange);
        });

        document.getElementById("save-reflection-button")
            .addEventListener("click", saveDashboardReflection);

        document.getElementById("dashboard-reflection")
            .addEventListener("input", () => {
                document.getElementById("reflection-save-status").textContent =
                    "Unsaved changes";
            });

        document.getElementById("history-search")
            .addEventListener("input", event => {
                historyQuery = event.target.value.trim();
                renderHistory();
            });

        document.getElementById("reflection-search")
            .addEventListener("input", event => {
                reflectionQuery = event.target.value.trim();
                renderReflections();
            });

        document.getElementById("analytics-period")
            .addEventListener("change", event => {
                analyticsPeriod = event.target.value;
                renderAnalytics();
            });

        document.getElementById("add-checklist-form")
            .addEventListener("submit", addChecklistItem);

        document.getElementById("checklist-editor-items")
            .addEventListener("change", editChecklistItem);

        document.getElementById("checklist-editor-items")
            .addEventListener("focusout", event => {
                if (
                    event.target instanceof HTMLInputElement &&
                    event.target.type === "text"
                ) {
                    editChecklistItem({ target: event.target });
                    renderChecklistEditor();
                }
            });

        document.getElementById("save-settings-button")
            .addEventListener("click", saveSettings);

        document.getElementById("nurse-review-button")?.addEventListener("click", reviewNurseNote);
        document.getElementById("nurse-save-button")?.addEventListener("click", () => {
            saveNurseNote(document.getElementById("nurse-entry")?.value || "");
        });
        document.getElementById("nurse-clear-button")?.addEventListener("click", () => {
            if (!window.confirm("Clear all locally saved AI Discipline Nurse notes?")) return;
            localStorage.removeItem("discipline-hq-nurse-notes-v1");
            renderNurseHistory();
            if (getCloudToken()) scheduleCloudSync();
            showToast("Coaching notes cleared.");
        });

        document.getElementById("export-data-button")
            .addEventListener("click", exportData);

        document.getElementById("restore-data-input")
            .addEventListener("change", restoreData);

        document.getElementById("compliance-review")
            .addEventListener("change", () => {
                document.getElementById("daily-save-status").textContent =
                    "Unsaved changes";
            });

        document.getElementById("violation-notes")
            .addEventListener("input", () => {
                document.getElementById("daily-save-status").textContent =
                    "Unsaved changes";
            });

        document.querySelectorAll(
            "#reflection-wins, #reflection-mistakes, #reflection-lessons, #reflection-tomorrow"
        ).forEach(textarea => {
            textarea.addEventListener("input", () => {
                document.getElementById("daily-save-status").textContent =
                    "Unsaved changes";
            });
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeMobileMenu();
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 650) {
                closeMobileMenu();
            }
        });

        window.addEventListener("storage", event => {
            if (event.key !== APP_KEY || !event.newValue) {
                return;
            }

            try {
                state = normalizeState(JSON.parse(event.newValue));

                loadSettingsForm();
                renderDailySession();
                renderDashboard();
            } catch (error) {
                console.error("Could not synchronize browser tabs:", error);
            }
        });
    }



    /* ========================================================
       CLOUD SYNC — Cloudflare Workers + D1
       One account can be used on multiple devices.
       ======================================================== */

    function getCloudToken() {
        return localStorage.getItem(CLOUD_TOKEN_KEY) || "";
    }

    function getCloudEmail() {
        return localStorage.getItem(CLOUD_EMAIL_KEY) || "";
    }

    async function cloudRequest(path, options = {}) {
        const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
        const token = getCloudToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(`${CLOUD_API}${path}`, {
            ...options,
            headers,
            cache: "no-store"
        });

        let payload;
        try { payload = await response.json(); }
        catch (_) { payload = {}; }

        if (!response.ok) {
            const message = payload.error || `Cloud request failed (${response.status}).`;
            if (response.status === 401) {
                localStorage.removeItem(CLOUD_TOKEN_KEY);
                updateCloudStatus("Sign in required", "error");
            }
            throw new Error(message);
        }
        return payload;
    }

    function getCloudEnvelope() {
        let nurseNotes = [];
        try {
            nurseNotes = JSON.parse(localStorage.getItem("discipline-hq-nurse-notes-v1") || "[]");
            if (!Array.isArray(nurseNotes)) nurseNotes = [];
        } catch (_) { nurseNotes = []; }

        return {
            state,
            nurseNotes,
            theme: localStorage.getItem(THEME_KEY) || "dark",
            schemaVersion: 1,
            clientUpdatedAt: new Date().toISOString()
        };
    }

    function scheduleCloudSync() {
        if (!getCloudToken() || cloudSyncPaused) return;
        clearTimeout(cloudSyncTimer);
        updateCloudStatus("Saving changes…", "pending");
        cloudSyncTimer = setTimeout(() => {
            cloudSyncChain = cloudSyncChain
                .then(() => pushCloudData())
                .catch(error => {
                    console.error("Cloud sync failed:", error);
                    updateCloudStatus("Sync error", "error");
                });
        }, 900);
    }

    async function pushCloudData() {
        if (!getCloudToken() || cloudSyncPaused) return;
        const envelope = getCloudEnvelope();
        const result = await cloudRequest("/api/data", {
            method: "PUT",
            body: JSON.stringify({ data: envelope })
        });
        cloudLastUpdatedAt = result.updatedAt || new Date().toISOString();
        updateCloudStatus("Synced", "success");
    }

    function applyCloudEnvelope(envelope) {
        if (!envelope || typeof envelope !== "object") return false;
        const incoming = envelope.state || envelope;
        if (!incoming || typeof incoming !== "object" || !incoming.checklists || !incoming.settings || !incoming.records) {
            throw new Error("The cloud data format is not recognized. Your local data has not been replaced.");
        }

        cloudSyncPaused = true;
        try {
            state = normalizeState(incoming);
            localStorage.setItem(APP_KEY, JSON.stringify(state));

            if (Array.isArray(envelope.nurseNotes)) {
                localStorage.setItem("discipline-hq-nurse-notes-v1", JSON.stringify(envelope.nurseNotes.slice(-100)));
            }
            if (envelope.theme === "light" || envelope.theme === "dark") {
                localStorage.setItem(THEME_KEY, envelope.theme);
                document.body.classList.toggle("light-theme", envelope.theme === "light");
            }
        } finally {
            cloudSyncPaused = false;
        }

        loadSettingsForm();
        applyAppearancePreferences();
        renderNurseHistory();
        renderDailySession();
        renderDashboard();
        renderHistory();
        renderAnalytics();
        renderReflections();
        renderChecklistEditor();
        renderCalendar();
        return true;
    }

    function updateCloudStatus(text, mode = "") {
        const status = document.getElementById("cloud-status-text");
        const dot = document.getElementById("cloud-status-dot");
        const account = document.getElementById("cloud-account-button");
        if (status) status.textContent = text;
        if (dot) {
            dot.style.background = mode === "error" ? "#ff8585" :
                mode === "pending" ? "#f2c879" :
                mode === "success" ? "#74e5a0" : "#87938a";
        }
        if (account) {
            account.textContent = getCloudToken()
                ? (getCloudEmail() ? getCloudEmail() : "Cloud account")
                : "Connect cloud";
            account.title = getCloudToken() ? "Cloud account and sync" : "Connect this app to cloud sync";
        }
    }

    function ensureCloudInterface() {
        if (cloudUiReady) return;
        cloudUiReady = true;

        const style = document.createElement("style");
        style.textContent = `
          .cloud-account-wrap{display:flex;align-items:center;gap:8px;min-width:0}
          #cloud-account-button{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:36px;padding:7px 11px;border:1px solid var(--border-strong,#344238);border-radius:10px;background:var(--surface,#101613);color:var(--text,#f0f5f1);font-size:11px;cursor:pointer}
          #cloud-account-button:hover{border-color:var(--accent,#74e5a0);color:var(--accent,#74e5a0)}
          .cloud-sync-dot{width:7px;height:7px;border-radius:50%;background:#87938a;flex:0 0 auto}
          #cloud-status-text{font-size:10px;color:var(--text-secondary,#a0afa4);white-space:nowrap}
          .cloud-modal-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px}
          .cloud-modal{width:min(470px,100%);background:#0d1511;color:#f0f5f1;border:1px solid #344238;border-radius:18px;padding:24px;box-shadow:0 24px 90px #000a}
          .cloud-modal h2{margin:0 0 8px;font-size:22px}.cloud-modal p{color:#a0afa4;font-size:13px;line-height:1.6}
          .cloud-modal label{display:block;margin:12px 0 5px;font-size:12px;color:#cbd7ce}
          .cloud-modal input{width:100%;padding:12px;border:1px solid #344238;border-radius:9px;background:#090c0b;color:#f0f5f1}
          .cloud-modal-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
          .cloud-modal button{padding:10px 14px;border-radius:9px;border:1px solid #344238;background:#141c17;color:#f0f5f1;cursor:pointer}
          .cloud-modal button.primary{background:#74e5a0;color:#07130b;border-color:#74e5a0;font-weight:700}
          .cloud-modal button:disabled{opacity:.55;cursor:wait}.cloud-modal .cloud-error{color:#ff8585;min-height:18px;font-size:12px;margin-top:8px}
          .cloud-modal .cloud-switch{background:transparent;border:0;color:#74e5a0;padding-left:0}
          @media(max-width:650px){#cloud-status-text{display:none}#cloud-account-button{max-width:120px}.cloud-modal{padding:18px}}
        `;
        document.head.appendChild(style);

        const topbar = document.querySelector(".topbar-right");
        if (topbar) {
            const wrap = document.createElement("div");
            wrap.className = "cloud-account-wrap";
            wrap.innerHTML = `<span class="cloud-sync-dot" id="cloud-status-dot"></span><span id="cloud-status-text">Local only</span><button id="cloud-account-button" type="button">Connect cloud</button>`;
            topbar.insertBefore(wrap, topbar.firstChild);
        }

        const backdrop = document.createElement("div");
        backdrop.className = "cloud-modal-backdrop";
        backdrop.id = "cloud-modal-backdrop";
        backdrop.hidden = true;
        backdrop.innerHTML = `
          <section class="cloud-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-modal-title">
            <div class="eyebrow">DISCIPLINE HQ CLOUD</div>
            <h2 id="cloud-modal-title">Sync across your devices</h2>
            <p>Your checklists, daily sessions, reflections, settings, and coaching notes can be shared between your laptop and phone after you sign in to the same account.</p>
            <form id="cloud-auth-form">
              <label for="cloud-email">Email</label>
              <input id="cloud-email" type="email" autocomplete="email" required maxlength="200">
              <label for="cloud-password">Password</label>
              <input id="cloud-password" type="password" autocomplete="current-password" required minlength="12" maxlength="200" placeholder="At least 12 characters">
              <div id="cloud-auth-error" class="cloud-error" role="status"></div>
              <div class="cloud-modal-actions">
                <button class="primary" id="cloud-submit-button" type="submit">Sign in</button>
                <button type="button" id="cloud-cancel-button">Not now</button>
              </div>
              <button type="button" id="cloud-mode-switch" class="cloud-switch">Need an account? Create one</button>
            </form>
            <div id="cloud-merge-actions" hidden>
              <p id="cloud-merge-message"></p>
              <div class="cloud-modal-actions">
                <button class="primary" id="cloud-load-remote" type="button">Load cloud data</button>
                <button id="cloud-upload-local" type="button">Replace cloud with this device's data</button>
              </div>
              <div class="cloud-modal-actions"><button id="cloud-merge-cancel" type="button">Cancel</button></div>
            </div>
          </section>`;
        document.body.appendChild(backdrop);

        let authMode = "login";
        let pendingCloudEnvelope = null;
        const form = document.getElementById("cloud-auth-form");
        const emailInput = document.getElementById("cloud-email");
        const passwordInput = document.getElementById("cloud-password");
        const submitButton = document.getElementById("cloud-submit-button");
        const authError = document.getElementById("cloud-auth-error");
        const switchButton = document.getElementById("cloud-mode-switch");
        const mergeActions = document.getElementById("cloud-merge-actions");

        function showCloudModal() {
            backdrop.hidden = false;
            form.hidden = false;
            mergeActions.hidden = true;
            authError.textContent = "";
            if (getCloudToken()) {
                document.getElementById("cloud-modal-title").textContent = "Cloud account connected";
                form.hidden = true;
                mergeActions.hidden = false;
                document.getElementById("cloud-merge-message").textContent =
                    `Signed in as ${getCloudEmail()}. You can refresh from the cloud or upload this device's current data.`;
                document.getElementById("cloud-load-remote").textContent = "Refresh from cloud";
                document.getElementById("cloud-upload-local").textContent = "Upload this device's data";
                pendingCloudEnvelope = null;
            } else {
                document.getElementById("cloud-modal-title").textContent = "Sync across your devices";
                submitButton.textContent = authMode === "login" ? "Sign in" : "Create account";
                passwordInput.autocomplete = authMode === "login" ? "current-password" : "new-password";
                switchButton.textContent = authMode === "login" ? "Need an account? Create one" : "Already have an account? Sign in";
            }
        }

        document.getElementById("cloud-account-button")?.addEventListener("click", showCloudModal);
        document.getElementById("cloud-cancel-button").addEventListener("click", () => { backdrop.hidden = true; });
        document.getElementById("cloud-merge-cancel").addEventListener("click", () => { backdrop.hidden = true; });
        document.getElementById("cloud-logout-button").addEventListener("click", async () => {
            await logoutCloud();
            backdrop.hidden = true;
        });
        backdrop.addEventListener("click", event => { if (event.target === backdrop) backdrop.hidden = true; });

        switchButton.addEventListener("click", () => {
            authMode = authMode === "login" ? "register" : "login";
            submitButton.textContent = authMode === "login" ? "Sign in" : "Create account";
            passwordInput.autocomplete = authMode === "login" ? "current-password" : "new-password";
            switchButton.textContent = authMode === "login" ? "Need an account? Create one" : "Already have an account? Sign in";
            authError.textContent = authMode === "register"
                ? "Use a strong password with at least 12 characters."
                : "";
        });

        form.addEventListener("submit", async event => {
            event.preventDefault();
            authError.textContent = "";
            submitButton.disabled = true;
            submitButton.textContent = authMode === "login" ? "Signing in…" : "Creating account…";
            try {
                const result = await cloudRequest(authMode === "login" ? "/api/login" : "/api/register", {
                    method: "POST",
                    headers: {},
                    body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value })
                });
                localStorage.setItem(CLOUD_TOKEN_KEY, result.token);
                localStorage.setItem(CLOUD_EMAIL_KEY, result.user.email);
                updateCloudStatus("Checking cloud…", "pending");

                const remote = await cloudRequest("/api/data", { method: "GET" });
                backdrop.hidden = true;
                if (remote.data && (remote.data.state || remote.data.checklists)) {
                    pendingCloudEnvelope = remote.data;
                    cloudLastUpdatedAt = remote.updatedAt || null;
                    backdrop.hidden = false;
                    document.getElementById("cloud-modal-title").textContent = "Choose which data to keep";
                    form.hidden = true;
                    mergeActions.hidden = false;
                    document.getElementById("cloud-merge-message").textContent =
                        "This account already has cloud data. Load it onto this device, or deliberately replace the cloud copy with this device's current local data.";
                    document.getElementById("cloud-load-remote").textContent = "Load cloud data on this device";
                    document.getElementById("cloud-upload-local").textContent = "Replace cloud with this device's data";
                    updateCloudStatus("Choose sync direction", "pending");
                } else {
                    await pushCloudData();
                    backdrop.hidden = true;
                    startCloudPolling();
                    showToast("Cloud account connected. This device's existing data was uploaded.");
                }
                updateCloudStatus("Connected", "success");
            } catch (error) {
                authError.textContent = error.message || "Could not connect to cloud.";
                backdrop.hidden = false;
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = authMode === "login" ? "Sign in" : "Create account";
            }
        });

        document.getElementById("cloud-load-remote").addEventListener("click", async () => {
            try {
                let envelope = pendingCloudEnvelope;
                if (!envelope) {
                    const remote = await cloudRequest("/api/data", { method: "GET" });
                    envelope = remote.data;
                }
                if (!envelope) throw new Error("No cloud data exists for this account yet.");
                applyCloudEnvelope(envelope);
                const remote = await cloudRequest("/api/data", { method: "GET" });
                cloudLastUpdatedAt = remote.updatedAt || null;
                backdrop.hidden = true;
                startCloudPolling();
                updateCloudStatus("Synced", "success");
                showToast("Cloud data loaded on this device.");
            } catch (error) {
                document.getElementById("cloud-auth-error").textContent = error.message;
                form.hidden = true;
                mergeActions.hidden = false;
                backdrop.hidden = false;
            }
        });

        document.getElementById("cloud-upload-local").addEventListener("click", async () => {
            if (!window.confirm("This will replace the cloud copy for this account with this device's current app data. Continue only if this is the data you want to keep.")) return;
            try {
                await pushCloudData();
                const remote = await cloudRequest("/api/data", { method: "GET" });
                cloudLastUpdatedAt = remote.updatedAt || null;
                backdrop.hidden = true;
                startCloudPolling();
                updateCloudStatus("Synced", "success");
                showToast("This device's data has been uploaded to the cloud.");
            } catch (error) {
                document.getElementById("cloud-auth-error").textContent = error.message;
            }
        });

        // Existing sessions can be logged out without deleting the local copy.
        if (getCloudToken()) {
            updateCloudStatus("Connected", "success");
            startCloudPolling();
        } else {
            updateCloudStatus("Local only");
        }
    }

    async function logoutCloud() {
        const token = getCloudToken();
        try {
            if (token) await cloudRequest("/api/logout", { method: "POST" });
        } catch (error) {
            console.warn("Cloud logout request failed:", error);
        }
        localStorage.removeItem(CLOUD_TOKEN_KEY);
        localStorage.removeItem(CLOUD_EMAIL_KEY);
        if (cloudPollingTimer) clearInterval(cloudPollingTimer);
        updateCloudStatus("Local only");
        showToast("Signed out of cloud. Local data remains on this device.");
    }

    function startCloudPolling() {
        if (cloudPollingTimer) clearInterval(cloudPollingTimer);
        cloudPollingTimer = setInterval(async () => {
            if (!getCloudToken() || cloudSyncPaused || document.hidden) return;
            try {
                const remote = await cloudRequest("/api/data", { method: "GET" });
                if (!remote.data) return;
                const stamp = remote.updatedAt || remote.data.clientUpdatedAt || null;
                if (!cloudLastUpdatedAt) {
                    cloudLastUpdatedAt = stamp;
                    return;
                }
                if (stamp && stamp > cloudLastUpdatedAt) {
                    const hasUnsaved = document.getElementById("daily-save-status")?.textContent?.toLowerCase().includes("unsaved")
                        || document.getElementById("reflection-save-status")?.textContent?.toLowerCase().includes("unsaved");
                    if (hasUnsaved) {
                        updateCloudStatus("Other device changed data", "pending");
                        return;
                    }
                    applyCloudEnvelope(remote.data);
                    cloudLastUpdatedAt = stamp;
                    updateCloudStatus("Updated from cloud", "success");
                }
            } catch (error) {
                console.warn("Cloud polling failed:", error);
                if (error.message && error.message.includes("sign in")) updateCloudStatus("Sign in required", "error");
            }
        }, 12000);
    }


    /* ========================================================
       INITIALIZATION
       ======================================================== */

    function initialize() {
        state = loadState();

        bindEvents();
        ensureCloudInterface();

        document.getElementById("session-date").value = todayKey();

        loadSettingsForm();
        applyAppearancePreferences();
        renderNurseHistory();

        renderDailySession();
        renderDashboard();
        renderHistory();
        renderAnalytics();
        renderReflections();
        renderChecklistEditor();

        selectStage(selectedStage);

        if (!getCloudToken()) {
            setTimeout(() => showToast("Local mode: select Connect cloud to sync this app across devices.", "info"), 900);
        }
        console.info("Discipline HQ frontend initialized.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, {
            once: true
        });
    } else {
        initialize();
    }

    window.disciplineHQScheduleCloudSync = () => scheduleCloudSync();

})();


/* Small UI enhancements for the redesigned Discipline HQ shell. */
(() => {
  const themeButton = document.getElementById("theme-toggle");
  const search = document.getElementById("global-search");
  if (themeButton) {
    const storedTheme = localStorage.getItem("discipline-hq-theme");
    if (storedTheme === "light") document.body.classList.add("light-theme");
    themeButton.addEventListener("click", () => {
      document.body.classList.toggle("light-theme");
      localStorage.setItem("discipline-hq-theme", document.body.classList.contains("light-theme") ? "light" : "dark");
      if (typeof window.disciplineHQScheduleCloudSync === "function") window.disciplineHQScheduleCloudSync();
    });
  }
  if (search) {
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const query = search.value.trim().toLowerCase();
      if (!query) return;
      const labels = [...document.querySelectorAll(".nav-item")];
      const match = labels.find(button => button.textContent.toLowerCase().includes(query));
      if (match) match.click();
      else {
        const visibleText = [...document.querySelectorAll("h1,h2,h3,.section-heading,p,label")]
          .find(el => el.textContent.toLowerCase().includes(query));
        if (visibleText) visibleText.scrollIntoView({behavior:"smooth", block:"center"});
      }
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); search.focus(); search.select();
      }
      if (event.key === "Escape" && document.activeElement === search) {
        search.value = ""; search.blur();
      }
    });
  }
})();
