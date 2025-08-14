// --- IMPORTS ---
import { firebaseReady, logout } from './auth.js';
import { doc, getDoc, updateDoc, collection, query, orderBy, getDocs, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { updateProfile, deleteUser } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- DOM Elements ---
let loadingIndicator, statsContainer, pageTitle, welcomeMessage, userAvatar, avatarButton,
    historyList, insightsList, spendingChartCanvas, logoutButton,
    pfpModalOverlay, pfpPreview, pfpUploadInput, pfpSaveButton,
    pfpCloseButton, pfpError, userBioInput, customBalanceSelector, projectionInfoButton,
    openDeleteAccountBtn, deleteConfirmModalOverlay, deleteCancelBtn, 
    deleteConfirmBtn, deleteErrorMessage,
    // Rename balances elements (added for parity with dashboard)
    renameBalancesModal, renameBalancesForm, renameBalancesCloseBtn, renameBalancesSaveBtn, renameBalancesBtn;

// --- App State ---
let currentUser = null;
let firebaseServices = null;
let spendingChart = null;
let selectedPfpFile = null;
let selectedBalanceType = null;
let purchaseData = null;
let userDataCache = null;
let userBalanceTypes = [];
let unlockedForecasts = {}; // State to track unlocked forecasts per balance type

// Avatar cache config (shared with dashboard)
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
        if (blob.size > 600000) return null; // Skip very large images
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

// --- Main App Initialization ---
async function main() {
    assignDOMElements();
    try {
        // Await the firebaseReady wrapper first, then resolve its getters
        const services = await firebaseReady;
        const [auth, db, storage] = await Promise.all([
            services.auth,
            services.db,
            services.storage,
        ]);

        if (!auth || !db || !storage) {
            throw new Error('Firebase services could not be initialized.');
        }
        firebaseServices = { auth, db, storage };

        // Resolve current user reliably
        currentUser = auth.currentUser;
        if (!currentUser) {
            const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
            await new Promise((resolve) => {
                const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
            }).then((u) => { currentUser = u || null; });
        }

        if (!currentUser) {
            // No session -> go to login
            window.location.replace('/login.html');
            return;
        }

        checkProfile();

    } catch (error) {
        console.error('Fatal Error on Statistics:', error);
        if (loadingIndicator) {
            loadingIndicator.innerHTML = 'Failed to load statistics. Please try again later.';
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
        
        // Set up balance types based on user type
        setupBalanceTypes(userData);
        
        renderStatistics(userData);
    } else {
        window.location.href = "questionnaire.html";
    }
}

function setupBalanceTypes(userData) {
    const { balanceTypes, isDenisonStudent, classYear } = userData;
    let rawBalanceTypes = [];
    // Always start from stored balanceTypes to preserve custom labels
    const stored = (balanceTypes || []).slice();
    if (isDenisonStudent) {
        const mapById = new Map(stored.map(b => [b.id, b]));
        const seniorIds = ['credits','dining'];
        const fullIds = ['credits','dining','swipes','bonus'];
        const required = classYear === 'Senior' ? seniorIds : fullIds;
        rawBalanceTypes = required.map(id => mapById.get(id)).filter(Boolean);
        // Add fallbacks if missing to avoid breaking UI
        const ensure = (id,label,type,extra={}) => { if(!rawBalanceTypes.some(bt=>bt.id===id)) rawBalanceTypes.push({ id, label, type, ...extra }); };
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
        rawBalanceTypes = stored;
    }

    // FIX: Filter to only include balance types that are 'money'
    userBalanceTypes = rawBalanceTypes.filter(bt => bt.type === 'money');
    
    // Set default selected balance type from the filtered list
    if (userBalanceTypes.length > 0) {
        // If the previously selected type is not in the new list, or if it's null, reset to the first available.
        if (!selectedBalanceType || !userBalanceTypes.some(bt => bt.id === selectedBalanceType)) {
            selectedBalanceType = userBalanceTypes[0].id;
        }
    } else {
        selectedBalanceType = null;
    }
}

async function renderStatistics(userData) {
    // Store user data for later use
    userDataCache = userData;
    
    // Fetch purchase history
    const purchasesRef = collection(firebaseServices.db, "users", currentUser.uid, "purchases");
    const q = query(purchasesRef, orderBy("purchaseDate", "desc"));
    const purchasesSnap = await getDocs(q);
    
    const purchaseHistory = purchasesSnap.docs.map(doc => {
        const data = doc.data();
        return { ...data, purchaseDate: data.purchaseDate.toDate() };
    });
    
    // Store purchase data for later use
    purchaseData = purchaseHistory;

    // Pre-calculate which forecasts are unlocked
    calculateForecastUnlocks(purchaseHistory);

    // Update bio input if it exists
    if (userBioInput) {
        userBioInput.value = userData.bio || '';
    }
    
    // Update avatar in modal
    updateAvatar(userData.photoURL, userData.displayName);

    // Initialize balance type dropdown
    initializeBalanceDropdown();

    // Render all components
    renderAllComponents(userData, purchaseHistory);
    
    loadingIndicator.style.display = 'none';
    statsContainer.style.display = 'block';
    
    setupEventListeners();
    handleBioInput();
}

// New function to determine unlocked status for all balance types at once
function calculateForecastUnlocks(allPurchases) {
    unlockedForecasts = {}; // Reset
    userBalanceTypes.forEach(balanceType => {
        const filteredPurchases = allPurchases.filter(p => 
            !p.balanceType || p.balanceType === balanceType.id
        );
        
        const spendingByDay = {};
        filteredPurchases.forEach(p => {
            const day = p.purchaseDate.toISOString().split('T')[0];
            spendingByDay[day] = true; // We just need to know the day had a purchase
        });
        
        const uniqueSpendingDays = Object.keys(spendingByDay).length;
        unlockedForecasts[balanceType.id] = uniqueSpendingDays >= 3;
    });
}

// --- Balance Dropdown Functions ---
function initializeBalanceDropdown() {
    if (!customBalanceSelector || userBalanceTypes.length === 0) return;
    
    const customSelect = customBalanceSelector.querySelector('.custom-select');
    const trigger = customSelect.querySelector('.custom-select-trigger span');
    const optionsContainer = customSelect.querySelector('.custom-options');
    
    // Find the selected balance type
    const selectedBalance = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
    trigger.textContent = selectedBalance ? selectedBalance.label : 'Select Balance';
    
    // Clear and populate options
    optionsContainer.innerHTML = '';
    userBalanceTypes.forEach(balanceType => {
        const option = document.createElement('div');
        option.className = 'custom-option';
        option.dataset.value = balanceType.id;
        option.textContent = balanceType.label;
        if (balanceType.id === selectedBalanceType) {
            option.classList.add('selected');
        }
        optionsContainer.appendChild(option);
    });
    
    // Remove any existing event listeners by cloning
    const newCustomSelect = customSelect.cloneNode(true);
    customSelect.parentNode.replaceChild(newCustomSelect, customSelect);
    
    // Re-query elements after cloning
    const newTrigger = newCustomSelect.querySelector('.custom-select-trigger');
    const newOptionsContainer = newCustomSelect.querySelector('.custom-options');
    const chartCard = newCustomSelect.closest('.stats-card'); // Get the parent card

    // Click handler for trigger
    newTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = newCustomSelect.classList.toggle('open');
        if (chartCard) {
            chartCard.classList.toggle('dropdown-active', isOpen);
        }
    });
    
    // Click handler for options
    newOptionsContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        const option = e.target.closest('.custom-option');
        if (option) {
            // Update selected state
            newOptionsContainer.querySelectorAll('.custom-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            
            // Update trigger text
            const newBalanceType = option.dataset.value;
            const balanceInfo = userBalanceTypes.find(bt => bt.id === newBalanceType);
            newTrigger.querySelector('span').textContent = balanceInfo ? balanceInfo.label : 'Select Balance';
            
            // Close dropdown
            newCustomSelect.classList.remove('open');
            if (chartCard) {
                chartCard.classList.remove('dropdown-active');
            }
            
            // Update selected balance and refresh components
            if (newBalanceType !== selectedBalanceType) {
                // Check if what-if was active before switching
                const whatIfToggle = document.getElementById('what-if-toggle');
                const wasWhatIfActive = whatIfToggle && whatIfToggle.classList.contains('active');
                
                selectedBalanceType = newBalanceType;
                if (purchaseData && userDataCache) {
                    // Re-render components that depend on the selected balance
                    renderChart(userDataCache, purchaseData);
                    renderInsights(purchaseData);
                    renderHistory(purchaseData);
                    
                    // Re-initialize What-If with new balance type
                    initializeWhatIfScenario(userDataCache, purchaseData);
                    
                    // If what-if was active, re-enable it automatically
                    if (wasWhatIfActive) {
                        const newWhatIfToggle = document.getElementById('what-if-toggle');
                        if (newWhatIfToggle && newWhatIfToggle.textContent === 'Enable') {
                            setTimeout(() => {
                                newWhatIfToggle.click(); // Activate what-if with new balance
                            }, 100);
                        }
                    }
                }
            }
        }
    });
    
    // Click outside to close
    document.addEventListener('click', (e) => {
        if (!customBalanceSelector.contains(e.target)) {
            if (newCustomSelect.classList.contains('open')) {
                newCustomSelect.classList.remove('open');
                if (chartCard) {
                    chartCard.classList.remove('dropdown-active');
                }
            }
        }
    });
}


function formatBalanceValue(value, balanceType) {
    if (!balanceType) return value.toString();
    
    if (balanceType.type === 'money') {
        return `$${value.toFixed(2)}`;
    } else {
        return value.toString();
    }
}

function assignDOMElements() {
    loadingIndicator = document.getElementById('loading-indicator');
    statsContainer = document.getElementById('stats-container');
    pageTitle = document.getElementById('page-title');
    welcomeMessage = document.getElementById('welcome-message');
    userAvatar = document.getElementById('user-avatar');
    if (userAvatar) {
        try { userAvatar.setAttribute('crossorigin', 'anonymous'); } catch(_) {}
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
    historyList = document.getElementById('purchase-history-list');
    insightsList = document.getElementById('insights-list');
    // spendingChartCanvas is assigned dynamically in renderChart
    logoutButton = document.getElementById('logout-button');
    pfpModalOverlay = document.getElementById('pfp-modal-overlay');
    pfpPreview = document.getElementById('pfp-preview');
    pfpUploadInput = document.getElementById('pfp-upload-input');
    pfpSaveButton = document.getElementById('pfp-save-button');
    pfpCloseButton = document.getElementById('pfp-close-button');
    pfpError = document.getElementById('pfp-error');
    userBioInput = document.getElementById('user-bio-input');
    customBalanceSelector = document.getElementById('custom-currency-selector');
    projectionInfoButton = document.getElementById('projection-info-button');
    
    // Delete Account Elements
    openDeleteAccountBtn = document.getElementById('open-delete-account-button');
    deleteConfirmModalOverlay = document.getElementById('delete-confirm-modal-overlay');
    deleteCancelBtn = document.getElementById('delete-cancel-button');
    deleteConfirmBtn = document.getElementById('delete-confirm-button');
    deleteErrorMessage = document.getElementById('delete-error-message');
    // Rename balances modal elements
    renameBalancesModal = document.getElementById('rename-balances-modal');
    renameBalancesForm = document.getElementById('rename-balances-form');
    renameBalancesCloseBtn = document.getElementById('rename-balances-close');
    const renameBalancesCloseX = document.getElementById('rename-balances-close-x');
    if (!renameBalancesCloseBtn && renameBalancesCloseX) renameBalancesCloseBtn = renameBalancesCloseX; // fallback
    renameBalancesSaveBtn = document.getElementById('rename-balances-save');
    renameBalancesBtn = document.getElementById('rename-balances-btn');
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

    if (userBioInput) userBioInput.addEventListener('input', handleBioInput);
    
    if (projectionInfoButton) {
        projectionInfoButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleProjectionTooltip();
        });
    }
    
    // Delete Account Listeners
    if (openDeleteAccountBtn) openDeleteAccountBtn.addEventListener('click', () => deleteConfirmModalOverlay.classList.remove('hidden'));
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => deleteConfirmModalOverlay.classList.add('hidden'));
    if (deleteConfirmModalOverlay) deleteConfirmModalOverlay.addEventListener('click', (e) => {
        if (e.target === deleteConfirmModalOverlay) deleteConfirmModalOverlay.classList.add('hidden');
    });
    if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', deleteUserDataAndLogout);

    // Rename balances modal listeners
    if (renameBalancesBtn && !renameBalancesBtn.dataset.bound) {
        renameBalancesBtn.addEventListener('click', openRenameBalancesModal);
        renameBalancesBtn.dataset.bound = '1';
    }
    if (renameBalancesCloseBtn && !renameBalancesCloseBtn.dataset.bound) { renameBalancesCloseBtn.addEventListener('click', closeRenameBalancesModal); renameBalancesCloseBtn.dataset.bound='1'; }
    const renameBalancesCloseX2 = document.getElementById('rename-balances-close-x');
    if (renameBalancesCloseX2 && !renameBalancesCloseX2.dataset.bound) { renameBalancesCloseX2.addEventListener('click', closeRenameBalancesModal); renameBalancesCloseX2.dataset.bound='1'; }
    if (renameBalancesModal) renameBalancesModal.addEventListener('click', (e) => { if (e.target === renameBalancesModal) closeRenameBalancesModal(); });
    if (renameBalancesSaveBtn) renameBalancesSaveBtn.addEventListener('click', saveRenamedBalances);
}

