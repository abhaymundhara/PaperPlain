let currentSummary = "";
let authMode = "signin";

async function apiRequest(path, { method = "GET", body } = {}) {
  const options = {
    method,
    headers: {},
  };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.message || data?.error || "Request failed";
    throw new Error(message);
  }

  return data;
}

function setAuthMode(mode) {
  authMode = mode;

  const tabSignIn = document.getElementById("tabSignIn");
  const tabSignUp = document.getElementById("tabSignUp");
  const signUpFields = document.getElementById("signUpFields");
  const authSubmitText = document.getElementById("authSubmitText");

  if (mode === "signup") {
    tabSignIn.classList.remove("is-active");
    tabSignIn.setAttribute("aria-selected", "false");
    tabSignUp.classList.add("is-active");
    tabSignUp.setAttribute("aria-selected", "true");
    signUpFields.style.display = "block";
    authSubmitText.textContent = "Create account";
    document
      .getElementById("authPassword")
      .setAttribute("autocomplete", "new-password");
  } else {
    tabSignUp.classList.remove("is-active");
    tabSignUp.setAttribute("aria-selected", "false");
    tabSignIn.classList.add("is-active");
    tabSignIn.setAttribute("aria-selected", "true");
    signUpFields.style.display = "none";
    authSubmitText.textContent = "Sign in";
    document
      .getElementById("authPassword")
      .setAttribute("autocomplete", "current-password");
  }
}

function toggleAuthPanel() {
  const panel = document.getElementById("authPanel");
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  hideAuthError();

  if (!isOpen) {
    document.getElementById("authEmail").focus();
  }
}

function showAuthError(message) {
  const el = document.getElementById("authError");
  el.textContent = message;
  el.style.display = "block";
}

function hideAuthError() {
  document.getElementById("authError").style.display = "none";
}

async function submitAuth(event) {
  event.preventDefault();
  hideAuthError();

  const btn = document.getElementById("authSubmitBtn");
  const btnText = document.getElementById("authSubmitText");
  const btnLoader = document.getElementById("authSubmitLoader");
  btn.disabled = true;
  btnText.style.display = "none";
  btnLoader.style.display = "inline";

  try {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    if (!email || !password) {
      throw new Error("Email and password are required");
    }

    if (authMode === "signup") {
      const name = document.getElementById("authName").value.trim();
      if (!name) throw new Error("Name is required");

      await apiRequest("/api/auth/signup", {
        method: "POST",
        body: { name, email, password },
      });
    } else {
      await apiRequest("/api/auth/signin", {
        method: "POST",
        body: { email, password },
      });
    }

    await refreshSession();
    document.getElementById("authPassword").value = "";
    document.getElementById("authPanel").style.display = "none";
  } catch (error) {
    showAuthError(error.message || "Authentication failed");
  } finally {
    btn.disabled = false;
    btnText.style.display = "inline";
    btnLoader.style.display = "none";
  }
}

async function signOut() {
  try {
    await apiRequest("/api/auth/signout", { method: "POST" });
  } catch {
    // ignore
  }
  await refreshSession();
}

async function refreshSession() {
  const statusEl = document.getElementById("accountStatus");
  const toggleBtn = document.getElementById("toggleAuthBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  try {
    const session = await apiRequest("/api/auth/me");
    if (session?.user?.email) {
      statusEl.textContent = session.user.email;
      toggleBtn.style.display = "none";
      signOutBtn.style.display = "inline-flex";
      return;
    }
  } catch {
    // ignore
  }

  statusEl.textContent = "Not signed in";
  toggleBtn.style.display = "inline-flex";
  toggleBtn.textContent = "Sign in";
  signOutBtn.style.display = "none";
}

async function simplifyPaper() {
  const urlInput = document.getElementById("arxivUrl");
  const url = urlInput.value.trim();

  if (!url) {
    showError("Please enter an ArXiv URL");
    return;
  }

  // Reset previous results
  hideError();
  hideResults();

  // Update button state
  const btn = document.getElementById("simplifyBtn");
  const btnText = btn.querySelector(".btn-text");
  const btnLoader = btn.querySelector(".btn-loader");

  btn.disabled = true;
  btnText.style.display = "none";
  btnLoader.style.display = "inline";

  try {
    const response = await fetch("/api/simplify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ arxivUrl: url }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Failed to simplify paper");
    }

    // Display results
    displayResults(result.data);
  } catch (error) {
    showError(error.message || "An error occurred. Please try again.");
  } finally {
    // Reset button state
    btn.disabled = false;
    btnText.style.display = "inline";
    btnLoader.style.display = "none";
  }
}

function displayResults(data) {
  // Set paper info
  document.getElementById("paperTitle").textContent = data.title;
  document.getElementById("paperAuthors").textContent = data.authors;

  const date = new Date(data.published);
  document.getElementById("paperDate").textContent = date.toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  const pdfLink = document.getElementById("paperPdfLink");
  pdfLink.href = data.pdfUrl;

  // Format and display summary
  const summaryContent = document.getElementById("summaryContent");
  summaryContent.innerHTML = formatSummary(data.simplifiedSummary);

  // Store summary for copying
  currentSummary = data.simplifiedSummary;

  // Show results
  document.getElementById("results").style.display = "block";

  // Scroll to results
  document.getElementById("results").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function formatSummary(summary) {
  // Convert markdown-style formatting to HTML
  let formatted = summary
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  // Wrap in paragraph tags
  formatted = "<p>" + formatted + "</p>";

  return formatted;
}

function showError(message) {
  const errorDiv = document.getElementById("error");
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

function hideError() {
  document.getElementById("error").style.display = "none";
}

function hideResults() {
  document.getElementById("results").style.display = "none";
}

function copyToClipboard(event) {
  const textArea = document.createElement("textarea");
  textArea.value = currentSummary;
  document.body.appendChild(textArea);
  textArea.select();

  try {
    document.execCommand("copy");

    // Visual feedback
    const btn = event?.target;
    if (!btn) return;
    const originalText = btn.textContent;
    btn.textContent = "Copied";
    btn.style.background = "var(--success)";

    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = "";
    }, 2000);
  } catch (err) {
    showError("Failed to copy to clipboard");
  }

  document.body.removeChild(textArea);
}

function reset() {
  document.getElementById("arxivUrl").value = "";
  hideError();
  hideResults();
  document.getElementById("arxivUrl").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Allow Enter key to submit
document.getElementById("arxivUrl").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    simplifyPaper();
  }
});

// Auto-focus on input when page loads
window.addEventListener("load", () => {
  document.getElementById("arxivUrl").focus();
  setAuthMode("signin");
  refreshSession();
});
