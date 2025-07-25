// auth.js - The Single Source of Truth for Firebase

// --- IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut as firebaseSignOut,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
// --- FIX: Import initializeFirestore and other necessary functions for the new setup ---
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

        // --- FIX: Initialize Firestore with multi-tab synchronization enabled ---
        // This resolves the "Failed to obtain exclusive access" error by allowing
        // multiple tabs (or instances in a dev environment) to share the database connection.
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
        const onLandingPage = path === '/' || path.endsWith('/index.html');
        const onQuestionnairePage = path.endsWith('/questionnaire.html');
        const onProtectedPage = !onAuthPage && !onLandingPage && !onQuestionnairePage;

        if (user) {
            // --- USER IS LOGGED IN ---
            console.log(`Auth Guard: User logged in (${user.uid}). Path: ${path}`);
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
        } else {
            // --- USER IS LOGGED OUT ---
            console.log(`Auth Guard: User is logged out. Path: ${path}`);
            if (onProtectedPage) {
                console.log("User on protected page while logged out. Redirecting to landing page.");
                window.location.replace('/index.html');
            }
        }
    });
});