// --- Rename Balance Labels Feature (parity with dashboard) ---
function openRenameBalancesModal() {
    if (!renameBalancesModal || !renameBalancesForm) return;
    const container = renameBalancesForm.querySelector('.rename-balance-inputs');
    if (!container) return;
    container.innerHTML = '';
    // Source types from userDataCache.balanceTypes preserving custom labels
    const allTypes = (userDataCache?.balanceTypes || userBalanceTypes || []).slice();
    // Determine visible IDs for Denison students
    let allowedIds = null;
    if (userDataCache?.isDenisonStudent) {
        if (userDataCache.classYear === 'Senior') {
            allowedIds = new Set(['credits','dining']);
        } else {
            allowedIds = new Set(['credits','dining','swipes','bonus']);
        }
    }
    const filtered = allTypes.filter(t => t && t.id && (!allowedIds || allowedIds.has(t.id)));
    filtered.sort((a,b)=>a.id.localeCompare(b.id));
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
    const original = (userDataCache?.balanceTypes || userBalanceTypes || []).slice();
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
            const userDocRef = doc(firebaseServices.db, 'users', currentUser.uid);
            await updateDoc(userDocRef, { balanceTypes: updated });
        }
        userBalanceTypes = updated.filter(bt => bt.type === 'money'); // maintain money filter
        if (userDataCache) userDataCache.balanceTypes = updated;
        // Rebuild dropdown and dependent UI with new labels
        initializeBalanceDropdown();
        if (purchaseData && userDataCache) {
            renderChart(userDataCache, purchaseData);
            renderInsights(purchaseData);
            renderHistory(purchaseData);
        }
        // Lightweight inline success feedback
        const btn = renameBalancesSaveBtn;
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Saved';
            setTimeout(()=>{ btn.textContent = originalText; }, 1400);
        }
    } catch (err) {
        console.error('Failed to save renamed balances (stats page)', err);
        alert('Failed to update labels.');
    } finally {
        closeRenameBalancesModal();
    }
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

    // Enforce the max length by trimming the value
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

