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
    deleteConfirmBtn, deleteErrorMessage;

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
        console.error("Fatal Error on Statistics:", error);
        if (loadingIndicator) {
            loadingIndicator.innerHTML = "Failed to load statistics. Please try again later.";
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
    
    if (isDenisonStudent) {
        // For Denison students
        if (classYear === 'Senior') {
            // Seniors only see credits and dining
            rawBalanceTypes = [
                { id: 'credits', label: 'Campus Credits', type: 'money' },
                { id: 'dining', label: 'Dining Dollars', type: 'money' }
            ];
        } else {
            // Other years see all 4 standard types
            rawBalanceTypes = [
                { id: 'credits', label: 'Campus Credits', type: 'money' },
                { id: 'dining', label: 'Dining Dollars', type: 'money' },
                { id: 'swipes', label: 'Meal Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' },
                { id: 'bonus', label: 'Bonus Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' }
            ];
        }
    } else {
        // For custom universities, use their balance types
        rawBalanceTypes = balanceTypes || [];
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
                selectedBalanceType = newBalanceType;
                if (purchaseData && userDataCache) {
                    // Re-render components that depend on the selected balance
                    renderChart(userDataCache, purchaseData);
                    renderInsights(purchaseData);
                    renderHistory(purchaseData);
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

// Renders all parts of the page with whatever data it's given
function renderAllComponents(userData, purchaseHistory) {
    renderHeader(userData);
    renderHistory(purchaseHistory);
    renderInsights(purchaseHistory);
    renderChart(userData, purchaseHistory);
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
                    icon: '📚',
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
        const percentChange = ((thisWeekSpending - lastWeekSpending) / lastWeekSpending) * 100;
        if (Math.abs(percentChange) > 10) {
            const trend = percentChange > 0 ? 'up' : 'down';
            const emoji = percentChange > 30 ? '🚨' : percentChange > 0 ? '📈' : '📉';
            const trendText = percentChange > 0 ? 'increased' : 'decreased';
            insights.push(generateInsight('trend', {
                icon: emoji,
                text: `Spending ${trendText} ${Math.abs(percentChange).toFixed(0)}% vs last week.`
            }, percentChange > 30 ? 9 : 7));
        }
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
        const percentage = ((topCategory[1] / totalSpent) * 100).toFixed(0);
        const categoryEmoji = {
            'Coffee': '☕',
            'Food': '🍔',
            'Drinks': '🥤',
            'Snacks': '🍿',
            'Other': '📦'
        }[topCategory[0]] || '🛍️';
        
        insights.push(generateInsight('category', {
            icon: categoryEmoji,
            text: `${topCategory[0]} is ${percentage}% of your spending.`
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
        
        if (avgWeekend > avgWeekday * 1.5) {
            insights.push(generateInsight('weekend', {
                icon: '🎉',
                text: `Weekends hit different - you spend ${((avgWeekend / avgWeekday - 1) * 100).toFixed(0)}% more!`
            }, 6));
        } else if (avgWeekday > avgWeekend * 1.3) {
            insights.push(generateInsight('weekday', {
                icon: '💼',
                text: `Weekday warrior - spending more during the grind.`
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

// Smart prediction algorithm with pattern recognition and semester awareness
function calculateSmartProjection(purchases, currentBalance, userData) {
    const now = new Date();
    
    // Group purchases by date and calculate daily spending
    const dailySpending = {};
    purchases.forEach(p => {
        const dateKey = p.purchaseDate.toISOString().split('T')[0];
        dailySpending[dateKey] = (dailySpending[dateKey] || 0) + p.total;
    });
    
    const spendingDays = Object.keys(dailySpending).sort();
    const dayCount = spendingDays.length;
    
    // Get all spending values for statistical analysis
    const spendingValues = Object.values(dailySpending);
    
    // Calculate basic statistics
    const totalSpent = spendingValues.reduce((sum, val) => sum + val, 0);
    const simpleAverage = totalSpent / dayCount;
    
    // Calculate weighted average (recent days weighted more)
    let weightedSum = 0;
    let weightSum = 0;
    spendingDays.forEach((day, index) => {
        const weight = Math.pow(1.5, index / dayCount); // Exponential weighting
        weightedSum += dailySpending[day] * weight;
        weightSum += weight;
    });
    const weightedAverage = weightedSum / weightSum;
    
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
        if (weekdaySpending[day].length > 0) {
            weekdayAverages[day] = weekdaySpending[day].reduce((sum, val) => sum + val, 0) / weekdaySpending[day].length;
            if (weekdaySpending[day].length >= 2) hasWeekdayPattern = true;
        } else {
            weekdayAverages[day] = simpleAverage; // Use simple average as fallback
        }
    }
    
    // Detect outliers using IQR method
    const sortedValues = [...spendingValues].sort((a, b) => a - b);
    const q1Index = Math.floor(sortedValues.length * 0.25);
    const q3Index = Math.floor(sortedValues.length * 0.75);
    const q1 = sortedValues[q1Index];
    const q3 = sortedValues[q3Index];
    const iqr = q3 - q1;
    const outlierThreshold = q3 + 1.5 * iqr;
    
    // Remove outliers and recalculate
    const nonOutlierValues = spendingValues.filter(val => val <= outlierThreshold);
    const adjustedAverage = nonOutlierValues.length > 0 
        ? nonOutlierValues.reduce((sum, val) => sum + val, 0) / nonOutlierValues.length
        : simpleAverage;
    
    // Determine projection method based on data quality
    let projectionMethod;
    let dailyBurnRate;
    let confidence;
    
    if (dayCount < 3) {
        // Very limited data - use conservative estimate
        dailyBurnRate = Math.min(simpleAverage, currentBalance / 120); // Don't project less than 4 months
        projectionMethod = "conservative";
        confidence = "low";
    } else if (dayCount < 7) {
        // Limited data - blend simple and weighted averages
        dailyBurnRate = (simpleAverage + weightedAverage + adjustedAverage) / 3;
        projectionMethod = "blended";
        confidence = "medium";
    } else if (hasWeekdayPattern && dayCount >= 14) {
        // Good data with patterns - use day-of-week based projection
        projectionMethod = "pattern-based";
        confidence = "high";
        // Will calculate per-day in the projection loop
    } else {
        // Moderate data - use weighted average with outlier adjustment
        dailyBurnRate = (weightedAverage * 0.7 + adjustedAverage * 0.3);
        projectionMethod = "weighted";
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
    
    return {
        dailyBurnRate,
        weekdayAverages,
        projectionMethod,
        confidence,
        hasWeekdayPattern: hasWeekdayPattern && dayCount >= 14,
        semesterInfo,
        spendingMultipliers
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
    let dayCounter = 1;
    let zeroDate = null;
    let semesterEndWarning = null;
    const maxProjectionDays = 180;
    
    // Enhanced projection loop for Denison students
    while (projectedBalance > 0 && dayCounter <= maxProjectionDays) {
        const projectionDate = new Date(lastActualDate);
        projectionDate.setDate(lastActualDate.getDate() + dayCounter);
        labels.push(projectionDate.toISOString().split('T')[0]);
        
        let dailyBurn = projection.hasWeekdayPattern 
            ? projection.weekdayAverages[projectionDate.getDay()] 
            : projection.dailyBurnRate;
        
        // Apply semester-aware spending for Denison students
        if (userData.isDenisonStudent && projection.semesterInfo) {
            const dateInfo = getDenisonSemesterInfo(projectionDate);
            
            // Check if we're in a break period
            if (dateInfo.currentPeriod === 'break' || dateInfo.currentPeriod === 'winter-break' || 
                dateInfo.currentPeriod === 'summer' || dateInfo.currentPeriod === 'off-campus') {
                dailyBurn = 0; // No spending during breaks
            } else if (dateInfo.isFinalsWeek) {
                dailyBurn *= projection.spendingMultipliers['finals'] || 1.4;
            } else if (dateInfo.upcomingBreak && dateInfo.upcomingBreak.daysUntil <= 3) {
                dailyBurn *= projection.spendingMultipliers['pre-break'] || 1.3;
            } else if (dateInfo.semesterProgress < 15) {
                dailyBurn *= projection.spendingMultipliers['early-semester'] || 1.2;
            } else if (dateInfo.semesterProgress > 80) {
                dailyBurn *= projection.spendingMultipliers['late-semester'] || 0.9;
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
        
        projectedBalance -= dailyBurn;
        projectionData.push(Math.max(0, projectedBalance));
        
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
                {
                    label: `Projected (${projection.projectionMethod})`,
                    data: projectionData,
                    borderColor: '#E74C3C',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    fill: { target: 'origin', above: 'rgba(231, 76, 60, 0.1)' },
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
                title: { display: true, text: titleText, font: { size: 16, family: "'Patrick Hand', cursive" }, color: 'var(--text-primary)', padding: { bottom: 15 } },
                legend: { display: true, position: 'bottom' },
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

// --- Run the app ---
document.addEventListener('DOMContentLoaded', main);