// --- IMPORTS ---
import { firebaseReady, logout } from './auth.js';
import { doc, getDoc, updateDoc, collection, query, orderBy, getDocs, setDoc, deleteDoc, addDoc, Timestamp, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { updateProfile, deleteUser } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";


// --- DOM Elements ---
let loadingIndicator, dashboardContainer, pageTitle, welcomeMessage, userAvatar, avatarButton,
    creditsBalanceEl, diningBalanceEl, swipesBalanceEl, bonusBalanceEl,
    swipesCard, bonusCard, logoutButton, tabItems,
    mainSections, leaderboardList, publicLeaderboardContainer, publicLeaderboardCheckbox,
    weatherWidget, pfpModalOverlay, pfpPreview, pfpUploadInput, pfpSaveButton,
    pfpCloseButton, pfpError, mapOpener, mapModalOverlay, mapModal, mapCloseButton, mapRenderTarget,
    newspaperDate, fabContainer, mainFab, customLogBtn, customLogModal, customLogForm,
    customItemName, customItemPrice, customItemStore, customLogCancel, customLogClose, userBioInput,
    quickLogWidgetsContainer, saveAsWidgetCheckbox, openDeleteAccountBtn, deleteConfirmModalOverlay,
    deleteCancelBtn, deleteConfirmBtn, deleteErrorMessage;

// --- App State ---
let map = null;
let currentUser = null;
let selectedPfpFile = null;
let firebaseServices = null;
let isDeleteModeActive = false;
let pressTimer = null;

// --- Main App Initialization ---
async function main() {
    assignDOMElements();
    try {
        const services = await firebaseReady;
        if (!services.auth || !services.db || !services.storage) {
            throw new Error('Firebase services could not be initialized.');
        }
        firebaseServices = services;
        
        currentUser = firebaseServices.auth.currentUser;
        if (!currentUser) {
            window.location.replace('/login.html');
            return;
        }

        checkProfile();

    } catch (error) {
        console.error("Fatal Error on Dashboard:", error);
        if (loadingIndicator) {
            loadingIndicator.innerHTML = "Failed to load dashboard. Please try again later.";
        }
    }
}

// --- App Logic ---
async function checkProfile() {
    const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
        const userData = userDoc.data();
        currentUser.bio = userData.bio || '';
        renderDashboard(userData);
    } else {
        window.location.href = "questionnaire.html";
    }
}