function updateAvatar(photoURL, displayName) {
    const cached = getCachedAvatar();
    const now = Date.now();
    const hasFreshCache = cached && cached.dataUrl && cached.url === photoURL && (now - cached.ts) < AVATAR_TTL_MS;
    if (photoURL) {
        if (hasFreshCache) {
            if (userAvatar) userAvatar.src = cached.dataUrl;
            if (pfpPreview) pfpPreview.src = cached.dataUrl;
        } else {
            if (userAvatar) userAvatar.src = photoURL;
            if (pfpPreview) pfpPreview.src = photoURL;
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
        if (userAvatar) userAvatar.src = svgUrl;
        if (pfpPreview) pfpPreview.src = svgUrl;
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
            try {
                const dataUrl = await fetchAvatarAsDataURL(downloadURL);
                if (dataUrl) setCachedAvatar(downloadURL, dataUrl);
            } catch(_) {}
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

async function deleteUserDataAndLogout() {
    if (!currentUser || !firebaseServices) return;

    const { db } = firebaseServices;

    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting...';
    deleteErrorMessage.classList.add('hidden');

    try {
        // Fallback dynamic import (parity with dashboard) in case top-level imports change
        let fDoc = doc, fDeleteDoc = deleteDoc, fCollection = collection, fQuery = query, fGetDocs = getDocs;
        if (typeof fDoc !== 'function' || typeof fDeleteDoc !== 'function') {
            const mod = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
            fDoc = mod.doc; fDeleteDoc = mod.deleteDoc; fCollection = mod.collection; fQuery = mod.query; fGetDocs = mod.getDocs;
        }
        const userId = currentUser.uid;
        const purchasesPath = `users/${userId}/purchases`;
        const widgetsPath = `users/${userId}/quickLogWidgets`;
        const storesPath = `users/${userId}/customStores`; // Path for custom stores
        const userDocRef = fDoc(db, "users", userId);
        const wallOfFameDocRef = fDoc(db, "wallOfFame", userId);

        // Use existing deleteSubcollection (which still references imported funcs) for efficiency
        await Promise.all([
            deleteSubcollection(db, purchasesPath),
            deleteSubcollection(db, widgetsPath),
            deleteSubcollection(db, storesPath),
            fDeleteDoc(wallOfFameDocRef).catch(err => console.log("No Wall of Fame doc to delete:", err.message)),
            fDeleteDoc(userDocRef)
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

// --- Renders all parts of the page with whatever data it's given
function renderAllComponents(userData, purchaseHistory) {
    renderHeader(userData);
    renderHistory(purchaseHistory);
    renderInsights(purchaseHistory);
    renderChart(userData, purchaseHistory);
    initializeWhatIfScenario(userData, purchaseHistory);
    initializeViewToggle(userData, purchaseHistory);
}

function renderHeader(userData) {
    welcomeMessage.textContent = `A look at your spending habits, ${userData.displayName || 'friend'}...`;
    updateAvatar(userData.photoURL, userData.displayName);
}

function renderHistory(purchases) {
    if (!historyList) return;
    historyList.innerHTML = '';

    // Filter purchases for the selected balance type
    const filteredPurchases = purchases.filter(p => 
        !p.balanceType || p.balanceType === selectedBalanceType
    );

    if (filteredPurchases.length === 0) {
        const balanceInfo = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
        historyList.innerHTML = `
            <div class="data-gate">
                <div class="data-gate-icon">🛒</div>
                <div class="data-gate-title">No History Yet</div>
                <div class="data-gate-text">
                    Log your first ${balanceInfo ? balanceInfo.label : 'purchase'} transaction to see your history here!
                </div>
            </div>
        `;
        return;
    }
    
    const categoryIcons = { 'Coffee': '☕', 'Food': '🥐', 'Drinks': '🥤', 'Default': '🛒' };

    filteredPurchases.forEach(purchase => {
        const itemElement = document.createElement('div');
        itemElement.className = 'history-item';
        
        const formattedDate = purchase.purchaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const mainItemName = purchase.items.length > 1 ? `${purchase.items[0].name} & more` : purchase.items[0].name;
        const category = purchase.items[0]?.category || 'Default';
        
        const balanceInfo = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
        const priceDisplay = formatBalanceValue(purchase.total, balanceInfo);

        itemElement.innerHTML = `
            <div class="history-item-icon">${categoryIcons[category] || categoryIcons['Default']}</div>
            <div class="history-item-details">
                <div class="history-item-name">${mainItemName}</div>
                <div class="history-item-date">${purchase.store} on ${formattedDate}</div>
            </div>
            <div class="history-item-price">${priceDisplay}</div>
        `;
        historyList.appendChild(itemElement);
    });
}

// --- ENHANCED INSIGHTS SYSTEM ---
function generateInsight(type, data, priority = 5) {
    return {
        type,
        priority,
        icon: data.icon,
        text: data.text,
        data // Store raw data for potential future use
    };
}

function calculateInsightData(purchases, balanceInfo) {
    const now = new Date();
    const insights = [];
    
    // Only proceed if we have purchases
    if (purchases.length === 0) return insights;
    
    // Prepare common data
    const allItems = purchases.flatMap(p => p.items);
    const totalSpent = purchases.reduce((sum, p) => sum + p.total, 0);
    
    // Time-based analysis
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    const thisWeekPurchases = purchases.filter(p => p.purchaseDate > oneWeekAgo);
    const lastWeekPurchases = purchases.filter(p => p.purchaseDate > twoWeeksAgo && p.purchaseDate <= oneWeekAgo);
    const thisMonthPurchases = purchases.filter(p => p.purchaseDate > oneMonthAgo);
    
    const thisWeekSpending = thisWeekPurchases.reduce((sum, p) => sum + p.total, 0);
    const lastWeekSpending = lastWeekPurchases.reduce((sum, p) => sum + p.total, 0);
    const thisMonthSpending = thisMonthPurchases.reduce((sum, p) => sum + p.total, 0);
    
    // SEMESTER-AWARE INSIGHTS FOR DENISON STUDENTS
    if (userDataCache && userDataCache.isDenisonStudent) {
        const semesterInfo = getDenisonSemesterInfo(now);
        
        // Critical semester warnings
        if (semesterInfo.currentSemester && semesterInfo.daysUntilSemesterEnd) {
            const currentBalance = userDataCache.balances?.[selectedBalanceType] || 0;
            const avgDailySpending = thisWeekSpending / 7;
            
            // Calculate active days remaining
            const semesterEndDate = semesterInfo.currentSemester === 'fall' 
                ? semesterInfo.semesters.fall.end 
                : semesterInfo.semesters.spring.end;
            const activeRemainingDays = calculateActiveSpendingDays(now, semesterEndDate, semesterInfo);
            
            const projectedDaysUntilEmpty = avgDailySpending > 0 ? currentBalance / avgDailySpending : 999;
            
            // Finals week warning
            if (semesterInfo.isFinalsWeek) {
                insights.push(generateInsight('finals_alert', {
                    icon: '🤯',
                    text: `Finals week! Expect 40% higher spending on coffee & late food.`
                }, 10));
            }
            
            // Upcoming break reminder
            else if (semesterInfo.upcomingBreak && semesterInfo.upcomingBreak.daysUntil <= 7) {
                insights.push(generateInsight('break_coming', {
                    icon: '🏖️',
                    text: `${semesterInfo.upcomingBreak.name} in ${semesterInfo.upcomingBreak.daysUntil} days - budget accordingly!`
                }, 9));
            }
            
            // Semester end warning
            if (projectedDaysUntilEmpty < activeRemainingDays && semesterInfo.daysUntilSemesterEnd > 14) {
                const daysShort = Math.floor(activeRemainingDays - projectedDaysUntilEmpty);
                insights.push(generateInsight('semester_warning', {
                    icon: '🚨',
                    text: `At this rate, you'll run out ${daysShort} days before semester ends!`
                }, 10));
            }
            
            // Positive reinforcement if on track
            else if (projectedDaysUntilEmpty > activeRemainingDays + 10 && avgDailySpending > 5) {
                insights.push(generateInsight('on_track', {
                    icon: '✅',
                    text: `Great job! On track to have funds through semester end.`
                }, 6));
            }
            
            // Semester progress insight
            if (semesterInfo.semesterProgress >= 75) {
                const remainingWeeks = Math.ceil(semesterInfo.daysUntilSemesterEnd / 7);
                insights.push(generateInsight('semester_progress', {
                    icon: '📅',
                    text: `Home stretch! ${remainingWeeks} weeks left in the semester.`
                }, 5));
            }
        }
        
        // Break period insight
        if (semesterInfo.currentPeriod === 'break' || semesterInfo.currentPeriod === 'winter-break') {
            insights.push(generateInsight('on_break', {
                icon: '🏝️',
                text: `Enjoy break! Your funds are safe while you're off campus.`
            }, 8));
        }
    }
    
    // 1. Spending Trend Insight (High Priority)
    if (lastWeekPurchases.length > 0 && thisWeekPurchases.length > 0) {
        const weekDifference = thisWeekSpending - lastWeekSpending;
        const percentChange = (weekDifference / lastWeekSpending) * 100;
        
        // Use more natural language instead of confusing percentages
        let trendMessage;
        let emoji;
        let priority;
        
        if (Math.abs(weekDifference) < 5) {
            // Very small change
            trendMessage = `Steady spending week-to-week.`;
            emoji = '➡️';
            priority = 4;
        } else if (weekDifference > 0) {
            // Spending increased
            const increase = formatBalanceValue(weekDifference, balanceInfo);
            if (percentChange > 100) {
                trendMessage = `You doubled your spending! (${increase} more than last week)`;
                emoji = '🚨';
                priority = 9;
            } else if (percentChange > 50) {
                trendMessage = `Spending up by ${increase} this week.`;
                emoji = '📈';
                priority = 8;
            } else {
                trendMessage = `Spent ${increase} more than last week.`;
                emoji = '📊';
                priority = 6;
            }
        } else {
            // Spending decreased
            const savings = formatBalanceValue(Math.abs(weekDifference), balanceInfo);
            if (percentChange < -50) {
                trendMessage = `Great job! You cut spending in half (saved ${savings})`;
                emoji = '🎉';
                priority = 7;
            } else {
                trendMessage = `Nice! Saved ${savings} vs last week.`;
                emoji = '📉';
                priority = 6;
            }
        }
        
        insights.push(generateInsight('trend', {
            icon: emoji,
            text: trendMessage
        }, priority));
    }
    
    // 2. Budget Pace Insight (Critical Priority if overspending) - Non-Denison version
    if (userDataCache && userDataCache.balances && userDataCache.balances[selectedBalanceType] && !userDataCache.isDenisonStudent) {
        const currentBalance = userDataCache.balances[selectedBalanceType];
        const avgDailySpending = thisWeekSpending / 7;
        const daysUntilEmpty = avgDailySpending > 0 ? currentBalance / avgDailySpending : 999;
        
        if (daysUntilEmpty < 30) {
            const emoji = daysUntilEmpty < 7 ? '⚠️' : daysUntilEmpty < 14 ? '⏰' : '📅';
            const urgency = daysUntilEmpty < 7 ? 'Alert: ' : '';
            insights.push(generateInsight('budget_pace', {
                icon: emoji,
                text: `${urgency}At this rate, funds last ~${Math.floor(daysUntilEmpty)} days.`
            }, daysUntilEmpty < 7 ? 10 : 8));
        }
    }
    
    // 3. Category Breakdown (if enough variety)
    const categorySpending = {};
    purchases.forEach(p => {
        p.items.forEach(item => {
            const category = item.category || 'Other';
            categorySpending[category] = (categorySpending[category] || 0) + (item.price * item.quantity);
        });
    });
    
    const categories = Object.entries(categorySpending);
    if (categories.length >= 2) {
        const topCategory = categories.reduce((max, curr) => curr[1] > max[1] ? curr : max);
        const categoryAmount = formatBalanceValue(topCategory[1], balanceInfo);
        const categoryEmoji = {
            'Coffee': '☕',
            'Food': '🍔',
            'Drinks': '🥤',
            'Snacks': '🍿',
            'Other': '📦'
        }[topCategory[0]] || '🛍️';
        
        // More natural language for category spending
        let message;
        const percentage = (topCategory[1] / totalSpent) * 100;
        if (percentage > 70) {
            message = `${topCategory[0]} addiction? You've spent ${categoryAmount} there!`;
        } else if (percentage > 50) {
            message = `Most of your money (${categoryAmount}) goes to ${topCategory[0]}.`;
        } else {
            message = `${topCategory[0]} is your top category at ${categoryAmount}.`;
        }
        
        insights.push(generateInsight('category', {
            icon: categoryEmoji,
            text: message
        }, 6));
    }
    
    // 4. Store Frequency Insight
    const storeVisits = {};
    purchases.forEach(p => {
        storeVisits[p.store] = (storeVisits[p.store] || 0) + 1;
    });
    
    const storeArray = Object.entries(storeVisits);
    if (storeArray.length > 0) {
        const favoriteStore = storeArray.reduce((max, curr) => curr[1] > max[1] ? curr : max);
        if (favoriteStore[1] >= 3) {
            insights.push(generateInsight('store', {
                icon: '🏪',
                text: `You're a regular at ${favoriteStore[0]} (${favoriteStore[1]} visits).`
            }, 5));
        }
    }
    
    // 5. Expensive Day Alert
    const dailySpending = {};
    purchases.forEach(p => {
        const day = p.purchaseDate.toISOString().split('T')[0];
        dailySpending[day] = (dailySpending[day] || 0) + p.total;
    });
    
    const dailyValues = Object.values(dailySpending);
    if (dailyValues.length >= 3) {
        const avgDaily = dailyValues.reduce((sum, val) => sum + val, 0) / dailyValues.length;
        const maxDaily = Math.max(...dailyValues);
        if (maxDaily > avgDaily * 2) {
            const bigSpendDay = Object.entries(dailySpending).find(([day, amount]) => amount === maxDaily);
            const dayDate = new Date(bigSpendDay[0]);
            const daysAgo = Math.floor((now - dayDate) / (1000 * 60 * 60 * 24));
            const when = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
            
            insights.push(generateInsight('spike', {
                icon: '💰',
                text: `${when} was a big spend day (${formatBalanceValue(maxDaily, balanceInfo)}).`
            }, daysAgo <= 1 ? 8 : 4));
        }
    }
    
    // 6. Time Pattern Insight
    const hourCounts = new Array(24).fill(0);
    purchases.forEach(p => {
        const hour = p.purchaseDate.getHours();
        hourCounts[hour]++;
    });
    
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    if (Math.max(...hourCounts) >= 3) {
        let timeDescription;
        let timeEmoji;
        if (peakHour >= 5 && peakHour < 12) {
            timeDescription = 'morning person';
            timeEmoji = '☀️';
        } else if (peakHour >= 12 && peakHour < 17) {
            timeDescription = 'lunch regular';
            timeEmoji = '🌤️';
        } else if (peakHour >= 17 && peakHour < 21) {
            timeDescription = 'dinner crowd';
            timeEmoji = '🌆';
        } else {
            timeDescription = 'night owl';
            timeEmoji = '🌙';
        }
        
        insights.push(generateInsight('time_pattern', {
            icon: timeEmoji,
            text: `You're a ${timeDescription} - most active around ${peakHour > 12 ? peakHour - 12 : peakHour}${peakHour >= 12 ? 'pm' : 'am'}.`
        }, 4));
    }
    
    // 7. Streak Detection
    const purchaseDates = purchases.map(p => p.purchaseDate.toDateString());
    const uniqueDates = [...new Set(purchaseDates)];
    
    // Check for no-spend streaks
    if (uniqueDates.length > 0) {
        const sortedDates = uniqueDates.map(d => new Date(d)).sort((a, b) => a - b);
        let maxGap = 0;
        let gapStart = null;
        
        for (let i = 1; i < sortedDates.length; i++) {
            const gap = Math.floor((sortedDates[i] - sortedDates[i-1]) / (1000 * 60 * 60 * 24));
            if (gap > maxGap) {
                maxGap = gap;
                gapStart = sortedDates[i-1];
            }
        }
        
        if (maxGap >= 3) {
            insights.push(generateInsight('streak', {
                icon: '🎯',
                text: `Longest no-spend streak: ${maxGap} days!`
            }, 5));
        }
    }
    
    // 8. Smart Shopping Pattern
    const weekdayPurchases = purchases.filter(p => {
        const day = p.purchaseDate.getDay();
        return day >= 1 && day <= 5;
    });
    const weekendPurchases = purchases.filter(p => {
        const day = p.purchaseDate.getDay();
        return day === 0 || day === 6;
    });
    
    if (weekdayPurchases.length > 3 && weekendPurchases.length > 3) {
        const avgWeekday = weekdayPurchases.reduce((sum, p) => sum + p.total, 0) / weekdayPurchases.length;
        const avgWeekend = weekendPurchases.reduce((sum, p) => sum + p.total, 0) / weekendPurchases.length;
        const difference = avgWeekend - avgWeekday;
        
        if (Math.abs(difference) > 2) {
            let message;
            let emoji;
            
            if (difference > 0) {
                const extra = formatBalanceValue(difference, balanceInfo);
                if (avgWeekend > avgWeekday * 2) {
                    message = `Weekends hit different - spending doubles! (${extra} more per purchase)`;
                    emoji = '🎉';
                } else {
                    message = `Weekend vibes cost ${extra} more per purchase.`;
                    emoji = '🎊';
                }
            } else {
                const savings = formatBalanceValue(Math.abs(difference), balanceInfo);
                message = `Weekday warrior - saving ${savings} per purchase vs weekends.`;
                emoji = '💼';
            }
            
            insights.push(generateInsight('weekend', {
                icon: emoji,
                text: message
            }, 5));
        }
    }
    
    // 9. Item Loyalty
    const itemCounts = {};
    allItems.forEach(item => {
        itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
    });
    
    const itemArray = Object.entries(itemCounts);
    if (itemArray.length > 0) {
        const favoriteItem = itemArray.reduce((max, curr) => curr[1] > max[1] ? curr : max);
        if (favoriteItem[1] >= 5) {
            insights.push(generateInsight('loyalty', {
                icon: '❤️',
                text: `True love: ${favoriteItem[0]} (${favoriteItem[1]}x ordered).`
            }, 4));
        }
    }
    
    // 10. Recent Activity
    const daysSinceLastPurchase = Math.floor((now - purchases[0].purchaseDate) / (1000 * 60 * 60 * 24));
    if (daysSinceLastPurchase >= 3) {
        insights.push(generateInsight('activity', {
            icon: '📍',
            text: `${daysSinceLastPurchase} days since last purchase - saving mode?`
        }, 3));
    }
    
    // 11. Peer Comparison (for Denison students)
    const peerInsight = generatePeerComparisonInsight(purchases, balanceInfo);
    if (peerInsight) {
        insights.push(peerInsight);
    }
    
    return insights;
}

function renderInsights(purchases) {
    if (!insightsList) return;
    insightsList.innerHTML = '';

    // Filter purchases for the selected balance type
    const filteredPurchases = purchases.filter(p => 
        !p.balanceType || p.balanceType === selectedBalanceType
    );

    const balanceInfo = userBalanceTypes.find(bt => bt.id === selectedBalanceType);

    if (filteredPurchases.length === 0) {
        insightsList.innerHTML = `
            <div class="data-gate">
                <div class="data-gate-icon">💡</div>
                <div class="data-gate-title">Unlock Insights</div>
                <div class="data-gate-text">
                    Start logging ${balanceInfo ? balanceInfo.label : 'purchases'} to discover your spending habits.
                </div>
            </div>
        `;
        return;
    }

    // Generate all possible insights
    const insights = calculateInsightData(filteredPurchases, balanceInfo);
    
    // Sort by priority (higher = more important)
    insights.sort((a, b) => b.priority - a.priority);
    
    // Take top 4 insights (or less if not enough data)
    const topInsights = insights.slice(0, 4);
    
    // Render insights
    if (topInsights.length > 0) {
        topInsights.forEach(insight => {
            const insightElement = document.createElement('li');
            insightElement.className = 'insight-item';
            insightElement.innerHTML = `
                <span class="insight-icon">${insight.icon}</span>
                <span class="insight-text">${insight.text}</span>
            `;
            insightsList.appendChild(insightElement);
        });
    } else {
        // Fallback to basic insight if no smart insights available
        const basicInsight = document.createElement('li');
        basicInsight.className = 'insight-item';
        const spentText = balanceInfo && balanceInfo.type === 'count' ? 'used' : 'spent';
        basicInsight.innerHTML = `
            <span class="insight-icon">📊</span>
            <span class="insight-text">Keep logging to unlock personalized insights!</span>
        `;
        insightsList.appendChild(basicInsight);
    }
}

// Denison semester configuration
function getDenisonSemesterInfo(date) {
    const year = date.getFullYear();
    
    // Dynamic year calculation for breaks and finals
    const academicYear = date.getMonth() >= 8 ? year : year - 1; // Aug-Dec uses current year, Jan-July uses previous
    const springYear = academicYear + 1;
    
    // Define semester periods with dynamic years
    const semesters = {
        fall: {
            start: new Date(academicYear, 7, 20), // Aug 20
            end: new Date(academicYear, 11, 18), // Dec 18
            finals: {
                start: new Date(academicYear, 11, 14), // Dec 14
                end: new Date(academicYear, 11, 18) // Dec 18
            },
            breaks: [
                {
                    name: 'Fall Break',
                    start: new Date(academicYear, 9, 16), // Oct 16
                    end: new Date(academicYear, 9, 20) // Oct 20
                },
                {
                    name: 'Thanksgiving',
                    start: new Date(academicYear, 10, 27), // Nov 27
                    end: new Date(academicYear, 10, 30) // Nov 30
                }
            ]
        },
        spring: {
            start: new Date(springYear, 0, 19), // Jan 19
            end: new Date(springYear, 4, 12), // May 12
            finals: {
                start: new Date(springYear, 4, 6), // May 6
                end: new Date(springYear, 4, 12) // May 12
            },
            breaks: [
                {
                    name: 'Spring Break',
                    start: new Date(springYear, 2, 16), // March 16
                    end: new Date(springYear, 2, 22) // March 22
                }
            ]
        },
        winter: {
            name: 'Winter Break',
            start: new Date(academicYear, 11, 19), // Dec 19
            end: new Date(springYear, 0, 18) // Jan 18
        }
    };
    
    // Determine current semester and period
    let currentSemester = null;
    let currentPeriod = 'off-campus';
    let daysUntilSemesterEnd = null;
    let upcomingBreak = null;
    let isFinalsWeek = false;
    let semesterProgress = 0;
    
    // Check if in Fall semester
    if (date >= semesters.fall.start && date <= semesters.fall.end) {
        currentSemester = 'fall';
        daysUntilSemesterEnd = Math.ceil((semesters.fall.end - date) / (1000 * 60 * 60 * 24));
        
        // Check if in finals
        if (date >= semesters.fall.finals.start && date <= semesters.fall.finals.end) {
            currentPeriod = 'finals';
            isFinalsWeek = true;
        } else {
            currentPeriod = 'active';
            // Check for breaks
            for (const breakPeriod of semesters.fall.breaks) {
                if (date >= breakPeriod.start && date <= breakPeriod.end) {
                    currentPeriod = 'break';
                    break;
                } else if (date < breakPeriod.start) {
                    const daysUntil = Math.ceil((breakPeriod.start - date) / (1000 * 60 * 60 * 24));
                    if (!upcomingBreak || daysUntil < upcomingBreak.daysUntil) {
                        upcomingBreak = { name: breakPeriod.name, daysUntil, ...breakPeriod };
                    }
                }
            }
            // Check for upcoming finals
            if (!upcomingBreak && date < semesters.fall.finals.start) {
                const daysUntil = Math.ceil((semesters.fall.finals.start - date) / (1000 * 60 * 60 * 24));
                upcomingBreak = { name: 'Finals Week', daysUntil, start: semesters.fall.finals.start };
            }
        }
        
        const totalDays = Math.ceil((semesters.fall.end - semesters.fall.start) / (1000 * 60 * 60 * 24));
        const daysElapsed = Math.ceil((date - semesters.fall.start) / (1000 * 60 * 60 * 24));
        semesterProgress = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
    }
    // Check if in Spring semester
    else if (date >= semesters.spring.start && date <= semesters.spring.end) {
        currentSemester = 'spring';
        daysUntilSemesterEnd = Math.ceil((semesters.spring.end - date) / (1000 * 60 * 60 * 24));
        
        // Check if in finals
        if (date >= semesters.spring.finals.start && date <= semesters.spring.finals.end) {
            currentPeriod = 'finals';
            isFinalsWeek = true;
        } else {
            currentPeriod = 'active';
            // Check for breaks
            for (const breakPeriod of semesters.spring.breaks) {
                if (date >= breakPeriod.start && date <= breakPeriod.end) {
                    currentPeriod = 'break';
                    break;
                } else if (date < breakPeriod.start) {
                    const daysUntil = Math.ceil((breakPeriod.start - date) / (1000 * 60 * 60 * 24));
                    if (!upcomingBreak || daysUntil < upcomingBreak.daysUntil) {
                        upcomingBreak = { name: breakPeriod.name, daysUntil, ...breakPeriod };
                    }
                }
            }
            // Check for upcoming finals
            if (!upcomingBreak && date < semesters.spring.finals.start) {
                const daysUntil = Math.ceil((semesters.spring.finals.start - date) / (1000 * 60 * 60 * 24));
                upcomingBreak = { name: 'Finals Week', daysUntil, start: semesters.spring.finals.start };
            }
        }
        
        const totalDays = Math.ceil((semesters.spring.end - semesters.spring.start) / (1000 * 60 * 60 * 24));
        const daysElapsed = Math.ceil((date - semesters.spring.start) / (1000 * 60 * 60 * 24));
        semesterProgress = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
    }
    // Check if in Winter break
    else if ((date >= semesters.winter.start && date.getFullYear() === academicYear) || 
             (date <= semesters.winter.end && date.getFullYear() === springYear)) {
        currentPeriod = 'winter-break';
        // Calculate days until spring semester
        daysUntilSemesterEnd = Math.ceil((semesters.spring.start - date) / (1000 * 60 * 60 * 24));
    }
    // Summer or other periods
    else {
        currentPeriod = 'summer';
    }
    
    return {
        currentSemester,
        currentPeriod,
        daysUntilSemesterEnd,
        upcomingBreak,
        isFinalsWeek,
        semesterProgress,
        semesters,
        academicYear
    };
}

// Calculate active spending days (excluding breaks)
function calculateActiveSpendingDays(startDate, endDate, semesterInfo) {
    let activeDays = 0;
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
        const dayOfWeek = current.getDay();
        let isActiveDay = true;
        
        // Check if it's during winter break
        if ((current >= semesterInfo.semesters.winter.start && current.getFullYear() === semesterInfo.academicYear) ||
            (current <= semesterInfo.semesters.winter.end && current.getFullYear() === semesterInfo.academicYear + 1)) {
            isActiveDay = false;
        }
        
        // Check fall breaks
        if (isActiveDay && semesterInfo.semesters.fall.breaks) {
            for (const breakPeriod of semesterInfo.semesters.fall.breaks) {
                if (current >= breakPeriod.start && current <= breakPeriod.end) {
                    isActiveDay = false;
                    break;
                }
            }
        }
        
        // Check spring breaks
        if (isActiveDay && semesterInfo.semesters.spring.breaks) {
            for (const breakPeriod of semesterInfo.semesters.spring.breaks) {
                if (current >= breakPeriod.start && current <= breakPeriod.end) {
                    isActiveDay = false;
                    break;
                }
            }
        }
        
        if (isActiveDay) {
            activeDays++;
        }
        
        current.setDate(current.getDate() + 1);
    }
    
    return activeDays;
}

// Helper: compute quantile (q in [0,1]) from a numeric array (no deps)
function quantile(arr, q) {
    if (!arr || arr.length === 0) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const pos = (a.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (a[base + 1] !== undefined) {
        return a[base] + rest * (a[base + 1] - a[base]);
    }
    return a[base];
}

// Helper: winsorize values between low/high quantiles (clamp outliers)
function winsorize(values, lowQ = 0.1, highQ = 0.9) {
    if (!values || values.length === 0) return [];
    const lo = quantile(values, lowQ);
    const hi = quantile(values, highQ);
    return values.map(v => Math.min(hi, Math.max(lo, v)));
}

// Helper: simple EMA for recency emphasis (alpha 0..1)
function ema(values, alpha) {
    if (!values || values.length === 0) return 0;
    let s = values[0];
    for (let i = 1; i < values.length; i++) {
        s = alpha * values[i] + (1 - alpha) * s;
    }
    return s;
}

// Smart prediction algorithm with robust stats, confidence bands, and semester awareness
function calculateSmartProjection(purchases, currentBalance, userData) {
    const now = new Date();
    
    // Group purchases by date and calculate daily spending
    const dailySpending = {};
    purchases.forEach(p => {
        const dateKey = p.purchaseDate.toISOString().split('T')[0];
        dailySpending[dateKey] = (dailySpending[dateKey] || 0) + p.total;
    });
    
    const spendingDays = Object.keys(dailySpending).sort(); // yyyy-mm-dd ascending
    const dayCount = spendingDays.length;
    
    // Get all spending values for statistical analysis
    // Limit the window to the most recent 45 spending days to keep stats relevant
    const allValuesChrono = spendingDays.map(d => dailySpending[d]);
    const spendingValues = allValuesChrono.slice(-45);
    
    // Calculate basic statistics
    const totalSpent = spendingValues.reduce((sum, val) => sum + val, 0);
    const simpleAverage = dayCount > 0 ? totalSpent / dayCount : 0;
    
    // Robust central tendency: median + winsorized mean; Recency via EMA
    const p50 = quantile(spendingValues, 0.5);
    const p20 = quantile(spendingValues, 0.2);
    const p80 = quantile(spendingValues, 0.8);
    const wins = winsorize(spendingValues, 0.1, 0.9);
    const winsMean = wins.length ? wins.reduce((s, v) => s + v, 0) / wins.length : simpleAverage;
    const alpha = 2 / Math.max(spendingValues.length + 1, 2); // classic EMA alpha
    const emaRecent = ema(spendingValues, alpha);
    const robustAverage = (p50 * 0.6) + (winsMean * 0.2) + (emaRecent * 0.2);
    
    // Analyze day-of-week patterns
    const weekdaySpending = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    purchases.forEach(p => {
        const dayOfWeek = p.purchaseDate.getDay();
        weekdaySpending[dayOfWeek].push(p.total);
    });
    
    // Calculate average spending per weekday
    const weekdayAverages = {};
    let hasWeekdayPattern = false;
    for (let day = 0; day < 7; day++) {
        const arr = weekdaySpending[day];
        if (arr.length >= 3) {
            // Use median for robustness per weekday
            const wMed = quantile(arr, 0.5);
            weekdayAverages[day] = wMed;
            hasWeekdayPattern = true;
        } else if (arr.length > 0) {
            // fallback to trimmed mean
            const tri = winsorize(arr, 0.2, 0.8);
            weekdayAverages[day] = tri.reduce((s, v) => s + v, 0) / tri.length;
        } else {
            weekdayAverages[day] = robustAverage || simpleAverage;
        }
    }
    
    // Derive band factors from quantiles; guard for zeros
    const upperFactor = (p50 > 0 && p80 > 0) ? Math.max(1.05, p80 / p50) : 1.25;
    const lowerFactor = (p50 > 0 && p20 > 0) ? Math.max(0.4, Math.min(0.95, p20 / p50)) : 0.75;
    
    // Determine projection method based on data quality
    let projectionMethod;
    let dailyBurnRate;
    let confidence;
    
    // Determine projection method based on data quality
    if (dayCount < 3) {
        // Very limited data - use conservative estimate
        dailyBurnRate = Math.min(robustAverage || simpleAverage, currentBalance / 120);
        projectionMethod = "conservative";
        confidence = "low";
    } else if (dayCount < 7) {
        // Limited data - blend simple and weighted averages
        dailyBurnRate = (robustAverage * 0.6) + (simpleAverage * 0.4);
        projectionMethod = "robust-blend";
        confidence = "medium";
    } else if (hasWeekdayPattern && dayCount >= 14) {
        // Good data with patterns - use day-of-week based projection
        projectionMethod = "pattern-based";
        confidence = "high";
        // Will calculate per-day in the projection loop
    } else {
        // Moderate data - use weighted average with outlier adjustment
        dailyBurnRate = robustAverage;
        projectionMethod = "robust";
        confidence = "medium-high";
    }
    
    // For Denison students, apply ADVANCED semester awareness
    let semesterInfo = null;
    let spendingMultipliers = {};
    
    if (userData.isDenisonStudent) {
        semesterInfo = getDenisonSemesterInfo(now);
        
        // Set spending multipliers based on semester patterns
        spendingMultipliers = {
            'pre-break': 1.3,      // Students spend more before breaks
            'post-break': 1.15,    // Slightly elevated after returning
            'finals': 1.4,         // Coffee and late-night food spike
            'early-semester': 1.2, // First 2 weeks higher spending
            'mid-semester': 1.0,   // Normal baseline
            'late-semester': 0.9,  // Students start conserving
            'break': 0,            // No spending during breaks
        };
        
        // If we have semester info and are in an active period
        if (semesterInfo.currentSemester && semesterInfo.daysUntilSemesterEnd) {
            // Calculate how many active days remain (excluding breaks)
            const semesterEndDate = semesterInfo.currentSemester === 'fall' 
                ? semesterInfo.semesters.fall.end 
                : semesterInfo.semesters.spring.end;
            
            const activeRemainingDays = calculateActiveSpendingDays(now, semesterEndDate, semesterInfo);
            
            // Adjust burn rate to make money last the semester
            const targetDailyBurn = currentBalance / Math.max(activeRemainingDays, 1);
            
            // Blend current burn rate with target
        if (dailyBurnRate) {
                // If burning too fast, apply stronger correction
                if (dailyBurnRate > targetDailyBurn * 1.5) {
                    dailyBurnRate = targetDailyBurn * 1.1; // Allow 10% overage
                    projectionMethod += " (semester-adjusted)";
                } else if (dailyBurnRate > targetDailyBurn * 1.2) {
            dailyBurnRate = (dailyBurnRate * 0.6 + targetDailyBurn * 0.4);
                    projectionMethod += " (semester-balanced)";
                }
            }
            
            // Add semester context to confidence
            if (semesterInfo.semesterProgress > 70) {
                confidence = confidence === "high" ? "high" : "medium-high";
            }
        }
    }
    
    // Horizon guardrails for thin data
    const horizonDays = dayCount <= 4 ? 21 : 180;

    return {
        dailyBurnRate,
        weekdayAverages,
        projectionMethod,
        confidence,
        hasWeekdayPattern: hasWeekdayPattern && dayCount >= 14,
        semesterInfo,
        spendingMultipliers,
        band: { lowerFactor, upperFactor },
        horizonDays
    };
}

// Rewrote this function to be more robust
function renderChart(userData, purchases) {
    const chartCard = document.querySelector('.chart-card');
    if (!chartCard) return;
    
    const chartContainer = chartCard.querySelector('.chart-container');
    if (!chartContainer) return;

    // Always destroy the old chart instance to prevent memory leaks
    if (spendingChart) {
        spendingChart.destroy();
        spendingChart = null;
    }
    
    // Clear the container to ensure a clean slate
    chartContainer.innerHTML = '';

    const balanceInfo = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
    if (!balanceInfo) {
        chartContainer.innerHTML = '<p style="text-align:center; padding: 2rem;">No balance type selected.</p>';
        return;
    }
    
    // The tooltip button is now always visible, so we don't need to hide/show it here.
    
    // Check the pre-calculated unlocked status
    if (!unlockedForecasts[selectedBalanceType]) {
        const filteredPurchases = purchases.filter(p => !p.balanceType || p.balanceType === selectedBalanceType);
        const spendingByDay = {};
        filteredPurchases.forEach(p => {
            const day = p.purchaseDate.toISOString().split('T')[0];
            spendingByDay[day] = true;
        });
        const uniqueSpendingDays = Object.keys(spendingByDay).length;
        const daysNeeded = 3 - uniqueSpendingDays;
        
        chartContainer.innerHTML = `
            <div class="data-gate">
                <div class="data-gate-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>
                </div>
                <div class="data-gate-title">Unlock Your Forecast</div>
                <div class="data-gate-text">
                    Log ${balanceInfo.label} usage for <strong>${daysNeeded} more day${daysNeeded > 1 ? 's' : ''}</strong> to see your projection. The more you log, the smarter it gets!
                </div>
            </div>
        `;
        return;
    }
    
    // Add the canvas back to the container
    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'spending-chart';
    chartContainer.appendChild(newCanvas);
    spendingChartCanvas = newCanvas;

    // --- Start Chart Rendering Logic ---
    const currentBalance = userData.balances?.[selectedBalanceType] || 0;
    const filteredPurchases = purchases.filter(p => !p.balanceType || p.balanceType === selectedBalanceType);
    
    const projection = calculateSmartProjection(filteredPurchases, currentBalance, userData);
    
    const spendingByDay = {};
    filteredPurchases.forEach(p => {
        const day = p.purchaseDate.toISOString().split('T')[0];
        spendingByDay[day] = (spendingByDay[day] || 0) + p.total;
    });
    const uniqueSpendingDays = Object.keys(spendingByDay).sort();
    
    const totalSpent = filteredPurchases.reduce((sum, p) => sum + p.total, 0);
    let runningBalance = currentBalance + totalSpent;
    
    const labels = [];
    const actualData = [];

    uniqueSpendingDays.forEach(day => {
        runningBalance -= spendingByDay[day];
        labels.push(day);
        actualData.push(runningBalance);
    });

    const lastActualBalance = actualData.length > 0 ? actualData[actualData.length - 1] : currentBalance;
    const lastActualDate = uniqueSpendingDays.length > 0 ? new Date(uniqueSpendingDays[uniqueSpendingDays.length - 1]) : new Date();

    const projectionData = new Array(actualData.length - 1).fill(null);
    projectionData.push(lastActualBalance);

    let projectedBalance = lastActualBalance;
    let projectedBalanceUpper = lastActualBalance;
    let projectedBalanceLower = lastActualBalance;
    let dayCounter = 1;
    let zeroDate = null;
    let semesterEndWarning = null;
    const maxProjectionDays = projection.horizonDays || 180;

    // Confidence band arrays (align with labels)
    const upperProjectionData = new Array(actualData.length - 1).fill(null);
    upperProjectionData.push(lastActualBalance);
    const lowerProjectionData = new Array(actualData.length - 1).fill(null);
    lowerProjectionData.push(lastActualBalance);
    
    // Enhanced projection loop for Denison students
    while (projectedBalance > 0 && dayCounter <= maxProjectionDays) {
        const projectionDate = new Date(lastActualDate);
        projectionDate.setDate(lastActualDate.getDate() + dayCounter);
        labels.push(projectionDate.toISOString().split('T')[0]);
        
    let dailyBurn = projection.hasWeekdayPattern 
            ? projection.weekdayAverages[projectionDate.getDay()] 
            : projection.dailyBurnRate;
    let dailyUpper = dailyBurn * (projection.band?.upperFactor || 1.25);
    let dailyLower = dailyBurn * (projection.band?.lowerFactor || 0.75);
        
        // Apply semester-aware spending for Denison students
        if (userData.isDenisonStudent && projection.semesterInfo) {
            const dateInfo = getDenisonSemesterInfo(projectionDate);
            
            // Check if we're in a break period
            if (dateInfo.currentPeriod === 'break' || dateInfo.currentPeriod === 'winter-break' || 
                dateInfo.currentPeriod === 'summer' || dateInfo.currentPeriod === 'off-campus') {
        dailyBurn = 0; // No spending during breaks
        dailyUpper = 0;
        dailyLower = 0;
            } else if (dateInfo.isFinalsWeek) {
        const mult = projection.spendingMultipliers['finals'] || 1.4;
        dailyBurn *= mult; dailyUpper *= mult; dailyLower *= mult;
            } else if (dateInfo.upcomingBreak && dateInfo.upcomingBreak.daysUntil <= 3) {
        const mult = projection.spendingMultipliers['pre-break'] || 1.3;
        dailyBurn *= mult; dailyUpper *= mult; dailyLower *= mult;
            } else if (dateInfo.semesterProgress < 15) {
        const mult = projection.spendingMultipliers['early-semester'] || 1.2;
        dailyBurn *= mult; dailyUpper *= mult; dailyLower *= mult;
            } else if (dateInfo.semesterProgress > 80) {
        const mult = projection.spendingMultipliers['late-semester'] || 0.9;
        dailyBurn *= mult; dailyUpper *= mult; dailyLower *= mult;
            }
            
            // Check if balance runs out before semester end
            if (!semesterEndWarning && projectedBalance > 0 && projectedBalance - dailyBurn <= 0) {
                if (dateInfo.currentSemester && dateInfo.daysUntilSemesterEnd && dateInfo.daysUntilSemesterEnd > 7) {
                    const semEndDate = dateInfo.currentSemester === 'fall' 
                        ? dateInfo.semesters.fall.end 
                        : dateInfo.semesters.spring.end;
                    semesterEndWarning = {
                        date: projectionDate,
                        semesterEnd: semEndDate,
                        daysShort: Math.ceil((semEndDate - projectionDate) / (1000 * 60 * 60 * 24))
                    };
                }
            }
        }

        // Avoid confusing flat days: if pattern suggests ~0 spend (likely due to sparse weekday data),
        // blend with overall daily rate unless it's a real break/off-campus day
        if (dailyBurn < 0.01 && !(userData.isDenisonStudent && projection.semesterInfo)) {
            const base = projection.dailyBurnRate || 0;
            const blended = base * 0.7 + dailyBurn * 0.3;
            dailyUpper = blended * (projection.band?.upperFactor || 1.25);
            dailyLower = blended * (projection.band?.lowerFactor || 0.75);
            dailyBurn = blended;
        }
        
    projectedBalance -= dailyBurn;
    projectedBalanceUpper -= dailyUpper;
    projectedBalanceLower -= dailyLower;
    projectionData.push(Math.max(0, projectedBalance));
    upperProjectionData.push(Math.max(0, projectedBalanceUpper));
    lowerProjectionData.push(Math.max(0, projectedBalanceLower));
        
        if (projectedBalance <= 0 && !zeroDate) {
            zeroDate = projectionDate;
        }
        dayCounter++;
    }

    // Generate smart title text based on semester context
    let titleText;
    const zeroValueDisplay = formatBalanceValue(0, balanceInfo);
    const confidenceEmoji = { 'low': '🔮', 'medium': '📊', 'medium-high': '📈', 'high': '🎯' }[projection.confidence];
    
    if (userData.isDenisonStudent && projection.semesterInfo) {
        const semInfo = projection.semesterInfo;
        
        if (semesterEndWarning) {
            titleText = `⚠️ Running out ${semesterEndWarning.daysShort} days before semester ends!`;
        } else if (semInfo.currentPeriod === 'finals') {
            titleText = `${confidenceEmoji} Finals mode - expect higher spending this week`;
        } else if (semInfo.upcomingBreak && semInfo.upcomingBreak.daysUntil <= 7) {
            titleText = `${confidenceEmoji} ${semInfo.upcomingBreak.name} in ${semInfo.upcomingBreak.daysUntil} days`;
        } else if (semInfo.currentPeriod === 'winter-break' || semInfo.currentPeriod === 'break') {
            titleText = `${confidenceEmoji} On break - projections resume when semester starts`;
        } else if (semInfo.daysUntilSemesterEnd && semInfo.daysUntilSemesterEnd <= 30) {
            const runOutBeforeSem = zeroDate && zeroDate < (semInfo.currentSemester === 'fall' 
                ? semInfo.semesters.fall.end 
                : semInfo.semesters.spring.end);
            
            if (runOutBeforeSem) {
                titleText = `⚠️ Projected to run out before semester ends (${semInfo.daysUntilSemesterEnd} days left)`;
            } else {
                titleText = `${confidenceEmoji} On track to last the semester (${semInfo.daysUntilSemesterEnd} days)`;
            }
        } else {
            const zeroDateText = !zeroDate ? "past semester end" : zeroDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            titleText = `${confidenceEmoji} Projected to reach ${zeroValueDisplay} around ${zeroDateText}`;
        }
    } else {
        const zeroDateText = !zeroDate ? "more than 6 months" : zeroDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        titleText = `${confidenceEmoji} Projected to reach ${zeroValueDisplay} around ${zeroDateText}`;
    }

    spendingChart = new Chart(spendingChartCanvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Actual Balance',
                    data: actualData,
                    borderColor: '#4CAF50',
                    fill: false,
                    tension: 0.1,
                    borderWidth: 3,
                    pointRadius: 5,
                    pointBackgroundColor: '#4CAF50',
                },
                // Confidence band (P20–P80) as a shaded region
                {
                    label: 'Likely outcome range (best-case)',
                    data: lowerProjectionData,
                    borderColor: 'rgba(231, 76, 60, 0)',
                    backgroundColor: 'rgba(231, 76, 60, 0)',
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    borderWidth: 0,
                    // Hide from legend and tooltips
                    skipLegend: true,
                    _isBand: true,
                    tooltip: { enabled: false },
                },
                {
                    label: 'Likely outcome range',
                    data: upperProjectionData,
                    borderColor: 'rgba(231, 76, 60, 0.15)',
                    backgroundColor: 'rgba(231, 76, 60, 0.12)',
                    fill: '-1', // fill to previous dataset to create band
                    pointRadius: 0,
                    tension: 0.1,
                    borderWidth: 0,
                    _isBand: true,
                    // Keep a single legend entry; tooltips off for the band
                    tooltip: { enabled: false },
                },
                {
                    label: `Projected (${projection.projectionMethod})`,
                    data: projectionData,
                    borderColor: '#E74C3C',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    // Do not fill to origin; the band conveys uncertainty
                    fill: false,
                    borderDash: projection.confidence === 'high' ? [0, 0] : [5, 5],
                    borderWidth: 3,
                    tension: 0.1,
                    pointRadius: (context) => {
                        const index = context.dataIndex;
                        const actualDataLength = actualData.length;
                        if (index === actualDataLength - 1) return 5;
                        if (index >= actualDataLength) {
                            const projectionIndex = index - actualDataLength + 1;
                            if (projectionIndex % 7 === 0 || context.raw === 0) return 5;
                        }
                        return 0;
                    },
                    pointStyle: 'rectRot',
                    pointBackgroundColor: '#E74C3C',
                    pointHoverRadius: 6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: [titleText, 'Shaded band shows where your balance is most likely to land.'], font: { size: 16, family: "'Patrick Hand', cursive" }, color: 'var(--text-primary)', padding: { bottom: 15 } },
                legend: { 
                    display: true, 
                    position: 'bottom',
                    labels: {
                        filter: (legendItem, chartData) => {
                            const ds = chartData?.datasets?.[legendItem.datasetIndex];
                            return !(ds && ds.skipLegend);
                        }
                    }
                },
                tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${formatBalanceValue(Number(context.raw), balanceInfo)}` } }
            },
            scales: {
                x: { type: 'time', time: { unit: 'day', tooltipFormat: 'MMM d' }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { callback: (value) => formatBalanceValue(value, balanceInfo) } }
            }
        }
    });
}


// Tooltip functionality
function toggleProjectionTooltip() {
    const chartCard = document.querySelector('.chart-card');
    if (!chartCard) return;
    
    let tooltip = document.getElementById('projection-tooltip');
    
    if (tooltip) {
        tooltip.remove();
    } else {
        const tooltipHTML = `
            <div id="projection-tooltip" class="projection-tooltip">
                <div class="tooltip-paper">
                    <div class="tooltip-tape"></div>
                    <button class="tooltip-close">&times;</button>
                    <h3 class="tooltip-title">🧠 How Your Smart Forecast Works</h3>
                    <div class="tooltip-content">
                        <div class="tooltip-section">
                            <div class="tooltip-icon">📅</div>
                            <div class="tooltip-text">
                                <strong>Learns Your Patterns</strong>
                                <p>I notice if you spend more on weekends vs weekdays!</p>
                            </div>
                        </div>
                        <div class="tooltip-section">
                            <div class="tooltip-icon">🎯</div>
                            <div class="tooltip-text">
                                <strong>Gets Smarter Over Time</strong>
                                <p>The more you log, the better I predict. After 2 weeks, I'm super accurate!</p>
                            </div>
                        </div>
                        <div class="tooltip-section">
                            <div class="tooltip-icon">🚀</div>
                            <div class="tooltip-text">
                                <strong>Ignores One-Time Splurges</strong>
                                <p>That birthday dinner won't mess up your forecast!</p>
                            </div>
                        </div>
                        <div class="tooltip-section">
                            <div class="tooltip-icon">📚</div>
                            <div class="tooltip-text">
                                <strong>Semester Smart</strong>
                                <p>Designed to help your money last the whole semester!</p>
                            </div>
                        </div>
                        <div class="tooltip-cta">
                            <p>💡 <strong>Pro tip:</strong> Log daily for a week to unlock the most accurate predictions!</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        chartCard.insertAdjacentHTML('beforeend', tooltipHTML);
            
        const closeBtn = document.querySelector('.tooltip-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                document.getElementById('projection-tooltip').remove();
            });
        }
        
        setTimeout(() => {
            document.addEventListener('click', function closeTooltipOnClickOutside(e) {
                const tooltip = document.getElementById('projection-tooltip');
                const infoButton = document.getElementById('projection-info-button');
                if (tooltip && !tooltip.contains(e.target) && e.target !== infoButton && !infoButton.contains(e.target)) {
                    tooltip.remove();
                    document.removeEventListener('click', closeTooltipOnClickOutside);
                }
            });
        }, 0);
    }
}

// --- NEW FEATURE FUNCTIONS ---

// Initialize view toggle for forecast/heatmap
function initializeViewToggle(userData, purchaseHistory) {
    const viewButtons = document.querySelectorAll('.view-toggle-btn');
    const forecastView = document.getElementById('forecast-view');
    const heatmapView = document.getElementById('heatmap-view');
    const whatIfControls = document.getElementById('what-if-controls');
    const whatIfToggle = document.getElementById('what-if-toggle');
    
    if (!viewButtons.length || !forecastView || !heatmapView) return;
    
    viewButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            
            // Update button states
            viewButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Toggle views
            if (view === 'forecast') {
                forecastView.classList.remove('hidden');
                heatmapView.classList.add('hidden');
                // Show what-if controls if they were visible before
                if (whatIfControls && !whatIfControls.classList.contains('hidden')) {
                    whatIfControls.style.display = 'block';
                }
            } else if (view === 'heatmap') {
                forecastView.classList.add('hidden');
                heatmapView.classList.remove('hidden');
                renderHeatmap(purchaseHistory);
                // Hide what-if controls when in heatmap view
                if (whatIfControls) {
                    whatIfControls.style.display = 'none';
                    // Reset what-if if it was active
                    if (whatIfToggle && whatIfToggle.classList.contains('active')) {
                        whatIfToggle.click(); // Disable it
                    }
                }
            }
        });
    });
    
    // Initialize heatmap period buttons
    const periodButtons = document.querySelectorAll('.period-btn');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderHeatmap(purchaseHistory);
        });
    });
}

