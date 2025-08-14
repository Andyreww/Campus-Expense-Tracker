// --- IMPORTS ---
import { firebaseReady, logout } from './auth.js';
// Firestore/auth modules now loaded dynamically to trim initial JS cost
let firestoreModule = null; // populated on first Firestore need
let authModule = null;      // populated on first auth utility need

async function fs() {
    if (!firestoreModule) {
        firestoreModule = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
    }
    return firestoreModule;
}


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
    lazyLogInputsContainer, lazyLogCancelBtn, lazyLogError, lazyLogTitle, lazyLogSubtitle, eodUpdateBtn,
    leaderboardHeadlineEl;

// --- App State ---
let map = null;
let leafletReady = false;
let currentUser = null;
let currentUserData = null; // To store user profile data globally
let selectedPfpFile = null;

// Avatar cache config (similar idea to weather TTL caching)
const AVATAR_CACHE_KEY = 'avatarCache:v1';
const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCachedAvatar() {
    try {
        const raw = localStorage.getItem(AVATAR_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.url || !parsed.dataUrl || !parsed.ts) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function setCachedAvatar(url, dataUrl) {
    try {
        localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify({ url, dataUrl, ts: Date.now() }));
    } catch (_) {}
}

async function fetchAvatarAsDataURL(url) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 6000);
    try {
        const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal: controller.signal });
        if (!res.ok) throw new Error('Avatar fetch failed: ' + res.status);
        const blob = await res.blob();
        // Avoid stuffing very large images into localStorage (>600KB)
        if (blob.size > 600000) return null;
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        return dataUrl;
    } finally {
        clearTimeout(id);
    }
}
let firebaseServices = null;
let isDeleteModeActive = false;
let pressTimer = null;
let userBalanceTypes = [];
let cachedBalanceHTML = null;
let lastBalanceSignature = '';
// Rename balance modal elements
let renameBalancesModal, renameBalancesForm, renameBalancesCloseBtn, renameBalancesSaveBtn, renameBalancesBtn;

// --- Leaderboard avatar session-LRU (avoid persistent storage) ---
const AVATAR_LRU_MAX_ENTRIES = 40;
const AVATAR_LRU_MAX_BYTES = 2 * 1024 * 1024; // ~2MB across session
const AVATAR_LRU_MAX_BLOB = 120 * 1024; // skip caching very large images
const avatarLRU = new Map(); // url -> { objectUrl, size }
let avatarLRUTotalBytes = 0;
let avatarObserver = null;

function avatarLRUGet(url) {
    if (!url || !avatarLRU.has(url)) return null;
    const value = avatarLRU.get(url);
    // mark as recently used
    avatarLRU.delete(url); avatarLRU.set(url, value);
    return value.objectUrl;
}

function avatarLRUPut(url, objectUrl, size) {
    if (!url || !objectUrl) return;
    // size guard
    if (typeof size === 'number' && size > AVATAR_LRU_MAX_BLOB) return; 
    if (avatarLRU.has(url)) {
        const prev = avatarLRU.get(url);
        try { URL.revokeObjectURL(prev.objectUrl); } catch(_) {}
        avatarLRUTotalBytes -= (prev.size || 0);
        avatarLRU.delete(url);
    }
    avatarLRU.set(url, { objectUrl, size: size || 0 });
    avatarLRUTotalBytes += (size || 0);
    // evict LRU until within caps
    while ((avatarLRU.size > AVATAR_LRU_MAX_ENTRIES) || (avatarLRUTotalBytes > AVATAR_LRU_MAX_BYTES)) {
        const firstKey = avatarLRU.keys().next().value;
        if (!firstKey) break;
        const entry = avatarLRU.get(firstKey);
        avatarLRU.delete(firstKey);
        avatarLRUTotalBytes -= (entry?.size || 0);
        try { if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl); } catch(_) {}
    }
}

async function prefetchAvatarObjectURL(url) {
    try {
        if (!url) return null;
        const existing = avatarLRUGet(url);
        if (existing) return existing;
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob && blob.size && blob.size > AVATAR_LRU_MAX_BLOB) return null; // too large
        const objUrl = URL.createObjectURL(blob);
        avatarLRUPut(url, objUrl, blob.size || 0);
        return objUrl;
    } catch (_) { return null; }
}

function getAvatarObserver() {
    if (avatarObserver) return avatarObserver;
    avatarObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const img = entry.target;
            const url = img.getAttribute('data-avatar-url');
            if (!url) { avatarObserver.unobserve(img); continue; }
            // best-effort prefetch; we keep current src (HTTP cache handles reuse)
            prefetchAvatarObjectURL(url).finally(() => {
                avatarObserver.unobserve(img);
            });
        }
    }, { root: null, rootMargin: '100px', threshold: 0.01 });
    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
        for (const [, entry] of avatarLRU) {
            try { URL.revokeObjectURL(entry.objectUrl); } catch(_) {}
        }
        avatarLRU.clear(); avatarLRUTotalBytes = 0;
    }, { once: true });
    return avatarObserver;
}

function applyLeaderboardAvatar(imgEl, photoURL, fallbackInitial) {
    if (!imgEl) return;
    try { imgEl.setAttribute('crossorigin', 'anonymous'); } catch(_) {}
    if (!photoURL) return; // already has initials placeholder
    const cachedObj = avatarLRUGet(photoURL);
    if (cachedObj) {
        imgEl.src = cachedObj; // fast path
        return;
    }
    // Keep remote URL (benefits from HTTP cache) and lazy prefetch when visible
    imgEl.src = photoURL;
    imgEl.onerror = () => {
        // fallback to initials svg
        const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" ry="20" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="20" fill="#FFF" text-anchor="middle" dy=".3em">${fallbackInitial}</text></svg>`;
        imgEl.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    };
    imgEl.setAttribute('data-avatar-url', photoURL);
    getAvatarObserver().observe(imgEl);
}

// --- Main App Initialization ---
async function main() {
    assignDOMElements();
    try {
        // Await the firebaseReady wrapper first, then resolve its getters
        const services = await firebaseReady;
    const auth = await services.auth;

    if (!auth) {
            throw new Error('Firebase services could not be initialized.');
        }
    firebaseServices = { auth };

        // Resolve current user reliably
        currentUser = auth.currentUser;
        if (!currentUser) {
            const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
            await new Promise((resolve) => {
                const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
            }).then((u) => { currentUser = u || null; });
        }

    if (!currentUser) {
            // In testing mode, allow unauthenticated access to render demo UI
            if (window.__TESTING_MODE) {
                console.warn('[DASH] TESTING_MODE: rendering demo dashboard without auth');
        firebaseServices = { auth: null };
                // Minimal demo data
                const demoUser = {
                    displayName: 'Demo User',
                    photoURL: '',
                    bio: '',
                    balances: { credits: 100, dining: 250, swipes: 10, bonus: 2 },
                    balanceTypes: [
                        { id: 'credits', label: 'Campus Credits', type: 'money' },
                        { id: 'dining', label: 'Dining Dollars', type: 'money' },
                        { id: 'swipes', label: 'Meal Swipes', type: 'count', resetsWeekly: true },
                        { id: 'bonus', label: 'Bonus Swipes', type: 'count', resetsWeekly: true },
                    ],
                    isDenisonStudent: true,
                    classYear: 'Sophomore',
                    showOnWallOfFame: false,
                    university: 'Demo U'
                };
                currentUser = { uid: 'DEMO' };
                renderDashboard(demoUser);
                return;
            } else {
                // No session -> go to login
                window.location.replace('/login.html');
                return;
            }
        }
    // Only now load Firestore (after we know we'll need it)
    const db = await services.db;
    firebaseServices.db = db;
        checkProfile();

    } catch (error) {
        console.error('Fatal Error on Dashboard:', error);
        if (loadingIndicator) {
            loadingIndicator.innerHTML = 'Failed to load dashboard. Please try again later.';
        }
    }
}

