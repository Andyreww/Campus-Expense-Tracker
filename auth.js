// auth.js - The Single Source of Truth for Firebase

// --- IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut as firebaseSignOut,
    setPersistence,
    browserLocalPersistence, // This keeps the user signed in across browser sessions.
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- CENTRAL FIREBASE INITIALIZATION ---
// This promise ensures Firebase is initialized only ONCE and makes services available to other scripts.
export const firebaseReady = new Promise(async (resolve) => {
    try {
        // Fetch the config from your Netlify function. This is a great way to keep keys secure.
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) throw new Error('Could not load Firebase configuration.');
        const firebaseConfig = await response.json();
        
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const storage = getStorage(app);

        // Set persistence to LOCAL to keep users logged in even after they close the browser.
        await setPersistence(auth, browserLocalPersistence);
        
        // Enable offline data persistence for Firestore.
        await enableIndexedDbPersistence(db).catch(err => console.warn("Firestore persistence error:", err.message));

        console.log("Firebase services initialized successfully with LOCAL persistence.");
        resolve({ auth, db, storage });

    } catch (error) {
        console.error("FATAL: Firebase initialization failed.", error);
        document.body.innerHTML = 'Could not connect to application services. Please try again later.';
        resolve({ auth: null, db: null, storage: null });
    }
});

// --- LOGOUT FUNCTION ---
// A simple, clean function to sign the user out.
export const logout = async () => {
    console.log("Logout function called.");
    const { auth } = await firebaseReady;
    if (!auth) {
        console.error("Auth service not ready, cannot log out.");
        return;
    }
    try {
        // The onAuthStateChanged listener below will automatically handle redirecting the user.
        await firebaseSignOut(auth);
        console.log("Firebase sign out successful.");
    } catch (error) {
        console.error("Error during sign out:", error);
    }
};


// --- AUTH STATE GUARD & ROUTER ---
// This is the most important part. It runs whenever the user's login state changes
// and handles all page routing to prevent unauthorized access and redirect loops.
firebaseReady.then(({ auth, db }) => {
    if (!auth || !db) return;

    onAuthStateChanged(auth, async (user) => {
        const path = window.location.pathname;

        // Define all possible page types for clarity.
        const onAuthPage = path.endsWith('/login.html') || path.endsWith('/signup.html');
        const onLandingPage = path === '/' || path.endsWith('/index.html');
        const onQuestionnairePage = path.endsWith('/questionnaire.html');

        // A page is "protected" if it's NOT the landing, auth, or questionnaire page.
        const onProtectedPage = !onAuthPage && !onLandingPage && !onQuestionnairePage;

        if (user) {
            // --- USER IS LOGGED IN ---
            console.log(`Auth Guard: User logged in (${user.uid}). Path: ${path}`);

            // If a logged-in user is on an auth page, they need to be redirected.
            if (onAuthPage) {
                try {
                    // Check if they have a user profile document.
                    const userDocRef = doc(db, "users", user.uid);
                    const userDocSnap = await getDoc(userDocRef);

                    if (userDocSnap.exists()) {
                        // Profile exists, go to the main dashboard.
                        console.log("Redirecting existing user from auth page to dashboard.");
                        window.location.replace('/dashboard.html');
                    } else {
                        // New user, send them to the questionnaire to set up their profile.
                        console.log("Redirecting new user from auth page to questionnaire.");
                        window.location.replace('/questionnaire.html');
                    }
                } catch (dbError) {
                    console.error("Error checking user document, redirecting to dashboard as a fallback:", dbError);
                    window.location.replace('/dashboard.html');
                }
            }
            // If they are on any other page (dashboard, landing page, etc.), they are fine. No redirect needed.

        } else {
            // --- USER IS LOGGED OUT ---
            console.log(`Auth Guard: User is logged out. Path: ${path}`);

            // If a logged-out user tries to access a protected page (e.g., dashboard),
            // send them back to the landing page.
            if (onProtectedPage) {
                console.log("User on protected page while logged out. Redirecting to landing page.");
                window.location.replace('/index.html');
            }
            // If they are on the landing page, login, or signup page, they are fine. This prevents the redirect loop.
        }
    });
});


// --- LOGIN PAGE SPECIFIC LOGIC ---
// This part of the script only runs on pages with the login form.
if (window.location.pathname.includes('/login.html')) {
    
    const setupLoginEventListeners = (auth) => {
        const authForm = document.getElementById('auth-form');
        if (!authForm) return; // Don't run if the form isn't on the page
        
        // Get all the form elements
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const createAccountButton = document.getElementById('create-account-button');
        const signInButton = document.getElementById('sign-in-button');
        const googleSignInButton = document.getElementById('google-signin-button');
        const authError = document.getElementById('auth-error');

        // Store original button text to restore after loading
        const originalButtonContent = {
            signIn: signInButton.innerHTML,
            createAccount: createAccountButton.innerHTML,
            google: googleSignInButton.innerHTML
        };

        // Function to show a user-friendly error message
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

        // Function to handle button loading states
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
        
        // Wrapper to handle auth actions, including loading and error states
        const handleAuthAction = (authPromise, button) => {
            if(authError) authError.classList.add('hidden');
            setLoadingState(true, button);
            authPromise.catch(error => {
                console.error("Auth Action Error:", error.code, error.message);
                showAuthError(error.message);
            }).finally(() => {
                setLoadingState(false);
            });
        };

        // Attach event listeners
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

    // Wait for Firebase to be ready before setting up listeners
    firebaseReady.then(({ auth }) => {
        if (!auth) {
            console.error("Firebase not available for login page.");
            return;
        }
        // Make sure the DOM is loaded before trying to find elements
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setupLoginEventListeners(auth));
        } else {
            setupLoginEventListeners(auth);
        }
    });
}