// Render spending heatmap
function renderHeatmap(purchases) {
    const heatmapContainer = document.getElementById('spending-heatmap');
    if (!heatmapContainer) return;

    // Track currently active cell and last show time to prevent instant hide on mobile
    let activeHeatmapCell = null;
    let lastHeatmapShowTs = 0;
    
    // Get selected period
    const activePeriodBtn = document.querySelector('.period-btn.active');
    const days = parseInt(activePeriodBtn?.dataset.days || 30);
    
    // Filter purchases for selected balance type
    const filteredPurchases = purchases.filter(p => 
        !p.balanceType || p.balanceType === selectedBalanceType
    );
    
    // Calculate daily spending
    const dailySpending = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    filteredPurchases.forEach(p => {
        const date = new Date(p.purchaseDate);
        date.setHours(0, 0, 0, 0);
        const dateKey = date.toISOString().split('T')[0];
        dailySpending[dateKey] = (dailySpending[dateKey] || 0) + p.total;
    });
    
    // Find max spending for color scaling
    const spendingValues = Object.values(dailySpending);
    const maxSpending = Math.max(...spendingValues, 1);
    
    // Generate calendar grid
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);
    
    // Clear container
    heatmapContainer.innerHTML = '';
    
    // Add day labels
    const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const labelRow = document.createElement('div');
    labelRow.className = 'heatmap-day-labels';
    dayLabels.forEach(label => {
        const dayLabel = document.createElement('div');
        dayLabel.className = 'heatmap-day-label';
        dayLabel.textContent = label;
        labelRow.appendChild(dayLabel);
    });
    heatmapContainer.appendChild(labelRow);
    
    // Create weeks container
    const weeksContainer = document.createElement('div');
    weeksContainer.className = 'heatmap-weeks';
    
    // Generate calendar cells
    const currentDate = new Date(startDate);
    let currentWeek = document.createElement('div');
    currentWeek.className = 'heatmap-week';
    
    // Add empty cells for first week
    const firstDayOfWeek = startDate.getDay();
    for (let i = 0; i < firstDayOfWeek; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'heatmap-cell empty';
        currentWeek.appendChild(emptyCell);
    }
    
    while (currentDate <= today) {
        const dateKey = currentDate.toISOString().split('T')[0];
        const spending = dailySpending[dateKey] || 0;
        const intensity = spending / maxSpending;
        
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.dataset.date = dateKey;
        cell.dataset.spending = spending.toFixed(2);
        
        // Set color based on intensity
        if (spending === 0) {
            cell.classList.add('no-spend');
        } else if (intensity < 0.25) {
            cell.classList.add('low-spend');
        } else if (intensity < 0.5) {
            cell.classList.add('med-spend');
        } else if (intensity < 0.75) {
            cell.classList.add('high-spend');
        } else {
            cell.classList.add('max-spend');
        }
        
        // Add tooltip on hover
        // Desktop hover (only on devices that support hover)
        const hasHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
        if (hasHover) {
            cell.addEventListener('mouseenter', (e) => showHeatmapTooltip(e, dateKey, spending));
            cell.addEventListener('mouseleave', hideHeatmapTooltip);
        }

        // Mobile/touch-friendly: show on tap/click
        // Prefer Pointer Events where supported
        const preferPointer = 'onpointerup' in window;
        if (preferPointer) {
            cell.addEventListener('pointerup', (e) => {
                // Only handle direct taps/clicks; ignore mouseup from drag
                if (e.pointerType === 'touch' || e.pointerType === 'pen' || e.pointerType === 'mouse') {
                    e.stopPropagation();
                    // Toggle behavior: if tapping same cell shortly after, hide instead
                    const targetCell = e.currentTarget || e.target.closest('.heatmap-cell');
                    const now = performance.now();
                    if (activeHeatmapCell === targetCell && now - lastHeatmapShowTs < 600) {
                        hideHeatmapTooltip();
                        activeHeatmapCell = null;
                        return;
                    }
                    showHeatmapTooltip(e, dateKey, spending);
                    activeHeatmapCell = targetCell;
                    lastHeatmapShowTs = performance.now();
                }
            });
        } else {
            // Fallback to click for older browsers
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetCell = e.currentTarget || e.target.closest('.heatmap-cell');
                const now = performance.now();
                if (activeHeatmapCell === targetCell && now - lastHeatmapShowTs < 600) {
                    hideHeatmapTooltip();
                    activeHeatmapCell = null;
                    return;
                }
                showHeatmapTooltip(e, dateKey, spending);
                activeHeatmapCell = targetCell;
                lastHeatmapShowTs = performance.now();
            });
            // Optional: basic touchstart support
            cell.addEventListener('touchend', (e) => {
                e.stopPropagation();
                const targetCell = e.currentTarget || e.target.closest('.heatmap-cell');
                const now = performance.now();
                if (activeHeatmapCell === targetCell && now - lastHeatmapShowTs < 600) {
                    hideHeatmapTooltip();
                    activeHeatmapCell = null;
                    return;
                }
                showHeatmapTooltip(e, dateKey, spending);
                activeHeatmapCell = targetCell;
                lastHeatmapShowTs = performance.now();
            });
        }
        
        currentWeek.appendChild(cell);
        
        // Start new week on Sunday
        if (currentDate.getDay() === 6) {
            weeksContainer.appendChild(currentWeek);
            currentWeek = document.createElement('div');
            currentWeek.className = 'heatmap-week';
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Add last week if it has cells
    if (currentWeek.children.length > 0) {
        weeksContainer.appendChild(currentWeek);
    }
    
    heatmapContainer.appendChild(weeksContainer);

    // One-time outside-tap handler to hide tooltip on mobile
    if (!heatmapContainer.dataset.boundOutside) {
        document.addEventListener('pointerdown', (e) => {
            const target = e.target;
            const isCell = target && (target.classList?.contains('heatmap-cell') || target.closest?.('.heatmap-cell'));
            const isTooltip = target && (target.id === 'heatmap-tooltip' || target.closest?.('#heatmap-tooltip'));
            // Guard: ignore hides right after showing to prevent flash
            if (!isCell && !isTooltip) {
                const now = performance.now();
                if (now - lastHeatmapShowTs < 150) return;
                hideHeatmapTooltip();
                activeHeatmapCell = null;
            }
    }, { passive: true });
        heatmapContainer.dataset.boundOutside = '1';
    }
    
    // Add month labels
    const monthLabels = generateMonthLabels(startDate, today);
    const monthRow = document.createElement('div');
    monthRow.className = 'heatmap-month-labels';
    monthLabels.forEach(label => {
        const monthLabel = document.createElement('div');
        monthLabel.className = 'heatmap-month-label';
        monthLabel.style.gridColumn = `span ${label.span}`;
        monthLabel.textContent = label.month;
        monthRow.appendChild(monthLabel);
    });
    heatmapContainer.insertBefore(monthRow, weeksContainer);
}

