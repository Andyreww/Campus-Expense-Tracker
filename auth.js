// Ultra-optimized auth.js - Maximum lazy loading

// Constants
const TESTING_MODE = false;
const LAUNCH_DATE = new Date("Aug 20, 2025 00:00:00");

// Cache for loaded modules
const moduleCache = {
    app: null,
    auth: null,
    firestore: null,
    storage: null,
    config: null
};

// Track if we're already checking auth to prevent loops
let authCheckInProgress = false;

// Get config with caching
async function getFirebaseConfig() {
    if (moduleCache.config) return moduleCache.config;
    
    try {
        // Fetch with a timeout to avoid hanging
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const response = await fetch('/.netlify/functions/getFirebaseConfig', { signal: controller.signal });
        clearTimeout(t);
        if (response.ok) {
            moduleCache.config = await response.json();
            return moduleCache.config;
        }
        throw new Error('Config fetch failed');
    } catch (error) {
        console.error("Config error:", error);
        // Fallbacks for local/dev without Netlify running
        try {
            if (window.__FIREBASE_CONFIG) {
                moduleCache.config = window.__FIREBASE_CONFIG;
                console.log('[AUTH] Using window.__FIREBASE_CONFIG fallback');
                return moduleCache.config;
            }
        } catch {}
        try {
            const raw = localStorage.getItem('FIREBASE_CONFIG');
            if (raw) {
                moduleCache.config = JSON.parse(raw);
                console.log('[AUTH] Using localStorage FIREBASE_CONFIG fallback');
                return moduleCache.config;
            }
        } catch {}
        return null;
    }
}

// Initialize Firebase only when first accessed
async function initFirebaseCore() {
    if (moduleCache.app) return moduleCache.app;
    
    try {
        // Dynamic import only when needed
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
        const config = await getFirebaseConfig();
        if (!config) throw new Error('No config');
        
        moduleCache.app = initializeApp(config);
        return moduleCache.app;
    } catch (error) {
        console.error("Firebase init error:", error);
        return null;
    }
}

// Lazy load auth
async function getAuth() {
    if (moduleCache.auth) return moduleCache.auth;
    
    try {
        const app = await initFirebaseCore();
        if (!app) return null;
        
        const authModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
        const { getAuth: initAuth, setPersistence, browserLocalPersistence } = authModule;
        
        moduleCache.auth = initAuth(app);
        // Ensure persistence is set before any sign-in to avoid session loss on redirect
        try {
            await setPersistence(moduleCache.auth, browserLocalPersistence);
        } catch (e) {
            console.warn('[AUTH] Failed to set persistence (continuing):', e);
        }
        return moduleCache.auth;
    } catch (error) {
        console.error("Auth load error:", error);
        return null;
    }
}

// Lazy load Firestore
async function getFirestore() {
    if (moduleCache.firestore) return moduleCache.firestore;
    
    try {
        const app = await initFirebaseCore();
        if (!app) return null;
        
        const { initializeFirestore, CACHE_SIZE_UNLIMITED } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
        
        moduleCache.firestore = initializeFirestore(app, {
            cacheSizeBytes: CACHE_SIZE_UNLIMITED,
            synchronizeTabs: true
        });
        
        return moduleCache.firestore;
    } catch (error) {
        console.error("Firestore load error:", error);
        return null;
    }
}

// Lazy load Storage (only when explicitly needed)
async function getStorage() {
    if (moduleCache.storage) return moduleCache.storage;
    
    try {
        const app = await initFirebaseCore();
        if (!app) return null;
        
        const { getStorage: initStorage } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js");
        moduleCache.storage = initStorage(app);
        return moduleCache.storage;
    } catch (error) {
        console.error("Storage load error:", error);
        return null;
    }
}

// Export promise that resolves when Firebase CAN be loaded (not when it IS loaded)
export const firebaseReady = Promise.resolve({
    get auth() { return getAuth(); },
    get db() { return getFirestore(); },
    get storage() { return getStorage(); }
});

// Logout function - loads auth only when needed
export const logout = async () => {
    const auth = await getAuth();
    if (!auth) return;
    
    const { signOut } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
    try {
        await signOut(auth);
        // Clear any local flags that might affect routing
        try { sessionStorage.clear(); localStorage.removeItem('firebase:previous_websocket_failure'); } catch {}
        // Post-logout navigation: go to login page explicitly
        if (!window.location.pathname.includes('/login')) {
            window.location.replace('/login.html');
        }
    } catch (error) {
        console.error("Sign out error:", error);
    }
};

// Email functions with deduplication
const emailQueue = new Map();
const EMAIL_COOLDOWN = 5000;

async function sendEmail(endpoint, email) {
    const now = Date.now();
    const lastSent = emailQueue.get(email);
    
    if (lastSent && now - lastSent < EMAIL_COOLDOWN) return;
    
    emailQueue.set(email, now);
    
    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    }).catch(console.error);
}