// --- App Logic ---
async function checkProfile() {
    try {
        if (!firebaseServices?.db || !currentUser?.uid || currentUser.uid === 'DEMO') {
            // Skip Firestore fetch in demo mode
            renderDashboard({
                displayName: 'Demo User',
                photoURL: '',
                bio: '',
                balances: { credits: 100, dining: 250, swipes: 10, bonus: 2 },
                balanceTypes: [
                    { id: 'credits', label: 'Campus Credits', type: 'money' },
                    { id: 'dining', label: 'Dining Dollars', type: 'money' },
                    { id: 'swipes', label: 'Meal Swipes', type: 'count', resetsWeekly: true },
                    { id: 'bonus', label: 'Bonus Swipes', type: 'count', resetsWeekly: true },
                ],
                isDenisonStudent: true,
                classYear: 'Sophomore',
                showOnWallOfFame: false,
                university: 'Demo U'
            });
            return;
        }
    const { doc, getDoc } = await fs();
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
    // Defer non-critical work to reduce TBT
    const idle = (fn) => ('requestIdleCallback' in window) ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 0);
    if (firebaseServices?.db && currentUser?.uid && currentUser.uid !== 'DEMO') {
        idle(() => renderQuickLogWidgets(firebaseServices.db));
    }
    populatePaymentDropdown(userData);
    idle(() => checkAndTriggerLazyLog(userData)); // Automatic Lazy Log check
    
    const today = new Date();
    if (newspaperDate) {
        newspaperDate.textContent = today.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        // After date renders, size the Roadmap link to be a bit shorter than the date width
        requestAnimationFrame(() => {
            const dateEl = newspaperDate;
            const roadmapLink = document.getElementById('roadmap-link');
            if (!dateEl || !roadmapLink) return;
            const dateWidth = dateEl.getBoundingClientRect().width;
            // target ~85% of date width, with min/max for responsiveness
            const target = Math.max(110, Math.min(240, Math.round(dateWidth * 0.85)));
            roadmapLink.style.width = target + 'px';
            roadmapLink.style.justifyContent = 'center';
            roadmapLink.style.whiteSpace = 'nowrap';
        });
    }
    
    loadingIndicator.style.display = 'none';
    dashboardContainer.style.display = 'block';

    // Keep Roadmap width synced on resize/orientation changes
    const syncRoadmapWidth = () => {
        const dateEl = newspaperDate;
        const roadmapLink = document.getElementById('roadmap-link');
        if (!dateEl || !roadmapLink) return;
        const dateWidth = dateEl.getBoundingClientRect().width;
        const target = Math.max(110, Math.min(240, Math.round(dateWidth * 0.85)));
        roadmapLink.style.width = target + 'px';
    };
    window.addEventListener('resize', () => requestAnimationFrame(syncRoadmapWidth));
    window.addEventListener('orientationchange', () => requestAnimationFrame(syncRoadmapWidth));
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => requestAnimationFrame(syncRoadmapWidth));
    }
    
    // Bind critical tab navigation immediately so active highlight works even if user clicks fast
    setupCriticalTabListeners();
    // Defer heavier/less critical listeners (pfp modals, fab, etc.) to idle to reduce TBT
    const wire = () => setupEventListeners();
    if ('requestIdleCallback' in window) requestIdleCallback(wire, { timeout: 1500 }); else setTimeout(wire, 0);
    handleInitialTab();
    // Verify active tab visual (fallback if stylesheet race prevents gradient)
    verifyActiveTabVisual();
    handleBioInput();
    ensureMobileScroll();
}

function setupCriticalTabListeners() {
    if (!tabItems) return;
    const { db } = firebaseServices || {};
    tabItems.forEach(tab => {
        if (!tab.dataset.tabBound && tab.dataset.section) { // only internal tabs
            tab.addEventListener('click', (e) => handleTabClick(e, db));
            tab.dataset.tabBound = '1';
        }
    });
}

