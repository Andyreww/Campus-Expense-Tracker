// Optimized auth.js - Lazy loading and performance improvements

// --- LAZY LOAD IMPORTS ---
// Only load core Firebase initially
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";

// Lazy load auth modules
let authModule = null;
const getAuthModule = async () => {
    if (!authModule) {
        authModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
    }
    return authModule;
};

// Lazy load Firestore
let firestoreModule = null;
const getFirestoreModule = async () => {
    if (!firestoreModule) {
        firestoreModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    }
    return firestoreModule;
};

// Lazy load Storage (only when needed)
let storageModule = null;
const getStorageModule = async () => {
    if (!storageModule) {
        storageModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js");
    }
    return storageModule;
};

// --- CONSTANTS ---
const TESTING_MODE = false;
const LAUNCH_DATE = new Date("Aug 20, 2025 00:00:00");

// Cache Firebase config
let cachedConfig = null;
const getFirebaseConfig = async () => {
    if (cachedConfig) return cachedConfig;
    
    try {
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) throw new Error('Config fetch failed');
        cachedConfig = await response.json();
        return cachedConfig;
    } catch (error) {
        console.error("Failed to fetch Firebase config:", error);
        throw error;
    }
};

// --- OPTIMIZED FIREBASE INITIALIZATION ---
export const firebaseReady = new Promise(async (resolve) => {
    try {
        // Get config first
        const firebaseConfig = await getFirebaseConfig();
        const app = initializeApp(firebaseConfig);
        
        // Load auth module in parallel with Firestore
        const [authMod, firestoreMod] = await Promise.all([
            getAuthModule(),
            getFirestoreModule()
        ]);
        
        const { getAuth, setPersistence, browserLocalPersistence } = authMod;
        const { initializeFirestore, CACHE_SIZE_UNLIMITED } = firestoreMod;
        
        const auth = getAuth(app);
        const db = initializeFirestore(app, {
            cacheSizeBytes: CACHE_SIZE_UNLIMITED,
            synchronizeTabs: true
        });
        
        // Set persistence in background
        setPersistence(auth, browserLocalPersistence).catch(console.error);
        
        // Storage will be loaded only when needed
        const storage = null; // Lazy load when required
        
        console.log("Firebase core services ready");
        resolve({ auth, db, storage, app });
        
    } catch (error) {
        console.error("Firebase init failed:", error);
        // Graceful degradation
        resolve({ auth: null, db: null, storage: null, app: null });
    }
});

// --- OPTIMIZED LOGOUT ---
export const logout = async () => {
    const { auth } = await firebaseReady;
    if (!auth) return;
    
    const { signOut } = await getAuthModule();
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Sign out error:", error);
    }
};

// --- OPTIMIZED EMAIL FUNCTIONS ---
// Debounce email sending to prevent duplicates
const emailQueue = new Set();

async function sendEmail(endpoint, email) {
    const key = `${endpoint}-${email}`;
    if (emailQueue.has(key)) return;
    
    emailQueue.add(key);
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        if (!response.ok) {
            console.error(`Email error (${endpoint}):`, await response.text());
        }
    } catch (error) {
        console.error(`Failed to send email (${endpoint}):`, error);
    } finally {
        // Remove from queue after 5 seconds
        setTimeout(() => emailQueue.delete(key), 5000);
    }
}

const sendPreLaunchEmail = (email) => sendEmail('/.netlify/functions/send-prelaunch-email', email);
const sendWelcomeEmail = (email) => sendEmail('/.netlify/functions/send-welcome-email', email);

// --- HELPER FUNCTIONS ---
function isBeforeLaunch() {
    return TESTING_MODE ? false : new Date() < LAUNCH_DATE;
}