function renderDashboard(userData) {
    const { balances, displayName, photoURL, showOnWallOfFame, bio } = userData;
    
    welcomeMessage.innerHTML = `<span class="wave">👋</span> Welcome back, <span class="user-name">${displayName}</span>!`;
    updateAvatar(photoURL, displayName);
    publicLeaderboardCheckbox.checked = !!showOnWallOfFame;
    
    if (userBioInput) {
        userBioInput.value = bio || '';
    }
    
    updateBalancesUI(balances);
    fetchAndRenderWeather();
    renderQuickLogWidgets(firebaseServices.db);
    
    const today = new Date();
    if (newspaperDate) {
        newspaperDate.textContent = today.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
    
    loadingIndicator.style.display = 'none';
    dashboardContainer.style.display = 'block';
    
    setupEventListeners();
    handleInitialTab();
    handleBioInput();
}

function assignDOMElements() {
    loadingIndicator = document.getElementById('loading-indicator');
    dashboardContainer = document.getElementById('dashboard-container');
    pageTitle = document.getElementById('page-title');
    welcomeMessage = document.getElementById('welcome-message');
    userAvatar = document.getElementById('user-avatar');
    avatarButton = document.getElementById('avatar-button');
    creditsBalanceEl = document.getElementById('credits-balance');
    diningBalanceEl = document.getElementById('dining-balance');
    swipesBalanceEl = document.getElementById('swipes-balance');
    bonusBalanceEl = document.getElementById('bonus-balance');
    swipesCard = document.getElementById('swipes-card');
    bonusCard = document.getElementById('bonus-card');
    logoutButton = document.getElementById('logout-button');
    tabItems = document.querySelectorAll('.tab-item[data-section]');
    mainSections = document.querySelectorAll('.main-section');
    leaderboardList = document.getElementById('leaderboard-list');
    publicLeaderboardContainer = document.getElementById('public-leaderboard-container');
    publicLeaderboardCheckbox = document.getElementById('public-leaderboard-checkbox');
    weatherWidget = document.getElementById('weather-widget');
    pfpModalOverlay = document.getElementById('pfp-modal-overlay');
    pfpPreview = document.getElementById('pfp-preview');
    pfpUploadInput = document.getElementById('pfp-upload-input');
    pfpSaveButton = document.getElementById('pfp-save-button');
    pfpCloseButton = document.getElementById('pfp-close-button');
    pfpError = document.getElementById('pfp-error');
    userBioInput = document.getElementById('user-bio-input');
    mapOpener = document.getElementById('map-opener');
    mapModalOverlay = document.getElementById('map-modal-overlay');
    mapModal = document.getElementById('map-modal');
    mapCloseButton = document.getElementById('map-close-button');
    mapRenderTarget = document.getElementById('map-render-target');
    newspaperDate = document.getElementById('newspaper-date');
    fabContainer = document.getElementById('fab-container');
    mainFab = document.getElementById('main-fab');
    customLogBtn = document.getElementById('custom-log-btn');
    customLogModal = document.getElementById('custom-log-modal');
    customLogForm = document.getElementById('custom-log-form');
    customItemName = document.getElementById('custom-item-name');
    customItemPrice = document.getElementById('custom-item-price');
    customItemStore = document.getElementById('custom-item-store');
    customLogCancel = document.getElementById('custom-log-cancel');
    customLogClose = document.getElementById('custom-log-close');
    quickLogWidgetsContainer = document.getElementById('quick-log-widgets-container');
    saveAsWidgetCheckbox = document.getElementById('save-as-widget-checkbox');
    // New elements for delete functionality
    openDeleteAccountBtn = document.getElementById('open-delete-account-button');
    deleteConfirmModalOverlay = document.getElementById('delete-confirm-modal-overlay');
    deleteCancelBtn = document.getElementById('delete-cancel-button');
    deleteConfirmBtn = document.getElementById('delete-confirm-button');
    deleteErrorMessage = document.getElementById('delete-error-message');
}

function setupEventListeners() {
    const { db, storage } = firebaseServices;

    if (avatarButton) avatarButton.addEventListener('click', () => pfpModalOverlay.classList.remove('hidden'));
    if (pfpCloseButton) pfpCloseButton.addEventListener('click', closeModal);
    if (pfpModalOverlay) pfpModalOverlay.addEventListener('click', (e) => {
        if (e.target === pfpModalOverlay) closeModal();
    });
    if (pfpUploadInput) pfpUploadInput.addEventListener('change', handlePfpUpload);
    if (pfpSaveButton) pfpSaveButton.addEventListener('click', () => saveProfile(storage, db));

    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            logout();
        });
    }

    if (tabItems) tabItems.forEach(tab => {
        tab.addEventListener('click', (e) => handleTabClick(e, db));
    });
    
    if (publicLeaderboardCheckbox) publicLeaderboardCheckbox.addEventListener('change', (e) => handlePublicToggle(e, db));

    if (mapOpener) mapOpener.addEventListener('click', openMapModal);
    if (mapCloseButton) mapCloseButton.addEventListener('click', closeMapModal);
    if (mapModalOverlay) mapModalOverlay.addEventListener('click', (e) => {
        if(e.target === mapModalOverlay) closeMapModal();
    });

    // FAB Logic - Fixed for both mobile and desktop
    if (mainFab && fabContainer) {
        const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        if (isMobile) {
            mainFab.addEventListener('click', (e) => {
                e.preventDefault();
                fabContainer.classList.toggle('expanded');
            });
            document.addEventListener('click', (e) => {
                if (!fabContainer.contains(e.target)) {
                    fabContainer.classList.remove('expanded');
                }
            });
        }
    }

    if (customLogBtn) customLogBtn.addEventListener('click', async () => {
        customLogModal.classList.remove('hidden');
        customItemName.focus();
        const saveWidgetContainer = saveAsWidgetCheckbox.closest('.form-group-inline');
        if (saveWidgetContainer) {
            const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
            const snapshot = await getDocs(widgetsRef);
            if (snapshot.size >= 3) {
                saveWidgetContainer.style.display = 'none';
                saveAsWidgetCheckbox.checked = false;
            } else {
                saveWidgetContainer.style.display = 'flex';
            }
        }
    });
    if (customLogCancel) customLogCancel.addEventListener('click', closeCustomLogModal);
    if (customLogClose) customLogClose.addEventListener('click', closeCustomLogModal);
    if (customLogModal) customLogModal.addEventListener('click', (e) => {
        if (e.target === customLogModal) closeCustomLogModal();
    });
    if (customLogForm) customLogForm.addEventListener('submit', (e) => {
        e.preventDefault();
        logCustomPurchase(db);
    });

    if (userBioInput) userBioInput.addEventListener('input', handleBioInput);
    
    // Listener to exit delete mode on mobile
    document.body.addEventListener('click', (e) => {
        if (isDeleteModeActive && !quickLogWidgetsContainer.contains(e.target)) {
            toggleDeleteMode(false);
        }
    }, true); // Use capture to catch clicks anywhere

    // Event listeners for delete account functionality
    if (openDeleteAccountBtn) openDeleteAccountBtn.addEventListener('click', () => deleteConfirmModalOverlay.classList.remove('hidden'));
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => deleteConfirmModalOverlay.classList.add('hidden'));
    if (deleteConfirmModalOverlay) deleteConfirmModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteConfirmModalOverlay) deleteConfirmModalOverlay.classList.add('hidden');
    });
    if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', deleteUserAccount);
}

/**
 * Deletes a user's account and all associated data.
 * This is a destructive and irreversible action.
 * It now deletes all data from Firestore/Storage BEFORE deleting the Auth user.
 */
