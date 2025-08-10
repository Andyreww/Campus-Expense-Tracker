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

// Get config with caching
async function getFirebaseConfig() {
    if (moduleCache.config) return moduleCache.config;
    
    try {
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) throw new Error('Config fetch failed');
        moduleCache.config = await response.json();
        return moduleCache.config;
    } catch (error) {
        console.error("Config error:", error);
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
        
        // Set persistence in background
        setPersistence(moduleCache.auth, browserLocalPersistence).catch(console.error);
        
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

// Auth state guard - only loads when on protected pages
async function setupAuthGuard() {
    const path = window.location.pathname;
    
    // Don't load auth for public pages
    const publicPaths = ['/', '/index.html', '/roadmap.html', '/roadmap'];
    if (publicPaths.includes(path)) return;
    
    // Only load auth for protected pages
    const authPaths = ['/login.html', '/signup.html'];
    const isAuthPage = authPaths.includes(path);
    const isProtectedPage = !publicPaths.includes(path) && !isAuthPage;
    
    if (!isAuthPage && !isProtectedPage) return;
    
    // Now load auth
    const auth = await getAuth();
    if (!auth) return;
    
    const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
    
    onAuthStateChanged(auth, async (user) => {
        if (user && isAuthPage) {
            // Check if new user
            const db = await getFirestore();
            if (db) {
                const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);
                
                if (userDocSnap.exists()) {
                    // Existing user
                    const beforeLaunch = isBeforeLaunch();
                    window.location.replace(beforeLaunch ? '/gate.html' : '/dashboard.html');
                } else {
                    // New user
                    if (isBeforeLaunch()) {
                        sendEmail('/.netlify/functions/send-prelaunch-email', user.email);
                    } else {
                        sendEmail('/.netlify/functions/send-welcome-email', user.email);
                    }
                    window.location.replace('/questionnaire.html');
                }
            }
        } else if (!user && isProtectedPage) {
            window.location.replace('/login.html');
        }
    });
}

// Login page setup - only runs on login page
if (window.location.pathname.includes('/login.html')) {
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
                
            } catch (error) {
                // Show error
                const errorMessages = {
                    'auth/invalid-credential': 'Incorrect email or password',
                    'auth/email-already-in-use': 'Account already exists',
                    'auth/popup-closed-by-user': 'Sign-in cancelled'
                };
                
                const message = Object.entries(errorMessages).find(([key]) => 
                    error.message?.includes(key))?.[1] || 'An error occurred';
                
                elements.error.textContent = message;
                elements.error.classList.remove('hidden');
            } finally {
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

// Only setup auth guard if on protected pages
if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
        const path = window.location.pathname;
        const needsAuth = !['/','index.html','/roadmap.html','/roadmap'].includes(path);
        if (needsAuth) setupAuthGuard();
    });
} else {
    setTimeout(() => {
        const path = window.location.pathname;
        const needsAuth = !['/','index.html','/roadmap.html','/roadmap'].includes(path);
        if (needsAuth) setupAuthGuard();
    }, 100);
}