function generateMonthLabels(startDate, endDate) {
    const labels = [];
    const current = new Date(startDate);
    let currentMonth = current.getMonth();
    let weekCount = 1;
    
    while (current <= endDate) {
        if (current.getMonth() !== currentMonth) {
            labels.push({
                month: new Date(current.getFullYear(), currentMonth).toLocaleDateString('en-US', { month: 'short' }),
                span: weekCount
            });
            currentMonth = current.getMonth();
            weekCount = 1;
        } else {
            if (current.getDay() === 6) weekCount++;
        }
        current.setDate(current.getDate() + 1);
    }
    
    // Add last month
    labels.push({
        month: new Date(endDate.getFullYear(), currentMonth).toLocaleDateString('en-US', { month: 'short' }),
        span: weekCount
    });
    
    return labels;
}

/**
 * Shows and positions the heatmap tooltip correctly.
 *
 * FIX: This function is completely replaced to solve the positioning issue.
 * - Uses `position: absolute` instead of `position: fixed` to avoid issues with transformed parent elements.
 * - Calculates position relative to the tooltip's `offsetParent` (the container card) instead of the viewport.
 * - This ensures the tooltip is always positioned correctly over the hovered cell on all devices.
 * - Also prevents the "flying" animation by disabling transitions during positioning.
 */