async function deleteUserAccount() {
    if (!currentUser || !firebaseServices) return;

    const { db, storage } = firebaseServices;

    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting...';
    deleteErrorMessage.classList.add('hidden');

    const userId = currentUser.uid;
    const userToDelete = currentUser; // Keep a reference to the user object

    try {
        // STEP 1: Delete all associated data from Firestore and Storage first.
        // This must be done while the user is still authenticated.
        console.log(`User ${userId} initiated deletion. Deleting data first...`);

        const purchasesPath = `users/${userId}/purchases`;
        const widgetsPath = `users/${userId}/quickLogWidgets`;
        const userDocRef = doc(db, "users", userId);
        const wallOfFameDocRef = doc(db, "wallOfFame", userId);
        const storageRef = ref(storage, `profile_pictures/${userId}`);

        // Use Promise.all to run deletions in parallel for efficiency
        await Promise.all([
            deleteSubcollection(db, purchasesPath),
            deleteSubcollection(db, widgetsPath),
            deleteDoc(wallOfFameDocRef).catch(err => console.log("No Wall of Fame doc to delete:", err.message)),
            deleteDoc(userDocRef),
            deleteObject(storageRef).catch(err => {
                // This catch is important. If the user has no profile picture,
                // deleteObject will throw an error. We want to catch it and continue.
                // The CORS error in your logs also suggests a potential issue with Storage permissions/setup.
                if (err.code !== 'storage/object-not-found') {
                    console.error("Error deleting profile picture (might be a CORS issue):", err);
                } else {
                    console.log("No profile picture to delete.");
                }
            })
        ]);
        
        console.log(`Successfully deleted data for user ${userId}.`);

        // STEP 2: Now that all data is gone, delete the user from Firebase Authentication.
        await deleteUser(userToDelete);
        console.log(`Successfully deleted user ${userId} from Auth.`);


        // STEP 3: Redirect the user.
        window.location.replace('/login.html');

    } catch (error) {
        console.error("Account Deletion Failed:", error);
        
        let errorMessage = 'Failed to delete account. Please try again.';
        if (error.code === 'auth/requires-recent-login') {
            errorMessage = 'This is a sensitive action. Please log out and log back in before trying to delete your account.';
        } else if (error.code === 'permission-denied') {
            errorMessage = 'Could not delete user data. Please check Firestore security rules.';
        }
        
        deleteErrorMessage.textContent = errorMessage;
        deleteErrorMessage.classList.remove('hidden');

    } finally {
        // This 'finally' block ensures the button is ALWAYS reset if the process fails,
        // preventing it from getting stuck on "Deleting...".
        // If successful, the page redirects before this matters.
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = 'Yes, Delete It';
    }
}


/**
 * Helper function to recursively delete all documents in a subcollection.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} collectionPath - The path to the subcollection to delete.
 */
async function deleteSubcollection(db, collectionPath) {
    const collectionRef = collection(db, collectionPath);
    const q = query(collectionRef);
    const snapshot = await getDocs(q);

    if (snapshot.size === 0) {
        return; // Nothing to delete
    }

    const deletePromises = [];
    snapshot.forEach(docSnapshot => {
        deletePromises.push(deleteDoc(docSnapshot.ref));
    });

    await Promise.all(deletePromises);
    console.log(`All documents in '${collectionPath}' have been deleted.`);
}


function containsProfanity(text) {
    // Comprehensive list of profanity and inappropriate words
    const profanityList = [
        // sexual & explicit
        'fuck','fucking','fucked','shit','shitty','crap','bitch','bastard','dick','cock','pussy',
        'cunt','asshole','ass','douche','twat','prick','bollocks','bugger','shag','slut','whore',
        'fag','faggot','dyke','tranny','shemale','kike','spic','chink','gook','beaner','wetback',
        'nigger','nigga','dyke','retard','idiot','moron','cretin',
        'jizz','cum','dildo','handjob','blowjob','tits','boobs','penis','vagina','anus',
        'porn','sex','suck','blow','rape','molest','pedophile','pedo','incest',
        'motherfucker','mother fucker','motha fucker','cocksucker','cock sucker',
        'jerkoff','jerk off','clit','titty','twatwaffle','dumbass','asswipe','dumbfuck',
        'dumb fuck','bullshit','holy shit','holy fuck','fuckedup','fuckup','fuckyou','fuck you',
        'goddamn','god damn','damn','bloody','frigging','fricking','hell','arse','arsehole',
        'shite','crikey','crapola','piss','pissed','pissedoff','piss off','shitter','shitface',
        'shithead','shitshow','shitstorm','pisshead',
        // hate speech & modern slurs
        'nazi','hitler','kkk','antisemite','white supremacist','whoreface','slutface',
        'autistic','autism','schizo','schizophrenic','crazy','insane','lunatic','spastic',
        'cripple','crip','retard','retarded','gimp','spaz','mong','mongoloid',
        'feminazi','beanerpede','alfaclan','alien','illegal alien','wetback','raghead',
        'honky','cracker','coon','coonass','golliwog','raghead','kafir','paki',
        'jap','chingchong','chink','zipperhead','zipcrow','kraut','polack','slantee',
        // misc offense, mild abuse, recent slang
        'wtf','stfu','gtfo','omfg','omg','fml','lmao','rofl','roflmao','suckmydick',
        'suckmyass','eatmyass','eatmyshit','eatmyshit','kissmyass','kissmyfeet','tosser',
        'wanker','twatwaffle','clunge','gash','minge','clunge','nudist','nude','pornstar',
        'escort','stripper','stripclub','cumshot','pearljamer','pearl jammer','gore', 'gory',
        'neckbeard','incel','simp','stan','wang','dong','meatspin','goatse','lolita',
        'cp','hentai','lolicon','shota','bestiality','zoophilia','zoophile','beastiality',
        'beastial','beast','snuff','necrophilia','necrophile','vore','voreplay',
        'spook','jungle bunny','fried chicken','macaco','macaca',
        // euphemisms, variants & obfuscations
        'f u c k','s h i t','s h i t t y','f@ck','sh1t','sh!t','b!tch','c0ck','p!ss','c u n t',
        'f u c k e d','f u c k i n g','s h i t s h o w','b 1 t c h','grrrrr','damnit','damnit',
    ];
    
    // Convert to lowercase and remove spaces for checking
    const cleanText = text.toLowerCase().replace(/\s/g, '');
    
    // Check for exact matches and l33t speak variations
    for (const word of profanityList) {
        // Create pattern for l33t speak (common substitutions)
        const l33tPattern = word
            .replace(/a/g, '[a@4]')
            .replace(/e/g, '[e3]')
            .replace(/i/g, '[i1!]')
            .replace(/o/g, '[o0]')
            .replace(/s/g, '[s5$]')
            .replace(/t/g, '[t7]')
            .replace(/g/g, '[g9]')
            .replace(/l/g, '[l1]')
            .replace(/z/g, '[z2]');
        
        const regex = new RegExp(l33tPattern, 'i');
        if (regex.test(cleanText) || cleanText.includes(word)) {
            return true;
        }
    }
    
    return false;
}

