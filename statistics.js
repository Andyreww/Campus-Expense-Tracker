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

    const allItems = filteredPurchases.flatMap(p => p.items);

    // Insight 1: Most frequent purchase
    const purchaseCounts = allItems.reduce((acc, item) => {
        acc[item.name] = (acc[item.name] || 0) + item.quantity;
        return acc;
    }, {});

    const countsArray = Object.entries(purchaseCounts);
    if (countsArray.length > 0) {
        const [mostFrequentItem] = countsArray.reduce((max, current) => 
            current[1] > max[1] ? current : max, 
            countsArray[0]
        );
        
        const insight1 = document.createElement('li');
        insight1.className = 'insight-item';
        insight1.innerHTML = `<span class="insight-icon">🏆</span><span class="insight-text">Your usual seems to be the ${mostFrequentItem}.</span>`;
        insightsList.appendChild(insight1);
    }

    // Insight 2: Total spending this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weeklySpending = filteredPurchases
        .filter(p => p.purchaseDate > oneWeekAgo)
        .reduce((sum, p) => sum + p.total, 0);

    const weeklyDisplay = formatBalanceValue(weeklySpending, balanceInfo);

    const insight2 = document.createElement('li');
    insight2.className = 'insight-item';
    const spentText = balanceInfo && balanceInfo.type === 'count' ? 'used' : 'spent';
    insight2.innerHTML = `<span class="insight-icon">💸</span><span class="insight-text">You've ${spentText} ${weeklyDisplay} in the last 7 days.</span>`;
    insightsList.appendChild(insight2);

    // Insight 3: Most expensive time of day
    const spendingByTime = {
        "Morning": 0,
        "Afternoon": 0,
        "Evening": 0,
        "Late Night": 0
    };

    filteredPurchases.forEach(p => {
        const hour = p.purchaseDate.getHours();
        if (hour >= 5 && hour <= 11) {
            spendingByTime["Morning"] += p.total;
        } else if (hour >= 12 && hour <= 16) {
            spendingByTime["Afternoon"] += p.total;
        } else if (hour >= 17 && hour <= 21) {
            spendingByTime["Evening"] += p.total;
        } else {
            spendingByTime["Late Night"] += p.total;
        }
    });

    const timeSpendingArray = Object.entries(spendingByTime);
    if (timeSpendingArray.some(time => time[1] > 0)) {
        const [topTime] = timeSpendingArray.reduce((max, current) =>
            current[1] > max[1] ? current : max
        );
        
        const timeEmojis = { "Morning": "☀️", "Afternoon": "😎", "Evening": "🌆", "Late Night": "🌙" };
        const timeEmoji = timeEmojis[topTime] || '⏰';

        const insight3 = document.createElement('li');
        insight3.className = 'insight-item';
        const useText = balanceInfo && balanceInfo.type === 'count' ? 'using' : 'spending';
        insight3.innerHTML = `<span class="insight-icon">${timeEmoji}</span><span class="insight-text">${topTime} seems to be your prime ${useText} time.</span>`;
        insightsList.appendChild(insight3);
    }
}

// Smart prediction algorithm with pattern recognition
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
    
    // For Denison students, apply semester awareness
    if (userData.isDenisonStudent) {
        const semesterMonths = 4; // August to December
        const targetDays = semesterMonths * 30;
        const maxReasonableBurn = currentBalance / targetDays;
        
        // Cap the burn rate for semester students
        if (dailyBurnRate && dailyBurnRate > maxReasonableBurn * 1.5) {
            dailyBurnRate = maxReasonableBurn * 1.2; // Allow 20% faster than ideal
        }
    }
    
    return {
        dailyBurnRate,
        weekdayAverages,
        projectionMethod,
        confidence,
        hasWeekdayPattern: hasWeekdayPattern && dayCount >= 14
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
    const maxProjectionDays = 180;
    
    while (projectedBalance > 0 && dayCounter <= maxProjectionDays) {
        const projectionDate = new Date(lastActualDate);
        projectionDate.setDate(lastActualDate.getDate() + dayCounter);
        labels.push(projectionDate.toISOString().split('T')[0]);
        
        let dailyBurn = projection.hasWeekdayPattern 
            ? projection.weekdayAverages[projectionDate.getDay()] 
            : projection.dailyBurnRate;
        
        projectedBalance -= dailyBurn;
        projectionData.push(Math.max(0, projectedBalance));
        
        if (projectedBalance <= 0 && !zeroDate) {
            zeroDate = projectionDate;
        }
        dayCounter++;
    }

    const zeroDateText = !zeroDate ? "more than 6 months" : zeroDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const zeroValueDisplay = formatBalanceValue(0, balanceInfo);
    const confidenceEmoji = { 'low': '🔮', 'medium': '📊', 'medium-high': '📈', 'high': '🎯' }[projection.confidence];
    const titleText = `${confidenceEmoji} Projected to reach ${zeroValueDisplay} around ${zeroDateText}`;

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