// --- OPTIMIZED AUTH STATE GUARD ---
// Defer non-critical auth checks
firebaseReady.then(async ({ auth, db }) => {
    if (!auth || !db) return;
    
    const { onAuthStateChanged } = await getAuthModule();
    const { doc, getDoc } = await getFirestoreModule();
    
    // Cache current path
    const path = window.location.pathname;
    const publicPaths = ['/', '/index.html', '/roadmap.html', '/roadmap'];
    const authPaths = ['/login.html', '/signup.html'];
    const questionnairePath = '/questionnaire.html';
    const gatePath = '/gate.html';
    
    const isPublicPage = publicPaths.includes(path);
    const isAuthPage = authPaths.includes(path);
    const isQuestionnairePage = path.endsWith(questionnairePath);
    const isGatePage = path.endsWith(gatePath);
    const isProtectedPage = !isPublicPage && !isAuthPage && !isQuestionnairePage && !isGatePage;
    
    onAuthStateChanged(auth, async (user) => {
        // Use requestIdleCallback for non-critical redirects
        const handleRedirect = (url) => {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => window.location.replace(url));
            } else {
                setTimeout(() => window.location.replace(url), 0);
            }
        };
        
        if (user) {
            // User is logged in
            const beforeLaunch = isBeforeLaunch();
            
            if (isAuthPage) {
                // Check if new or existing user
                try {
                    const userDocRef = doc(db, "users", user.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    
                    if (userDocSnap.exists()) {
                        // Existing user
                        handleRedirect(beforeLaunch ? '/gate.html' : '/dashboard.html');
                    } else {
                        // New user - send email asynchronously
                        if (beforeLaunch) {
                            sendPreLaunchEmail(user.email);
                        } else {
                            sendWelcomeEmail(user.email);
                        }
                        handleRedirect('/questionnaire.html');
                    }
                } catch (error) {
                    console.error("User check failed:", error);
                    handleRedirect(beforeLaunch ? '/gate.html' : '/dashboard.html');
                }
            }
            
            // Handle protected pages before launch
            if (isProtectedPage && beforeLaunch) {
                handleRedirect('/gate.html');
            }
            
            // After launch, redirect from gate to dashboard
            if (isGatePage && !beforeLaunch) {
                handleRedirect('/dashboard.html');
            }
            
        } else {
            // User is logged out
            if (isProtectedPage || isGatePage) {
                handleRedirect('/login.html');
            }
        }
    });
});

// --- OPTIMIZED LOGIN PAGE LOGIC ---
if (window.location.pathname.includes('/login.html')) {
    
    const setupLoginPage = async () => {
        const { auth } = await firebaseReady;
        if (!auth) return;
        
        // Get auth methods
        const {
            createUserWithEmailAndPassword,
            signInWithEmailAndPassword,
            GoogleAuthProvider,
            signInWithPopup
        } = await getAuthModule();
        
        // Wait for DOM
        const waitForElement = (id) => {
            return new Promise(resolve => {
                const check = () => {
                    const el = document.getElementById(id);
                    if (el) resolve(el);
                    else requestAnimationFrame(check);
                };
                check();
            });
        };
        
        // Get form elements
        const authForm = await waitForElement('auth-form');
        const emailInput = await waitForElement('email');
        const passwordInput = await waitForElement('password');
        const createAccountButton = await waitForElement('create-account-button');
        const signInButton = await waitForElement('sign-in-button');
        const googleSignInButton = await waitForElement('google-signin-button');
        const authError = await waitForElement('auth-error');
        
        // Cache button text
        const buttonText = {
            signIn: signInButton.innerHTML,
            create: createAccountButton.innerHTML,
            google: googleSignInButton.innerHTML
        };
        
        // Error messages map
        const errorMessages = {
            'auth/invalid-credential': 'Incorrect email or password',
            'auth/wrong-password': 'Incorrect email or password',
            'auth/user-not-found': 'Incorrect email or password',
            'auth/email-already-in-use': 'Account already exists',
            'auth/popup-closed-by-user': 'Sign-in cancelled',
            'auth/network-request-failed': 'Network error - check connection'
        };
        
        const showError = (error) => {
            const msg = Object.entries(errorMessages).find(([key]) => 
                error.message.includes(key))?.[1] || 'An error occurred';
            authError.textContent = msg;
            authError.classList.remove('hidden');
        };
        
        const setLoading = (loading, activeBtn) => {
            [signInButton, createAccountButton, googleSignInButton].forEach(btn => {
                btn.disabled = loading;
                if (!loading) {
                    if (btn === signInButton) btn.innerHTML = buttonText.signIn;
                    if (btn === createAccountButton) btn.innerHTML = buttonText.create;
                    if (btn === googleSignInButton) btn.innerHTML = buttonText.google;
                } else if (btn === activeBtn) {
                    btn.innerHTML = '<div class="spinner"></div> Verifying...';
                }
            });
        };
        
        const handleAuth = async (promise, button) => {
            authError.classList.add('hidden');
            setLoading(true, button);
            try {
                await promise;
            } catch (error) {
                showError(error);
            } finally {
                setLoading(false);
            }
        };
        
        // Event listeners with delegation
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleAuth(
                signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value),
                signInButton
            );
        });
        
        createAccountButton.addEventListener('click', () => {
            handleAuth(
                createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value),
                createAccountButton
            );
        });
        
        googleSignInButton.addEventListener('click', () => {
            const provider = new GoogleAuthProvider();
            handleAuth(signInWithPopup(auth, provider), googleSignInButton);
        });
    };
    
    // Start setup when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupLoginPage);
    } else {
        setupLoginPage();
    }
}