function handleBioInput() {
    if (!userBioInput) return;

    const maxLength = 15;
    const warningThreshold = 8;
    let currentLength = userBioInput.value.length;

    // THE FIX: Enforce the max length by trimming the value
    if (currentLength > maxLength) {
        userBioInput.value = userBioInput.value.substring(0, maxLength);
        currentLength = maxLength;
    }

    // Check for profanity
    if (containsProfanity(userBioInput.value)) {
        userBioInput.classList.add('bio-danger');
        if (!document.getElementById('bio-profanity-warning')) {
            const warning = document.createElement('div');
            warning.id = 'bio-profanity-warning';
            warning.className = 'profanity-warning-note';
            warning.innerHTML = `
                <div class="warning-paper">
                    <div class="warning-tape"></div>
                    <div class="warning-content">
                        <span class="warning-emoji">🙊</span>
                        <span class="warning-text">Whoa there, friend!</span>
                        <span class="warning-subtext">Let's keep it family-friendly</span>
                    </div>
                </div>
            `;
            userBioInput.parentElement.appendChild(warning);
        }
        return;
    } else {
        // Remove profanity warning if it exists
        const warning = document.getElementById('bio-profanity-warning');
        if (warning) warning.remove();
    }

    userBioInput.classList.remove('bio-warning', 'bio-danger');

    if (currentLength >= maxLength) {
        userBioInput.classList.add('bio-danger');
    } else if (currentLength >= warningThreshold) {
        userBioInput.classList.add('bio-warning');
    }
}

function handleTabClick(e, db) {
    e.preventDefault(); 
    const tab = e.currentTarget;
    const targetSectionId = tab.dataset.section;
    switchTab(targetSectionId, db);
}

function switchTab(sectionId, db) {
    const targetTab = document.querySelector(`.tab-item[data-section="${sectionId}"]`);
    const targetSection = document.getElementById(sectionId);

    if (targetTab && targetSection) {
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        mainSections.forEach(s => s.classList.remove('active'));

        targetTab.classList.add('active');
        targetSection.classList.add('active');

        if (sectionId === 'home-section' && quickLogWidgetsContainer.querySelector('.quick-log-widget-btn')) {
            quickLogWidgetsContainer.style.display = 'block';
        } else {
            quickLogWidgetsContainer.style.display = 'none';
        }

        if (sectionId === 'leaderboard-section') {
            publicLeaderboardContainer.classList.remove('hidden');
            if (db) {
                fetchAndRenderLeaderboard(db);
            }
        } else {
            publicLeaderboardContainer.classList.add('hidden');
        }
    }
}

function handleInitialTab() {
    const hash = window.location.hash;
    if (hash) {
        const sectionId = hash.substring(1);
        switchTab(sectionId, firebaseServices?.db);
    } else {
        switchTab('home-section', firebaseServices?.db);
    }
}

function openMapModal() {
    if (!map) {
        initializeMap();
    }
    mapModalOverlay.classList.remove('hidden');
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 300);
}

function closeMapModal() {
    mapModalOverlay.classList.add('hidden');
}

