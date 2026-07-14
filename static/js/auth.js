/* ============================================================
   Miki.ai — Firebase authentication (login / signup page)
   Email/password + Google. On success, exchange the Firebase
   ID token for a server session, then redirect to the app.
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  updateProfile,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
auth.useDeviceLanguage();
setPersistence(auth, browserLocalPersistence);

const $ = (id) => document.getElementById(id);
const els = {
  tabs: $("authTabs"), ink: $("tabInk"),
  title: $("authTitle"), subtitle: $("authSubtitle"), foot: $("authFoot"),
  form: $("authForm"), nameField: $("nameField"),
  name: $("name"), email: $("email"), password: $("password"),
  submit: $("submitBtn"),
  google: $("googleBtn"), forgot: $("forgotBtn"),
  error: $("authError"), pwToggle: $("pwToggle"), themeFab: $("themeFab"),
};

let mode = "signin"; // or "signup"

// ---- Theme ----------------------------------------------------------
(function initTheme() {
  const saved = localStorage.getItem("miki-theme");
  if (saved) document.documentElement.dataset.theme = saved;
})();
els.themeFab.onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("miki-theme", next);
};

// ---- Mode switching -------------------------------------------------
function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  els.ink.classList.toggle("right", signup);
  document.querySelectorAll(".auth-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.mode === mode));
  els.title.textContent = signup ? "Create your account" : "Welcome back";
  els.subtitle.textContent = signup ? "Start chatting with your documents" : "Sign in to continue to Miki.ai";
  els.nameField.hidden = !signup;
  els.password.autocomplete = signup ? "new-password" : "current-password";
  els.submit.querySelector(".btn-primary__label").textContent = signup ? "Create account" : "Sign in";
  els.forgot.style.display = signup ? "none" : "block";
  els.foot.innerHTML = signup
    ? `Already have an account? <button class="link-btn link-btn--inline" data-switch="signin">Sign in</button>`
    : `New here? <button class="link-btn link-btn--inline" data-switch="signup">Create an account</button>`;
  clearError();
}

els.tabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".auth-tab");
  if (tab) setMode(tab.dataset.mode);
});
els.foot.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-switch]");
  if (btn) setMode(btn.dataset.switch);
});

// ---- Password visibility -------------------------------------------
els.pwToggle.onclick = () => {
  const showing = els.password.type === "text";
  els.password.type = showing ? "password" : "text";
};

// ---- Error / status helpers -----------------------------------------
function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
  els.error.classList.remove("auth-error--ok");
}
function showSuccess(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
  els.error.classList.add("auth-error--ok");
}
function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
  els.error.classList.remove("auth-error--ok");
}

function friendly(code) {
  const map = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/popup-blocked": "Your browser blocked the sign-in popup.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase.",
    "auth/unauthorized-domain": "This domain isn't authorized for sign-in. Add it in Firebase → Authentication → Settings → Authorized domains, or open the app at http://localhost:5000.",
    "auth/missing-email": "Please enter your email address first.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

// ---- Busy state -----------------------------------------------------
function setBusy(on) {
  els.submit.disabled = on;
  els.google.disabled = on;
  els.submit.querySelector(".btn-primary__label").hidden = on;
  els.submit.querySelector(".btn-primary__spin").hidden = !on;
}

// ---- Exchange ID token for a server session -------------------------
async function establishSession(user) {
  const idToken = await user.getIdToken(true);
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not start a session on the server.");
  window.location.href = "/";
}

// ---- Email / password submit ---------------------------------------
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const email = els.email.value.trim();
  const password = els.password.value;
  if (!email || !password) { showError("Please enter your email and password."); return; }

  setBusy(true);
  try {
    let cred;
    if (mode === "signup") {
      cred = await createUserWithEmailAndPassword(auth, email, password);
      const name = els.name.value.trim();
      if (name) await updateProfile(cred.user, { displayName: name });
    } else {
      cred = await signInWithEmailAndPassword(auth, email, password);
    }
    await establishSession(cred.user);
  } catch (err) {
    setBusy(false);
    showError(err.code ? friendly(err.code) : err.message);
  }
});

// ---- Google sign-in -------------------------------------------------
els.google.onclick = async () => {
  clearError();
  setBusy(true);
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    await establishSession(cred.user);
  } catch (err) {
    // If the popup was blocked, fall back to a full-page redirect flow.
    if (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request") {
      try {
        await signInWithRedirect(auth, provider);
        return; // page will navigate away
      } catch (redirErr) {
        err = redirErr;
      }
    }
    setBusy(false);
    showError(err.code ? friendly(err.code) : err.message);
  }
};

// Complete a redirect-based Google sign-in when the page reloads.
getRedirectResult(auth)
  .then((result) => {
    if (result && result.user) {
      setBusy(true);
      return establishSession(result.user);
    }
  })
  .catch((err) => {
    showError(err.code ? friendly(err.code) : err.message);
  });

// ---- Forgot password ------------------------------------------------
els.forgot.onclick = async () => {
  clearError();
  const email = els.email.value.trim();
  if (!email) { showError("Enter your email above, then click 'Forgot password'."); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showSuccess("Password reset email sent. Check your inbox (and spam folder).");
  } catch (err) {
    showError(err.code ? friendly(err.code) : err.message);
  }
};

setMode("signin");
