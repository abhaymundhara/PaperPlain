let currentSummary = "";
let currentPaper = null;
let savedPapers = [];
let currentPaperId = null;
let projectFilter = "";
let currentTags = [];
let currentQaHistory = [];
let currentSourceType = "arxiv";
let currentPage = 1;
const THEME_STORAGE_KEY = "paperplain-theme";
const WARM_STORAGE_KEY = "paperplain-warm";
const DRAFT_STORAGE_KEY = "paperplain:draft";

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- API Helper ---
async function apiRequest(path, { method = "GET", body, cache } = {}) {
  const controller = new AbortController();
  const timeoutMs = 20000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const options = {
    method,
    headers: {},
    credentials: "same-origin",
    signal: controller.signal,
  };
  if (typeof cache === "string") {
    options.cache = cache;
  }

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type") || "";
  let data;
  try {
    data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.message || data?.error || "Request failed";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

function getStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function persistDraft() {
  if (!currentPaper || currentPaperId) return;
  const projectEl = document.getElementById("paperProject");
  const notesEl = document.getElementById("userNotes");
  const draft = {
    paper: {
      arxivId: currentPaper.arxivId || "",
      title: currentPaper.title || "",
      authors: currentPaper.authors || "",
      abstract: currentPaper.abstract || "",
      pdfUrl: currentPaper.pdfUrl || "",
      summary: currentPaper.summary || "",
    },
    project: projectEl?.value?.trim() || currentPaper.project || "",
    tags: Array.isArray(currentTags) ? currentTags : [],
    notes: notesEl?.value || "",
    qaHistory: Array.isArray(currentQaHistory) ? currentQaHistory : [],
    savedAt: Date.now(),
  };
  setStoredValue(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

function renderSummary(summaryText) {
  const summary = (summaryText || "").toString();
  const keyTermsMatch = summary.match(
    /(\*\*\s*Key\s*Terms\s*:\s*\*\*|Key\s*Terms\s*:)/i,
  );
  const keyTermsIndex = keyTermsMatch?.index ?? -1;

  const mainSummary = (
    keyTermsIndex >= 0 ? summary.slice(0, keyTermsIndex) : summary
  ).trim();
  let keyTerms = keyTermsIndex >= 0 ? summary.slice(keyTermsIndex).trim() : "";
  if (keyTerms) {
    keyTerms = keyTerms.replace(
      /^(\*\*\s*)?Key\s*Terms\s*:\s*(\*\*)?/i,
      "**Key Terms:**",
    );
  }

  document.getElementById("summaryContent").innerHTML =
    formatMarkdown(mainSummary);

  const takeawaysEl = document.getElementById("takeawaysContent");
  if (keyTerms) {
    takeawaysEl.innerHTML = formatMarkdown(keyTerms);
    takeawaysEl.parentElement.style.display = "block";
  } else {
    takeawaysEl.parentElement.style.display = "none";
  }
}

function renderDraft(draft) {
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("results").style.display = "block";
  document.querySelector(".right-panel").style.display = "flex";

  document.getElementById("paperTitle").textContent =
    currentPaper.title || "Untitled";
  document.getElementById("paperAuthors").textContent =
    currentPaper.authors || "";
  document.getElementById("paperDate").textContent = "";

  updatePdfLink(currentPaper.pdfUrl);

  const citeBtn = document.getElementById("paperCiteBtn");
  if (citeBtn)
    citeBtn.style.display = currentPaper.arxivId ? "inline-flex" : "none";

  const exportBtn = document.getElementById("paperExportBtn");
  if (exportBtn) exportBtn.style.display = "inline-flex";

  renderSummary(currentPaper.summary);

  document.getElementById("paperProject").value = draft.project || "";
  document.getElementById("userNotes").value = draft.notes || "";
  renderTags();
  renderQaHistory(currentQaHistory);
  updateSaveButtonState();

  const status = document.getElementById("saveStatus");
  if (status) status.textContent = "Saved (Local)";
}

function restoreDraft() {
  if (currentPaper || currentPaperId) return;
  const raw = getStoredValue(DRAFT_STORAGE_KEY);
  if (!raw) return;
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    return;
  }

  const paper = draft?.paper || {};
  if (!paper.summary && !paper.title) return;

  currentPaper = {
    arxivId: paper.arxivId || "",
    title: paper.title || "",
    authors: paper.authors || "",
    abstract: paper.abstract || "",
    pdfUrl: paper.pdfUrl || "",
    summary: paper.summary || "",
    project: draft.project || "",
    tags: Array.isArray(draft.tags) ? draft.tags : [],
  };
  currentPaperId = null;
  currentTags = Array.isArray(draft.tags) ? draft.tags : [];
  currentQaHistory = Array.isArray(draft.qaHistory) ? draft.qaHistory : [];

  renderDraft(draft);
}

function updateThemeToggle(theme) {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  btn.setAttribute("aria-pressed", isDark ? "true" : "false");
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
  btn.classList.toggle("is-active", isDark);
}

function updateWarmToggle(isWarm) {
  const btn = document.getElementById("warmToggleBtn");
  if (!btn) return;
  const label = isWarm ? "Warm mode on" : "Warm mode off";
  btn.setAttribute("aria-pressed", isWarm ? "true" : "false");
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
  btn.classList.toggle("is-active", isWarm);
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", nextTheme);
  updateThemeToggle(nextTheme);
}

function applyWarm(isWarm) {
  document.documentElement.setAttribute("data-warm", isWarm ? "on" : "off");
  updateWarmToggle(isWarm);
}

function initTheme() {
  const storedTheme = getStoredValue(THEME_STORAGE_KEY);
  const storedWarm = getStoredValue(WARM_STORAGE_KEY);
  const theme = storedTheme === "dark" ? "dark" : "light";
  const isWarm = storedWarm === "on";
  applyTheme(theme);
  applyWarm(isWarm);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  setStoredValue(THEME_STORAGE_KEY, next);
  applyTheme(next);
}

function toggleWarm() {
  const current = document.documentElement.getAttribute("data-warm");
  const next = current !== "on";
  setStoredValue(WARM_STORAGE_KEY, next ? "on" : "off");
  applyWarm(next);
}

// --- Auth Functions ---
function toggleAuthPanel() {
  const overlay = document.getElementById("authOverlay");
  const isOpen = overlay.style.display !== "none";
  overlay.style.display = isOpen ? "none" : "flex";
  hideAuthError();

  if (!isOpen) {
    document.getElementById("googleSignInBtn")?.focus();
  }
}

function openAuthPanel() {
  const overlay = document.getElementById("authOverlay");
  if (!overlay || overlay.style.display !== "none") return;
  overlay.style.display = "flex";
  hideAuthError();
  document.getElementById("googleSignInBtn")?.focus();
}

function handleAuthRequired(error) {
  if (error?.status === 401) {
    showToast("Sign in to save papers", "error");
    openAuthPanel();
    return true;
  }
  return false;
}

function getInitials(name, email) {
  const base = (name || email || "").trim();
  if (!base) return "U";
  const atSplit = base.split("@")[0];
  const parts = atSplit.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const cleaned = parts[0].replace(/[^a-zA-Z0-9]/g, "");
    return cleaned.slice(0, 2).toUpperCase() || "U";
  }
  const first = parts[0][0] || "";
  const last = parts[parts.length - 1][0] || "";
  return `${first}${last}`.toUpperCase() || "U";
}

function setUserMenuOpen(open) {
  const menuButton = document.getElementById("userMenuButton");
  const menuDropdown = document.getElementById("userMenuDropdown");
  if (!menuButton || !menuDropdown) return;
  menuDropdown.style.display = open ? "flex" : "none";
  menuButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleUserMenu() {
  const menuDropdown = document.getElementById("userMenuDropdown");
  if (!menuDropdown) return;
  const isOpen = menuDropdown.style.display !== "none";
  setUserMenuOpen(!isOpen);
}

function closeUserMenu() {
  setUserMenuOpen(false);
}

function openSettingsModal() {
  closeUserMenu();
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return;
  overlay.style.display = "flex";
}

function closeSettingsModal() {
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return;
  overlay.style.display = "none";
}

function showAuthError(message) {
  const el = document.getElementById("authError");
  if (!el) return;
  el.textContent = message;
  el.style.display = "block";
}

function hideAuthError() {
  const el = document.getElementById("authError");
  if (el) el.style.display = "none";
}

async function continueWithGoogle() {
  hideAuthError();
  try {
    const callbackURL = `${window.location.pathname}${window.location.search}`;
    const response = await apiRequest(SOCIAL_SIGN_IN_PATH, {
      method: "POST",
      body: buildSocialSignInPayload({
        provider: "google",
        callbackURL: callbackURL || "/",
      }),
    });
    const redirectUrl = getSocialRedirectUrl(response);
    if (!redirectUrl) {
      throw new Error("Google sign-in could not start. Please try again.");
    }
    window.location.href = redirectUrl;
  } catch (error) {
    showAuthError(error.message || "Google sign-in failed");
  }
}

async function handleSignOut() {
  closeUserMenu();
  await signOut();
}

async function signOut() {
  try {
    await apiRequest("/api/auth/signout", { method: "POST" });
    showToast("Signed out", "success");
  } catch {
    // ignore
  }
  await refreshSession();
}

async function refreshSession() {
  const signInBtn = document.getElementById("signInBtn");
  const userMenu = document.getElementById("userMenu");
  const userMenuButton = document.getElementById("userMenuButton");
  const userAvatarInitials = document.getElementById("userAvatarInitials");

  try {
    const session = await apiRequest("/api/auth/me");
    if (session?.user?.email) {
      const initials = getInitials(session.user.name, session.user.email);
      if (userAvatarInitials) {
        userAvatarInitials.textContent = initials;
      }
      if (userMenuButton) {
        const label = session.user.name || session.user.email || "Account";
        userMenuButton.setAttribute("aria-label", `${label} menu`);
      }
      if (userMenu) userMenu.style.display = "flex";
      if (signInBtn) signInBtn.style.display = "none";

      await loadSavedPapers();
      return;
    }
  } catch {
    // ignore
  }

  closeUserMenu();
  if (userMenu) userMenu.style.display = "none";
  if (signInBtn) signInBtn.style.display = "inline-flex";
  savedPapers = [];
  renderSavedList();
  currentPaperId = null;
}

// --- Main Logic ---

function openPdfPicker() {
  const input = document.getElementById("pdfUploadInput");
  if (input) input.click();
}

async function uploadPdf(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (file.type !== "application/pdf") {
    showToast("Please select a PDF file", "error");
    event.target.value = "";
    return;
  }

  const btn = document.getElementById("uploadPdfBtn");
  const simplifyBtn = document.getElementById("simplifyBtn");
  const original = btn?.textContent || "Upload PDF";

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Uploading…";
    }
    if (simplifyBtn) simplifyBtn.disabled = true;

    const form = new FormData();
    form.append("pdf", file);
    form.append("filename", file.name);

    const response = await fetch("/api/simplify/pdf", {
      method: "POST",
      body: form,
    });

    const result = await response.json();
    if (!response.ok || !result?.success) {
      throw new Error(
        result?.message || result?.error || "Failed to simplify PDF",
      );
    }

    displayResults(result.data || {});
    showToast("PDF simplified", "success");
  } catch (e) {
    showToast(e?.message || "Failed to simplify PDF", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original;
    }
    if (simplifyBtn) simplifyBtn.disabled = false;
    event.target.value = "";
  }
}

async function simplifyPaper() {
  const style = document.getElementById("summaryStyle")?.value || "simple";
  let url = "";
  let endpoint = "/api/simplify";
  let body = {};

  if (currentSourceType === "arxiv") {
    const urlInput = document.getElementById("arxivUrl");
    url = urlInput?.value?.trim() || "";
    if (!url) {
      showToast("Please enter an arXiv URL", "error");
      return;
    }
    endpoint = "/api/simplify";
    body = { arxivUrl: url, style };
  } else if (currentSourceType === "doi") {
    const doiInput = document.getElementById("doiInput");
    url = doiInput?.value?.trim() || "";
    if (!url) {
      showToast("Please enter a DOI", "error");
      return;
    }
    endpoint = "/api/simplify/doi";
    body = { doi: url, style };
  } else if (currentSourceType === "pubmed") {
    const pubmedInput = document.getElementById("pubmedInput");
    url = pubmedInput?.value?.trim() || "";
    if (!url) {
      showToast("Please enter a PMID", "error");
      return;
    }
    endpoint = "/api/simplify/pubmed";
    body = { pmid: url, style };
  }

  const btn = document.getElementById("simplifyBtn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Processing...';

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!result.success)
      throw new Error(result.error || "Failed to simplify paper");

    displayResults(result.data);

    // Fetch suggestions after displaying results
    if (result.data.title && result.data.abstract) {
      fetchSuggestions(result.data);
    }
  } catch (error) {
    showToast(error.message || "An error occurred", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function selectSourceType(type) {
  currentSourceType = type;

  // Update tab styles
  document.querySelectorAll(".source-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.type === type);
  });

  // Show/hide inputs
  document.querySelectorAll(".source-input").forEach((input) => {
    input.style.display = "none";
  });
  document.querySelector(`.source-${type}`).style.display = "block";
}

async function regenerateSummary() {
  if (!currentPaper) return;

  const style = document.getElementById("summaryStyle")?.value || "simple";
  let endpoint = "/api/simplify";
  let body = { style };

  if (currentPaper.arxivId) {
    body.arxivUrl = `https://arxiv.org/abs/${currentPaper.arxivId}`;
  } else if (currentPaper.doi) {
    endpoint = "/api/simplify/doi";
    body.doi = currentPaper.doi;
  } else if (currentPaper.pmid) {
    endpoint = "/api/simplify/pubmed";
    body.pmid = currentPaper.pmid;
  } else {
    showToast("Cannot regenerate: no source identifier", "error");
    return;
  }

  const btn = document.getElementById("regenerateBtn");
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span>';

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!result.success)
      throw new Error(result.error || "Failed to regenerate");

    currentPaper.summary = result.data.simplifiedSummary;
    renderSummary(result.data.simplifiedSummary);
    currentSummary = result.data.simplifiedSummary;

    // Update draft
    persistDraft();
  } catch (error) {
    showToast(error.message || "Failed to regenerate", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

async function runCriticalAnalysis() {
  if (!currentPaper) return;

  const section = document.getElementById("criticalAnalysisSection");
  const content = document.getElementById("criticalAnalysisContent");

  section.style.display = "block";
  content.innerHTML = '<span class="loader"></span> Analyzing...';

  try {
    const response = await fetch("/api/analyze/critical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paper: currentPaper,
        summary: currentSummary,
      }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to analyze");

    content.innerHTML = formatMarkdown(result.data.analysis);
    section.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    content.innerHTML = `<p class="error">${error.message || "Analysis failed"}</p>`;
  }
}

async function fetchSuggestions(paper) {
  try {
    const response = await fetch("/api/analyze/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paper }),
    });

    const result = await response.json();
    if (result.success && result.data.suggestions?.length > 0) {
      displaySuggestions(result.data.suggestions);
    }
  } catch (e) {
    // Silently fail - suggestions are optional
  }
}

function displaySuggestions(suggestions) {
  const container = document.getElementById("qaSuggestions");
  const list = document.getElementById("suggestionsList");

  list.innerHTML = suggestions
    .map(
      (q) =>
        `<button class="suggestion-chip" onclick="useSuggestion(this)">${escapeHtml(q)}</button>`,
    )
    .join("");

  container.style.display = "block";
}

function useSuggestion(btn) {
  const input = document.getElementById("qaInput");
  input.value = btn.textContent;
  input.focus();
  document.getElementById("qaSuggestions").style.display = "none";
}

async function copyTextToClipboard(text) {
  if (!text) throw new Error("Nothing to copy");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyCitation() {
  const citeBtn = document.getElementById("paperCiteBtn");
  const arxivId = currentPaper?.arxivId;

  if (!arxivId) {
    showToast("No arXiv ID available for citation", "error");
    return;
  }

  const original = citeBtn?.textContent || "Cite";
  if (citeBtn) {
    citeBtn.disabled = true;
    citeBtn.textContent = "Loading…";
  }

  try {
    const response = await apiRequest(
      `/api/arxiv/${encodeURIComponent(arxivId)}/bibtex`,
      { cache: "no-store" },
    );
    const bibtex = (response?.bibtex || "").toString().trim();
    if (!bibtex) throw new Error("Failed to fetch BibTeX");
    await copyTextToClipboard(bibtex);
    showToast("BibTeX copied", "success");
  } catch (e) {
    showToast(e?.message || "Failed to copy citation", "error");
  } finally {
    if (citeBtn) {
      citeBtn.disabled = false;
      citeBtn.textContent = original;
    }
  }
}

async function downloadPdf() {
  if (!currentPaper?.pdfUrl) {
    showToast("No PDF available", "error");
    return;
  }

  const btn = document.getElementById("paperPdfLink");
  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Downloading…";
  }

  const arxivId = currentPaper.arxivId;
  const downloadUrl = arxivId
    ? `/api/arxiv/${encodeURIComponent(arxivId)}/pdf`
    : currentPaper.pdfUrl;
  const filename = `${safeFilename(arxivId || currentPaper.title || "paper")}.pdf`;

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error("Failed to download PDF");
    const blob = await response.blob();
    downloadBlob(blob, filename);
    showToast("PDF downloaded", "success");
  } catch (error) {
    if (!arxivId && currentPaper.pdfUrl) {
      const link = document.createElement("a");
      link.href = currentPaper.pdfUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("Downloading PDF", "success");
    } else {
      showToast(error?.message || "Failed to download PDF", "error");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      if (original) {
        btn.innerHTML = original;
      } else {
        btn.textContent = "PDF";
      }
    }
  }
}

function displayResults(data) {
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("results").style.display = "block";
  document.querySelector(".right-panel").style.display = "flex";

  document.getElementById("paperTitle").textContent = data.title;
  document.getElementById("paperAuthors").textContent = data.authors;

  // Show date
  const date =
    data.published || data.year
      ? new Date(data.published || `${data.year}-01-01`)
      : null;
  document.getElementById("paperDate").textContent =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : data.year || "";

  // Show source badge
  const sourceEl = document.getElementById("paperSource");
  if (sourceEl) {
    const sourceLabel =
      data.source === "crossref"
        ? "DOI"
        : data.source === "pubmed"
          ? "PubMed"
          : data.source === "pdf"
            ? "PDF"
            : "arXiv";
    sourceEl.textContent = sourceLabel;
    sourceEl.style.display = "inline-flex";
  }

  updatePdfLink(data.pdfUrl);

  const citeBtn = document.getElementById("paperCiteBtn");
  if (citeBtn) citeBtn.style.display = data.arxivId ? "inline-flex" : "none";

  const exportBtn = document.getElementById("paperExportBtn");
  if (exportBtn) exportBtn.style.display = "inline-flex";

  const summaryText = (data.simplifiedSummary || "").toString();
  renderSummary(summaryText);

  // Hide critical analysis section when loading new paper
  document.getElementById("criticalAnalysisSection").style.display = "none";

  // Hide suggestions
  document.getElementById("qaSuggestions").style.display = "none";

  // Reset State
  currentPaper = {
    arxivId: data.arxivId || "",
    doi: data.doi || "",
    pmid: data.pmid || "",
    title: data.title,
    authors: data.authors,
    abstract: data.abstract,
    pdfUrl: data.pdfUrl,
    summary: data.simplifiedSummary,
    source: data.source || "arxiv",
    journal: data.journal || "",
    year: data.year || null,
    citationCount: data.citationCount || 0,
    project: "",
    tags: [],
  };
  currentPaperId = null;
  currentTags = [];
  currentSummary = summaryText;

  document.getElementById("paperProject").value = "";
  document.getElementById("userNotes").value = "";
  renderTags();

  // Update Save Button
  updateSaveButtonState();
  persistDraft();
}

function safeFilename(name) {
  return (name || "paper")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getExportState() {
  if (!currentPaper) return null;
  return {
    title: currentPaper.title || "Untitled",
    authors: currentPaper.authors || "",
    arxivId: currentPaper.arxivId || "",
    doi: currentPaper.doi || "",
    pmid: currentPaper.pmid || "",
    pdfUrl: currentPaper.pdfUrl || "",
    project: document.getElementById("paperProject")?.value?.trim() || "",
    tags: Array.isArray(currentTags) ? currentTags : [],
    notes: document.getElementById("userNotes")?.value || "",
    summary: currentPaper.summary || "",
    qa: Array.isArray(currentQaHistory) ? currentQaHistory : [],
  };
}

async function exportFormat(format) {
  closeExportMenu();

  if (!currentPaperId) {
    // Fallback to old export for non-saved papers
    if (format === "markdown") {
      exportMarkdown();
    } else if (format === "json") {
      exportJson();
    } else {
      showToast("Please save the paper first", "error");
    }
    return;
  }

  try {
    const response = await fetch(
      `/api/papers/${currentPaperId}/export?format=${format}`,
      {
        method: "GET",
        credentials: "same-origin",
      },
    );

    if (!response.ok) {
      throw new Error("Export failed");
    }

    const contentType = response.headers.get("content-type") || "text/plain";
    const blob = await response.blob();
    const ext = format === "bibtex" ? "bib" : format;
    const filename = `paper.${ext}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${format.toUpperCase()}`, "success");
  } catch (error) {
    showToast(error.message || "Export failed", "error");
  }
}

async function exportMarkdown() {
  closeExportMenu();
  const state = getExportState();
  if (!state) {
    showToast("No paper to export", "error");
    return;
  }

  const { title, authors, project, tags, notes, summary, pdfUrl, arxivId, qa } =
    state;

  let bibtex = "";
  if (arxivId) {
    try {
      const resp = await apiRequest(
        `/api/arxiv/${encodeURIComponent(arxivId)}/bibtex`,
        { cache: "no-store" },
      );
      bibtex = (resp?.bibtex || "").toString().trim();
    } catch {
      bibtex = "";
    }
  }

  const lines = [];
  lines.push(`# ${title}`);
  if (authors) lines.push(`**Authors:** ${authors}`);
  if (arxivId) lines.push(`**arXiv:** ${arxivId}`);
  if (pdfUrl) lines.push(`**PDF:** ${pdfUrl}`);
  if (project) lines.push(`**Project:** ${project}`);
  if (tags.length) lines.push(`**Tags:** ${tags.join(", ")}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(summary || "(none)");
  lines.push("");

  lines.push("## Notes");
  lines.push(notes?.trim() ? notes.trim() : "(none)");
  lines.push("");

  lines.push("## Q&A");
  if (!qa.length) {
    lines.push("(none)");
  } else {
    for (const m of qa) {
      const role = m.role === "user" ? "You" : "AI";
      lines.push(
        `- **${role}:** ${String(m.text || "")
          .replace(/\n/g, " ")
          .trim()}`,
      );
    }
  }
  lines.push("");

  if (bibtex) {
    lines.push("## BibTeX");
    lines.push("```bibtex");
    lines.push(bibtex);
    lines.push("```");
    lines.push("");
  }

  const md = lines.join("\n");
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const base = safeFilename(arxivId || title);
  downloadBlob(blob, `${base || "paper"}.md`);

  showToast("Exported Markdown", "success");
}

function exportText() {
  closeExportMenu();
  const state = getExportState();
  if (!state) {
    showToast("No paper to export", "error");
    return;
  }

  const { title, authors, arxivId, pdfUrl, project, tags, summary, notes, qa } =
    state;

  const lines = [];
  lines.push(title);
  if (authors) lines.push(`Authors: ${authors}`);
  if (arxivId) lines.push(`arXiv: ${arxivId}`);
  if (pdfUrl) lines.push(`PDF: ${pdfUrl}`);
  if (project) lines.push(`Project: ${project}`);
  if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
  lines.push("");
  lines.push("Summary");
  lines.push(summary || "(none)");
  lines.push("");
  lines.push("Notes");
  lines.push(notes?.trim() ? notes.trim() : "(none)");
  lines.push("");
  lines.push("Q&A");
  if (!qa.length) {
    lines.push("(none)");
  } else {
    for (const m of qa) {
      const role = m.role === "user" ? "You" : "AI";
      lines.push(
        `${role}: ${String(m.text || "")
          .replace(/\n/g, " ")
          .trim()}`,
      );
    }
  }

  const text = lines.join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const base = safeFilename(arxivId || title);
  downloadBlob(blob, `${base || "paper"}.txt`);
  showToast("Exported text", "success");
}

function exportJson() {
  closeExportMenu();
  const state = getExportState();
  if (!state) {
    showToast("No paper to export", "error");
    return;
  }

  const payload = {
    title: state.title,
    authors: state.authors,
    arxivId: state.arxivId,
    pdfUrl: state.pdfUrl,
    project: state.project,
    tags: state.tags,
    summary: state.summary,
    notes: state.notes,
    qa: state.qa,
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const base = safeFilename(state.arxivId || state.title);
  downloadBlob(blob, `${base || "paper"}.json`);
  showToast("Exported JSON", "success");
}

async function exportBibtex() {
  closeExportMenu();
  const arxivId = currentPaper?.arxivId;
  if (!arxivId) {
    showToast("No arXiv ID available", "error");
    return;
  }

  try {
    const response = await apiRequest(
      `/api/arxiv/${encodeURIComponent(arxivId)}/bibtex`,
      { cache: "no-store" },
    );
    const bibtex = (response?.bibtex || "").toString().trim();
    if (!bibtex) throw new Error("Failed to fetch BibTeX");
    const blob = new Blob([bibtex], { type: "text/plain;charset=utf-8" });
    const base = safeFilename(arxivId || currentPaper.title || "paper");
    downloadBlob(blob, `${base || "paper"}.bib`);
    showToast("Exported BibTeX", "success");
  } catch (error) {
    showToast(error?.message || "Failed to export BibTeX", "error");
  }
}

function formatMarkdown(text) {
  if (!text) return "";

  const renderInline = (str) =>
    str.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  const lines = escapeHtml(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }

    const h3 = trimmed.match(/^##\s+(.*)$/);
    const h4 = trimmed.match(/^###\s+(.*)$/);
    const li = trimmed.match(/^[\-\•]\s+(.*)$/);

    if (h4) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<h4>${renderInline(h4[1])}</h4>`);
      continue;
    }

    if (h3) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<h3>${renderInline(h3[1])}</h3>`);
      continue;
    }

    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${renderInline(li[1])}</li>`);
      continue;
    }

    if (inList) {
      out.push("</ul>");
      inList = false;
    }

    out.push(`<p>${renderInline(trimmed)}</p>`);
  }

  if (inList) out.push("</ul>");

  return out.join("\n");
}

function updatePdfLink(pdfUrl) {
  const pdfLink = document.getElementById("paperPdfLink");
  if (!pdfLink) return;
  if (pdfUrl) {
    pdfLink.style.display = "inline-flex";
    pdfLink.dataset.url = pdfUrl;
  } else {
    pdfLink.style.display = "none";
    pdfLink.dataset.url = "";
  }
}

function setExportMenuOpen(open) {
  const menu = document.getElementById("exportMenu");
  if (!menu) return;
  menu.style.display = open ? "flex" : "none";
}

function toggleExportMenu() {
  const menu = document.getElementById("exportMenu");
  if (!menu) return;
  const isOpen = menu.style.display !== "none";
  setExportMenuOpen(!isOpen);
}

function closeExportMenu() {
  setExportMenuOpen(false);
}

// --- Tags & Project ---

function handleTagInput(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    const val = event.target.value.trim();
    if (val && !currentTags.includes(val)) {
      currentTags.push(val);
      renderTags();
      event.target.value = "";
      if (currentPaperId) {
        savePaperUpdates();
      } else {
        persistDraft();
      }
    }
  }
}

function removeTag(tag) {
  currentTags = currentTags.filter((t) => t !== tag);
  renderTags();
  if (currentPaperId) {
    savePaperUpdates();
  } else {
    persistDraft();
  }
}

function renderTags() {
  const container = document.getElementById("tagsList");
  container.innerHTML = "";
  currentTags.forEach((tag) => {
    const chip = document.createElement("div");
    chip.className = "tag-chip";

    const label = document.createElement("span");
    label.textContent = tag;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag-remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => removeTag(tag));

    chip.appendChild(label);
    chip.appendChild(remove);
    container.appendChild(chip);
  });
}

function normalizeTags(raw) {
  if (Array.isArray(raw))
    return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    // Postgres array text format: {a,b}
    if (s.startsWith("{") && s.endsWith("}")) {
      return s
        .slice(1, -1)
        .split(",")
        .map((t) => t.replace(/^"|"$/g, "").trim())
        .filter(Boolean);
    }
    // JSON array string
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed))
        return parsed.map((t) => String(t).trim()).filter(Boolean);
    } catch {
      // ignore
    }
    return s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function renderQaHistory(messages) {
  const container = document.getElementById("qaHistory");
  container.innerHTML = "";

  if (!Array.isArray(messages) || messages.length === 0) {
    const welcome = document.createElement("div");
    welcome.className = "qa-welcome";
    welcome.innerHTML = "<p>Ask questions about the paper.</p>";
    container.appendChild(welcome);
    return;
  }

  for (const m of messages) {
    appendQaMessage(m.text, m.role === "user" ? "user" : "ai", m.id);
  }
}

async function persistQaHistory() {
  if (!currentPaperId) return;
  try {
    await apiRequest(`/api/papers/${currentPaperId}`, {
      method: "PATCH",
      body: { qa_history: currentQaHistory },
    });
  } catch {
    // ignore persistence errors (don't disrupt chat)
  }
}

function updatePaperProject() {
  if (currentPaper) {
    currentPaper.project = document.getElementById("paperProject").value.trim();
    if (currentPaperId) {
      savePaperUpdates();
    } else {
      persistDraft();
    }
  }
}

async function savePaper() {
  if (!currentPaper) return;

  const project = document.getElementById("paperProject").value.trim();
  const notes = document.getElementById("userNotes")?.value || "";

  let body = {
    summary: currentPaper.summary,
    project,
    tags: currentTags,
    notes,
  };

  // Handle different source types
  if (currentPaper.arxivId) {
    body.arxivUrl = `https://arxiv.org/abs/${currentPaper.arxivId}`;
  } else if (currentPaper.doi) {
    body.doi = currentPaper.doi;
    body.source = "crossref";
    body.title = currentPaper.title;
    body.authors = currentPaper.authors;
    body.abstract = currentPaper.abstract;
    body.journal = currentPaper.journal;
    body.year = currentPaper.year;
  } else if (currentPaper.pmid) {
    body.pmid = currentPaper.pmid;
    body.source = "pubmed";
    body.title = currentPaper.title;
    body.authors = currentPaper.authors;
    body.abstract = currentPaper.abstract;
    body.journal = currentPaper.journal;
    body.year = currentPaper.year;
  } else {
    // Manual paper entry
    body.title = currentPaper.title;
    body.authors = currentPaper.authors;
    body.abstract = currentPaper.abstract;
    body.source = currentPaper.source || "manual";
  }

  try {
    const endpoint = body.arxivUrl
      ? "/api/papers/import"
      : "/api/papers/manual";

    const response = await apiRequest(endpoint, {
      method: "POST",
      body,
    });

    if (response?.paper?.id) {
      currentPaperId = response.paper.id;
      currentPaper.project = response.paper.project || project;
      currentPaper.tags = response.paper.tags || currentTags;
      showToast("Paper saved to library", "success");
      updateSaveButtonState();
      clearDraft();
      await loadSavedPapers();
    }
  } catch (error) {
    if (handleAuthRequired(error)) return;
    showToast(error?.message || "Failed to save paper", "error");
  }
}

async function deleteSavedPaper() {
  if (!currentPaperId) return;
  const deleteBtn = document.getElementById("paperDeleteBtn");
  const original = deleteBtn?.textContent || "Delete";
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting…";
  }

  const deletingId = currentPaperId;
  try {
    await apiRequest(`/api/papers/${deletingId}`, { method: "DELETE" });
    savedPapers = savedPapers.filter((p) => p.id !== deletingId);
    currentPaperId = null;
    updateSaveButtonState();
    renderSavedList();
    persistDraft();
    const status = document.getElementById("saveStatus");
    if (status) status.textContent = "Saved (Local)";
    showToast("Paper removed", "success");
  } catch (error) {
    if (handleAuthRequired(error)) return;
    showToast(error?.message || "Failed to delete paper", "error");
  } finally {
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = original;
    }
  }
}