function updateAvatar(photoURL, displayName) {
    if (photoURL) {
        userAvatar.src = photoURL;
        pfpPreview.src = photoURL;
    } else {
        const initial = displayName ? displayName.charAt(0).toUpperCase() : '?';
        const svg = `<svg width="56" height="56" xmlns="http://www.w3.org/2000/svg"><rect width="56" height="56" rx="28" ry="28" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="28" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
        const svgUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
        userAvatar.src = svgUrl;
        pfpPreview.src = svgUrl;
    }
}

function closeModal() {
    pfpModalOverlay.classList.add('hidden');
    pfpUploadInput.value = '';
    selectedPfpFile = null;
    pfpError.classList.add('hidden');
    if (userBioInput) {
        userBioInput.value = currentUser.bio || '';
    }
    // Remove any profanity warnings when closing
    const warning = document.getElementById('bio-profanity-warning');
    if (warning) warning.remove();
}

function closeCustomLogModal() {
    customLogModal.classList.add('hidden');
    customLogForm.reset();
    if(saveAsWidgetCheckbox) saveAsWidgetCheckbox.checked = false;
}

function handlePfpUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        pfpError.textContent = 'Please select an image file.';
        pfpError.classList.remove('hidden');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        pfpError.textContent = 'File is too large (max 5MB).';
        pfpError.classList.remove('hidden');
        return;
    }
    
    pfpError.classList.add('hidden');
    selectedPfpFile = file;

    const reader = new FileReader();
    reader.onload = (event) => {
        pfpPreview.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

async function saveProfile(storage, db) {
    if (!currentUser) return;

    pfpSaveButton.disabled = true;
    pfpSaveButton.textContent = 'Saving...';
    pfpError.classList.add('hidden');

    const newBio = userBioInput.value.trim();
    
    // Check for profanity before saving
    if (containsProfanity(newBio)) {
        pfpError.textContent = 'Please use appropriate language in your status.';
        pfpError.classList.remove('hidden');
        pfpSaveButton.disabled = false;
        pfpSaveButton.textContent = 'Save Changes';
        return;
    }
    
    const updateData = { bio: newBio };

    try {
        if (selectedPfpFile) {
            const storageRef = ref(storage, `profile_pictures/${currentUser.uid}`);
            const snapshot = await uploadBytes(storageRef, selectedPfpFile);
            const downloadURL = await getDownloadURL(snapshot.ref);
            
            updateData.photoURL = downloadURL;
            await updateProfile(currentUser, { photoURL: downloadURL });
            updateAvatar(downloadURL, currentUser.displayName);
        }

        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, updateData);
        currentUser.bio = newBio;

        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists() && userDocSnap.data().showOnWallOfFame) {
            const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
            const { displayName, photoURL, currentStreak } = userDocSnap.data();
            await setDoc(wallOfFameDocRef, {
                displayName,
                photoURL,
                currentStreak: currentStreak || 0,
                bio: newBio
            }, { merge: true });
        }

        closeModal();

    } catch (error) {
        console.error("Profile Save Error:", error);
        pfpError.textContent = 'Save failed. Please try again.';
        pfpError.classList.remove('hidden');
    } finally {
        pfpSaveButton.disabled = false;
        pfpSaveButton.textContent = 'Save Changes';
    }
}

/**
 * Checks if an item is purchased frequently and creates a widget if it is.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} itemName - The name of the item purchased.
 * @param {number} itemPrice - The price of the item.
 * @param {string} storeName - The name of the store.
 * @returns {Promise<boolean>} - True if a widget was created, false otherwise.
 */
async function checkAndCreateFrequentWidget(db, itemName, itemPrice, storeName) {
    if (!currentUser) return false;

    try {
        const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
        const widgetsSnapshot = await getDocs(widgetsRef);
        
        // 1. Check if we have reached the max number of widgets (3)
        if (widgetsSnapshot.size >= 3) {
            return false;
        }

        // 2. Check if a widget for this item already exists
        let widgetExists = false;
        widgetsSnapshot.forEach(doc => {
            if (doc.data().itemName === itemName) {
                widgetExists = true;
            }
        });
        if (widgetExists) {
            return false;
        }

        // 3. Count past purchases of this specific item
        const purchasesRef = collection(db, "users", currentUser.uid, "purchases");
        const allPurchasesSnapshot = await getDocs(purchasesRef);
        
        let purchaseCount = 0;
        allPurchasesSnapshot.forEach(doc => {
            const purchase = doc.data();
            // Check if the purchase has an items array and the first item's name matches
            if (purchase.items && purchase.items.length > 0 && purchase.items[0].name === itemName) {
                purchaseCount++;
            }
        });

        // 4. If the item has been purchased enough times, create the widget
        const FREQUENCY_THRESHOLD = 3;
        if (purchaseCount >= FREQUENCY_THRESHOLD) {
            await addDoc(widgetsRef, {
                itemName,
                itemPrice,
                storeName,
                createdAt: Timestamp.now()
            });
            return true; // Indicate that a widget was created
        }

    } catch (error) {
        console.error("Error checking/creating frequent widget:", error);
    }
    
    return false; // No widget was created
}


async function logCustomPurchase(db) {
    if (!currentUser) return;

    const itemName = customItemName.value.trim();
    const itemPrice = parseFloat(customItemPrice.value);
    const storeName = customItemStore.value;
    const shouldSaveWidget = saveAsWidgetCheckbox.checked;

    if (!itemName || isNaN(itemPrice) || itemPrice <= 0) {
        alert('Please fill in all fields correctly');
        return;
    }

    const userDocRef = doc(db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    const currentBalance = userData.balances.credits;

    if (itemPrice > currentBalance) {
        alert("Not enough credits!");
        return;
    }

    const submitBtn = customLogForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite;"></span> Logging...';

    let widgetCreated = false;

    try {
        let { currentStreak = 0, longestStreak = 0, lastLogDate = null } = userData;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (lastLogDate) {
            const lastDate = lastLogDate.toDate();
            lastDate.setHours(0, 0, 0, 0);
            const diffTime = today - lastDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                currentStreak++;
            } else if (diffDays > 1) {
                currentStreak = 1;
            }
        } else {
            currentStreak = 1;
        }

        if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
        }

        const purchaseRef = collection(db, "users", currentUser.uid, "purchases");
        await addDoc(purchaseRef, {
            items: [{ name: itemName, price: itemPrice, quantity: 1 }],
            total: itemPrice,
            store: storeName,
            purchaseDate: Timestamp.now(),
            isCustom: true
        });

        const newBalance = currentBalance - itemPrice;
        await updateDoc(userDocRef, {
            "balances.credits": newBalance,
            currentStreak: currentStreak,
            longestStreak: longestStreak,
            lastLogDate: Timestamp.now()
        });
        
        if (shouldSaveWidget) {
            const quickLogWidgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
            const snapshot = await getDocs(quickLogWidgetsRef);
            if (snapshot.size < 3) {
                const q = query(quickLogWidgetsRef, where("itemName", "==", itemName));
                const existingWidgets = await getDocs(q);
                if (existingWidgets.empty) {
                    await addDoc(quickLogWidgetsRef, {
                        itemName,
                        itemPrice,
                        storeName,
                        createdAt: Timestamp.now()
                    });
                    widgetCreated = true;
                }
            }
        } else {
            // If user didn't manually save, check if it's a frequent purchase
            widgetCreated = await checkAndCreateFrequentWidget(db, itemName, itemPrice, storeName);
        }

        if (userData.showOnWallOfFame && currentUser?.uid) {
            const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
            await setDoc(wallOfFameDocRef, {
                displayName: currentUser.displayName || "Anonymous",
                photoURL: currentUser.photoURL || "",
                currentStreak: currentStreak,
                bio: userData.bio || ""
            }, { merge: true });
        }

        creditsBalanceEl.textContent = `$${newBalance.toFixed(2)}`;
        const walletContainer = document.querySelector('.wallet-container, .table-item.item-credits');
        if (walletContainer) {
            walletContainer.classList.add('hit');
            setTimeout(() => walletContainer.classList.remove('hit'), 600);
        }

        if (widgetCreated) {
            await renderQuickLogWidgets(db);
        }

        closeCustomLogModal();
        showSuccessMessage(`✓ Logged: ${itemName}`);

    } catch (error) {
        console.error("Error logging custom purchase:", error);
        alert("Failed to log purchase. Please try again.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Log Purchase</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    }
}

async function renderQuickLogWidgets(db) {
    if (!currentUser || !quickLogWidgetsContainer) return;

    const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
    const q = query(widgetsRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    quickLogWidgetsContainer.innerHTML = ''; // Clear existing

    if (querySnapshot.empty) {
        quickLogWidgetsContainer.style.display = 'none';
        return;
    }

    const isHomeActive = document.getElementById('home-section')?.classList.contains('active');
    quickLogWidgetsContainer.style.display = isHomeActive ? 'block' : 'none';
    
    const title = document.createElement('h3');
    title.className = 'quick-log-title';
    title.textContent = 'Favie Log';
    quickLogWidgetsContainer.appendChild(title);

    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'quick-log-buttons';
    quickLogWidgetsContainer.appendChild(buttonWrapper);

    querySnapshot.forEach(docSnapshot => {
        const widgetData = docSnapshot.data();
        const button = document.createElement('button');
        button.className = 'quick-log-widget-btn';
        
        button.innerHTML = `
            <span class="widget-name">${widgetData.itemName}</span>
            <span class="widget-price">$${widgetData.itemPrice.toFixed(2)}</span>
        `;
        
        button.title = `Log ${widgetData.itemName} ($${widgetData.itemPrice.toFixed(2)})`;
        
        button.addEventListener('click', (e) => {
            if (isDeleteModeActive) {
                e.preventDefault();
                return;
            }
            logFromWidget(db, widgetData, button);
        });
        
        // Mobile Press and Hold Logic
        button.addEventListener('touchstart', (e) => {
            if (isDeleteModeActive) return;
            pressTimer = setTimeout(() => {
                e.preventDefault();
                toggleDeleteMode(true);
            }, 500); // 500ms for a long press
        }, { passive: true });

        button.addEventListener('touchend', () => clearTimeout(pressTimer));
        button.addEventListener('touchmove', () => clearTimeout(pressTimer));
        
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-widget-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Remove this Quick Log';
        
        const deleteHandler = async (e) => {
            e.stopPropagation();
            button.disabled = true;
            await deleteDoc(docSnapshot.ref);
            button.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            button.style.opacity = '0';
            button.style.transform = 'scale(0.8)';
            setTimeout(() => {
                button.remove();
                const remainingButtons = buttonWrapper.querySelectorAll('.quick-log-widget-btn');
                if (remainingButtons.length === 0) {
                    quickLogWidgetsContainer.style.display = 'none';
                }
            }, 300);
        };
        
        deleteBtn.addEventListener('click', deleteHandler);
        // Also listen for touchend on mobile to ensure it fires reliably
        deleteBtn.addEventListener('touchend', (e) => {
             if (isDeleteModeActive) {
                e.preventDefault();
                deleteHandler(e);
             }
        });

        button.appendChild(deleteBtn);
        buttonWrapper.appendChild(button);
    });
}

function toggleDeleteMode(enable) {
    isDeleteModeActive = enable;
    if (enable) {
        quickLogWidgetsContainer.classList.add('delete-mode');
    } else {
        quickLogWidgetsContainer.classList.remove('delete-mode');
    }
}

async function logFromWidget(db, widgetData, buttonEl) {
    if (!currentUser) return;

    const { itemName, itemPrice } = widgetData;

    const userDocRef = doc(db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    const currentBalance = userData.balances.credits;

    if (itemPrice > currentBalance) {
        showQuickLogError('Not enough credits!');
        return;
    }
    
    if(buttonEl) buttonEl.disabled = true;

    try {
        let { currentStreak = 0, longestStreak = 0, lastLogDate = null } = userData;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (lastLogDate) {
            const lastDate = lastLogDate.toDate();
            lastDate.setHours(0, 0, 0, 0);
            const diffTime = today - lastDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) { currentStreak++; }
            else if (diffDays > 1) { currentStreak = 1; }
        } else {
            currentStreak = 1;
        }
        if (currentStreak > longestStreak) { longestStreak = currentStreak; }

        const purchaseRef = collection(db, "users", currentUser.uid, "purchases");
        await addDoc(purchaseRef, {
            items: [{ name: itemName, price: itemPrice, quantity: 1 }],
            total: itemPrice,
            store: widgetData.storeName,
            purchaseDate: Timestamp.now(),
            isFromWidget: true
        });

        const newBalance = currentBalance - itemPrice;
        await updateDoc(userDocRef, {
            "balances.credits": newBalance,
            currentStreak: currentStreak,
            longestStreak: longestStreak,
            lastLogDate: Timestamp.now()
        });

        if (userData.showOnWallOfFame) {
            const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
            await setDoc(wallOfFameDocRef, { currentStreak }, { merge: true });
        }

        updateBalancesUI({ ...userData.balances, credits: newBalance });
        const creditsCard = document.getElementById('credits-card');
        if (creditsCard) {
            creditsCard.classList.add('hit');
            setTimeout(() => creditsCard.classList.remove('hit'), 600);
        }
        
        showSuccessMessage(`✓ Logged: ${itemName}`);

    } catch (error) {
        console.error("Error logging from widget:", error);
        showQuickLogError('Logging failed. Try again.');
    } finally {
        if(buttonEl) buttonEl.disabled = false;
    }
}

function showSuccessMessage(message) {
    const successMsg = document.createElement('div');
    successMsg.className = 'custom-log-success';
    successMsg.textContent = message;
    document.body.appendChild(successMsg);
    setTimeout(() => successMsg.remove(), 3000);
}

function showQuickLogError(message) {
    let errorEl = document.getElementById('quick-log-error');
    if (errorEl) errorEl.remove(); 
    
    errorEl = document.createElement('div');
    errorEl.id = 'quick-log-error';
    errorEl.className = 'quick-log-error';
    errorEl.textContent = message;
    
    if (quickLogWidgetsContainer) {
        quickLogWidgetsContainer.insertBefore(errorEl, quickLogWidgetsContainer.firstChild);
        setTimeout(() => {
            if (errorEl) errorEl.remove();
        }, 3000);
    }
}


async function fetchAndRenderLeaderboard(db) {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = '<div class="spinner" style="margin: 2rem auto;"></div>';
    
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("currentStreak", "desc"));
    
    try {
        const querySnapshot = await getDocs(q);
        const users = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        leaderboardList.innerHTML = '';
        users.forEach((user, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            if (user.id === currentUser.uid) {
                item.classList.add('current-user');
            }

            const initial = user.displayName ? user.displayName.charAt(0).toUpperCase() : '?';
            const svgAvatar = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" ry="20" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="20" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
            const avatarSrc = user.photoURL || `data:image/svg+xml;base64,${btoa(svgAvatar)}`;
            
            const bioHtml = user.bio ? `<div class="leaderboard-bio">"${user.bio}"</div>` : '';

            item.innerHTML = `
                <span class="leaderboard-rank">#${index + 1}</span>
                <img src="${avatarSrc}" alt="${user.displayName}" class="leaderboard-avatar">
                <div class="leaderboard-details">
                    <span class="leaderboard-name">${user.displayName}</span>
                    ${bioHtml}
                </div>
                <span class="leaderboard-streak">🔥 ${user.currentStreak || 0}</span>
            `;
            leaderboardList.appendChild(item);
        });

    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        leaderboardList.innerHTML = '<p>Could not load leaderboard.</p>';
    }
}


async function handlePublicToggle(e, db) {
    if (!currentUser) return;
    const isChecked = e.target.checked;
    const userDocRef = doc(db, "users", currentUser.uid);
    const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);

    try {
        await updateDoc(userDocRef, { showOnWallOfFame: isChecked });
        
        if (isChecked) {
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const { displayName, photoURL, currentStreak, bio } = userDoc.data();
                await setDoc(wallOfFameDocRef, { 
                    displayName, 
                    photoURL, 
                    currentStreak: currentStreak || 0,
                    bio: bio || ""
                });
            }
        } else {
            await deleteDoc(wallOfFameDocRef);
        }
    } catch (error) {
        console.error("Error updating Top of the Grind status:", error);
    }
}


function updateBalancesUI(balances) {
    creditsBalanceEl.textContent = `$${balances.credits.toFixed(2)}`;
    diningBalanceEl.textContent = `$${balances.dining.toFixed(2)}`;
    swipesBalanceEl.textContent = balances.swipes;
    bonusBalanceEl.textContent = balances.bonus;
}

async function fetchAndRenderWeather() {
    if (!weatherWidget) return;
    weatherWidget.innerHTML = `<div class="spinner"></div>`;

    const lat = 40.08;
    const lon = -82.49;

    const apiUrl = `/.netlify/functions/getWeather?lat=${lat}&lon=${lon}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Error fetching weather');
        }

        const temp = Math.round(data.main.temp);
        const description = data.weather[0].description;
        const iconCode = data.weather[0].icon;

        weatherWidget.innerHTML = `
            <div class="weather-content">
                <img src="https://openweathermap.org/img/wn/${iconCode}@2x.png" alt="${description}" class="weather-icon">
                <div class="weather-details">
                    <div class="weather-temp">${temp}°F</div>
                    <div class="weather-location">Granville, OH</div>
                    <div class="weather-description">${description}</div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error("Weather fetch error:", error);
        weatherWidget.innerHTML = `<p class="weather-error">Could not load weather data.</p>`;
    }
}

function initializeMap() {
    if (!mapRenderTarget || map) return;

    const locations = [
        { name: 'Campus Market', address: 'Inside Student Union', coords: [40.0630707, -82.5189282], accepts: ['credits'] },
        { name: 'Local Coffee Shop', address: '123 College Ave', coords: [40.0648271, -82.5205385], accepts: ['credits'] },
        { name: 'Downtown Pub', address: '126 E Main St', coords: [40.068128, -82.5191948], accepts: ['credits'] },
        { name: 'Taco Spot', address: '133 N Oak St', coords: [40.0683299, -82.5184905], accepts: ['credits'] },
        { name: 'Pizza Place', address: '128 E Main St', coords: [40.0681522, -82.5190099], accepts: ['credits'] },
        { name: 'Healthy Eats', address: '454 S University Dr', coords: [40.063813, -82.520413], accepts: ['credits'] },
        { name: 'Ice Cream Parlor', address: '226 E Main St', coords: [40.0680189, -82.5174337], accepts: ['credits'] },
        { name: 'Noodle House', address: '127 E Main St', coords: [40.0676361, -82.5190986], accepts: ['credits'] },
        { name: 'West Dining Hall', address: '100 West Campus Dr', coords: [40.0718253, -82.5243115], accepts: ['dining', 'swipes', 'bonus'] },
        { name: 'East Dining Hall', address: '700 East Campus Dr', coords: [40.072603, -82.517739], accepts: ['dining', 'swipes', 'bonus'] },
        { name: 'Student Union Cafe', address: '200 College Ave', coords: [40.0718253, -82.5243115], accepts: ['dining', 'bonus'] },
        { name: 'Science Center Cafe', address: '900 Knowledge Hill', coords: [40.0744031, -82.5274519], accepts: ['dining'] }
    ];

    mapRenderTarget.style.width = '100%';
    mapRenderTarget.style.height = '100%';
    
    map = L.map('map-render-target', {
        scrollWheelZoom: false,
        zoomControl: true
    }).setView([40.069, -82.52], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    const createIcon = (color, symbol) => L.divIcon({
        html: `<div style="background: ${color}; color: white; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.4); border: 2px solid white;">${symbol}</div>`,
        iconSize: [32, 32],
        className: 'custom-map-icon'
    });

    const creditsIcon = createIcon('#4CAF50', '$');
    const diningIcon = createIcon('#2196F3', 'D');

    locations.forEach(location => {
        let icon = creditsIcon;
        if (location.accepts.includes('dining') || location.accepts.includes('swipes')) {
            icon = diningIcon;
        }

        const popupContent = `
            <div style="font-family: 'Nunito', sans-serif; text-align: center;">
                <strong style="font-size: 1.1em;">${location.name}</strong><br>
                ${location.address}<br>
                <em style="font-size: 0.9em; color: #555;">Accepts: ${location.accepts.join(', ')}</em>
            </div>
        `;

        L.marker(location.coords, { icon: icon }).addTo(map)
            .bindPopup(popupContent);
    });

    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 100);
}

const style = document.createElement('style');
style.textContent = `
    .custom-log-success {
        position: fixed; bottom: 140px; left: 50%; transform: translateX(-50%);
        background: var(--brand-primary); color: white; padding: 1rem 2rem;
        border-radius: 50px; font-weight: 700; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        animation: slideUp 0.3s ease-out, fadeOut 0.3s ease-out 2.7s forwards;
        z-index: 200;
    }
    @keyframes slideUp {
        from { transform: translate(-50%, 20px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
    }
    @keyframes fadeOut {
        to { opacity: 0; transform: translate(-50%, -10px); }
    }
    .table-item.hit { animation: shake 0.5s ease-out; }
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px) rotate(-1deg); }
        75% { transform: translateX(5px) rotate(1deg); }
    }
    .animate-spin, .spinner {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .leaflet-popup-content-wrapper {
        border-radius: 8px !important;
    }
    
    /* Profanity Warning Styles */
    .profanity-warning-note {
        position: relative;
        margin-top: 0.75rem;
        animation: wobbleIn 0.5s ease-out;
    }
    
    .warning-paper {
        background: #FFE4B5;
        background-image: 
            repeating-linear-gradient(
                0deg,
                transparent,
                transparent 20px,
                rgba(139, 69, 19, 0.03) 20px,
                rgba(139, 69, 19, 0.03) 21px
            );
        border: 2px solid #D2691E;
        border-radius: 4px;
        padding: 0.75rem 1rem;
        position: relative;
        transform: rotate(-2deg);
        box-shadow: 
            2px 2px 8px rgba(0,0,0,0.1),
            inset 0 0 20px rgba(139, 69, 19, 0.05);
        font-family: 'Patrick Hand', cursive;
    }
    
    .warning-tape {
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%) rotate(3deg);
        width: 60px;
        height: 24px;
        background: rgba(255, 255, 255, 0.6);
        border: 1px dashed rgba(0,0,0,0.1);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .warning-tape::before {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        right: 3px;
        bottom: 3px;
        background: repeating-linear-gradient(
            45deg,
            transparent,
            transparent 4px,
            rgba(0,0,0,0.03) 4px,
            rgba(0,0,0,0.03) 8px
        );
    }
    
    .warning-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
    }
    
    .warning-emoji {
        font-size: 1.8rem;
        filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.2));
    }
    
    .warning-text {
        font-size: 1.1rem;
        font-weight: 700;
        color: #8B4513;
        text-shadow: 1px 1px 0 rgba(255,255,255,0.5);
    }
    
    .warning-subtext {
        font-size: 0.9rem;
        color: #A0522D;
        font-style: italic;
    }
    
    @keyframes wobbleIn {
        0% {
            opacity: 0;
            transform: scale(0.8) rotate(-8deg);
        }
        50% {
            transform: scale(1.05) rotate(3deg);
        }
        100% {
            opacity: 1;
            transform: scale(1) rotate(-2deg);
        }
    }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', main);
