// --- IMPORTS ---
import { firebaseReady, logout } from './auth.js';
import { doc, getDoc, updateDoc, collection, query, orderBy, getDocs, setDoc, deleteDoc, addDoc, Timestamp, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
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
    deleteCancelBtn, deleteConfirmBtn, deleteErrorMessage, customPaymentType, pricePrefix,
    tabletopGrid, universityBadge, customLogSaveWidgetBtn, lazyLogModal, lazyLogForm,
    lazyLogInputsContainer, lazyLogCancelBtn, lazyLogError, lazyLogTitle, lazyLogSubtitle, eodUpdateBtn;

// --- App State ---
let map = null;
let currentUser = null;
let currentUserData = null; // To store user profile data globally
let selectedPfpFile = null;
let firebaseServices = null;
let isDeleteModeActive = false;
let pressTimer = null;
let userBalanceTypes = [];

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
    try {
        const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const userData = userDoc.data();
            currentUser.bio = userData.bio || '';
            userBalanceTypes = userData.balanceTypes || [];
            
            // Check and perform balance resets if needed
            await checkAndPerformBalanceResets(userData);
            
            // Re-fetch data after potential resets
            const updatedDoc = await getDoc(userDocRef);
            const updatedData = updatedDoc.exists() ? updatedDoc.data() : userData;
            
            renderDashboard(updatedData);
        } else {
            window.location.href = "questionnaire.html";
        }
    } catch (error) {
        console.error("Error fetching user profile:", error);
        if (error.code === 'permission-denied' || error.code === 'unauthenticated') {
            // Session expired or permissions issue
            logout();
        } else {
            // Show error message
            if (loadingIndicator) {
                loadingIndicator.innerHTML = `
                    <div style="text-align: center; padding: 2rem;">
                        <p style="color: var(--brand-danger); font-weight: 700;">Failed to load profile</p>
                        <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: var(--brand-primary); color: white; border: none; border-radius: 8px; cursor: pointer;">Retry</button>
                    </div>
                `;
            }
        }
    }
}