async function savePaperUpdates() {
  if (!currentPaperId) return;

  try {
    const updated = await apiRequest(`/api/papers/${currentPaperId}`, {
      method: "PATCH",
      body: {
        project: document.getElementById("paperProject").value.trim(),
        tags: currentTags,
        notes: document.getElementById("userNotes").value,
      },
    });

    const paper = updated?.paper;
    if (paper?.id) {
      const idx = savedPapers.findIndex((p) => p.id === paper.id);
      if (idx >= 0) savedPapers[idx] = { ...savedPapers[idx], ...paper };
    }
    document.getElementById("saveStatus").textContent = "Saved";
  } catch (e) {
    document.getElementById("saveStatus").textContent = "Error saving";
  }
}

function updateSaveButtonState() {
  const btn = document.getElementById("saveBtn");
  const deleteBtn = document.getElementById("paperDeleteBtn");

  if (currentPaperId) {
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> Saved';
    btn.classList.add("btn-primary");
    btn.classList.remove("btn-outline");
    if (deleteBtn) deleteBtn.style.display = "inline-flex";
  } else {
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> Save';
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-outline");
    if (deleteBtn) deleteBtn.style.display = "none";
  }
}

// --- Sidebar & Saved Papers ---

async function loadSavedPapers() {
  const q = document.getElementById("savedSearch")?.value?.trim() || "";
  const project = document.getElementById("projectFilter")?.value?.trim() || "";
  const sortBy = document.getElementById("sortBy")?.value || "created_at";
  const sortOrder = document.getElementById("sortOrder")?.value || "desc";

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (project) params.set("project", project);
  params.set("sort_by", sortBy);
  params.set("sort_order", sortOrder);
  params.set("page", currentPage);
  params.set("limit", "50");

  try {
    const response = await apiRequest(`/api/papers?${params.toString()}`);
    savedPapers = response.papers || [];
    renderSavedList();

    // Update pagination info
    const pageInfo = document.getElementById("pageInfo");
    if (pageInfo && response.pagination) {
      pageInfo.textContent = `Page ${response.pagination.page}`;
    }
  } catch (error) {
    console.error("Failed to load saved papers", error);
  }
}

