// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    updateProfile 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Your web app's Firebase configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyCPQe0CL9FmUu2auma8s5Zkh9hCIV41jfg",
  authDomain: "big-red-balance.firebaseapp.com",
  projectId: "big-red-balance",
  storageBucket: "big-red-balance.firebasestorage.app",
  messagingSenderId: "100680274894",
  appId: "1:100680274894:web:527953526eeffb00e9d19f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

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
        window.location.href = userDocSnap.exists() ? "dashboard.html" : "questionnaire.html";
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