// Helper functions
function isBeforeLaunch() {
    return TESTING_MODE ? false : new Date() < LAUNCH_DATE;
}

function safeNavigate(target) {
    try {
        const current = (window.location.pathname || '').toLowerCase();
        const normalized = (target || '').toLowerCase();
        if (current.endsWith(normalized)) return; // already there
        window.location.replace(target);
    } catch (e) {
        console.warn('[AUTH] Navigation failed, trying assign:', e);
        try { window.location.assign(target); } catch {}
    }
}

// Auth state guard - only loads when on protected pages
async function setupAuthGuard() {
    // Prevent multiple simultaneous auth checks
    if (authCheckInProgress) return;
    authCheckInProgress = true;
    
    const rawPath = window.location.pathname;
    const path = (rawPath.replace(/\/+$/, '') || '/').toLowerCase();
    console.log('Setting up auth guard for path:', path);

    // Determine page type using exact matching
    const isPublicPage = path === '/' || ['/index.html', '/roadmap.html', '/roadmap'].includes(path);
    const isAuthPage = ['/login.html', '/signup.html', '/login', '/signup'].includes(path);
    const isProtectedPage = ['/dashboard.html', '/dashboard', '/questionnaire.html', '/questionnaire', '/gate.html', '/gate'].includes(path);
    
    // Don't load auth for public pages
    if (isPublicPage) {
        authCheckInProgress = false;
        return;
    }
    
    // Only proceed if we need auth
    if (!isAuthPage && !isProtectedPage) {
        authCheckInProgress = false;
        return;
    }
    
    try {
        const auth = await getAuth();
        if (!auth) {
            authCheckInProgress = false;
            return;
        }
        const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
        const isGatePage = path.includes('/gate');
        const isDashboardPage = path.includes('/dashboard');
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
            try {
                const beforeLaunch = isBeforeLaunch();

                if (user) {
                    console.log('[AUTH] User authenticated:', user.email);

                    if (isAuthPage) {
                        // Ensure config is available before redirecting away from login
                        const cfg = await getFirebaseConfig();
                        if (!cfg) {
                            console.warn('[AUTH] No Firebase config yet; deferring redirect to avoid loop');
                            if (!TESTING_MODE && isBeforeLaunch()) {
                                // Keep user on gate if gating applies
                                safeNavigate('/gate.html');
                            }
                            return;
                        }
                        // Signed in from login/signup page
                        if (TESTING_MODE) {
                            // Developer override: allow dashboard access pre-launch
                            console.log('[AUTH] TESTING_MODE active -> redirecting to /dashboard.html');
                            safeNavigate('/dashboard.html');
                            return;
                        }

                        // Determine new vs existing user
                        const db = await getFirestore();
                        if (db) {
                            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
                            const userDocRef = doc(db, 'users', user.uid);
                            const userDocSnap = await getDoc(userDocRef);

                            if (userDocSnap.exists()) {
                                // Existing user: gate before launch, dashboard after
                                const target = beforeLaunch ? '/gate.html' : '/dashboard.html';
                                console.log('[AUTH] Existing user -> redirecting to', target);
                                safeNavigate(target);
                            } else {
                                // New user: send appropriate email and go to questionnaire
                                try {
                                    if (beforeLaunch) {
                                        sendEmail('/.netlify/functions/send-prelaunch-email', user.email);
                                    } else {
                                        sendEmail('/.netlify/functions/send-welcome-email', user.email);
                                    }
                                } catch (e) {
                                    console.warn('[AUTH] Email send failed (non-blocking):', e);
                                }
                                console.log('[AUTH] New user -> redirecting to /questionnaire.html');
                                safeNavigate('/questionnaire.html');
                            }
                        } else {
                            // Fallback if Firestore not available
                            const target = (TESTING_MODE || !beforeLaunch) ? '/dashboard.html' : '/gate.html';
                            console.log('[AUTH] Firestore unavailable -> redirecting to', target);
                            safeNavigate(target);
                        }
                        return;
                    }

                    // User is on a protected page and authenticated
                    if (!TESTING_MODE && beforeLaunch && isDashboardPage) {
                        // Prevent dashboard access before launch
                        console.log('[AUTH] Pre-launch and not testing -> redirecting to /gate.html');
                        safeNavigate('/gate.html');
                        return;
                    }
                    if (TESTING_MODE && beforeLaunch && isGatePage) {
                        // Developer override: skip gate, go to dashboard
                        console.log('[AUTH] TESTING_MODE pre-launch on gate -> redirecting to /dashboard.html');
                        safeNavigate('/dashboard.html');
                        return;
                    }
                    if (!beforeLaunch && isGatePage) {
                        // After launch, gate should funnel to dashboard
                        console.log('[AUTH] Post-launch -> redirecting from gate to /dashboard.html');
                        safeNavigate('/dashboard.html');
                        return;
                    }
                    console.log('[AUTH] Authenticated on protected page, no redirect');
                } else {
                    // Not signed in
                    console.log('[AUTH] No authenticated user');
                    if (isProtectedPage) {
                        console.log('[AUTH] Protected page -> redirecting to /login.html');
                        safeNavigate('/login.html');
                        return;
                    }
                    // On auth/public pages without auth: no redirect
                }
            } finally {
                authCheckInProgress = false;
                // Keep listener active on auth pages to catch sign-in; otherwise unsubscribe
                if (!isAuthPage) unsubscribe();
            }
        });
    } catch (error) {
        console.error('[AUTH] Auth guard error:', error);
        authCheckInProgress = false;
    }
}