function applyAdvancedFilters() {
  currentPage = 1;
  loadSavedPapers();
}

function changePage(delta) {
  currentPage += delta;
  if (currentPage < 1) currentPage = 1;
  loadSavedPapers();
}

function renderSavedList() {
  const container = document.getElementById("savedList");
  container.innerHTML = "";

  const search =
    document.getElementById("savedSearch")?.value?.toLowerCase() || "";
  const project =
    document.getElementById("projectFilter")?.value?.toLowerCase() || "";

  const filtered = savedPapers.filter((p) => {
    const matchesSearch =
      (p.title || "").toLowerCase().includes(search) ||
      (p.authors || "").toLowerCase().includes(search);
    const matchesProject =
      !project || (p.project || "").toLowerCase().includes(project);
    return matchesSearch && matchesProject;
  });

  if (filtered.length === 0) {
    container.innerHTML =
      '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 13px;">No papers found</div>';
    return;
  }

  filtered.forEach((paper) => {
    const item = document.createElement("div");
    item.className = `nav-item ${currentPaperId === paper.id ? "active" : ""}`;
    item.onclick = () => loadSavedPaper(paper);

    const date = new Date(paper.created_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

    const citationCount = paper.citation_count || 0;
    const sourceIcon = paper.doi ? "📄" : paper.pmid ? "🔬" : "📑";

    item.innerHTML = `
      <span class="nav-item-title">${paper.title}</span>
      <div class="nav-item-meta">
        <span>${sourceIcon} ${paper.project || "No Project"}</span>
        <span>${date}${citationCount ? ` • ${citationCount} citations` : ""}</span>
      </div>
    `;
    container.appendChild(item);
  });
}

async function loadSavedPaper(paper) {
  const paperId = paper?.id;
  if (!paperId) return;
  currentPaperId = paperId;

  let hydrated = paper;
  try {
    const response = await apiRequest(`/api/papers/${paperId}`);
    if (response?.paper) hydrated = response.paper;
  } catch {
    // If hydrate fails, fall back to list payload
  }

  const arxivId =
    (typeof hydrated.arxiv_id === "string" && hydrated.arxiv_id.trim()) ||
    (typeof hydrated.arxivId === "string" && hydrated.arxivId.trim()) ||
    (typeof hydrated.arxiv_url === "string" &&
      hydrated.arxiv_url.split("/").pop()) ||
    "";

  const pdfUrl =
    (typeof hydrated.pdf_url === "string" && hydrated.pdf_url) ||
    (typeof hydrated.pdfUrl === "string" && hydrated.pdfUrl) ||
    (typeof hydrated.arxiv_url === "string"
      ? hydrated.arxiv_url.replace("abs", "pdf") + ".pdf"
      : arxivId
        ? `https://arxiv.org/pdf/${arxivId}.pdf`
        : "#");

  currentPaper = {
    arxivId,
    title: hydrated.title,
    authors: hydrated.authors || "",
    abstract: hydrated.abstract || "",
    pdfUrl,
    summary: hydrated.summary || "",
    project: hydrated.project || "",
    tags: normalizeTags(hydrated.tags),
  };
  currentTags = normalizeTags(hydrated.tags);
  currentQaHistory = Array.isArray(hydrated.qa_history)
    ? hydrated.qa_history
    : Array.isArray(hydrated.qaHistory)
      ? hydrated.qaHistory
      : [];

  // Update UI
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("results").style.display = "block";
  document.querySelector(".right-panel").style.display = "flex";

  document.getElementById("paperTitle").textContent = hydrated.title;
  document.getElementById("paperAuthors").textContent =
    hydrated.authors || currentPaper.authors || "";
  document.getElementById("paperDate").textContent = new Date(
    hydrated.created_at,
  ).toLocaleDateString();
  updatePdfLink(currentPaper.pdfUrl);

  const citeBtn = document.getElementById("paperCiteBtn");
  if (citeBtn)
    citeBtn.style.display = currentPaper.arxivId ? "inline-flex" : "none";

  const exportBtn = document.getElementById("paperExportBtn");
  if (exportBtn) exportBtn.style.display = "inline-flex";

  // Summary
  const summaryText = (hydrated.summary || "").toString();
  const keyTermsMatch = summaryText.match(
    /(\*\*\s*Key\s*Terms\s*:\s*\*\*|Key\s*Terms\s*:)/i,
  );
  const keyTermsIndex = keyTermsMatch?.index ?? -1;

  const mainSummary = (
    keyTermsIndex >= 0 ? summaryText.slice(0, keyTermsIndex) : summaryText
  ).trim();
  let keyTerms =
    keyTermsIndex >= 0 ? summaryText.slice(keyTermsIndex).trim() : "";
  if (keyTerms) {
    keyTerms = keyTerms.replace(
      /^(\*\*\s*)?Key\s*Terms\s*:\s*(\*\*)?/i,
      "**Key Terms:**",
    );
  }

  document.getElementById("summaryContent").innerHTML =
    formatMarkdown(mainSummary);

  const takeawaysEl = document.getElementById("takeawaysContent");
  if (keyTerms) {
    takeawaysEl.innerHTML = formatMarkdown(keyTerms);
    takeawaysEl.parentElement.style.display = "block";
  } else {
    takeawaysEl.parentElement.style.display = "none";
  }

  // Inputs
  document.getElementById("paperProject").value = hydrated.project || "";
  document.getElementById("userNotes").value = hydrated.notes || "";
  renderTags();
  renderQaHistory(currentQaHistory);
  updateSaveButtonState();
  renderSavedList(); // Update active state

  const idx = savedPapers.findIndex((p) => p.id === hydrated.id);
  if (idx >= 0) savedPapers[idx] = { ...savedPapers[idx], ...hydrated };
}

function searchSaved() {
  renderSavedList();
}

function applyProjectFilter() {
  renderSavedList();
}

function refreshSavedList() {
  loadSavedPapers();
}

// --- Right Panel & Q&A ---

function switchRightPanel(tab) {
  document
    .querySelectorAll(".panel-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".panel-content")
    .forEach((c) => (c.style.display = "none"));

  if (tab === "notes") {
    document.querySelector(".panel-tab:nth-child(1)").classList.add("active");
    document.getElementById("panelNotes").style.display = "flex";
  } else {
    document.querySelector(".panel-tab:nth-child(2)").classList.add("active");
    document.getElementById("panelQa").style.display = "flex";
  }
}

let notesTimeout;
function autoSaveNotes() {
  document.getElementById("saveStatus").textContent = "Saving...";
  clearTimeout(notesTimeout);
  notesTimeout = setTimeout(() => {
    if (currentPaperId) {
      savePaperUpdates();
    } else {
      document.getElementById("saveStatus").textContent = "Saved (Local)";
    }
    persistDraft();
  }, 1000);
}

async function sendQa() {
  const input = document.getElementById("qaInput");
  const question = input.value.trim();
  if (!question) return;

  const userId = appendQaMessage(question, "user");
  currentQaHistory.push({
    id: userId,
    role: "user",
    text: question,
    ts: Date.now(),
  });
  input.value = "";

  const msgId = appendQaMessage("Thinking...", "ai");
  currentQaHistory.push({
    id: msgId,
    role: "ai",
    text: "Thinking...",
    ts: Date.now(),
  });

  try {
    const endpoint = currentPaperId
      ? `/api/qa/saved/${currentPaperId}`
      : "/api/qa/live";
    // Fallback to summary if live and no full text available
    const body = currentPaperId
      ? { question }
      : {
          question,
          paper: {
            title: currentPaper?.title,
            abstract: currentPaper?.abstract,
            summary: currentPaper?.summary,
          },
        };

    const response = await apiRequest(endpoint, {
      method: "POST",
      body,
    });

    if (response.answer) {
      let text = response.answer;

      if (Array.isArray(response.sources) && response.sources.length) {
        const lines = response.sources
          .slice(0, 3)
          .map((s) => `- ${s.label}: ${s.text}`);
        text += `\n\nSources:\n${lines.join("\n")}`;
      }

      updateQaMessage(msgId, text);

      const idx = currentQaHistory.findIndex((m) => m.id === msgId);
      if (idx >= 0) currentQaHistory[idx] = { ...currentQaHistory[idx], text };
      await persistQaHistory();
    } else {
      updateQaMessage(msgId, "I couldn't generate an answer.");

      const idx = currentQaHistory.findIndex((m) => m.id === msgId);
      if (idx >= 0)
        currentQaHistory[idx] = {
          ...currentQaHistory[idx],
          text: "I couldn't generate an answer.",
        };
      await persistQaHistory();
    }
  } catch (error) {
    updateQaMessage(
      msgId,
      "Error: " + (error.message || "Failed to get answer"),
    );

    const idx = currentQaHistory.findIndex((m) => m.id === msgId);
    if (idx >= 0)
      currentQaHistory[idx] = {
        ...currentQaHistory[idx],
        text: "Error: " + (error.message || "Failed to get answer"),
      };
    await persistQaHistory();
  } finally {
    persistDraft();
  }
}

function handleQaKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendQa();
  }
}

