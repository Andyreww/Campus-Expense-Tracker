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

// --- FINAL LOGOUT FUNCTION ---
// This function now handles the entire logout process to ensure proper order of operations.
export const logout = async () => {
    console.log("Logout function called. Beginning sign out process.");
    const { auth } = await firebaseReady;
    if (!auth) {
        console.error("Auth service not ready, cannot log out.");
        return;
    }
    try {
        // Step 1: Tell Firebase to sign the user out. Wait for this to complete.
        await firebaseSignOut(auth);
        console.log("Firebase sign out successful.");

        // Step 2: Manually clear all client-side storage to prevent UI flicker.
        localStorage.clear();
        sessionStorage.clear();
        console.log("Cleared client-side storage.");

        // Step 3: Redirect to the login page. This only happens AFTER sign-out and clearing is done.
        window.location.replace('/login.html');

    } catch (error) {
        console.error("Error during sign out:", error);
        // As a last resort, if signout fails, still clear everything and force a redirect.
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('/login.html');
    }
};


// --- AUTH STATE GUARD & ROUTER ---
// This is the core of the auth system. It's the single source of truth for what happens
// when a user's login state changes.
firebaseReady.then(({ auth, db }) => {
    if (!auth) return;

    onAuthStateChanged(auth, (user) => {
        const path = window.location.pathname;
        const onLoginPage = path.endsWith('/login.html');
        const onIndexPage = path === '/' || path.endsWith('/index.html');
        const onQuestionnairePage = path.endsWith('/questionnaire.html');
        
        const onProtectedPage = !onLoginPage && !onIndexPage && !onQuestionnairePage;

        if (user) {
            // --- USER IS LOGGED IN ---
            console.log(`Auth Guard: User logged in (${user.uid}). Path: ${path}`);
            if (onLoginPage || onIndexPage) {
                // If a logged-in user is on the login/index page, send them where they belong.
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
            // --- USER IS LOGGED OUT ---
            console.log(`Auth Guard: User is logged out. Path: ${path}`);
            
            // The logout() function now handles clearing storage and the initial redirect.
            // This block's only job is to protect pages if a logged-out user tries to access them directly.
            if (onProtectedPage) {
                console.log("User on protected page, redirecting to login...");
                window.location.replace('/login.html');
            }
        }
    });
});


// --- LOGIN PAGE SPECIFIC LOGIC (No changes needed here) ---
if (window.location.pathname.endsWith('/') || window.location.pathname.endsWith('/login.html') || window.location.pathname.endsWith('/index.html')) {
    
    const setupLoginEventListeners = (auth) => {
        const authForm = document.getElementById('auth-form');
        if (!authForm) {
            console.log("No auth form found on this page. Skipping login event listeners.");
            return;
        }
        
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const createAccountButton = document.getElementById('create-account-button');
        const signInButton = document.getElementById('sign-in-button');
        const googleSignInButton = document.getElementById('google-signin-button');
        const authError = document.getElementById('auth-error');

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
            allButtons.forEach(btn => {
                if (btn) {
                    btn.disabled = isLoading;
                    if (isLoading && btn === activeBtn) {
                        btn.innerHTML = `<div class="spinner"></div> Verifying...`;
                    } else if (!isLoading) {
                        if (btn === signInButton) btn.innerHTML = originalButtonContent.signIn;
                        if (btn === createAccountButton) btn.innerHTML = originalButtonContent.createAccount;
                        if (btn === googleSignInButton) btn.innerHTML = originalButtonContent.google;
                    }
                }
            });
        };
        
        const handleAuthAction = (authPromise, button) => {
            if(authError) authError.classList.add('hidden');
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
    };

    firebaseReady.then(({ auth }) => {
        if (!auth) {
            console.error("Firebase not available for login page.");
            return;
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setupLoginEventListeners(auth));
        } else {
            setupLoginEventListeners(auth);
        }
    });
}