function showHeatmapTooltip(event, date, spending) {
    const tooltip = document.getElementById('heatmap-tooltip');
    if (!tooltip) return;

    // FIX: Parse the date string correctly to avoid timezone issues.
    // The 'date' is in 'YYYY-MM-DD' format. Creating a new Date() from this
    // string interprets it as UTC, which can cause it to be a day off in
    // local timezones. Parsing it manually avoids this.
    const parts = date.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed in JS Date
    const day = parseInt(parts[2], 10);
    const dateObj = new Date(year, month, day);
    
    const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    const balanceInfo = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
    const spendingDisplay = formatBalanceValue(spending, balanceInfo);
    
    tooltip.innerHTML = `
        <div class="tooltip-date">${dayName}, ${formattedDate}</div>
        <div class="tooltip-amount">${spending > 0 ? spendingDisplay : 'No spending'}</div>
    `;
    
    // Prepare tooltip for accurate measurement on first show
    tooltip.style.position = 'absolute'; // ensure offsetParent is used
    tooltip.style.top = '0px';
    tooltip.style.left = '0px';
    tooltip.style.transition = 'none';
    tooltip.style.visibility = 'hidden';
    tooltip.classList.remove('hidden'); // ensure it's not display:none

    // Double-rAF to ensure layout stabilizes before measuring (fixes first-click misposition)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const cell = event.target.closest ? (event.target.closest('.heatmap-cell') || event.target) : event.target;
            // Anchor to closest positioned ancestor if available (stats card/heatmap container), else body
            const anchoredParent = tooltip.offsetParent || tooltip.closest?.('.stats-card') || tooltip.closest?.('#heatmap-view') || document.body;

            const tooltipRect = tooltip.getBoundingClientRect();
            const cellRect = cell.getBoundingClientRect();
            const parentRect = anchoredParent.getBoundingClientRect();

            // Calculate position relative to the anchoredParent
            let top = (cellRect.top - parentRect.top) - tooltipRect.height - 8; // 8px above
            let left = (cellRect.left - parentRect.left) + (cellRect.width / 2) - (tooltipRect.width / 2);

            // Keep within container bounds
            if (top < 0) top = (cellRect.bottom - parentRect.top) + 8; // place below if not enough space
            if (left < 0) left = 5;
            if (left + tooltipRect.width > parentRect.width) left = parentRect.width - tooltipRect.width - 5;

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;

            // Reveal and re-enable transitions
            tooltip.style.visibility = 'visible';
            setTimeout(() => { tooltip.style.transition = ''; }, 50);
        });
    });
}


