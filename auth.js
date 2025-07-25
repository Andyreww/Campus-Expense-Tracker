// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    setPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Main App Initialization ---
async function main() {
    try {
        // Securely fetch the Firebase config from our Netlify function
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            throw new Error('Could not load app configuration.');
        }
        const firebaseConfig = await response.json();

        // Initialize Firebase with the secure config
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const googleProvider = new GoogleAuthProvider();

        // IMPORTANT: Set auth persistence to SESSION only
        // This ensures auth state is cleared when the browser is closed
        try {
            await setPersistence(auth, browserSessionPersistence);
        } catch (error) {
            console.warn("Could not set auth persistence:", error);
        }

        // Enable offline persistence to prevent "client is offline" errors
        enableIndexedDbPersistence(db).catch((err) => {
            console.warn("Firestore persistence error:", err.message);
        });

        // --- Get DOM Elements ---
        const authForm = document.getElementById('auth-form');
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const createAccountButton = document.getElementById('create-account-button');
        const signInButton = document.getElementById('sign-in-button');
        const googleSignInButton = document.getElementById('google-signin-button');
        const authError = document.getElementById('auth-error');

        // Store original button content
        const originalButtonContent = {
            signIn: signInButton.innerHTML,
            createAccount: createAccountButton.innerHTML,
            google: googleSignInButton.innerHTML
        };

        // --- Functions ---
        const showAuthError = (message) => {
            let friendlyMessage = "An unexpected error occurred.";
            if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) {
                friendlyMessage = "Incorrect email or password. Please try again.";
            } else if (message.includes('auth/email-already-in-use')) {
                friendlyMessage = "An account with this email already exists.";
            } else if (message.includes('permission-denied')) {
                friendlyMessage = "PERMISSION ERROR: Check your Firestore rules.";
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
                    btn.disabled = true;
                    if (btn === activeBtn) {
                        btn.innerHTML = `<div class="spinner"></div> Verifying...`;
                    }
                });
            } else {
                signInButton.innerHTML = originalButtonContent.signIn;
                createAccountButton.innerHTML = originalButtonContent.createAccount;
                googleSignInButton.innerHTML = originalButtonContent.google;
                allButtons.forEach(btn => btn.disabled = false);
            }
        };

        const handleRedirect = async (user) => {
            if (!user) return setLoadingState(false);
            try {
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);
                // Use replace() instead of href to prevent back button issues
                window.location.replace(userDocSnap.exists() ? "dashboard.html" : "questionnaire.html");
            } catch (error) {
                showAuthError(error.message);
                setLoadingState(false);
            }
        };

        const handleAuthAction = (authPromise, button) => {
            authError.classList.add('hidden');
            setLoadingState(true, button);
            authPromise
                .then(userCredential => handleRedirect(userCredential.user))
                .catch(error => {
                    showAuthError(error.message);
                    setLoadingState(false);
                });
        };

        const handleGoogleSignIn = () => {
            authError.classList.add('hidden');
            setLoadingState(true, googleSignInButton);
            signInWithPopup(auth, googleProvider)
                .then(result => handleRedirect(result.user))
                .catch(error => {
                    showAuthError(error.message);
                    setLoadingState(false);
                });
        };

        // --- Event Listeners ---
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleAuthAction(signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value), signInButton);
        });
        createAccountButton.addEventListener('click', () => {
            handleAuthAction(createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value), createAccountButton);
        });
        googleSignInButton.addEventListener('click', handleGoogleSignIn);

    } catch (error) {
        console.error("Fatal Error initializing auth page:", error);
        const authErrorEl = document.getElementById('auth-error');
        if(authErrorEl) {
            authErrorEl.textContent = "Could not connect to services. Please check your connection and try again.";
            authErrorEl.classList.remove('hidden');
        }
    }
}

// Start the application
main();