function appendQaMessage(text, role, forcedId) {
  const container = document.getElementById("qaHistory");
  const div = document.createElement("div");
  div.className = `qa-message ${role}`;
  div.textContent = text;
  div.id =
    forcedId || "msg-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div.id;
}

function updateQaMessage(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.parentElement.scrollTop = el.parentElement.scrollHeight;
  }
}

// --- Toast ---
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  // Add styles dynamically if not in CSS
  toast.style.background = type === "error" ? "#fee2e2" : "#333";
  toast.style.color = type === "error" ? "#991b1b" : "#fff";
  toast.style.padding = "12px 24px";
  toast.style.borderRadius = "8px";
  toast.style.marginTop = "10px";
  toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  toast.style.fontSize = "14px";
  toast.style.animation = "fadeIn 0.3s ease";

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  (async () => {
    await refreshSession();
    restoreDraft();
  })();
});

document.addEventListener("click", (event) => {
  const userMenu = document.getElementById("userMenu");
  const menuDropdown = document.getElementById("userMenuDropdown");
  if (!userMenu || !menuDropdown) return;
  if (menuDropdown.style.display === "none") return;
  if (!userMenu.contains(event.target)) closeUserMenu();
});

document.addEventListener("click", (event) => {
  const exportMenu = document.getElementById("exportMenu");
  const exportBtn = document.getElementById("paperExportBtn");
  if (!exportMenu || !exportBtn) return;
  if (exportMenu.style.display === "none") return;
  if (!exportMenu.contains(event.target) && !exportBtn.contains(event.target)) {
    closeExportMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeUserMenu();
  closeSettingsModal();
  closeExportMenu();
});