function hideHeatmapTooltip() {
    const tooltip = document.getElementById('heatmap-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

// Initialize What-If Scenario controls
function initializeWhatIfScenario(userData, purchases) {
    const whatIfControls = document.getElementById('what-if-controls');
    const whatIfToggle = document.getElementById('what-if-toggle');
    const whatIfPanel = document.getElementById('what-if-panel');
    const spendingSlider = document.getElementById('spending-slider');
    const spendingValue = document.getElementById('spending-value');
    
    if (!whatIfControls || !selectedBalanceType) {
        return;
    }
    
    // Show controls only if user has sufficient day coverage for this balance type
    const filteredPurchases = purchases.filter(p => !p.balanceType || p.balanceType === selectedBalanceType);
    const distinctDays = new Set(filteredPurchases.map(p => p.purchaseDate.toISOString().split('T')[0]));
    const MIN_DAYS_REQUIRED = 3; // configurable threshold
    if (distinctDays.size < MIN_DAYS_REQUIRED) {
        // Expose container but mark disabled with explanatory helper
        whatIfControls.classList.remove('hidden');
        whatIfControls.classList.add('disabled');
        if (whatIfToggle) {
            whatIfToggle.disabled = true;
            whatIfToggle.title = `Need at least ${MIN_DAYS_REQUIRED} separate logging days to use What-If`;
        }
        if (!whatIfControls.querySelector('.what-if-disabled-hint')) {
            const hint = document.createElement('div');
            hint.className = 'what-if-disabled-hint';
            hint.style.cssText = 'margin-top:6px;font-size:0.75rem;color:var(--text-secondary);font-family:Nunito, sans-serif;';
            hint.textContent = `Log on ${MIN_DAYS_REQUIRED - distinctDays.size} more day${(MIN_DAYS_REQUIRED - distinctDays.size)===1?'':'s'} to unlock What-If projections.`;
            whatIfControls.appendChild(hint);
        }
        return; // stop further init
    }
    // If we reach here, ensure enabled state
    whatIfControls.classList.remove('hidden','disabled');
    if (whatIfToggle) { whatIfToggle.disabled = false; whatIfToggle.title = ''; }
    
    // Get current balance
    const currentBalance = userData.balances?.[selectedBalanceType] || 0;
    
    // Calculate current average daily spending
    const totalSpent = filteredPurchases.reduce((sum, p) => sum + p.total, 0);
    const dayCount = [...new Set(filteredPurchases.map(p => 
        p.purchaseDate.toISOString().split('T')[0]
    ))].length;
    const avgDaily = totalSpent / dayCount;
    
    // Set slider range based on balance and spending patterns
    // For low balances (like freshmen), use a more appropriate range
    let minSpending, maxSpending, defaultValue;
    
    if (currentBalance < 100) {
        // Low balance - more granular control
        minSpending = 1;
        maxSpending = Math.min(50, currentBalance / 2);
        defaultValue = Math.min(avgDaily, currentBalance / 10);
    } else if (currentBalance < 500) {
        // Medium balance
        minSpending = 5;
        maxSpending = Math.min(75, avgDaily * 2);
        defaultValue = avgDaily;
    } else {
        // High balance
        minSpending = 10;
        maxSpending = Math.min(100, avgDaily * 2.5);
        defaultValue = avgDaily;
    }
    
    spendingSlider.min = minSpending;
    spendingSlider.max = maxSpending;
    spendingSlider.value = Math.round(defaultValue);
    spendingSlider.step = currentBalance < 100 ? 0.5 : 1; // Smaller steps for low balances
    
    const balanceInfo = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
    spendingValue.textContent = formatBalanceValue(defaultValue, balanceInfo);
    
    // Update what-if title to be clearer
    const whatIfTitle = document.querySelector('.what-if-title');
    if (whatIfTitle) {
        whatIfTitle.innerHTML = `💡 What If I Spend <span style="color: var(--brand-primary)">${formatBalanceValue(defaultValue, balanceInfo)}</span> Daily?`;
    }
    
    // Toggle button handler - remove old listeners first
    const newToggle = whatIfToggle.cloneNode(true);
    whatIfToggle.parentNode.replaceChild(newToggle, whatIfToggle);
    
    newToggle.addEventListener('click', () => {
        const isEnabling = newToggle.textContent === 'Enable';
        
        if (isEnabling) {
            newToggle.textContent = 'Reset';
            newToggle.classList.add('active');
            whatIfPanel.classList.remove('hidden');
            
            // Show initial projection immediately
            updateWhatIfProjection(userData, purchases);

            // Hide uncertainty band while What‑If is active
            if (spendingChart?.data?.datasets) {
                spendingChart.data.datasets.forEach(ds => {
                    if (ds && ds._isBand) ds.hidden = true;
                });
                spendingChart.update();
            }
            
            // Add helper text with context based on balance
            const helperText = document.createElement('div');
            helperText.className = 'what-if-helper';
            
            if (currentBalance < 100) {
                helperText.innerHTML = '👆 With a smaller balance, even small changes make a big difference!';
            } else {
                helperText.innerHTML = '👆 Drag the slider to see how different spending habits affect your balance';
            }
            
            if (!whatIfPanel.querySelector('.what-if-helper')) {
                whatIfPanel.insertBefore(helperText, whatIfPanel.firstChild);
            }
        } else {
            newToggle.textContent = 'Enable';
            newToggle.classList.remove('active');
            whatIfPanel.classList.add('hidden');
            
            // Remove helper text
            const helperText = whatIfPanel.querySelector('.what-if-helper');
            if (helperText) helperText.remove();
            
            // Reset to normal chart
            renderChart(userData, purchases);
        }
    });
    
    // Slider handler - remove old listeners first
    const newSlider = spendingSlider.cloneNode(true);
    spendingSlider.parentNode.replaceChild(newSlider, spendingSlider);
    
    newSlider.addEventListener('input', () => {
        const value = parseFloat(newSlider.value);
        const valueDisplay = document.getElementById('spending-value');
        if (valueDisplay) {
            valueDisplay.textContent = formatBalanceValue(value, balanceInfo);
        }
        
        // Update title with new value
        const whatIfTitle = document.querySelector('.what-if-title');
        if (whatIfTitle) {
            whatIfTitle.innerHTML = `💡 What If I Spend <span style="color: var(--brand-primary)">${formatBalanceValue(value, balanceInfo)}</span> Daily?`;
        }
        
        if (newToggle.classList.contains('active')) {
            updateWhatIfProjection(userData, purchases);
        }
    });
}

// Update projection based on What-If scenario
function updateWhatIfProjection(userData, purchases) {
    const spendingSlider = document.getElementById('spending-slider');
    const targetDaily = parseFloat(spendingSlider.value);
    const currentBalance = userData.balances?.[selectedBalanceType] || 0;
    
    if (!spendingChart || !targetDaily) return;
    
    // Calculate new projection
    const now = new Date();
    const filteredPurchases = purchases.filter(p => 
        !p.balanceType || p.balanceType === selectedBalanceType
    );
    
    // Get historical data for the chart
    const spendingByDay = {};
    filteredPurchases.forEach(p => {
        const day = p.purchaseDate.toISOString().split('T')[0];
        spendingByDay[day] = (spendingByDay[day] || 0) + p.total;
    });
    const uniqueSpendingDays = Object.keys(spendingByDay).sort();
    
    const totalSpent = filteredPurchases.reduce((sum, p) => sum + p.total, 0);
    let runningBalance = currentBalance + totalSpent;
    
    // Build historical data
    const labels = [];
    const actualData = [];
    uniqueSpendingDays.forEach(day => {
        runningBalance -= spendingByDay[day];
        labels.push(day);
        actualData.push(runningBalance);
    });
    
    const lastActualBalance = actualData.length > 0 ? actualData[actualData.length - 1] : currentBalance;
    const lastActualDate = uniqueSpendingDays.length > 0 ? 
        new Date(uniqueSpendingDays[uniqueSpendingDays.length - 1]) : new Date();
    
    // Create what-if projection
    const projectionData = new Array(actualData.length - 1).fill(null);
    projectionData.push(lastActualBalance);
    
    let projectedBalance = lastActualBalance;
    let projectedDate = new Date(lastActualDate);
    let daysUntilEmpty = 0;
    let endDate = null;
    
    // For Denison students, consider semester boundaries
    let semesterInfo = null;
    if (userData.isDenisonStudent) {
        semesterInfo = getDenisonSemesterInfo(now);
    }
    
    // First, calculate the actual end date (when money runs out)
    let tempBalance = lastActualBalance;
    let tempDate = new Date(lastActualDate);
    let actualDaysUntilEmpty = 0;
    
    // Calculate up to 5 years in the future if needed
    for (let day = 1; day <= 1825 && tempBalance > 0; day++) {
        tempDate = new Date(lastActualDate);
        tempDate.setDate(lastActualDate.getDate() + day);
        
        let dailySpend = targetDaily;
        if (semesterInfo) {
            const dateInfo = getDenisonSemesterInfo(tempDate);
            if (dateInfo.currentPeriod === 'break' || dateInfo.currentPeriod === 'winter-break' || 
                dateInfo.currentPeriod === 'summer' || dateInfo.currentPeriod === 'off-campus') {
                dailySpend = 0;
            }
        }
        
        if (dailySpend > 0 && tempBalance > 0) {
            tempBalance -= dailySpend;
            if (tempBalance > 0) {
                actualDaysUntilEmpty++;
            } else {
                endDate = new Date(tempDate);
                actualDaysUntilEmpty = day;
                break;
            }
        }
    }
    
    // Now create visualization that ALWAYS shows until money runs out
    // For mobile, we need to be smart about data points
    const isMobile = window.innerWidth <= 768;
    const daysToProject = endDate ? actualDaysUntilEmpty + 5 : Math.min(365, actualDaysUntilEmpty);
    
    projectedBalance = lastActualBalance;
    for (let dayCounter = 1; dayCounter <= daysToProject; dayCounter++) {
        projectedDate = new Date(lastActualDate);
        projectedDate.setDate(lastActualDate.getDate() + dayCounter);
        
        // Check if it's a break day for Denison students
        let dailySpend = targetDaily;
        if (semesterInfo) {
            const dateInfo = getDenisonSemesterInfo(projectedDate);
            if (dateInfo.currentPeriod === 'break' || dateInfo.currentPeriod === 'winter-break' || 
                dateInfo.currentPeriod === 'summer' || dateInfo.currentPeriod === 'off-campus') {
                dailySpend = 0;
            }
        }
        
        // Determine if we should add this point to the graph
        let shouldAddPoint = false;
        
        if (isMobile) {
            // On mobile, be more selective with points to avoid clutter
            shouldAddPoint = dayCounter === 1 || // First day
                              dayCounter === daysToProject || // Last day
                              (dayCounter <= 14 && dayCounter % 2 === 0) || // Every 2 days for first 2 weeks
                              (dayCounter > 14 && dayCounter <= 30 && dayCounter % 5 === 0) || // Every 5 days for first month
                              (dayCounter > 30 && dayCounter % 14 === 0) || // Every 2 weeks after
                              projectedBalance <= targetDaily * 2 || // Near the end
                              projectedBalance <= 0; // At zero
        } else {
            // Desktop can handle more points
            shouldAddPoint = dayCounter === 1 || // First day
                              dayCounter === daysToProject || // Last day
                              dayCounter <= 7 || // Show first week in detail
                              (dayCounter <= 30 && dayCounter % 3 === 0) || // Every 3 days for first month
                              (dayCounter > 30 && dayCounter % 7 === 0) || // Weekly after that
                              projectedBalance <= targetDaily * 5 || // Show detail near end
                              projectedBalance <= 0; // At zero
        }
        
        // Calculate new balance
        if (projectedBalance > 0 && dailySpend > 0) {
            projectedBalance = Math.max(0, projectedBalance - dailySpend);
            daysUntilEmpty = dayCounter;
        }
        
        if (shouldAddPoint) {
            labels.push(projectedDate.toISOString().split('T')[0]);
            projectionData.push(projectedBalance);
        }
        
        // Stop when we hit zero
        if (projectedBalance <= 0) {
            // Make sure we have the zero point
            if (!shouldAddPoint) {
                labels.push(projectedDate.toISOString().split('T')[0]);
                projectionData.push(0);
            }
            break;
        }
    }
    
    // Update chart with new data
    spendingChart.data.labels = labels;
    // Keep Actual data in dataset[0]
    if (spendingChart.data.datasets[0]) {
        spendingChart.data.datasets[0].data = actualData;
    }

    // Hide the default projected line while What‑If is active
    const dsList = spendingChart.data.datasets;
    const projectedIdx = dsList.findIndex(d => typeof d.label === 'string' && d.label.startsWith('Projected ('));
    if (projectedIdx >= 0) {
        dsList[projectedIdx].hidden = true;
    }

    // Find or create the dedicated What‑If dataset
    let whatIfIdx = dsList.findIndex(d => d && d._whatIf === true);
    const balanceInfoWI = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
    const wiLabel = `What-If: ${formatBalanceValue(targetDaily, balanceInfoWI)}/day`;
    const whatIfDataset = {
        _whatIf: true,
        label: wiLabel,
        data: projectionData,
        borderColor: '#9C27B0',
        backgroundColor: 'rgba(156, 39, 176, 0.1)',
        borderDash: [8, 4],
        tension: 0.3,
    fill: false,
    pointRadius: 4,
    pointStyle: 'rectRot',
    pointBackgroundColor: '#9C27B0',
    pointBorderColor: '#9C27B0',
    pointHoverRadius: 5,
        order: 10 // draw on top
    };
    if (whatIfIdx === -1) {
        dsList.push(whatIfDataset);
    } else {
        // Update in place
        const ds = dsList[whatIfIdx];
        ds.label = wiLabel;
        ds.data = projectionData;
        ds.borderColor = '#9C27B0';
        ds.backgroundColor = 'rgba(156, 39, 176, 0.1)';
        ds.borderDash = [8, 4];
        ds.tension = 0.3;
    ds.fill = false;
    ds.pointRadius = 4;
    ds.pointStyle = 'rectRot';
    ds.pointBackgroundColor = '#9C27B0';
    ds.pointBorderColor = '#9C27B0';
        ds.order = 10;
    }
    
    // Format the end date text
    const balanceInfo = userBalanceTypes.find(bt => bt.id === selectedBalanceType);
    let endDateText;
    let titleText;
    
    if (!endDate) {
        // Money lasts more than 5 years
        endDateText = '5+ years';
        titleText = `💭 At ${formatBalanceValue(targetDaily, balanceInfo)}/day, your funds last over 5 years!`;
    } else {
        const monthsUntilEmpty = Math.floor(actualDaysUntilEmpty / 30);
        const yearsUntilEmpty = Math.floor(actualDaysUntilEmpty / 365);
        
        if (yearsUntilEmpty >= 2) {
            endDateText = `~${yearsUntilEmpty} years`;
            titleText = `💭 At ${formatBalanceValue(targetDaily, balanceInfo)}/day, funds last about ${yearsUntilEmpty} years`;
        } else if (monthsUntilEmpty >= 12) {
            endDateText = `~1 year`;
            titleText = `💭 At ${formatBalanceValue(targetDaily, balanceInfo)}/day, funds last about a year`;
        } else if (monthsUntilEmpty >= 6) {
            endDateText = endDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            titleText = `💭 At ${formatBalanceValue(targetDaily, balanceInfo)}/day, funds last until ${endDateText}`;
        } else {
            endDateText = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            titleText = `💭 At ${formatBalanceValue(targetDaily, balanceInfo)}/day, funds last until ${endDateText}`;
        }
    }
    
    
    // Update what-if results
    const whatIfDate = document.getElementById('what-if-date');
    const whatIfSavings = document.getElementById('what-if-savings');
    
    if (whatIfDate && whatIfSavings) {
        whatIfDate.textContent = endDateText;
        
        // Calculate difference from current spending
        const currentAvg = filteredPurchases.length > 0 ? 
            filteredPurchases.reduce((sum, p) => sum + p.total, 0) / 
            [...new Set(filteredPurchases.map(p => p.purchaseDate.toISOString().split('T')[0]))].length : 
            0;
        const difference = currentAvg - targetDaily;
        
        if (Math.abs(difference) < 0.50) {
            whatIfSavings.textContent = 'Same as now';
        } else if (difference > 0) {
            whatIfSavings.textContent = `Save ${formatBalanceValue(difference, balanceInfo)}`;
        } else {
            whatIfSavings.textContent = `Spend ${formatBalanceValue(Math.abs(difference), balanceInfo)} more`;
        }
        
        // Add context about semester if Denison student
        if (userData.isDenisonStudent && semesterInfo && semesterInfo.currentSemester && endDate) {
            const semesterEnd = semesterInfo.currentSemester === 'fall' 
                ? semesterInfo.semesters.fall.end 
                : semesterInfo.semesters.spring.end;
            
            if (endDate < semesterEnd) {
                whatIfDate.style.color = '#d32f2f';
                const daysBeforeSemEnd = Math.floor((semesterEnd - endDate) / (1000 * 60 * 60 * 24));
                whatIfDate.innerHTML = endDateText + `<br><small>(${daysBeforeSemEnd} days before semester ends!)</small>`;
            } else {
                whatIfDate.style.color = 'var(--brand-primary)';
                whatIfDate.innerHTML = endDateText;
                
                // Add positive reinforcement for lasting through semester
                if (monthsUntilEmpty >= 4) {
                    whatIfDate.innerHTML += '<br><small>(Easily lasts the semester!)</small>';
                }
            }
        }
    }
    
    // Sync chart title to What‑If message while preserving subtitle line
    const titlePlugin = spendingChart.options?.plugins?.title;
    if (titlePlugin) {
        const current = titlePlugin.text;
        const subtitle = Array.isArray(current) ? current[1] : 'Shaded band shows where your balance is most likely to land (not a guarantee).';
        titlePlugin.text = [titleText, subtitle];
    }

    spendingChart.update();
}

// Add peer comparison to insights
function generatePeerComparisonInsight(purchases, balanceInfo) {
    // This would normally fetch from Firebase aggregated data
    // For now, using realistic hardcoded averages for Denison students
    
    if (!userDataCache || !userDataCache.isDenisonStudent) return null;
    
    const avgDaily = purchases.length > 0 ? 
        purchases.reduce((sum, p) => sum + p.total, 0) / 
        [...new Set(purchases.map(p => p.purchaseDate.toISOString().split('T')[0]))].length : 0;
    
    // Hardcoded peer averages by class year (would be from Firebase in production)
    const peerAverages = {
        'Freshman': { credits: 18, dining: 22 },
        'Sophomore': { credits: 16, dining: 20 },
        'Junior': { credits: 15, dining: 18 },
        'Senior': { credits: 14, dining: 16 }
    };
    
    const classYear = userDataCache.classYear || 'Sophomore';
    const peerAvg = peerAverages[classYear]?.[selectedBalanceType] || 15;
    
    if (avgDaily > 0) {
        const difference = avgDaily - peerAvg;
        const absDiff = Math.abs(difference);
        
        if (absDiff < 2) {
            // Very close to average
            return generateInsight('peer_comparison', {
                icon: '👥',
                text: `You're right on track with other ${classYear}s.`
            }, 5);
        } else if (difference > 0) {
            // Spending more
            const extra = formatBalanceValue(absDiff, balanceInfo);
            const emoji = absDiff > 10 ? '📊' : '👥';
            return generateInsight('peer_comparison', {
                icon: emoji,
                text: `You spend ${extra}/day more than the average ${classYear}.`
            }, 7);
        } else {
            // Spending less
            const savings = formatBalanceValue(absDiff, balanceInfo);
            return generateInsight('peer_comparison', {
                icon: '💰',
                text: `Nice! You save ${savings}/day vs the average ${classYear}.`
            }, 6);
        }
    }
    
    return null;
}

// --- Run the app ---
document.addEventListener('DOMContentLoaded', main);