function renderDashboard(userData) {
    currentUserData = userData; // Store user data globally
    const { balances, displayName, photoURL, showOnWallOfFame, bio, university, isDenisonStudent, classYear } = userData;
    
    welcomeMessage.innerHTML = `<span class="wave">👋</span> Welcome back, <span class="user-name">${displayName}</span>!`;
    
    // Add university badge
    if (university && universityBadge) {
        universityBadge.innerHTML = `<span class="university-icon">🎓</span> ${university}`;
        universityBadge.style.display = 'block';
    }
    
    updateAvatar(photoURL, displayName);
    publicLeaderboardCheckbox.checked = !!showOnWallOfFame;
    
    if (userBioInput) {
        userBioInput.value = bio || '';
    }
    
    // Dynamic balance rendering
    renderBalanceCards(userData);
    updateBalancesUI(balances);
    
    fetchAndRenderWeather();
    renderQuickLogWidgets(firebaseServices.db);
    populatePaymentDropdown(userData);
    checkAndTriggerLazyLog(userData); // Automatic Lazy Log check
    
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

function renderBalanceCards(userData) {
    const { balanceTypes, isDenisonStudent, classYear } = userData;
    
    // Clear existing cards
    tabletopGrid.innerHTML = '';
    
    // Filter balance types based on user type
    let visibleBalanceTypes = [];
    
    if (isDenisonStudent) {
        // For Denison students
        if (classYear === 'Senior') {
            // Seniors only see credits and dining
            visibleBalanceTypes = [
                { id: 'credits', label: 'Campus Credits', type: 'money' },
                { id: 'dining', label: 'Dining Dollars', type: 'money' }
            ];
        } else {
            // Other years see all 4 standard types
            visibleBalanceTypes = [
                { id: 'credits', label: 'Campus Credits', type: 'money' },
                { id: 'dining', label: 'Dining Dollars', type: 'money' },
                { id: 'swipes', label: 'Meal Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' },
                { id: 'bonus', label: 'Bonus Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' }
            ];
        }
    } else {
        // For custom universities, use their balance types
        visibleBalanceTypes = balanceTypes || [];
        
        // Remove any duplicate IDs (edge case protection)
        const seenIds = new Set();
        visibleBalanceTypes = visibleBalanceTypes.filter(bt => {
            if (seenIds.has(bt.id)) {
                console.warn('Duplicate balance type ID found:', bt.id);
                return false;
            }
            seenIds.add(bt.id);
            return true;
        });
    }
    
    // Handle edge case: no balance types configured
    if (visibleBalanceTypes.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'no-balances-message';
        emptyMessage.innerHTML = '🎨 No balances configured yet!<br><small>Please update your profile to add balance types.</small>';
        tabletopGrid.appendChild(emptyMessage);
        return;
    }
    
    // Render each balance card
    visibleBalanceTypes.forEach((balanceType, index) => {
        try {
            const card = createBalanceCard(balanceType, userData.balances[balanceType.id] || 0);
            tabletopGrid.appendChild(card);
        } catch (error) {
            console.error('Error creating balance card:', error, balanceType);
        }
    });
    
    // Set card count for better grid layout
    const cardCount = visibleBalanceTypes.length;
    if (cardCount <= 4) { // Only apply data-card-count if 4 or less for specific desktop centering
        tabletopGrid.setAttribute('data-card-count', cardCount);
    } else {
        tabletopGrid.removeAttribute('data-card-count'); // Let CSS handle wrapping for more than 4
    }
    
    // Always add weather and map at the end in a wrapper
    const infoCardsRow = document.createElement('div');
    infoCardsRow.className = 'info-cards-row';
    
    const weatherCard = document.createElement('section');
    weatherCard.id = 'weather-widget';
    weatherCard.className = 'table-item weather-note';
    infoCardsRow.appendChild(weatherCard);
    
    const mapCard = document.createElement('section');
    mapCard.className = 'table-item map-container';
    mapCard.id = 'map-opener';
    mapCard.innerHTML = `
        <div class="folded-map">
            <div class="map-fold-top"></div>
            <div class="map-fold-bottom"></div>
            <span class="map-label">Campus Map</span>
        </div>
    `;
    infoCardsRow.appendChild(mapCard);
    
    // Add the wrapper to the grid
    tabletopGrid.appendChild(infoCardsRow);
    
    // Re-assign weather and map elements
    weatherWidget = document.getElementById('weather-widget');
    mapOpener = document.getElementById('map-opener');
    if (mapOpener) {
        mapOpener.addEventListener('click', openMapModal);
    }
}

function createBalanceCard(balanceType, currentBalance) {
    const card = document.createElement('div');
    card.className = `table-item item-${balanceType.id}`;
    card.id = `${balanceType.id}-card`;
    
    let iconHtml = '';
    let balanceDisplay = '';
    
    // Format balance based on type
    if (balanceType.type === 'money') {
        balanceDisplay = `$${currentBalance.toFixed(2)}`;
    } else {
        balanceDisplay = currentBalance.toString();
    }
    
    // Create icon based on balance ID
    switch (balanceType.id) {
        case 'credits':
            iconHtml = `
                <div class="bell-bag">
                    <svg viewBox="0 0 100 100" class="bell-bag-svg">
                        <defs>
                            <radialGradient id="bell-gradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                                <stop offset="0%" style="stop-color:#EACCA8;stop-opacity:1" />
                                <stop offset="100%" style="stop-color:#DDAA66;stop-opacity:1" />
                            </radialGradient>
                        </defs>
                        <path d="M20 90 C 20 70, 30 60, 50 60 S 80 70, 80 90 Z" fill="url(#bell-gradient)"/>
                        <path d="M50 60 C 40 50, 60 50, 50 60" fill="none" stroke="#A0522D" stroke-width="4" stroke-linecap="round"/>
                        <text x="50" y="85" font-family="'Patrick Hand', cursive" font-size="20" fill="#A0522D" text-anchor="middle">★</text>
                    </svg>
                </div>`;
            break;
            
        case 'dining':
            iconHtml = `
                <div class="wallet">
                    <div class="wallet-top"></div>
                    <div class="wallet-bottom">
                        <div class="cash-bills">
                            <div class="bill bill-1"></div>
                            <div class="bill bill-2"></div>
                            <div class="bill bill-3"></div>
                        </div>
                    </div>
                </div>`;
            break;
            
        case 'swipes':
            iconHtml = `
                <div class="coaster-stack">
                    <div class="coaster"></div>
                    <div class="coaster"></div>
                    <div class="coaster"></div>
                </div>`;
            break;
            
        case 'bonus':
            iconHtml = `
                <div class="coaster-stack">
                    <div class="coaster bonus-coaster">
                        <span style="position: relative; z-index: 1;">★</span>
                    </div>
                </div>`;
            break;
            
        default:
            // Custom balance type - use a generic token design
            const isMoneyType = balanceType.type === 'money';
            iconHtml = `
                <div class="custom-token-stack">
                    <div class="custom-token ${isMoneyType ? 'money-token' : 'count-token'}">
                        <span class="token-symbol">${isMoneyType ? '$' : '#'}</span>
                    </div>
                </div>`;
            break;
    }
    
    // Add reset info if applicable
    let resetInfo = '';
    if (balanceType.resetsWeekly) {
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
        const isToday = today === balanceType.resetDay;
        const resetClass = isToday ? 'resets-today' : '';
        const dayText = isToday ? 'Resets Today!' : `Resets ${balanceType.resetDay}s`;
        resetInfo = `<div class="reset-info ${resetClass}">${dayText}</div>`;
    }
    
    card.innerHTML = `
        ${iconHtml}
        <div class="item-details">
            <span class="item-title">${balanceType.label}</span>
            <div class="item-balance" id="${balanceType.id}-balance">${balanceDisplay}</div>
            ${resetInfo}
        </div>
    `;
    
    return card;
}

function populatePaymentDropdown(userData) {
    if (!customPaymentType) return;
    
    customPaymentType.innerHTML = '';
    
    const { balanceTypes, isDenisonStudent, classYear } = userData;
    
    let availableTypes = [];
    
    if (isDenisonStudent) {
        if (classYear === 'Senior') {
            availableTypes = [
                { id: 'credits', label: 'Campus Credits' },
                { id: 'dining', label: 'Dining Dollars' }
            ];
        } else {
            availableTypes = [
                { id: 'credits', label: 'Campus Credits' },
                { id: 'dining', label: 'Dining Dollars' },
                { id: 'swipes', label: 'Meal Swipes' },
                { id: 'bonus', label: 'Bonus Swipes' }
            ];
        }
    } else {
        availableTypes = balanceTypes || [];
    }
    
    availableTypes.forEach((type, index) => {
        const option = document.createElement('option');
        option.value = type.id;
        option.textContent = type.label;
        if (index === 0) option.selected = true;
        customPaymentType.appendChild(option);
    });
}

function assignDOMElements() {
    loadingIndicator = document.getElementById('loading-indicator');
    dashboardContainer = document.getElementById('dashboard-container');
    pageTitle = document.getElementById('page-title');
    welcomeMessage = document.getElementById('welcome-message');
    universityBadge = document.getElementById('university-badge');
    userAvatar = document.getElementById('user-avatar');
    avatarButton = document.getElementById('avatar-button');
    tabletopGrid = document.getElementById('tabletop-grid');
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
    customPaymentType = document.getElementById('custom-payment-type');
    pricePrefix = document.querySelector('.price-prefix');
    customLogCancel = document.getElementById('custom-log-cancel');
    customLogClose = document.getElementById('custom-log-close');
    quickLogWidgetsContainer = document.getElementById('quick-log-widgets-container');
    saveAsWidgetCheckbox = document.getElementById('save-as-widget-checkbox');
    customLogSaveWidgetBtn = document.getElementById('custom-log-save-widget');
    openDeleteAccountBtn = document.getElementById('open-delete-account-button');
    deleteConfirmModalOverlay = document.getElementById('delete-confirm-modal-overlay');
    deleteCancelBtn = document.getElementById('delete-cancel-button');
    deleteConfirmBtn = document.getElementById('delete-confirm-button');
    deleteErrorMessage = document.getElementById('delete-error-message');
    // Lazy Log & EOD Elements
    lazyLogModal = document.getElementById('lazy-log-modal');
    lazyLogForm = document.getElementById('lazy-log-form');
    lazyLogInputsContainer = document.getElementById('lazy-log-inputs-container');
    lazyLogCancelBtn = document.getElementById('lazy-log-cancel');
    lazyLogError = document.getElementById('lazy-log-error');
    lazyLogTitle = document.getElementById('lazy-log-title');
    lazyLogSubtitle = document.getElementById('lazy-log-subtitle');
    eodUpdateBtn = document.getElementById('eod-update-btn');
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

    // FAB Logic
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
        await populateLocationsDropdown(db);
        handlePaymentTypeChange();
        customLogModal.classList.remove('hidden');
        customItemName.focus();
        const saveWidgetContainer = saveAsWidgetCheckbox.closest('.form-group-inline');
        if (saveWidgetContainer) {
            const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
            const snapshot = await getDocs(widgetsRef);
            // Hide "also create" checkbox if max widgets are reached
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
    if (customLogSaveWidgetBtn) customLogSaveWidgetBtn.addEventListener('click', () => createWidgetOnly(db));
    if (customPaymentType) customPaymentType.addEventListener('change', handlePaymentTypeChange);

    if (userBioInput) userBioInput.addEventListener('input', handleBioInput);
    
    document.body.addEventListener('click', (e) => {
        if (isDeleteModeActive && !quickLogWidgetsContainer.contains(e.target)) {
            toggleDeleteMode(false);
        }
    }, true);

    if (openDeleteAccountBtn) openDeleteAccountBtn.addEventListener('click', () => deleteConfirmModalOverlay.classList.remove('hidden'));
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => deleteConfirmModalOverlay.classList.add('hidden'));
    if (deleteConfirmModalOverlay) deleteConfirmModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteConfirmModalOverlay) deleteConfirmModalOverlay.classList.add('hidden');
    });
    if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', deleteUserDataAndLogout);

    // EOD and Lazy Log Event Listeners
    if (eodUpdateBtn) eodUpdateBtn.addEventListener('click', () => showEODModal(currentUserData));

    if (lazyLogForm) lazyLogForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const dateString = lazyLogForm.dataset.logDate;
        const logDate = dateString ? new Date(dateString) : new Date();
        saveLazyLogData(db, logDate);
    });
    if (lazyLogCancelBtn) lazyLogCancelBtn.addEventListener('click', () => {
        lazyLogModal.classList.add('hidden');
        if (lazyLogForm.dataset.isLazyLog === 'true') {
            const userDocRef = doc(db, "users", currentUser.uid);
            updateDoc(userDocRef, { lazyLogDismissedUntil: Timestamp.now() });
        }
    });
    if (lazyLogModal) lazyLogModal.addEventListener('click', e => {
        if (e.target === lazyLogModal) {
             lazyLogModal.classList.add('hidden');
             if (lazyLogForm.dataset.isLazyLog === 'true') {
                const userDocRef = doc(db, "users", currentUser.uid);
                updateDoc(userDocRef, { lazyLogDismissedUntil: Timestamp.now() });
             }
        }
    });
}

