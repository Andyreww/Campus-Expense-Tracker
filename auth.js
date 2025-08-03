// auth.js - The Single Source of Truth for Firebase

// --- IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut as firebaseSignOut,
    setPersistence,
    browserLocalPersistence,
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    initializeFirestore, 
    doc, 
    getDoc, 
    CACHE_SIZE_UNLIMITED 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- CENTRAL FIREBASE INITIALIZATION ---
// This promise ensures Firebase is initialized only ONCE and makes services available to other scripts.
export const firebaseReady = new Promise(async (resolve) => {
    try {
        // Fetch the config from your Netlify function.
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) throw new Error('Could not load Firebase configuration.');
        const firebaseConfig = await response.json();
        
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const storage = getStorage(app);

        // Initialize Firestore with multi-tab synchronization enabled.
        const db = initializeFirestore(app, {
            cacheSizeBytes: CACHE_SIZE_UNLIMITED,
            synchronizeTabs: true
        });
        
        // Set auth persistence to LOCAL to keep users logged in.
        await setPersistence(auth, browserLocalPersistence);

        console.log("Firebase services initialized successfully with multi-tab persistence.");
        resolve({ auth, db, storage });

    } catch (error)
        {
        console.error("FATAL: Firebase initialization failed.", error);
        document.body.innerHTML = 'Could not connect to application services. Please try again later.';
        resolve({ auth: null, db: null, storage: null });
    }
});

// --- LOGOUT FUNCTION ---
export const logout = async () => {
    console.log("Logout function called.");
    const { auth } = await firebaseReady;
    if (!auth) {
        console.error("Auth service not ready, cannot log out.");
        return;
    }
    try {
        await firebaseSignOut(auth);
        console.log("Firebase sign out successful. Auth listener will handle redirect.");
    } catch (error) {
        console.error("Error during sign out:", error);
    }
};


// --- AUTH STATE GUARD & ROUTER ---
// This runs whenever the user's login state changes and handles all page routing.
firebaseReady.then(({ auth, db }) => {
    if (!auth || !db) return;

    onAuthStateChanged(auth, async (user) => {
        const path = window.location.pathname;

        const onAuthPage = path.endsWith('/login.html') || path.endsWith('/signup.html');
        const onLandingPage = path === '/' || path.endsWith('/index.html') || path.endsWith('/roadmap.html');
        const onQuestionnairePage = path.endsWith('/questionnaire.html');
        // A page is "protected" if it's NOT the landing, auth, or questionnaire page.
        const onProtectedPage = !onAuthPage && !onLandingPage && !onQuestionnairePage;

        if (user) {
            // --- USER IS LOGGED IN ---
            console.log(`Auth Guard: User logged in (${user.uid}). Path: ${path}`);
            // If a logged-in user is on an auth page, redirect them to their dashboard or questionnaire.
            if (onAuthPage) {
                try {
                    const userDocRef = doc(db, "users", user.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    if (userDocSnap.exists()) {
                        console.log("Redirecting existing user from auth page to dashboard.");
                        window.location.replace('/dashboard.html');
                    } else {
                        console.log("Redirecting new user from auth page to questionnaire.");
                        window.location.replace('/questionnaire.html');
                    }
                } catch (dbError) {
                    console.error("Error checking user document, redirecting to dashboard as fallback:", dbError);
                    window.location.replace('/dashboard.html');
                }
            }
            // If a logged-in user is on any other page (landing, dashboard, etc.), they can stay.
        } else {
            // --- USER IS LOGGED OUT ---
            console.log(`Auth Guard: User is logged out. Path: ${path}`);
            
            // --- REVISED LOGIC ---
            // If a logged-out user tries to access a PROTECTED page (like the dashboard),
            // redirect them to the login page.
            if (onProtectedPage) {
                console.log(`User on protected page "${path}" while logged out. Redirecting to login page.`);
                window.location.replace('/login.html');
            }
            // If they are on the landing page (index.html) or an auth page, they can stay. No redirect needed.
        }
    });
});

// --- LOGIN PAGE SPECIFIC LOGIC ---
// This part of the script only runs on the login page to make the form work.
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
