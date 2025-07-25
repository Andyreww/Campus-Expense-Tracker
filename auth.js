// auth.js - The Single Source of Truth for Firebase

// --- IMPORTS ---
// Import all necessary functions from the Firebase SDKs.
// This file will provide these services to the rest of the app.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut as firebaseSignOut,
    setPersistence,
    browserSessionPersistence,
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- CENTRAL FIREBASE INITIALIZATION ---
// This promise ensures Firebase is initialized only ONCE.
// Other scripts wait for this promise to resolve before using Firebase services.
export const firebaseReady = new Promise(async (resolve) => {
    try {
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) throw new Error('Could not load Firebase configuration.');
        const firebaseConfig = await response.json();
        
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const storage = getStorage(app);

        // Set persistence to SESSION - user is logged out when browser closes.
        await setPersistence(auth, browserSessionPersistence);
        
        // Enable offline data persistence for Firestore
        await enableIndexedDbPersistence(db).catch(err => console.warn("Firestore persistence error:", err.message));

        console.log("Firebase services initialized successfully.");
        resolve({ auth, db, storage });

    } catch (error) {
        console.error("FATAL: Firebase initialization failed.", error);
        document.body.innerHTML = 'Could not connect to application services. Please try again later.';
        resolve({ auth: null, db: null, storage: null }); // Resolve with null on failure
    }
});

// --- AUTH STATE GUARD & ROUTER ---
// This is the core of the auth system. It runs on page load and whenever auth state changes.
firebaseReady.then(({ auth, db }) => {
    if (!auth) return;

    onAuthStateChanged(auth, (user) => {
        const path = window.location.pathname;
        const onLoginPage = path.endsWith('/login.html');
        const onIndexPage = path === '/' || path.endsWith('/index.html');
        const onQuestionnairePage = path.endsWith('/questionnaire.html');
        
        const onProtectedPage = !onLoginPage && !onIndexPage && !onQuestionnairePage;

        if (user) {
            // USER IS LOGGED IN
            console.log(`Auth Guard: User logged in (${user.uid}). Path: ${path}`);
            if (onLoginPage) {
                // If a logged-in user is on the login page, check if they have a profile.
                const userDocRef = doc(db, "users", user.uid);
                getDoc(userDocRef).then(userDocSnap => {
                    if (userDocSnap.exists()) {
                        console.log("Redirecting to dashboard...");
                        window.location.replace('/dashboard.html');
                    } else {
                        console.log("New user, redirecting to questionnaire...");
                        window.location.replace('/questionnaire.html');
                    }
                });
            }
        } else {
            // USER IS LOGGED OUT
            console.log(`Auth Guard: User logged out. Path: ${path}`);
            if (onProtectedPage) {
                // If a logged-out user tries to access a protected page, send them to login.
                console.log("User on protected page, redirecting to login...");
                window.location.replace('/login.html');
            }
        }
    });
});

// --- UPDATED GLOBAL LOGOUT FUNCTION ---
export const logout = async () => {
    console.log("Logout function called. Aggressive mode ON.");
    const { auth } = await firebaseReady;
    if (!auth) {
        console.error("Auth service not ready, cannot log out.");
        return;
    }
    try {
        // Step 1: Sign out from Firebase. This tells the backend the session is over.
        await firebaseSignOut(auth);
        console.log("Firebase sign out successful.");

        // Step 2: Manually clear client-side storage to prevent stale data.
        // This is the aggressive part that helps prevent the UI flicker on the next page load.
        localStorage.clear();
        sessionStorage.clear();
        console.log("Cleared localStorage and sessionStorage.");

        // Step 3: Redirect to the login page. Use 'replace' to prevent the user from
        // using the back button to return to the authenticated state.
        window.location.replace('/login.html');
    } catch (error) {
        console.error("Error during sign out:", error);
        // As a fallback, still try to clear storage and redirect.
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('/login.html');
    }
};


// --- LOGIN PAGE SPECIFIC LOGIC ---
// This block only runs if we are on the login page.
if (window.location.pathname.endsWith('/') || window.location.pathname.endsWith('/login.html') || window.location.pathname.endsWith('/index.html')) {
    // Wait for Firebase to be ready before setting up listeners
    firebaseReady.then(({ auth }) => {
        if (!auth) return;

        // Wait for the DOM to be ready
        document.addEventListener('DOMContentLoaded', () => {
            const authForm = document.getElementById('auth-form');
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const createAccountButton = document.getElementById('create-account-button');
            const signInButton = document.getElementById('sign-in-button');
            const googleSignInButton = document.getElementById('google-signin-button');
            const authError = document.getElementById('auth-error');

            if (!authForm) return; // Don't run if the form isn't on the page

            const originalButtonContent = {
                signIn: signInButton.innerHTML,
                createAccount: createAccountButton.innerHTML,
                google: googleSignInButton.innerHTML
            };

            const showAuthError = (message) => {
                let friendlyMessage = "An unexpected error occurred.";
                if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) {
                    friendlyMessage = "Incorrect email or password. Please try again.";
                } else if (message.includes('auth/email-already-in-use')) {
                    friendlyMessage = "An account with this email already exists.";
                } else if (message.includes('auth/popup-closed-by-user')) {
                    friendlyMessage = "Sign-in window closed. Please try again.";
                } else if (message.includes('offline') || message.includes('network-request-failed')) {
                    friendlyMessage = "Network error. Please check your connection.";
                }
                authError.textContent = friendlyMessage;
                authError.classList.remove('hidden');
            };

            const setLoadingState = (isLoading, activeBtn = null) => {
                const allButtons = [signInButton, createAccountButton, googleSignInButton];
                if (isLoading) {
                    allButtons.forEach(btn => {
                        if (btn) {
                            btn.disabled = true;
                            if (btn === activeBtn) {
                                btn.innerHTML = `<div class="spinner"></div> Verifying...`;
                            }
                        }
                    });
                } else {
                    if(signInButton) signInButton.innerHTML = originalButtonContent.signIn;
                    if(createAccountButton) createAccountButton.innerHTML = originalButtonContent.createAccount;
                    if(googleSignInButton) googleSignInButton.innerHTML = originalButtonContent.google;
                    allButtons.forEach(btn => { if(btn) btn.disabled = false });
                }
            };

            // The onAuthStateChanged listener will handle the redirect automatically.
            // We just need to perform the auth action and handle errors.
            const handleAuthAction = (authPromise, button) => {
                authError.classList.add('hidden');
                setLoadingState(true, button);
                authPromise.catch(error => {
                    showAuthError(error.message);
                    setLoadingState(false);
                });
            };

            authForm.addEventListener('submit', (e) => {
                e.preventDefault();
                handleAuthAction(signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value), signInButton);
            });
            createAccountButton.addEventListener('click', () => {
                handleAuthAction(createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value), createAccountButton);
            });
            googleSignInButton.addEventListener('click', () => {
                const googleProvider = new GoogleAuthProvider();
                handleAuthAction(signInWithPopup(auth, googleProvider), googleSignInButton);
            });
        });
    });
}