async function deleteUserDataAndLogout() {
    if (!currentUser || !firebaseServices) return;

    const { db } = firebaseServices;

    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting...';
    deleteErrorMessage.classList.add('hidden');

    try {
        const userId = currentUser.uid;
        const purchasesPath = `users/${userId}/purchases`;
        const widgetsPath = `users/${userId}/quickLogWidgets`;
        const storesPath = `users/${userId}/customStores`; // Path for custom stores
        const userDocRef = doc(db, "users", userId);
        const wallOfFameDocRef = doc(db, "wallOfFame", userId);

        await Promise.all([
            deleteSubcollection(db, purchasesPath),
            deleteSubcollection(db, widgetsPath),
            deleteSubcollection(db, storesPath), // Delete custom stores
            deleteDoc(wallOfFameDocRef).catch(err => console.log("No Wall of Fame doc to delete:", err.message)),
            deleteDoc(userDocRef)
        ]);
        
        logout();

    } catch (error) {
        console.error("Data Deletion Failed:", error);
        let errorMessage = 'Failed to delete your data. Please try again.';
        if (error.code === 'permission-denied') {
            errorMessage = 'Could not delete user data due to a permissions issue.';
        }
        deleteErrorMessage.textContent = errorMessage;
        deleteErrorMessage.classList.remove('hidden');
    } finally {
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = 'Yes, Delete It';
    }
}

async function deleteSubcollection(db, collectionPath) {
    const collectionRef = collection(db, collectionPath);
    const q = query(collectionRef);
    const snapshot = await getDocs(q);

    if (snapshot.size === 0) return;

    const deletePromises = [];
    snapshot.forEach(docSnapshot => {
        deletePromises.push(deleteDoc(docSnapshot.ref));
    });

    await Promise.all(deletePromises);
}

// --- LAZY LOG & EOD ---
async function checkAndPerformBalanceResets(userData) {
    const { balanceTypes, balances, resetAmounts = {}, lastResetDates = {} } = userData;
    const today = new Date();
    const todayDayName = today.toLocaleDateString('en-US', { weekday: 'long' });
    
    let hasResets = false;
    const updatedBalances = { ...balances };
    const updatedLastResetDates = { ...lastResetDates };
    
    // Check each balance type for resets
    balanceTypes.forEach(balanceType => {
        if (balanceType.resetsWeekly && balanceType.resetDay === todayDayName) {
            const lastResetDate = lastResetDates[balanceType.id];
            const shouldReset = !lastResetDate || !isSameDay(new Date(lastResetDate), today);
            
            if (shouldReset && resetAmounts[balanceType.id] !== undefined) {
                // Perform the reset
                updatedBalances[balanceType.id] = resetAmounts[balanceType.id];
                updatedLastResetDates[balanceType.id] = today.toISOString();
                hasResets = true;
                console.log(`Reset ${balanceType.label} to ${resetAmounts[balanceType.id]}`);
            }
        }
    });
    
    // Update database if there were resets
    if (hasResets) {
        const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
            balances: updatedBalances,
            lastResetDates: updatedLastResetDates
        });
        
        // Show notification
        showSuccessMessage('✓ Weekly balances have been reset!');
    }
}

function isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function checkAndTriggerLazyLog(userData) {
    const { lastLogDate, lazyLogDismissedUntil } = userData;
    const today = new Date();
    
    if (lazyLogDismissedUntil && isSameDay(lazyLogDismissedUntil.toDate(), today)) {
        return;
    }

    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    
    const lastLog = lastLogDate ? lastLogDate.toDate() : null;

    if (!lastLog || !isSameDay(lastLog, today) && !isSameDay(lastLog, yesterday)) {
        showLazyLogModal(userData, yesterday, true);
    }
}

function showEODModal(userData) {
    const today = new Date();
    showLazyLogModal(userData, today, false);
}

function showLazyLogModal(userData, date, isLazyLog) {
    if (!lazyLogInputsContainer || !lazyLogModal) return;

    lazyLogInputsContainer.innerHTML = '';
    lazyLogError.classList.add('hidden');
    lazyLogForm.dataset.logDate = date.toISOString();
    lazyLogForm.dataset.isLazyLog = isLazyLog;

    if (isLazyLog) {
        lazyLogTitle.textContent = "Forgot to Log? 😴";
        lazyLogSubtitle.textContent = `Looks like you missed logging for ${date.toLocaleDateString('en-US', { weekday: 'long' })}. Let's catch up!`;
    } else {
        lazyLogTitle.textContent = "End of Day Update 🌙";
        lazyLogSubtitle.textContent = `Enter your final balances for today.`;
    }

    const balanceTypesToUpdate = userBalanceTypes.filter(bt => userData.balances.hasOwnProperty(bt.id));
    if (balanceTypesToUpdate.length === 0) return;

    balanceTypesToUpdate.forEach(balanceType => {
        const currentBalance = userData.balances[balanceType.id];
        const isMoney = balanceType.type === 'money';
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        formGroup.innerHTML = `
            <label for="lazy-log-${balanceType.id}">
                ${balanceType.label} 
                <small>(Currently: ${isMoney ? '$' : ''}${isMoney ? currentBalance.toFixed(2) : currentBalance})</small>
            </label>
            <div class="price-input-wrapper">
                <span class="price-prefix">${isMoney ? '$' : '#'}</span>
                <input type="number" id="lazy-log-${balanceType.id}" data-balance-id="${balanceType.id}"
                    placeholder="${isMoney ? currentBalance.toFixed(2) : currentBalance}" 
                    step="${isMoney ? '0.01' : '1'}" min="0" class="lazy-log-input">
            </div>
        `;
        lazyLogInputsContainer.appendChild(formGroup);
    });

    lazyLogModal.classList.remove('hidden');
}