function renderBalanceCards(userData) {
    const { balanceTypes, isDenisonStudent, classYear } = userData;

    // Build a signature to detect if we actually need to re-render
    const signature = JSON.stringify({
        denison: !!isDenisonStudent,
        classYear: classYear || '',
        balanceTypes: (balanceTypes || []).map(b => ({ id: b.id, label: b.label || '' })).sort((a,b) => a.id.localeCompare(b.id))
    });
    if (signature === lastBalanceSignature && cachedBalanceHTML) {
        // Re-use cached markup (no flash)
        tabletopGrid.innerHTML = cachedBalanceHTML;
        // Re-bind map opener if present
        mapOpener = document.getElementById('map-opener');
        if (mapOpener && !mapOpener.dataset.bound) {
            mapOpener.addEventListener('click', openMapModal);
            mapOpener.dataset.bound = '1';
        }
        return;
    }
    lastBalanceSignature = signature;
    tabletopGrid.innerHTML = '';
    
    // Filter balance types based on user type
    let visibleBalanceTypes = [];
    
    if (isDenisonStudent) {
        // Use user-provided labels (from balanceTypes) but enforce which IDs are shown
        const mapById = new Map((balanceTypes || []).map(b => [b.id, b]));
        if (classYear === 'Senior') {
            visibleBalanceTypes = ['credits','dining'].map(id => mapById.get(id)).filter(Boolean);
        } else {
            visibleBalanceTypes = ['credits','dining','swipes','bonus'].map(id => mapById.get(id)).filter(Boolean);
        }
        // Fallback add missing defaults with standard labels if not present (edge case)
        const ensure = (id,label,type,extra={}) => { if (!visibleBalanceTypes.some(bt=>bt.id===id)) visibleBalanceTypes.push({ id, label, type, ...extra }); };
        if (classYear === 'Senior') {
            ensure('credits','Campus Credits','money');
            ensure('dining','Dining Dollars','money');
        } else {
            ensure('credits','Campus Credits','money');
            ensure('dining','Dining Dollars','money');
            ensure('swipes','Meal Swipes','count',{resetsWeekly:true, resetDay:'Sunday'});
            ensure('bonus','Bonus Swipes','count',{resetsWeekly:true, resetDay:'Sunday'});
        }
    } else {
        // For custom universities, use their balance types directly
        visibleBalanceTypes = (balanceTypes || []).slice();
    }
    // Remove duplicates by id
    const seenIds = new Set();
    visibleBalanceTypes = visibleBalanceTypes.filter(bt => {
        if (!bt || !bt.id) return false;
        if (seenIds.has(bt.id)) return false;
        seenIds.add(bt.id);
        return true;
    });
    
    // Handle edge case: no balance types configured
    if (visibleBalanceTypes.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'no-balances-message';
        emptyMessage.innerHTML = '🎨 No balances configured yet!<br><small>Please update your profile to add balance types.</small>';
        tabletopGrid.appendChild(emptyMessage);
        return;
    }
    
    // Render each balance card into a fragment (reduces intermediate paints)
    const frag = document.createDocumentFragment();
    visibleBalanceTypes.forEach((balanceType) => {
        try {
            const card = createBalanceCard(balanceType, userData.balances[balanceType.id] || 0);
            frag.appendChild(card);
        } catch (error) {
            console.error('Error creating balance card:', error, balanceType);
        }
    });
    tabletopGrid.appendChild(frag);
    
    // Set card count for better grid layout
    const cardCount = visibleBalanceTypes.length;
    if (cardCount <= 4) { // Only apply data-card-count if 4 or less for specific desktop centering
        tabletopGrid.setAttribute('data-card-count', cardCount);
    } else {
        tabletopGrid.removeAttribute('data-card-count'); // Let CSS handle wrapping for more than 4
    }
    
    // Defer info cards row insertion to next frame, but only cache AFTER insertion so weather isn't lost.
    requestAnimationFrame(() => {
        // If we already have a cached snapshot from a prior render, reuse it fully (contains weather/map)
        if (cachedBalanceHTML) {
            tabletopGrid.innerHTML = cachedBalanceHTML;
            weatherWidget = document.getElementById('weather-widget');
            mapOpener = document.getElementById('map-opener');
            if (mapOpener && !mapOpener.dataset.bound) {
                mapOpener.addEventListener('click', openMapModal);
                mapOpener.dataset.bound = '1';
            }
            // Attempt weather fetch if never loaded (e.g., first visit after cache restore)
            if (weatherWidget && !weatherWidget.dataset.loaded) {
                fetchAndRenderWeather();
            }
            return; // Done.
        }

        const infoCardsRow = document.createElement('div');
        infoCardsRow.className = 'info-cards-row';
        const weatherCard = document.createElement('section');
        weatherCard.id = 'weather-widget';
        weatherCard.className = 'table-item weather-note';
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
        infoCardsRow.appendChild(weatherCard);
        infoCardsRow.appendChild(mapCard);
        tabletopGrid.appendChild(infoCardsRow);
        weatherWidget = weatherCard; // direct reference
        mapOpener = mapCard;
        if (mapOpener && !mapOpener.dataset.bound) {
            mapOpener.addEventListener('click', openMapModal);
            mapOpener.dataset.bound = '1';
        }
        // Kick off weather fetch now that DOM exists
        fetchAndRenderWeather();
        // Cache full snapshot (now includes weather + map)
        cachedBalanceHTML = tabletopGrid.innerHTML;
    });
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
        const mapById = new Map((balanceTypes || []).map(b => [b.id, b]));
        const order = classYear === 'Senior' ? ['credits','dining'] : ['credits','dining','swipes','bonus'];
        availableTypes = order.map(id => mapById.get(id)).filter(Boolean);
        // Fallbacks if missing
        const fallback = (id,label) => { if(!availableTypes.some(t=>t.id===id)) availableTypes.push({ id, label }); };
        if (classYear === 'Senior') { fallback('credits','Campus Credits'); fallback('dining','Dining Dollars'); }
        else { fallback('credits','Campus Credits'); fallback('dining','Dining Dollars'); fallback('swipes','Meal Swipes'); fallback('bonus','Bonus Swipes'); }
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

// --- Rename Balance Labels Feature ---
function openRenameBalancesModal() {
    if (!renameBalancesModal || !renameBalancesForm) return;
    const container = renameBalancesForm.querySelector('.rename-balance-inputs');
    if (!container) return;
    container.innerHTML = '';
    // Source types (saved types list)
    const allTypes = (currentUserData?.balanceTypes || userBalanceTypes || []).slice();
    // Determine visible IDs for Denison students
    let allowedIds = null;
    if (currentUserData?.isDenisonStudent) {
        if (currentUserData.classYear === 'Senior') {
            allowedIds = new Set(['credits','dining']);
        } else {
            allowedIds = new Set(['credits','dining','swipes','bonus']);
        }
    }
    const filtered = allTypes.filter(t => t && t.id && (!allowedIds || allowedIds.has(t.id)));
    // Order stable by id
    filtered.sort((a,b)=>a.id.localeCompare(b.id));

    // If nothing (edge case) fallback to full list
    const finalList = filtered.length ? filtered : allTypes;

    finalList.forEach(bt => {
        if (!bt || !bt.id) return;
        const row = document.createElement('div');
        row.className = 'rename-balance-row';
        row.innerHTML = `
            <label class="rename-balance-label" for="rename-input-${bt.id}">${bt.id}</label>
            <input id="rename-input-${bt.id}" type="text" data-balance-id="${bt.id}" value="${bt.label || ''}" maxlength="24" placeholder="${bt.id}" />
        `;
        container.appendChild(row);
    });
    renameBalancesModal.classList.remove('hidden');
    renameBalancesModal.inert = false;
}

function closeRenameBalancesModal() {
    if (!renameBalancesModal) return;
    renameBalancesModal.classList.add('hidden');
    renameBalancesModal.inert = true;
}

async function saveRenamedBalances() {
    if (!renameBalancesForm) return;
    const inputs = [...renameBalancesForm.querySelectorAll('input[data-balance-id]')];
    if (!inputs.length) { closeRenameBalancesModal(); return; }
    const original = (currentUserData?.balanceTypes || userBalanceTypes || []).slice();
    let changed = false;
    const updated = original.map(bt => {
        const input = inputs.find(i => i.dataset.balanceId === bt.id);
        if (!input) return bt;
        const val = input.value.trim();
        if (val && val !== bt.label) { changed = true; return { ...bt, label: val }; }
        return bt;
    });
    if (!changed) { closeRenameBalancesModal(); return; }
    try {
        if (currentUser?.uid && currentUser.uid !== 'DEMO' && firebaseServices?.db) {
            const { doc, updateDoc } = await fs();
            const userDocRef = doc(firebaseServices.db, 'users', currentUser.uid);
            await updateDoc(userDocRef, { balanceTypes: updated });
        }
        userBalanceTypes = updated;
        if (currentUserData) currentUserData.balanceTypes = updated;
        cachedBalanceHTML = null; // force fresh render with new labels
        // If the map was initialized, destroy it so it picks up new labels next open
        if (typeof map !== 'undefined' && map) {
            try { map.remove(); } catch(_) {}
            map = null;
        }
        renderBalanceCards(currentUserData);
        updateBalancesUI(currentUserData.balances);
        populatePaymentDropdown(currentUserData);
        showSuccessMessage('✓ Balance labels updated');
    } catch (err) {
        console.error('Failed to save renamed balances', err);
        showSimpleAlert('Failed to update labels.');
    } finally {
        closeRenameBalancesModal();
    }
}

function assignDOMElements() {
    loadingIndicator = document.getElementById('loading-indicator');
    dashboardContainer = document.getElementById('dashboard-container');
    pageTitle = document.getElementById('page-title');
    welcomeMessage = document.getElementById('welcome-message');
    universityBadge = document.getElementById('university-badge');
    userAvatar = document.getElementById('user-avatar');
    if (userAvatar) {
        // Help with cross-origin avatars
        try { userAvatar.setAttribute('crossorigin', 'anonymous'); } catch(_) {}
        // Fallback to initials or cached data if the network avatar fails
        userAvatar.addEventListener('error', () => {
            const cached = getCachedAvatar();
            if (cached && cached.dataUrl) {
                userAvatar.src = cached.dataUrl;
            } else if (currentUser && currentUser.displayName) {
                const initial = currentUser.displayName.charAt(0).toUpperCase();
                const svg = `<svg width="56" height="56" xmlns="http://www.w3.org/2000/svg"><rect width="56" height="56" rx="28" ry="28" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="28" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                const svgUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
                userAvatar.src = svgUrl;
            }
        }, { once: true });
    }
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
    leaderboardHeadlineEl = document.getElementById('leaderboard-headline-text');
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
    // Rename balances modal
    renameBalancesModal = document.getElementById('rename-balances-modal');
    renameBalancesForm = document.getElementById('rename-balances-form');
    // Two possible close buttons: main cancel and the X icon
    renameBalancesCloseBtn = document.getElementById('rename-balances-close');
    const renameBalancesCloseX = document.getElementById('rename-balances-close-x');
    if (!renameBalancesCloseBtn && renameBalancesCloseX) renameBalancesCloseBtn = renameBalancesCloseX; // fallback so earlier code keeps working
    renameBalancesSaveBtn = document.getElementById('rename-balances-save');
    renameBalancesBtn = document.getElementById('rename-balances-btn');
}

function setupEventListeners() {
    const { db } = firebaseServices;

    if (avatarButton) avatarButton.addEventListener('click', () => { pfpModalOverlay.classList.remove('hidden'); pfpModalOverlay.inert = false; });
    if (pfpCloseButton) pfpCloseButton.addEventListener('click', closeModal);
    if (pfpModalOverlay) pfpModalOverlay.addEventListener('click', (e) => {
        if (e.target === pfpModalOverlay) closeModal();
    });
    if (pfpUploadInput) pfpUploadInput.addEventListener('change', handlePfpUpload);
    if (pfpSaveButton) pfpSaveButton.addEventListener('click', () => saveProfile(db));

    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            logout();
        });
    }

    if (tabItems) tabItems.forEach(tab => {
        if (!tab.dataset.tabBound && tab.dataset.section) {
            tab.addEventListener('click', (e) => handleTabClick(e, db));
            tab.dataset.tabBound = '1';
        }
    });
    
    if (publicLeaderboardCheckbox) publicLeaderboardCheckbox.addEventListener('change', (e) => handlePublicToggle(e, db));

    if (mapOpener) mapOpener.addEventListener('click', openMapModal);
    if (mapCloseButton) mapCloseButton.addEventListener('click', closeMapModal);
    if (mapModalOverlay) mapModalOverlay.addEventListener('click', (e) => {
        if(e.target === mapModalOverlay) closeMapModal();
    });
    // Rename balances controls
    if (renameBalancesBtn && !renameBalancesBtn.dataset.bound) {
        renameBalancesBtn.addEventListener('click', openRenameBalancesModal);
        renameBalancesBtn.dataset.bound = '1';
    }
    if (renameBalancesCloseBtn && !renameBalancesCloseBtn.dataset.bound) { renameBalancesCloseBtn.addEventListener('click', closeRenameBalancesModal); renameBalancesCloseBtn.dataset.bound='1'; }
    const renameBalancesCloseX2 = document.getElementById('rename-balances-close-x');
    if (renameBalancesCloseX2 && !renameBalancesCloseX2.dataset.bound) { renameBalancesCloseX2.addEventListener('click', closeRenameBalancesModal); renameBalancesCloseX2.dataset.bound='1'; }
    if (renameBalancesModal) renameBalancesModal.addEventListener('click', (e) => { if (e.target === renameBalancesModal) closeRenameBalancesModal(); });
    if (renameBalancesSaveBtn) renameBalancesSaveBtn.addEventListener('click', saveRenamedBalances);

    // FAB Logic
    if (mainFab && fabContainer) {
        const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        mainFab.addEventListener('click', (e) => {
            e.preventDefault();
            fabContainer.classList.toggle('expanded');
            const backdrop = document.getElementById('fab-backdrop');
            if (backdrop) backdrop.inert = !fabContainer.classList.contains('expanded');
        });
        document.addEventListener('click', (e) => {
            if (!fabContainer.contains(e.target) && !mainFab.contains(e.target)) {
                fabContainer.classList.remove('expanded');
                const backdrop = document.getElementById('fab-backdrop');
                if (backdrop) backdrop.inert = true;
            }
        });
    }

    if (customLogBtn) customLogBtn.addEventListener('click', async () => {
        await populateLocationsDropdown(db);
        handlePaymentTypeChange();
        customLogModal.classList.remove('hidden');
        customLogModal.inert = false;
        customItemName.focus();
        const saveWidgetContainer = saveAsWidgetCheckbox.closest('.form-group-inline');
        if (saveWidgetContainer) {
            try {
                const { collection, getDocs } = await fs();
                const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
                const snapshot = await getDocs(widgetsRef);
                if (snapshot.size >= 3) {
                    saveWidgetContainer.style.display = 'none';
                    saveAsWidgetCheckbox.checked = false;
                } else {
                    saveWidgetContainer.style.display = 'flex';
                }
            } catch(err) {
                console.warn('[Favies] Could not check widget count:', err);
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

    if (openDeleteAccountBtn) openDeleteAccountBtn.addEventListener('click', () => { deleteConfirmModalOverlay.classList.remove('hidden'); deleteConfirmModalOverlay.inert = false; });
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => { deleteConfirmModalOverlay.classList.add('hidden'); deleteConfirmModalOverlay.inert = true; });
    if (deleteConfirmModalOverlay) deleteConfirmModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteConfirmModalOverlay) { deleteConfirmModalOverlay.classList.add('hidden'); deleteConfirmModalOverlay.inert = true; }
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
    lazyLogModal.inert = true;
        if (lazyLogForm.dataset.isLazyLog === 'true') {
            fs().then(({ doc, updateDoc, Timestamp }) => {
                const userDocRef = doc(db, "users", currentUser.uid);
                updateDoc(userDocRef, { lazyLogDismissedUntil: Timestamp.now() });
            }).catch(()=>{});
        }
    });
    if (lazyLogModal) lazyLogModal.addEventListener('click', e => {
        if (e.target === lazyLogModal) {
             lazyLogModal.classList.add('hidden');
             lazyLogModal.inert = true;
             if (lazyLogForm.dataset.isLazyLog === 'true') {
                fs().then(({ doc, updateDoc, Timestamp }) => {
                    const userDocRef = doc(db, "users", currentUser.uid);
                    updateDoc(userDocRef, { lazyLogDismissedUntil: Timestamp.now() });
                }).catch(()=>{});
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
        // Dynamically import Firestore helpers (was causing ReferenceError before)
        const { doc, deleteDoc, collection, query, getDocs } = await fs();
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
    const { collection, query, getDocs, deleteDoc } = await fs();
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
    const { balanceTypes, balances, lastResetDates = {}, isDenisonStudent, classYear } = userData;
    const { doc, updateDoc } = await fs();
    // Get current time in EST (America/New_York)
    const now = new Date();
    const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayDayName = estNow.toLocaleDateString('en-US', { weekday: 'long' });
    const estHour = estNow.getHours();
    const estMinute = estNow.getMinutes();

    // Debug logs
    console.log(`[DEBUG] Current day: ${todayDayName}, isDenisonStudent: ${isDenisonStudent}, classYear: ${classYear}`);
    console.log(`[DEBUG] balanceTypes:`, balanceTypes);
    console.log(`[DEBUG] lastResetDates:`, lastResetDates);

    // Denison class year defaults
    const DENISON_DEFAULTS = {
        Freshman:  { credits: 50, dining: 375, swipes: 15, bonus: 4 },
        Sophomore: { credits: 100, dining: 835, swipes: 8, bonus: 7 },
        Junior:    { credits: 100, dining: 835, swipes: 8, bonus: 7 },
        Senior:    { credits: 1000, dining: 2200, swipes: 0, bonus: 0 }
    };

    let hasResets = false;
    const updatedBalances = { ...balances };
    const updatedLastResetDates = { ...lastResetDates };

    // Sunday-only reset for Denison students: set to class defaults if not reset today OR values differ
    const isSundayEST = todayDayName === 'Sunday';
    if (isDenisonStudent && DENISON_DEFAULTS[classYear] && isSundayEST) {
        console.log(`[DEBUG] Processing Denison Sunday reset for ${classYear}`);

        // Swipes (reset only once per Sunday)
        const swipesBalanceType = balanceTypes.find(bt => bt.id === 'swipes');
        if (swipesBalanceType) {
            const desired = DENISON_DEFAULTS[classYear]['swipes'];
            const current = typeof updatedBalances['swipes'] === 'number' ? updatedBalances['swipes'] : 0;
            const lastResetDate = lastResetDates['swipes'];
            const notResetToday = !lastResetDate || !isSameDay(new Date(lastResetDate), estNow);
            console.log(`[DEBUG] Swipes check -> current: ${current}, desired: ${desired}, notResetToday: ${notResetToday}`);
            if (notResetToday) {
                updatedBalances['swipes'] = desired;
                updatedLastResetDates['swipes'] = estNow.toISOString();
                hasResets = true;
                console.log(`[RESET] Swipes set to ${desired} for ${classYear} (weekly reset)`);
            }
        }

        // Bonus (reset only once per Sunday)
        const bonusBalanceType = balanceTypes.find(bt => bt.id === 'bonus');
        if (bonusBalanceType) {
            const desired = DENISON_DEFAULTS[classYear]['bonus'];
            const current = typeof updatedBalances['bonus'] === 'number' ? updatedBalances['bonus'] : 0;
            const lastResetDate = lastResetDates['bonus'];
            const notResetToday = !lastResetDate || !isSameDay(new Date(lastResetDate), estNow);
            console.log(`[DEBUG] Bonus check -> current: ${current}, desired: ${desired}, notResetToday: ${notResetToday}`);
            if (notResetToday) {
                updatedBalances['bonus'] = desired;
                updatedLastResetDates['bonus'] = estNow.toISOString();
                hasResets = true;
                console.log(`[RESET] Bonus set to ${desired} for ${classYear} (weekly reset)`);
            }
        }
    }

    // Update database if there were resets
    if (hasResets) {
        console.log(`[DEBUG] Updating database with resets:`, updatedBalances);
        const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
            balances: updatedBalances,
            lastResetDates: updatedLastResetDates
        });

        // Show notification
        showSuccessMessage('✓ Weekly balances have been reset!');
    } else {
        console.log(`[DEBUG] No resets needed`);
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
    lazyLogModal.inert = false;
}

async function saveLazyLogData(db, logDate) {
    const submitBtn = lazyLogForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating...';
    lazyLogError.classList.add('hidden');
    const { doc, getDoc, collection, Timestamp, writeBatch } = await fs();

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
        // If it's an EOD submission with no numeric changes, still grant the daily 0.5 boost
        if (lazyLogForm.dataset.isLazyLog === 'false') {
            try {
                await grantEODBoost(db);
                // keep local cache in sync for UI reads
                // grantEODBoost already updated currentUserData.leaderboardScore
                lazyLogModal.classList.add('hidden');
                showSuccessMessage('✓ EOD saved!');
                // Refresh private leaderboard if visible
                try { await fetchAndRenderLeaderboard(db); } catch (_) {}
            } catch (e) {
                console.warn('[EOD] Failed during no-change boost:', e);
                showQuickLogError('Could not apply EOD boost. Try again.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Update Balances';
            }
            return;
        }
        // Lazy Log with no changes: just close out quietly
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

        // Lazy log doesn't break your streak - you're still engaging with the app!
        // We just keep the streak going since you're catching up
        if (lazyLogForm.dataset.isLazyLog === 'true') {
            // Don't modify the streak at all - they're being responsible by updating
        }

        batch.update(userDocRef, updatePayload);
        await batch.commit();

        currentUserData.balances = updatePayload.balances;
        updateBalancesUI(currentUserData.balances);
        
    // After a successful EOD (not lazy log), grant a 0.5 leaderboard boost
        if (lazyLogForm.dataset.isLazyLog === 'false') {
            try {
        await grantEODBoost(db);
        // Refresh private leaderboard if visible
        try { await fetchAndRenderLeaderboard(db); } catch (_) {}
            } catch (e) {
                console.warn('[EOD] Failed to set leaderboardScore boost:', e);
            }
        }
        
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

// Grant the daily 0.5 leaderboard boost for EOD submissions (idempotent per calendar day)
async function grantEODBoost(db) {
    const { doc, setDoc, updateDoc, getDoc } = await fs();
    const userDocRefLive = doc(db, "users", currentUser.uid);
    const current = Number(currentUserData?.currentStreak || 0);

    // Accumulate half-credits across days, but only once per calendar day
    const snap = await getDoc(userDocRefLive);
    const existing = snap.exists() ? snap.data() : {};
    const existingScore = typeof existing.leaderboardScore === 'number' ? existing.leaderboardScore : Number(existing.currentStreak || 0);
    const todayStr = new Date().toISOString().slice(0,10); // yyyy-mm-dd (client local)
    const base = Math.max(existingScore, current);
    let leaderboardScore = existingScore;

    if (existing.lastEODBoostDate !== todayStr) {
        leaderboardScore = base + 0.5; // add today’s half-credit
        await updateDoc(userDocRefLive, { leaderboardScore, lastEODBoostDate: todayStr });
    } else {
        // already boosted today; keep score as-is
        leaderboardScore = existingScore;
    }

    if (currentUserData?.showOnWallOfFame) {
        const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
        await setDoc(wallOfFameDocRef, {
            displayName: currentUser.displayName || "Anonymous",
            photoURL: currentUser.photoURL || "",
            currentStreak: current,
            longestStreak: Number(currentUserData?.longestStreak || current),
            leaderboardScore,
            bio: currentUserData?.bio || ""
        }, { merge: true });
    }

    // keep local cache in sync for UI reads
    currentUserData.leaderboardScore = leaderboardScore;
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

/**
 * Handles switching between dashboard sections.
 * FIX: This function now updates the URL hash to keep the UI state
 * in sync with the browser's history. This solves issues with
 * refreshing the page and incorrect component visibility.
 */
function switchTab(sectionId, db) {
    const targetTab = document.querySelector(`.tab-item[data-section="${sectionId}"]`);
    const targetSection = document.getElementById(sectionId);

    if (targetTab && targetSection) {
        // Update URL to reflect the current tab, which fixes refresh issues.
        if (sectionId === 'home-section') {
            // Use pushState to remove the hash without reloading the page.
            history.pushState("", document.title, window.location.pathname + window.location.search);
        } else {
            // For other tabs, set the hash.
            window.location.hash = sectionId;
        }

        // Update active classes for tabs and sections
        document.querySelectorAll('.tab-item[data-section]').forEach(t => {
            t.classList.remove('active', 'active-fallback');
        });
        mainSections.forEach(s => s.classList.remove('active'));

        targetTab.classList.add('active');
        targetSection.classList.add('active');
    verifyActiveTabVisual();

        // Show/hide the quick log widgets based on the active section
        const widgetsExist = quickLogWidgetsContainer && quickLogWidgetsContainer.querySelector('.quick-log-widget-btn');
        if (sectionId === 'home-section' && widgetsExist) {
            quickLogWidgetsContainer.style.display = 'block';
            // Postpone measurement to next frame for smoother interaction
            requestAnimationFrame(() => updateShelfWidth());
        } else {
            quickLogWidgetsContainer.style.display = 'none';
        }

        // Show/hide the public leaderboard toggle
        if (sectionId === 'leaderboard-section') {
            publicLeaderboardContainer.classList.remove('hidden');
            if (db) fetchAndRenderLeaderboard(db);
        } else {
            publicLeaderboardContainer.classList.add('hidden');
        }
    }
}

// Ensures the green gradient shows; if not, applies a fallback inline style class.
function verifyActiveTabVisual() {
    // Clean any stray fallback classes from non-active tabs first
    document.querySelectorAll('.tab-item.active-fallback:not(.active)').forEach(el => el.classList.remove('active-fallback'));
    const active = document.querySelector('.tab-item.active');
    if (!active) return;
    const cs = getComputedStyle(active);
    const bg = cs.backgroundImage || cs.background || '';
    if (!bg.includes('76, 175, 80') && !bg.includes('#4CAF50')) {
        if (!document.getElementById('active-tab-fallback-style')) {
            const style = document.createElement('style');
            style.id = 'active-tab-fallback-style';
            style.textContent = `.tab-item.active-fallback { background: linear-gradient(180deg, #4CAF50 0%, #45a049 100%) !important; color: #fff !important; border-color: transparent !important; border-bottom: 3px solid #388E3C !important; transform: translateY(-2px) !important; box-shadow: 0 3px 10px rgba(76,175,80,0.3) !important; }`;
            document.head.appendChild(style);
        }
        active.classList.add('active-fallback');
    } else if (active.classList.contains('active-fallback')) {
        // If native style now applies, drop fallback
        active.classList.remove('active-fallback');
    }
}

// Some mobile browsers may have body overflow locked if a modal was opened early; ensure scroll enabled
function ensureMobileScroll() {
    const ua = navigator.userAgent || '';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua) || (window.innerWidth <= 820);
    if (!isMobile) return;
    try {
        // Remove accidental overflow / position locks
        const html = document.documentElement;
        [html, document.body].forEach(el => {
            if (el.style.overflow === 'hidden' || el.style.overflowY === 'hidden') {
                el.style.overflow = 'visible';
                el.style.overflowY = 'auto';
            }
            el.classList.remove('no-scroll');
        });
        document.body.style.overflowY = 'auto';
        document.body.style.webkitOverflowScrolling = 'touch';
        if (getComputedStyle(document.body).position === 'fixed') {
            document.body.style.position = '';
            document.body.style.top = '';
        }
        // Remove any leftover inline style that sets height 100vh on body
        if (document.body.style.height && /100vh|100%/.test(document.body.style.height)) {
            document.body.style.height = '';
        }
        // If a modal is open, don't unlock (modal should scroll if tall). Only run if no overlays visible.
        const anyModalOpen = !!document.querySelector('.modal-overlay:not(.hidden)');
        if (!anyModalOpen) {
            html.inert = false;
            document.body.inert = false;
        }
        // Debug
        console.debug('[SCROLL_FIX] Applied scroll unlock');
    } catch(err) {
        console.warn('[SCROLL_FIX] Failed to adjust scroll state', err);
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

async function openMapModal() {
    if (!leafletReady) {
        await loadLeafletAssets();
        leafletReady = true;
    }
    if (!map) initializeMap();
    mapModalOverlay.classList.remove('hidden');
    // Allow interaction (was never unset causing mobile inability to close)
    mapModalOverlay.inert = false;
    // Focus close button for accessibility if present
    if (mapCloseButton) {
        try { mapCloseButton.focus(); } catch(_) {}
    }
    // Attach Escape key handler (added once)
    if (!window._mapEscHandler) {
        window._mapEscHandler = (e) => {
            if (e.key === 'Escape' && !mapModalOverlay.classList.contains('hidden')) {
                closeMapModal();
            }
        };
    }
    document.addEventListener('keydown', window._mapEscHandler);
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);
}

function closeMapModal() {
    mapModalOverlay.classList.add('hidden');
    mapModalOverlay.inert = true;
    if (window._mapEscHandler) {
        document.removeEventListener('keydown', window._mapEscHandler);
    }
}

function updateAvatar(photoURL, displayName) {
    const cached = getCachedAvatar();
    const now = Date.now();
    const hasFreshCache = cached && cached.dataUrl && cached.url === photoURL && (now - cached.ts) < AVATAR_TTL_MS;
    if (photoURL) {
        if (hasFreshCache) {
            userAvatar.src = cached.dataUrl;
            pfpPreview.src = cached.dataUrl;
        } else {
            // Set remote URL immediately (may be behind auth/CDN)
            userAvatar.src = photoURL;
            pfpPreview.src = photoURL;
            // Background revalidation: try to cache as data URL if not fresh
            (async () => {
                try {
                    const dataUrl = await fetchAvatarAsDataURL(photoURL);
                    if (dataUrl) {
                        setCachedAvatar(photoURL, dataUrl);
                    }
                } catch (_) {}
            })();
        }
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
    pfpModalOverlay.inert = true;
    pfpUploadInput.value = '';
    selectedPfpFile = null;
    pfpError.classList.add('hidden');
    if (userBioInput) userBioInput.value = currentUser.bio || '';
    const warning = document.getElementById('bio-profanity-warning');
    if (warning) warning.remove();
}

function closeCustomLogModal() {
    customLogModal.classList.add('hidden');
    customLogModal.inert = true;
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

async function saveProfile(db) {
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
        // Ensure Firestore helpers are loaded (doc, updateDoc, getDoc, setDoc)
        if (!db) {
            try {
                const services = await firebaseReady;
                db = await services.db;
            } catch (e) {
                console.warn('[PROFILE] Firestore unavailable while saving profile');
            }
        }
        let docRefFactory = null;
        let updateDocFn = null;
        let getDocFn = null;
        let setDocFn = null;
        if (db) {
            try {
                const { doc, updateDoc, getDoc, setDoc } = await fs();
                docRefFactory = doc;
                updateDocFn = updateDoc;
                getDocFn = getDoc;
                setDocFn = setDoc;
            } catch (e) {
                console.error('[PROFILE] Failed to load Firestore helpers:', e);
            }
        }
        if (selectedPfpFile) {
            // Lazy load storage module and service only when needed
            const storageModule = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js');
            const services = await firebaseReady;
            const storage = await services.storage;
            const storageRef = storageModule.ref(storage, `profile_pictures/${currentUser.uid}`);
            const snapshot = await storageModule.uploadBytes(storageRef, selectedPfpFile);
            const downloadURL = await storageModule.getDownloadURL(snapshot.ref);
            updateData.photoURL = downloadURL;
            await updateProfile(currentUser, { photoURL: downloadURL });
            updateAvatar(downloadURL, currentUser.displayName);
            // Warm the local cache with a data URL (best-effort)
            try {
                const dataUrl = await fetchAvatarAsDataURL(downloadURL);
                if (dataUrl) setCachedAvatar(downloadURL, dataUrl);
            } catch(_) {}
        }
        if (db && docRefFactory && updateDocFn && getDocFn && setDocFn) {
            const userDocRef = docRefFactory(db, "users", currentUser.uid);
            await updateDocFn(userDocRef, updateData);
            currentUser.bio = newBio;
            const userDocSnap = await getDocFn(userDocRef);
            if (userDocSnap.exists() && userDocSnap.data().showOnWallOfFame) {
                const wallOfFameDocRef = docRefFactory(db, "wallOfFame", currentUser.uid);
                const { displayName, photoURL, currentStreak, longestStreak } = userDocSnap.data();
                await setDocFn(wallOfFameDocRef, { 
                    displayName, 
                    photoURL, 
                    currentStreak: currentStreak || 0,
                    longestStreak: longestStreak || 0,
                    bio: newBio 
                }, { merge: true });
            }
        } else {
            console.warn('[PROFILE] Skipped Firestore profile update (db unavailable).');
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
    const { collection, getDocs, addDoc, Timestamp } = await fs();
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
    const { collection, query, orderBy, getDocs } = await fs();
        const storesRef = collection(db, "users", currentUser.uid, "customStores");
        const q = query(storesRef, orderBy("name"));
        const querySnapshot = await getDocs(q);

        customItemStore.innerHTML = '';

        // Add Denison-specific campus locations if the user is a Denison student
        if (currentUserData && currentUserData.isDenisonStudent) {
            const denisonLocations = [
                'Ross Granville Market',
                'Dragon Village',      // china-garden / DV_price.json
                'Three Tigers',        // three-tigers / TTigers_price.json
                'Harvest Pizza',       // harvest-pizza / harvest_price.json
                "Pocho's",            // pochos / pochos_price.json
                'Granville Pub',       // granville-pub / pub_price.json
                'The Station',         // the-station / station_price.json
                "Whitt's"             // whitts / whitts_price.json
            ];
            denisonLocations.forEach(loc => {
                const opt = document.createElement('option');
                opt.value = loc;
                opt.textContent = loc;
                customItemStore.appendChild(opt);
            });
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
    const { collection, getDocs, query, where, addDoc, Timestamp } = await fs();
    
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
    const { doc, getDoc, collection, addDoc, Timestamp, updateDoc, query, where, getDocs, setDoc } = await fs();

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
        // Preserve any EOD half-credit: do not decrease leaderboardScore below existing value
        const existingScore = typeof userData.leaderboardScore === 'number' ? userData.leaderboardScore : (userData.currentStreak || 0);
        const newLeaderboardScore = Math.max(existingScore, currentStreak);
        const updatePayload = {
            [`balances.${paymentType}`]: newBalance,
            currentStreak: currentStreak,
            longestStreak: longestStreak,
            lastLogDate: Timestamp.now(),
            leaderboardScore: newLeaderboardScore
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
        longestStreak: longestStreak,
        leaderboardScore: newLeaderboardScore,
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

/**
 * FIX: This function is now a standalone helper function to be called
 * both on initial render and when switching tabs.
 */
function updateShelfWidth() {
    const buttonWrapper = quickLogWidgetsContainer.querySelector('.quick-log-buttons');
    if (!buttonWrapper) return;

    // Use a timeout to ensure the browser has rendered the elements and their widths
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
    }, 50); // A small delay helps ensure accurate measurement
}

async function renderQuickLogWidgets(db) {
    if (!currentUser || !quickLogWidgetsContainer) return;
    const { collection, query, orderBy, getDocs, deleteDoc } = await fs();

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
        quickLogWidgetsContainer.style.setProperty('--shelf-width', '0px');
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

    updateShelfWidth();
}

function toggleDeleteMode(enable) {
    isDeleteModeActive = enable;
    if (enable) quickLogWidgetsContainer.classList.add('delete-mode');
    else quickLogWidgetsContainer.classList.remove('delete-mode');
}

async function logFromWidget(db, widgetData, buttonEl) {
    if (!currentUser) return;
    const { doc, getDoc, collection, addDoc, updateDoc, setDoc, Timestamp } = await fs();

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
    // Preserve any EOD half-credit previously granted
    const existingScore = typeof userData.leaderboardScore === 'number' ? userData.leaderboardScore : (userData.currentStreak || 0);
    const newLeaderboardScore = Math.max(existingScore, currentStreak);
    updateData.leaderboardScore = newLeaderboardScore;
    await updateDoc(userDocRef, updateData);

    if (userData.showOnWallOfFame) {
            const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
            await setDoc(wallOfFameDocRef, { 
                currentStreak,
                longestStreak: Math.max(longestStreak, currentStreak),
        leaderboardScore: newLeaderboardScore,
                displayName: currentUser.displayName || "Anonymous",
                photoURL: currentUser.photoURL || "",
                bio: userData.bio || ""
            }, { merge: true });
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
    
    const { collection, query, orderBy, getDocs } = await fs();
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("currentStreak", "desc"));
    
    try {
        const querySnapshot = await getDocs(q);
        let users = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Always include the current user, even if Firestore does not return them
        if (currentUser && !users.some(u => u.id === currentUser.uid)) {
            users.push({
                id: currentUser.uid,
                displayName: currentUser.displayName || (currentUserData?.displayName) || 'You',
                photoURL: currentUser.photoURL || (currentUserData?.photoURL) || '',
                currentStreak: Number(currentUserData?.currentStreak || 0),
                longestStreak: Number(currentUserData?.longestStreak || 0),
                leaderboardScore: (typeof currentUserData?.leaderboardScore === 'number') ? currentUserData.leaderboardScore : Number(currentUserData?.currentStreak || 0),
                bio: currentUserData?.bio || ''
            });
        }
        // Sort by leaderboardScore (if present), else currentStreak, desc
        users.sort((a,b) => {
            const sa = (typeof a.leaderboardScore === 'number') ? a.leaderboardScore : (a.currentStreak || 0);
            const sb = (typeof b.leaderboardScore === 'number') ? b.leaderboardScore : (b.currentStreak || 0);
            return sb - sa;
        });

    leaderboardList.innerHTML = '';
        users.forEach((user, index) => {
            try {
                const item = document.createElement('div');
                item.className = 'leaderboard-item';
                if (index === 0) item.classList.add('top-one');
                if (currentUser && user.id === currentUser.uid) item.classList.add('current-user');

                const safeName = user.displayName || 'User';
                const initial = safeName.charAt(0).toUpperCase();
                const svgAvatar = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" ry="20" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="20" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                // Use UTF-8 data URL to avoid btoa Unicode issues
                const avatarSrc = user.photoURL || `data:image/svg+xml;utf8,${encodeURIComponent(svgAvatar)}`;
                
                const bioHtml = user.bio ? `<div class="leaderboard-bio">"${user.bio}"</div>` : '';
                
                // Create trophy badge for longest streak if it's higher than current
                const longestStreak = user.longestStreak || 0;
                const score = (typeof user.leaderboardScore === 'number') ? user.leaderboardScore : (user.currentStreak || 0);
                const currentStreak = user.currentStreak || 0;
                const showTrophy = longestStreak > currentStreak;
                
                const streakDisplay = showTrophy ? 
                    `<div class="streak-container">
                        <span class="leaderboard-streak">🔥 ${currentStreak}</span>
                        <div class="best-streak-badge" title="Personal Best">
                            <span class="trophy-icon">🏆</span>
                            <span class="trophy-number">${longestStreak}</span>
                        </div>
                    </div>` :
                    `<span class="leaderboard-streak">🔥 ${Number.isInteger(score) ? score : score} </span>`;

                item.innerHTML = `
                    <span class="leaderboard-rank">#${index + 1}</span>
                    <div class="avatar-wrap"><img src="${avatarSrc}" alt="${safeName}" class="leaderboard-avatar" width="48" height="48" loading="lazy" decoding="async"></div>
                    <div class="leaderboard-details">
                        <span class="leaderboard-name">${safeName}</span>
                        ${bioHtml}
                    </div>
                    ${streakDisplay}
                `;
                leaderboardList.appendChild(item);

                // Hook avatar session cache
                try {
                    const img = item.querySelector('img.leaderboard-avatar');
                    const initialChar = initial;
                    applyLeaderboardAvatar(img, user.photoURL || '', initialChar);
                } catch(_) {}
            } catch (renderErr) {
                console.warn('[Leaderboard] Skipped a user due to render error:', renderErr);
            }
        });

        // After rendering, compute and update the dynamic headline
        try {
            updateLeaderboardHeadline(users);
        } catch (e) {
            console.debug('[Leaderboard] headline update skipped:', e);
        }

    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        leaderboardList.innerHTML = '<p>Could not load leaderboard.</p>';
    }
}

// --- Dynamic Streakboard Headline ---
function getPrevLeaderboardState() {
    try {
        const raw = localStorage.getItem('leaderboard:prev');
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function setPrevLeaderboardState(state) {
    try { localStorage.setItem('leaderboard:prev', JSON.stringify(state)); } catch {}
}

function toKeyed(users) {
    const arr = users.map((u, idx) => ({ id: u.id, name: u.displayName || 'Someone', score: (typeof u.leaderboardScore === 'number') ? u.leaderboardScore : (u.currentStreak || 0), rank: idx + 1 }));
    const byId = new Map(arr.map(u => [u.id, u]));
    return { arr, byId };
}

function isClose(a, b) { return Math.abs(a - b) <= 1; }

// TTL for repeating tie/close messages before a vibe break
const HEADLINE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function pickGenZHeadline(context) {
    const { topNow, topPrev, overtakes, tiesAtTop, userShift, closeRace, users } = context;
    const you = users.find(u => u.id === (currentUser?.uid));

    const tieVariants = (a, b) => [
        `${a} and ${b} are neck and neck rn 😮‍💨`,
        `Top spot is in a standoff rn: ${a} vs ${b} 📸`,
        `${a} & ${b} locked in a dead heat fr 🔥`,
    ];
    const closeVariants = (a, b) => [
        `${a} vs ${b} is basically a photo finish 📸`,
        `${a} is breathing down ${b}’s neck 😤`,
        `${a} & ${b} trading places like it’s musical chairs 🎶`,
    ];
    const moods = [
        'The Streakboard’s feeling extra cozy today 🧸',
        'Everyone’s in their grind era fr 🔥',
        'It’s giving consistent. We love to see it ✨',
        'Numbers moving quiet… calm before the glow up 🌊',
        'Streaks on streaks, vibes on vibes 🌈',
        'The leaderboard is lit today 🔥',
        'We’re all just vibing here ✌️',
        'It’s a good day to have a good day 🌞',
        'Just another day in the cozy corner of the internet 🌍',
        'Feeling good, living better ✨',
        'Vibes are high, and so are the scores! 🚀',
    ];

    // Priority: new #1, overtakes, ties, user shift, close race, fallback mood
    if (topNow && topPrev && topNow.id !== topPrev.id) {
        return { text: `${topNow.name} just snatched the crown from ${topPrev.name} 👑✨`, type: 'newTop' };
    }
    if (overtakes && overtakes.length) {
        const o = overtakes[0];
        return { text: `${o.winner.name} low key zoomed past ${o.loser.name} 🚀`, type: 'overtake' };
    }
    if (tiesAtTop && tiesAtTop.length >= 2) {
        const a = tiesAtTop[0].name, b = tiesAtTop[1].name;
        const choices = tieVariants(a, b);
        return { text: choices[Math.floor(Math.random() * choices.length)], type: 'tieTop' };
    }
    if (you && userShift && userShift.dir !== 0) {
        if (userShift.dir < 0) return { text: `You climbed to #${you.rank} — main character energy 💫`, type: 'userUp' };
        if (userShift.dir > 0) return { text: `Slipped to #${you.rank} — it happens, we move 🫶`, type: 'userDown' };
    }
    if (closeRace) {
        const a = closeRace[0].name, b = closeRace[1].name;
        const choices = closeVariants(a, b);
        return { text: choices[Math.floor(Math.random() * choices.length)], type: 'closeRace' };
    }
    // Fallback vibes
    return { text: moods[Math.floor(Math.random() * moods.length)], type: 'vibe' };
}

function getLastHeadlineState() {
    try {
        const raw = localStorage.getItem('leaderboard:headline:last');
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function setLastHeadlineState(state) {
    try { localStorage.setItem('leaderboard:headline:last', JSON.stringify(state)); } catch {}
}

function updateLeaderboardHeadline(users) {
    if (!leaderboardHeadlineEl || !users || users.length === 0) return;
    const now = toKeyed(users);
    const prev = getPrevLeaderboardState();

    let headline = null;
    let context = { users: now.arr };

    // Determine top change and ties
    const topNow = now.arr[0];
    context.topNow = topNow;
    if (prev?.arr?.length) {
        const prevTop = prev.arr[0];
        context.topPrev = prevTop;
        const topScore = topNow.score;
        const secondScore = now.arr[1]?.score ?? null;
        if (secondScore !== null && topScore === secondScore) {
            context.tiesAtTop = now.arr.filter(u => u.score === topScore).slice(0, 3);
        }
        // Overtakes: someone moved ahead of someone they were behind
        const overtakes = [];
        now.arr.slice(0, 5).forEach(curr => {
            const before = prev.byId?.get(curr.id);
            if (!before) return;
            // Find any user that was ahead before but is now behind
            prev.arr.forEach(prevUser => {
                if (prevUser.rank < before.rank) { // was ahead before
                    const currRival = now.byId.get(prevUser.id);
                    if (currRival && curr.rank < currRival.rank) {
                        overtakes.push({ winner: curr, loser: currRival });
                    }
                }
            });
        });
        context.overtakes = overtakes;
        // User shift
        if (currentUser?.uid) {
            const youNow = now.byId.get(currentUser.uid);
            const youPrev = prev.byId?.get(currentUser.uid);
            if (youNow && youPrev) {
                context.userShift = { dir: Math.sign(youPrev.rank - youNow.rank), from: youPrev.rank, to: youNow.rank };
            }
        }
        // Close race among top 3
        if (now.arr.length >= 2 && isClose(now.arr[0].score, now.arr[1].score)) {
            context.closeRace = [now.arr[0], now.arr[1]];
        }
    }

    const picked = pickGenZHeadline(context);
    const last = getLastHeadlineState();
    const ttlTypes = new Set(['tieTop', 'closeRace']);
    let finalText = picked.text;
    let finalType = picked.type;
    const sameType = last && last.type === finalType;
    if (ttlTypes.has(finalType) && last) {
        const age = Date.now() - last.ts;
        if (sameType && age >= HEADLINE_TTL_MS) {
            // inject a vibe break after TTL
            const vibes = [
                'The Streakboard’s feeling extra cozy today 🧸',
                'Everyone’s in their grind era fr 🔥',
                'It’s giving consistent. We love to see it ✨',
                'Numbers moving quiet… calm before the glow up 🌊',
            ];
            finalText = vibes[Math.floor(Math.random() * vibes.length)];
            finalType = 'vibeCooldown';
        } else if (sameType && age < HEADLINE_TTL_MS && last.text === finalText) {
            // nudge to avoid exact repeat within TTL
            finalText = finalText + ' ';
        }
    }
    if (finalText) {
        leaderboardHeadlineEl.textContent = finalText;
    }

    // Persist state for next diff
    setPrevLeaderboardState({ arr: now.arr, byIdObj: Object.fromEntries(now.byId) });
    setLastHeadlineState({ type: finalType, ts: Date.now(), text: finalText });
}


async function handlePublicToggle(e, db) {
    if (!currentUser) return;
    const { doc, updateDoc, getDoc, setDoc, deleteDoc } = await fs();
    const isChecked = e.target.checked;
    const checkboxEl = e.target;
    const previous = !isChecked; // previous state before user click
    checkboxEl.disabled = true;
    const userDocRef = doc(db, "users", currentUser.uid);
    const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);

    try {
        await updateDoc(userDocRef, { showOnWallOfFame: isChecked });
        
        if (isChecked) {
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const { displayName, photoURL, currentStreak, longestStreak, bio } = userDoc.data();
                await setDoc(wallOfFameDocRef, { 
                    displayName, 
                    photoURL, 
                    currentStreak: currentStreak || 0,
                    longestStreak: longestStreak || 0,
                    bio: bio || ""
                }, { merge: true });
            }
        } else {
            await deleteDoc(wallOfFameDocRef);
        }
        showSuccessMessage(isChecked ? '✓ Added to Top Grind' : 'Removed from Top Grind');
    } catch (error) {
        console.error("Error updating Top of the Grind status:", error);
        // Revert UI state on failure
        checkboxEl.checked = previous;
        showQuickLogError('Update failed. Try again.');
    }
    finally {
        checkboxEl.disabled = false;
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
    // Guard against duplicate fetches
    if (weatherWidget.dataset.loading === '1' || weatherWidget.dataset.loaded === '1') return;
    weatherWidget.dataset.loading = '1';
    // Defer weather fetch until section is near viewport to reduce TBT/CPU
    const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
    const lat = 40.08;
    const lon = -82.49;
    const cacheKey = `weather:${lat},${lon}`;

    const renderFromData = (data) => {
        try {
            const temp = Math.round(data.main.temp);
            const description = data.weather[0].description;
            const iconCode = data.weather[0].icon;
            weatherWidget.innerHTML = `
                <div class="weather-content">
                    <img src="https://openweathermap.org/img/wn/${iconCode}@2x.png" alt="${description}" class="weather-icon" width="80" height="80" loading="lazy" decoding="async">
                    <div class="weather-details">
                        <div class="weather-temp">${temp}°F</div>
                        <div class="weather-location">Granville, OH</div>
                        <div class="weather-description">${description}</div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.warn('Render weather failed, falling back to error.', e);
            weatherWidget.innerHTML = `<p class="weather-error">Could not load weather data.</p>`;
        }
        weatherWidget.dataset.loaded = '1';
        delete weatherWidget.dataset.loading;
        // Persist attribute so cachedBalanceHTML keeps it
        weatherWidget.setAttribute('data-loaded', '1');
    };

    // Try client-side cache first
    const now = Date.now();
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.ts && parsed.data) {
                const age = now - parsed.ts;
                if (age < WEATHER_CACHE_TTL_MS) {
                    // Fresh: render and skip network
                    renderFromData(parsed.data);
                    return;
                } else {
                    // Stale: render immediately, then revalidate in background
                    renderFromData(parsed.data);
                    // Allow a background refresh below
                    weatherWidget.dataset.loaded = '';
                }
            }
        }
    } catch (e) {
        console.debug('Weather cache parse error, will fetch fresh.', e);
    }

    const startFetch = async () => {
        weatherWidget.innerHTML = `<div class="spinner"></div>`;
        const apiUrl = `/.netlify/functions/getWeather?lat=${lat}&lon=${lon}`;

        try {
            const response = await fetch(apiUrl);
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Error fetching weather');
            // Cache and render
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })); } catch {}
            renderFromData(data);
        } catch (error) {
            console.error("Weather fetch error:", error);
            weatherWidget.innerHTML = `<p class="weather-error">Could not load weather data.</p>`;
            weatherWidget.dataset.loaded = '1';
            delete weatherWidget.dataset.loading;
            weatherWidget.setAttribute('data-loaded', '1');
        }
    };

    const run = () => {
        // Small timeout to avoid blocking long tasks at paint time
        setTimeout(startFetch, 0);
    };

    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    io.disconnect();
                    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
                    else run();
                }
            });
        }, { rootMargin: '200px' });
        io.observe(weatherWidget);
    } else {
        run();
    }

}

function initializeMap() {
    if (!mapRenderTarget || map) return;

    // Build a label resolver using the user's renamed balanceTypes (fallback to capitalized id)
    const getLabelFor = (id) => {
        const bt = (currentUserData?.balanceTypes || userBalanceTypes || []).find(t => t.id === id);
        const lbl = (bt && bt.label && bt.label.trim()) ? bt.label.trim() : (id.charAt(0).toUpperCase() + id.slice(1));
        return lbl;
    };

    const locations = [
        { name: 'Ross Granville Market', address: 'Inside Slayter Union', coords: [40.0630707, -82.5189282], accepts: ['credits'] },
        { name: 'Station', address: '425 S Main St, Granville', coords: [40.0648271, -82.5205385], accepts: ['credits'] },
        { name: 'Broadway Pub', address: '126 E Broadway, Granville', coords: [40.068128, -82.5191948], accepts: ['credits'] },
        { name: 'Three Tigers', address: '133 N Prospect St, Granville', coords: [40.0683299, -82.5184905], accepts: ['credits'] },
        { name: 'Pochos', address: '128 E Broadway, Granville', coords: [40.0681522, -82.5190099], accepts: ['credits'] },
        { name: 'Harvest', address: '454 S Main St, Granville', coords: [40.063813, -82.520413], accepts: ['credits'] },
        { name: 'Whitt\'s', address: '226 E Broadway, Granville', coords: [40.0680189, -82.5174337], accepts: ['credits'] },
        { name: 'Dragon Village', address: '127 E Broadway, Granville', coords: [40.0676361, -82.5190986], accepts: ['credits'] },
        { name: 'Curtis Dining Hall', address: '100 Smith Ln, Granville', coords: [40.116877, -83.742193], accepts: ['dining', 'swipes', 'bonus'] },
        { name: 'Huffman Dining Hall', address: '700 East Loop, Granville', coords: [40.072603, -82.517739], accepts: ['dining', 'swipes', 'bonus'] },
        { name: 'Slayter', address: '200 Ridge Rd, Granville', coords: [40.0718253, -82.5243115], accepts: ['dining', 'bonus'] },
        { name: 'Slivys', address: 'Olin Hall, 900 Sunset Hill', coords: [40.0744031, -82.5274519], accepts: ['dining'] }
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
        const acceptsLabels = location.accepts.map(getLabelFor).join(', ');
        const popupContent = `<div style="font-family: 'Nunito', sans-serif; text-align: center;"><strong style="font-size: 1.1em;">${location.name}</strong><br>${location.address}<br><em style="font-size: 0.9em; color: #555;">Accepts: ${acceptsLabels}</em></div>`;
        L.marker(location.coords, { icon: icon }).addTo(map).bindPopup(popupContent);
    });

    setTimeout(() => { if (map) map.invalidateSize(); }, 100);
}

function loadLeafletAssets() {
    return new Promise((resolve, reject) => {
        // If L is already present, resolve immediately
        if (window.L) return resolve();
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        css.crossOrigin = '';
        document.head.appendChild(css);

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
        script.crossOrigin = '';
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = (e) => reject(e);
        document.head.appendChild(script);
    });
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
    
    /* Streak container for leaderboard */
    .streak-container {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
    }
    
    /* Best streak badge - newspaper style */
    .best-streak-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
        padding: 0.2rem 0.5rem;
        border-radius: 20px;
        border: 2px solid var(--text-primary);
        box-shadow: 
            inset 0 1px 2px rgba(255,255,255,0.5),
            0 2px 4px rgba(0,0,0,0.2);
        font-family: 'Special Elite', monospace;
        font-weight: 700;
        position: relative;
        transform: rotate(-2deg);
        transition: transform 0.2s ease;
    }
    
    .best-streak-badge:hover {
        transform: rotate(-1deg) scale(1.05);
    }
    
    .best-streak-badge::before {
        content: '';
        position: absolute;
        top: -4px;
        right: -4px;
        width: 8px;
        height: 8px;
        background: radial-gradient(circle, #FFD700 0%, transparent 70%);
        border-radius: 50%;
        animation: sparkle 2s ease-in-out infinite;
    }
    
    @keyframes sparkle {
        0%, 100% { opacity: 0; }
        50% { opacity: 1; }
    }
    
    .trophy-icon {
        font-size: 0.9rem;
        filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.3));
    }
    
    .trophy-number {
        font-size: 0.85rem;
        color: var(--text-primary);
        font-weight: 900;
        text-shadow: 1px 1px 0 rgba(255,255,255,0.3);
    }
    
    /* Mobile adjustments for trophy badge */
    @media (max-width: 640px) {
        .streak-container {
            flex-direction: column;
            align-items: flex-end;
            gap: 0.25rem;
        }
        
        .best-streak-badge {
            font-size: 0.75rem;
            padding: 0.15rem 0.4rem;
            transform: rotate(-1deg);
        }
        
        .trophy-icon {
            font-size: 0.8rem;
        }
        
        .trophy-number {
            font-size: 0.75rem;
        }
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
