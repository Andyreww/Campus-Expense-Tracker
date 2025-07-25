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
        const onLandingPage = path === '/' || path.endsWith('/index.html');
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