async function saveLazyLogData(db, logDate) {
    const submitBtn = lazyLogForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating...';
    lazyLogError.classList.add('hidden');

    const inputs = lazyLogForm.querySelectorAll('.lazy-log-input');
    const newBalances = {};
    const purchaseLogs = [];
    let hasErrors = false;
    let hasChanges = false;

    const userDocRef = doc(db, "users", currentUser.uid);
    const userDocSnap = await getDoc(userDocRef);
    const userData = userDocSnap.data();
    const oldBalances = userData.balances;
    const resetAmounts = userData.resetAmounts || {};

    inputs.forEach(input => {
        const balanceId = input.dataset.balanceId;
        const oldValue = oldBalances[balanceId] || 0;

        if (!input.value.trim()) {
            newBalances[balanceId] = oldValue;
            return;
        }
        
        hasChanges = true;
        const newValue = parseFloat(input.value);

        if (isNaN(newValue) || newValue < 0) {
            lazyLogError.textContent = `Please enter a valid positive number for all balances.`;
            hasErrors = true;
            return;
        }

        if (newValue > oldValue) {
            const balanceType = userBalanceTypes.find(bt => bt.id === balanceId);
            lazyLogError.textContent = `New balance for ${balanceType.label} cannot be higher than the current one.`;
            hasErrors = true;
            return;
        }

        const amountSpent = oldValue - newValue;
        newBalances[balanceId] = newValue;

        if (amountSpent > 0) {
            const balanceType = userBalanceTypes.find(bt => bt.id === balanceId);
            purchaseLogs.push({
                items: [{ name: "Daily Spending Summary", price: amountSpent, quantity: 1 }],
                total: amountSpent,
                store: lazyLogForm.dataset.isLazyLog === 'true' ? "Lazy Log" : "EOD Update",
                purchaseDate: Timestamp.fromDate(logDate),
                isLazyLog: true,
                balanceType: balanceId,
                currency: balanceType.type === 'money' ? 'dollars' : 'custom_count',
            });
        }
    });

    if (hasErrors) {
        lazyLogError.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Balances';
        return;
    }
    
    if (!hasChanges) {
        lazyLogModal.classList.add('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Balances';
        return;
    }

    try {
        const batch = writeBatch(db);
        purchaseLogs.forEach(log => {
            const purchaseRef = doc(collection(db, "users", currentUser.uid, "purchases"));
            batch.set(purchaseRef, log);
        });

        const updatePayload = {
            balances: { ...oldBalances, ...newBalances },
            lastLogDate: Timestamp.now()
        };

        // If this is an EOD update and the balance has a reset amount, update it
        if (lazyLogForm.dataset.isLazyLog === 'false') {
            const updatedResetAmounts = { ...resetAmounts };
            Object.keys(newBalances).forEach(balanceId => {
                const balanceType = userBalanceTypes.find(bt => bt.id === balanceId);
                if (balanceType && balanceType.resetsWeekly) {
                    updatedResetAmounts[balanceId] = newBalances[balanceId];
                }
            });
            updatePayload.resetAmounts = updatedResetAmounts;
        }

        if (lazyLogForm.dataset.isLazyLog === 'true') {
             updatePayload.currentStreak = 0;
        }

        batch.update(userDocRef, updatePayload);
        await batch.commit();

        currentUserData.balances = updatePayload.balances;
        updateBalancesUI(currentUserData.balances);
        
        lazyLogModal.classList.add('hidden');
        showSuccessMessage('✓ Balances updated!');

    } catch (error) {
        console.error("Error saving lazy log:", error);
        lazyLogError.textContent = 'Failed to save. Please try again.';
        lazyLogError.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Balances';
    }
}


// --- HELPERS ---
function getPriceLabel(price, currency) {
    switch (currency) {
        case 'dollars': return `$${price.toFixed(2)}`;
        case 'swipes': return `${price} Swipe${price !== 1 ? 's' : ''}`;
        case 'bonus_swipes': return `${price} Bonus Swipe${price !== 1 ? 's' : ''}`;
        default: return `$${price.toFixed(2)}`;
    }
}

function containsProfanity(text) {
    const profanityList = [ 'fuck','fucking','fucked','shit','shitty','crap','bitch','bastard','dick','cock','pussy','cunt','asshole','ass','douche','twat','prick','bollocks','bugger','shag','slut','whore','fag','faggot','dyke','tranny','shemale','kike','spic','chink','gook','beaner','wetback','nigger','nigga','dyke','retard','idiot','moron','cretin','jizz','cum','dildo','handjob','blowjob','tits','boobs','penis','vagina','anus','porn','sex','suck','blow','rape','molest','pedophile','pedo','incest','motherfucker','mother fucker','motha fucker','cocksucker','cock sucker','jerkoff','jerk off','clit','titty','twatwaffle','dumbass','asswipe','dumbfuck','dumb fuck','bullshit','holy shit','holy fuck','fuckedup','fuckup','fuckyou','fuck you','goddamn','god damn','damn','bloody','frigging','fricking','hell','arse','arsehole','shite','crikey','crapola','piss','pissed','pissedoff','piss off','shitter','shitface','shithead','shitshow','shitstorm','pisshead','nazi','hitler','kkk','antisemite','white supremacist','whoreface','slutface','autistic','autism','schizo','schizophrenic','crazy','insane','lunatic','spastic','cripple','crip','retard','retarded','gimp','spaz','mong','mongoloid','feminazi','beanerpede','alfaclan','alien','illegal alien','wetback','raghead','honky','cracker','coon','coonass','golliwog','raghead','kafir','paki','jap','chingchong','chink','zipperhead','zipcrow','kraut','polack','slantee','wtf','stfu','gtfo','omfg','omg','fml','lmao','rofl','roflmao','suckmydick','suckmyass','eatmyass','eatmyshit','eatmyshit','kissmyass','kissmyfeet','tosser','wanker','twatwaffle','clunge','gash','minge','clunge','nudist','nude','pornstar','escort','stripper','stripclub','cumshot','pearljamer','pearl jammer','gore', 'gory','neckbeard','incel','simp','stan','wang','dong','meatspin','goatse','lolita','cp','hentai','lolicon','shota','bestiality','zoophilia','zoophile','beastiality','beastial','beast','snuff','necrophilia','necrophile','vore','voreplay','spook','jungle bunny','fried chicken','macaco','macaca','f u c k','s h i t','s h i t t y','f@ck','sh1t','sh!t','b!tch','c0ck','p!ss','c u n t','f u c k e d','f u c k i n g','s h i t s h o w','b 1 t c h','grrrrr','damnit','damnit', ];
    const cleanText = text.toLowerCase().replace(/\s/g, '');
    for (const word of profanityList) {
        const l33tPattern = word.replace(/a/g, '[a@4]').replace(/e/g, '[e3]').replace(/i/g, '[i1!]').replace(/o/g, '[o0]').replace(/s/g, '[s5$]').replace(/t/g, '[t7]').replace(/g/g, '[g9]').replace(/l/g, '[l1]').replace(/z/g, '[z2]');
        const regex = new RegExp(l33tPattern, 'i');
        if (regex.test(cleanText) || cleanText.includes(word)) return true;
    }
    return false;
}

function handleBioInput() {
    if (!userBioInput) return;
    const maxLength = 15;
    const warningThreshold = 8;
    let currentLength = userBioInput.value.length;
    if (currentLength > maxLength) {
        userBioInput.value = userBioInput.value.substring(0, maxLength);
        currentLength = maxLength;
    }
    if (containsProfanity(userBioInput.value)) {
        userBioInput.classList.add('bio-danger');
        if (!document.getElementById('bio-profanity-warning')) {
            const warning = document.createElement('div');
            warning.id = 'bio-profanity-warning';
            warning.className = 'profanity-warning-note';
            warning.innerHTML = `<div class="warning-paper"><div class="warning-tape"></div><div class="warning-content"><span class="warning-emoji">🙊</span><span class="warning-text">Whoa there, friend!</span><span class="warning-subtext">Let's keep it family-friendly</span></div></div>`;
            userBioInput.parentElement.appendChild(warning);
        }
        return;
    } else {
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
            if (db) fetchAndRenderLeaderboard(db);
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
    if (!map) initializeMap();
    mapModalOverlay.classList.remove('hidden');
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);
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
    if (userBioInput) userBioInput.value = currentUser.bio || '';
    const warning = document.getElementById('bio-profanity-warning');
    if (warning) warning.remove();
}

function closeCustomLogModal() {
    customLogModal.classList.add('hidden');
    customLogForm.reset();
    if(saveAsWidgetCheckbox) {
        saveAsWidgetCheckbox.checked = false;
    }
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
    reader.onload = (event) => { pfpPreview.src = event.target.result; };
    reader.readAsDataURL(file);
}

async function saveProfile(storage, db) {
    if (!currentUser) return;
    pfpSaveButton.disabled = true;
    pfpSaveButton.textContent = 'Saving...';
    pfpError.classList.add('hidden');
    const newBio = userBioInput.value.trim();
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
            await setDoc(wallOfFameDocRef, { displayName, photoURL, currentStreak: currentStreak || 0, bio: newBio }, { merge: true });
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

async function checkAndCreateFrequentWidget(db, itemName, itemPrice, storeName) {
    if (!currentUser) return false;
    try {
        const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
        const widgetsSnapshot = await getDocs(widgetsRef);
        if (widgetsSnapshot.size >= 3) return false;
        let widgetExists = false;
        widgetsSnapshot.forEach(doc => { if (doc.data().itemName === itemName) widgetExists = true; });
        if (widgetExists) return false;
        const purchasesRef = collection(db, "users", currentUser.uid, "purchases");
        const allPurchasesSnapshot = await getDocs(purchasesRef);
        let purchaseCount = 0;
        allPurchasesSnapshot.forEach(doc => {
            const purchase = doc.data();
            if (purchase.items && purchase.items.length > 0 && purchase.items[0].name === itemName) purchaseCount++;
        });
        const FREQUENCY_THRESHOLD = 3;
        if (purchaseCount >= FREQUENCY_THRESHOLD) {
            await addDoc(widgetsRef, { itemName, itemPrice, storeName, currency: 'dollars', balanceType: 'credits', createdAt: Timestamp.now() });
            return true;
        }
    } catch (error) {
        console.error("Error checking/creating frequent widget:", error);
    }
    return false;
}

function handlePaymentTypeChange() {
    if (!customPaymentType || !pricePrefix || !customItemPrice) return;
    const selectedType = customPaymentType.value;
    const priceInput = customItemPrice;
    
    // Find the balance type info
    const balanceType = userBalanceTypes.find(bt => bt.id === selectedType);
    const isCountType = balanceType && balanceType.type === 'count';
    
    if (isCountType) {
        pricePrefix.textContent = 'x';
        priceInput.step = "1";
        priceInput.min = "1";
        priceInput.placeholder = "1";
        priceInput.value = "1";
    } else {
        pricePrefix.textContent = '$';
        priceInput.step = "0.01";
        priceInput.min = "0";
        priceInput.placeholder = "0.00";
        priceInput.value = "";
    }
}

async function populateLocationsDropdown(db) {
    if (!currentUser || !customItemStore) return;
    customItemStore.innerHTML = '<option>Loading...</option>';
    
    try {
        const storesRef = collection(db, "users", currentUser.uid, "customStores");
        const q = query(storesRef, orderBy("name"));
        const querySnapshot = await getDocs(q);

        customItemStore.innerHTML = '';

        // Add Denison-specific stores only if the user is a Denison student
        if (currentUserData && currentUserData.isDenisonStudent) {
            const rossOption = document.createElement('option');
            rossOption.value = "Ross Granville Market";
            rossOption.textContent = "Ross Granville Market";
            customItemStore.appendChild(rossOption);
        }

        querySnapshot.forEach(doc => {
            const store = doc.data();
            const option = document.createElement('option');
            option.value = store.name;
            option.textContent = store.name;
            customItemStore.appendChild(option);
        });

        const otherOption = document.createElement('option');
        otherOption.value = "Other";
        otherOption.textContent = "Other Location";
        customItemStore.appendChild(otherOption);

    } catch (error) {
        console.error("Error fetching custom stores for dropdown:", error);
        customItemStore.innerHTML = '<option value="Other">Could not load stores</option>';
    }
}

async function createWidgetOnly(db) {
    if (!currentUser) return;
    
    const itemName = customItemName.value.trim();
    const itemPrice = parseFloat(customItemPrice.value);
    const storeName = customItemStore.value;
    const paymentType = customPaymentType.value;

    if (!itemName || isNaN(itemPrice) || itemPrice < 0) {
        showQuickLogError('Please fill in a valid item name and price.');
        return;
    }

    customLogSaveWidgetBtn.disabled = true;
    customLogSaveWidgetBtn.innerHTML = '<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite;"></span>';

    try {
        const quickLogWidgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
        const snapshot = await getDocs(quickLogWidgetsRef);
        
        if (snapshot.size >= 3) {
            showQuickLogError("You can only have up to 3 Favies.");
            return;
        }
        
        const q = query(quickLogWidgetsRef, where("itemName", "==", itemName));
        const existingWidgets = await getDocs(q);
        if (!existingWidgets.empty) {
            showQuickLogError("A Favie with this name already exists.");
            return;
        }

        const balanceTypeInfo = userBalanceTypes.find(bt => bt.id === paymentType);
        const isMoneyType = balanceTypeInfo && balanceTypeInfo.type === 'money';
        const currency = isMoneyType ? 'dollars' : 'custom_count';

        await addDoc(quickLogWidgetsRef, {
            itemName,
            itemPrice,
            storeName,
            currency: currency,
            balanceType: paymentType,
            createdAt: Timestamp.now()
        });

        await renderQuickLogWidgets(db);
        closeCustomLogModal();
        showSuccessMessage(`✓ Created Favie: ${itemName}`);

    } catch (error) {
        console.error("Error creating widget:", error);
        showQuickLogError("Failed to create Favie. Please try again.");
    } finally {
        customLogSaveWidgetBtn.disabled = false;
        customLogSaveWidgetBtn.innerHTML = `<span>Save Favie</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
    }
}

async function logCustomPurchase(db) {
    if (!currentUser) return;

    const itemName = customItemName.value.trim();
    const itemPrice = parseFloat(customItemPrice.value);
    const storeName = customItemStore.value;
    const shouldSaveWidget = saveAsWidgetCheckbox.checked;
    const paymentType = customPaymentType.value;

    if (!itemName || isNaN(itemPrice) || itemPrice <= 0) {
        showQuickLogError('Please fill in all fields correctly');
        return;
    }

    const userDocRef = doc(db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    const balances = userData.balances;
    const currentBalance = balances[paymentType] || 0;

    if (itemPrice > currentBalance) {
        const balanceTypeInfo = userBalanceTypes.find(bt => bt.id === paymentType);
        const balanceName = balanceTypeInfo ? balanceTypeInfo.label : paymentType;
        showQuickLogError(`Not enough ${balanceName}!`);
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
            if (diffDays === 1) currentStreak++;
            else if (diffDays > 1) currentStreak = 1;
        } else {
            currentStreak = 1;
        }
        if (currentStreak > longestStreak) longestStreak = currentStreak;

        const balanceTypeInfo = userBalanceTypes.find(bt => bt.id === paymentType);
        const isMoneyType = balanceTypeInfo && balanceTypeInfo.type === 'money';
        const currency = isMoneyType ? 'dollars' : 'custom_count';

        const purchaseRef = collection(db, "users", currentUser.uid, "purchases");
        await addDoc(purchaseRef, {
            items: [{ name: itemName, price: itemPrice, quantity: 1 }],
            total: itemPrice,
            store: storeName,
            purchaseDate: Timestamp.now(),
            isCustom: true,
            currency: currency,
            balanceType: paymentType
        });

        const newBalance = currentBalance - itemPrice;
        const updatePayload = {
            [`balances.${paymentType}`]: newBalance,
            currentStreak: currentStreak,
            longestStreak: longestStreak,
            lastLogDate: Timestamp.now()
        };
        await updateDoc(userDocRef, updatePayload);
        
        if (shouldSaveWidget) {
            const quickLogWidgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
            const snapshot = await getDocs(quickLogWidgetsRef);
            if (snapshot.size < 3) {
                const q = query(quickLogWidgetsRef, where("itemName", "==", itemName));
                const existingWidgets = await getDocs(q);
                if (existingWidgets.empty) {
                    await addDoc(quickLogWidgetsRef, {
                        itemName, itemPrice, storeName,
                        currency: currency,
                        balanceType: paymentType,
                        createdAt: Timestamp.now()
                    });
                    widgetCreated = true;
                }
            }
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

        const updatedBalances = { ...balances, [paymentType]: newBalance };
        updateBalancesUI(updatedBalances);

        const cardToAnimate = document.getElementById(`${paymentType}-card`);
        if (cardToAnimate) {
            cardToAnimate.classList.add('hit');
            setTimeout(() => cardToAnimate.classList.remove('hit'), 600);
        }

        if (widgetCreated) await renderQuickLogWidgets(db);
        closeCustomLogModal();
        showSuccessMessage(`✓ Logged: ${itemName}`);

    } catch (error) {
        console.error("Error logging custom purchase:", error);
        showQuickLogError("Failed to log purchase. Please try again.");
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

    const buttonWrapper = quickLogWidgetsContainer.querySelector('.quick-log-buttons') || document.createElement('div');
    if (!buttonWrapper.parentElement) {
        buttonWrapper.className = 'quick-log-buttons';
        quickLogWidgetsContainer.innerHTML = ''; // Clear previous content
        const title = document.createElement('h3');
        title.className = 'quick-log-title';
        title.textContent = 'Favie Log';
        quickLogWidgetsContainer.appendChild(title);
        quickLogWidgetsContainer.appendChild(buttonWrapper);
    } else {
        buttonWrapper.innerHTML = ''; // Clear only buttons
    }

    if (querySnapshot.empty) {
        quickLogWidgetsContainer.style.display = 'none';
        quickLogWidgetsContainer.style.setProperty('--shelf-width', '0px'); // Reset shelf width
        return;
    }

    const isHomeActive = document.getElementById('home-section')?.classList.contains('active');
    quickLogWidgetsContainer.style.display = isHomeActive ? 'block' : 'none';

    querySnapshot.forEach(docSnapshot => {
        const widgetData = docSnapshot.data();
        const button = document.createElement('button');
        button.className = 'quick-log-widget-btn';
        
        const { itemPrice, currency, balanceType } = widgetData;
        let priceLabel;

        const balanceTypeInfo = userBalanceTypes.find(bt => bt.id === balanceType);
        
        if (balanceTypeInfo) {
            if (balanceTypeInfo.type === 'money') {
                const abbrev = balanceTypeInfo.label.split(' ').map(word => word[0]).join('');
                priceLabel = `${abbrev} ${itemPrice.toFixed(2)}`;
            } else {
                const shortLabel = balanceTypeInfo.label.length > 10 
                    ? balanceTypeInfo.label.substring(0, 10) + '...' 
                    : balanceTypeInfo.label;
                priceLabel = `${itemPrice} ${shortLabel}`;
            }
        } else {
            priceLabel = getPriceLabel(itemPrice, currency);
        }

        button.innerHTML = `<span class="widget-name">${widgetData.itemName}</span><span class="widget-price">${priceLabel}</span>`;
        button.title = `Log ${widgetData.itemName} (${priceLabel})`;
        
        button.addEventListener('click', (e) => {
            if (isDeleteModeActive) { e.preventDefault(); return; }
            logFromWidget(db, widgetData, button);
        });
        
        button.addEventListener('touchstart', (e) => {
            if (isDeleteModeActive) return;
            pressTimer = setTimeout(() => { e.preventDefault(); toggleDeleteMode(true); }, 500);
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
                updateShelfWidth(); // Update shelf width after removal
                if (buttonWrapper.querySelectorAll('.quick-log-widget-btn').length === 0) {
                    quickLogWidgetsContainer.style.display = 'none';
                }
            }, 300);
        };
        
        deleteBtn.addEventListener('click', deleteHandler);
        deleteBtn.addEventListener('touchend', (e) => {
             if (isDeleteModeActive) { e.preventDefault(); deleteHandler(e); }
        });

        button.appendChild(deleteBtn);
        buttonWrapper.appendChild(button);
    });

    function updateShelfWidth() {
        setTimeout(() => {
            const buttons = buttonWrapper.querySelectorAll('.quick-log-widget-btn');
            if (buttons.length === 0) {
                quickLogWidgetsContainer.style.setProperty('--shelf-width', '0px');
                return;
            }
            
            let totalWidth = 0;
            const computedStyle = window.getComputedStyle(buttonWrapper);
            const gap = parseFloat(computedStyle.getPropertyValue('gap')) || 16;

            buttons.forEach((btn, index) => {
                totalWidth += btn.offsetWidth;
                if (index < buttons.length - 1) {
                    totalWidth += gap; 
                }
            });
            
            const shelfWidth = Math.min(totalWidth + 30, quickLogWidgetsContainer.offsetWidth * 0.95);
            quickLogWidgetsContainer.style.setProperty('--shelf-width', `${shelfWidth}px`);
        }, 50);
    }

    updateShelfWidth();
}

function toggleDeleteMode(enable) {
    isDeleteModeActive = enable;
    if (enable) quickLogWidgetsContainer.classList.add('delete-mode');
    else quickLogWidgetsContainer.classList.remove('delete-mode');
}

async function logFromWidget(db, widgetData, buttonEl) {
    if (!currentUser) return;

    const { itemName, itemPrice, currency = 'dollars', balanceType = 'credits' } = widgetData;

    const userDocRef = doc(db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    const balances = userData.balances;

    const balanceTypeInfo = userBalanceTypes.find(bt => bt.id === balanceType);
    const balanceName = balanceTypeInfo ? balanceTypeInfo.label : balanceType;
    const currentBalance = balances[balanceType] || 0;

    if (itemPrice > currentBalance) {
        showQuickLogError(`Not enough ${balanceName}!`);
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
            const diffTime = today.getTime() - lastDate.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays === 1) currentStreak++; 
            else if (diffDays > 1) currentStreak = 1; 
        } else {
            currentStreak = 1;
        }

        const purchaseRef = collection(db, "users", currentUser.uid, "purchases");
        await addDoc(purchaseRef, {
            items: [{ name: itemName, price: itemPrice, quantity: 1 }],
            total: itemPrice,
            store: widgetData.storeName,
            currency: currency,
            purchaseDate: Timestamp.now(),
            isFromWidget: true,
            balanceType: balanceType // Also log which balance was used
        });

        const newBalance = currentBalance - itemPrice;
        let updateData = {};
        updateData[`balances.${balanceType}`] = newBalance;
        updateData.currentStreak = currentStreak;
        updateData.longestStreak = Math.max(longestStreak, currentStreak);
        updateData.lastLogDate = Timestamp.now();
        await updateDoc(userDocRef, updateData);

        if (userData.showOnWallOfFame) {
            const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
            await setDoc(wallOfFameDocRef, { currentStreak }, { merge: true });
        }

        const updatedBalances = { ...balances, [balanceType]: newBalance };
        updateBalancesUI(updatedBalances);

        const cardToAnimate = document.getElementById(`${balanceType}-card`);
        if (cardToAnimate) {
            cardToAnimate.classList.add('hit');
            setTimeout(() => cardToAnimate.classList.remove('hit'), 600);
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
        setTimeout(() => { if (errorEl) errorEl.remove(); }, 3000);
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
            if (user.id === currentUser.uid) item.classList.add('current-user');

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
                    displayName, photoURL, 
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
    Object.keys(balances).forEach(balanceId => {
        const balanceEl = document.getElementById(`${balanceId}-balance`);
        if (balanceEl) {
            const balanceType = userBalanceTypes.find(bt => bt.id === balanceId);
            const oldValue = balanceEl.textContent;
            let newValue;
            
            if (balanceType && balanceType.type === 'money') {
                newValue = `$${balances[balanceId].toFixed(2)}`;
            } else {
                newValue = balances[balanceId].toString();
            }
            
            if (oldValue !== newValue) {
                balanceEl.textContent = newValue;
                balanceEl.classList.add('updating');
                setTimeout(() => balanceEl.classList.remove('updating'), 600);
            }
        }
    });
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
        if (!response.ok) throw new Error(data.message || 'Error fetching weather');

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
        if (location.accepts.includes('dining') || location.accepts.includes('swipes')) icon = diningIcon;
        const popupContent = `<div style="font-family: 'Nunito', sans-serif; text-align: center;"><strong style="font-size: 1.1em;">${location.name}</strong><br>${location.address}<br><em style="font-size: 0.9em; color: #555;">Accepts: ${location.accepts.join(', ')}</em></div>`;
        L.marker(location.coords, { icon: icon }).addTo(map).bindPopup(popupContent);
    });

    setTimeout(() => { if (map) map.invalidateSize(); }, 100);
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
    
    .profanity-warning-note {
        position: relative; margin-top: 0.75rem;
        animation: wobbleIn 0.5s ease-out;
    }
    .warning-paper {
        background: #FFE4B5;
        background-image: repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(139, 69, 19, 0.03) 20px, rgba(139, 69, 19, 0.03) 21px);
        border: 2px solid #D2691E; border-radius: 4px; padding: 0.75rem 1rem;
        position: relative; transform: rotate(-2deg);
        box-shadow: 2px 2px 8px rgba(0,0,0,0.1), inset 0 0 20px rgba(139, 69, 19, 0.05);
        font-family: 'Patrick Hand', cursive;
    }
    .warning-tape {
        position: absolute; top: -12px; left: 50%;
        transform: translateX(-50%) rotate(3deg); width: 60px; height: 24px;
        background: rgba(255, 255, 255, 0.6); border: 1px dashed rgba(0,0,0,0.1);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .warning-tape::before {
        content: ''; position: absolute; top: 3px; left: 3px; right: 3px; bottom: 3px;
        background: repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.03) 4px, rgba(0,0,0,0.03) 8px);
    }
    .warning-content {
        display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
    }
    .warning-emoji { font-size: 1.8rem; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.2)); }
    .warning-text { font-size: 1.1rem; font-weight: 700; color: #8B4513; text-shadow: 1px 1px 0 rgba(255,255,255,0.5); }
    .warning-subtext { font-size: 0.9rem; color: #A0522D; font-style: italic; }
    @keyframes wobbleIn {
        0% { opacity: 0; transform: scale(0.8) rotate(-8deg); }
        50% { transform: scale(1.05) rotate(3deg); }
        100% { opacity: 1; transform: scale(1) rotate(-2deg); }
    }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', main);