// Login page setup - only runs on login page
if (window.location.pathname.includes('/login')) {
    // Defer login setup until DOM is ready
    const setupLogin = async () => {
        // Wait for form to exist
        const form = document.getElementById('auth-form');
        if (!form) {
            requestAnimationFrame(setupLogin);
            return;
        }
        
        // Get form elements
        const elements = {
            email: document.getElementById('email'),
            password: document.getElementById('password'),
            createBtn: document.getElementById('create-account-button'),
            signInBtn: document.getElementById('sign-in-button'),
            googleBtn: document.getElementById('google-signin-button'),
            error: document.getElementById('auth-error')
        };
        
        // Check all elements exist
        if (!Object.values(elements).every(el => el)) {
            requestAnimationFrame(setupLogin);
            return;
        }

        // Add autocomplete attributes for better UX
        if (elements.email) {
            elements.email.setAttribute('autocomplete', 'username');
        }
        if (elements.password) {
            elements.password.setAttribute('autocomplete', 'current-password');
        }
        
        // Load auth and methods only when form is submitted
        const handleAuthAction = async (actionType, button) => {
            elements.error.classList.add('hidden');
            
            // Show loading state
            const originalText = button.innerHTML;
            button.innerHTML = '<div class="spinner"></div> Loading...';
            button.disabled = true;
            
            try {
                // Load Firebase auth now
                const auth = await getAuth();
                if (!auth) throw new Error('Auth not available');
                
                const authModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
                
                let result;
                switch(actionType) {
                    case 'signin':
                        result = await authModule.signInWithEmailAndPassword(
                            auth, 
                            elements.email.value, 
                            elements.password.value
                        );
                        break;
                    case 'create':
                        result = await authModule.createUserWithEmailAndPassword(
                            auth, 
                            elements.email.value, 
                            elements.password.value
                        );
                        break;
                    case 'google':
                        const provider = new authModule.GoogleAuthProvider();
                        result = await authModule.signInWithPopup(auth, provider);
                        break;
                }
                
                // Auth successful - auth state change will handle redirect
                console.log('Auth successful, waiting for redirect...');
                
                // Manually trigger auth guard to ensure redirect happens
                authCheckInProgress = false; // Reset flag first
                await setupAuthGuard();
                
                // Give the auth state listener time to trigger
                // Don't reset button since we're about to redirect
                setTimeout(() => {
                    // If still on login page after 2 seconds, something went wrong
                    if (window.location.pathname.includes('/login')) {
                        console.log('[AUTH] Redirect didn\'t happen within 2s, applying safe fallback');
                        const beforeLaunch = isBeforeLaunch();
                        const target = (TESTING_MODE || !beforeLaunch) ? '/dashboard.html' : '/gate.html';
                        safeNavigate(target);
                    }
                }, 2000);
                
            } catch (error) {
                // Show error
                const errorMessages = {
                    'auth/invalid-credential': 'Incorrect email or password',
                    'auth/email-already-in-use': 'Account already exists',
                    'auth/popup-closed-by-user': 'Sign-in cancelled',
                    'auth/weak-password': 'Password should be at least 6 characters',
                    'auth/invalid-email': 'Invalid email address'
                };
                
                const message = Object.entries(errorMessages).find(([key]) => 
                    error.message?.includes(key))?.[1] || 'An error occurred';
                
                elements.error.textContent = message;
                elements.error.classList.remove('hidden');
                
                // Reset button
                button.innerHTML = originalText;
                button.disabled = false;
            }
        };
        
        // Event listeners
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleAuthAction('signin', elements.signInBtn);
        });
        
        elements.createBtn.addEventListener('click', () => {
            handleAuthAction('create', elements.createBtn);
        });
        
        elements.googleBtn.addEventListener('click', () => {
            handleAuthAction('google', elements.googleBtn);
        });
    };
    
    // Start setup when idle
    if ('requestIdleCallback' in window) {
        requestIdleCallback(setupLogin);
    } else {
        setTimeout(setupLogin, 0);
    }
}

// Setup auth guard with better timing
if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
        setupAuthGuard();
    });
} else {
    setTimeout(() => {
        setupAuthGuard();
    }, 100);
}

// Add a session check function that can be called from dashboard
export const checkAuthSession = async () => {
    const auth = await getAuth();
    if (!auth) return null;
    
    const authModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
    
    return new Promise((resolve) => {
        const unsubscribe = authModule.onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
    });
};