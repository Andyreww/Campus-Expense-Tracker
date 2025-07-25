// --- IMPORTS ---
import { firebaseReady, logout } from './auth.js';
import { doc, getDoc, updateDoc, collection, query, orderBy, getDocs, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- DOM Elements ---
let loadingIndicator, statsContainer, pageTitle, welcomeMessage, userAvatar, avatarButton,
    historyList, insightsList, spendingChartCanvas, logoutButton,
    pfpModalOverlay, pfpPreview, pfpUploadInput, pfpSaveButton,
    pfpCloseButton, pfpError, userBioInput;

// --- App State ---
let currentUser = null;
let firebaseServices = null;
let spendingChart = null;
let selectedPfpFile = null;

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
        renderStatistics(userData);
    } else {
        window.location.href = "questionnaire.html";
    }
}

async function renderStatistics(userData) {
    // Fetch purchase history
    const purchasesRef = collection(firebaseServices.db, "users", currentUser.uid, "purchases");
    const q = query(purchasesRef, orderBy("purchaseDate", "desc"));
    const purchasesSnap = await getDocs(q);
    
    const purchaseHistory = purchasesSnap.docs.map(doc => {
        const data = doc.data();
        return { ...data, purchaseDate: data.purchaseDate.toDate() };
    });

    // Update bio input if it exists
    if (userBioInput) {
        userBioInput.value = userData.bio || '';
    }

    // Render all components
    renderAllComponents(userData, purchaseHistory);
    
    loadingIndicator.style.display = 'none';
    statsContainer.style.display = 'block';
    
    setupEventListeners();
    handleBioInput();
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
    spendingChartCanvas = document.getElementById('spending-chart');
    logoutButton = document.getElementById('logout-button');
    pfpModalOverlay = document.getElementById('pfp-modal-overlay');
    pfpPreview = document.getElementById('pfp-preview');
    pfpUploadInput = document.getElementById('pfp-upload-input');
    pfpSaveButton = document.getElementById('pfp-save-button');
    pfpCloseButton = document.getElementById('pfp-close-button');
    pfpError = document.getElementById('pfp-error');
    userBioInput = document.getElementById('user-bio-input');
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

    if (purchases.length === 0) {
        historyList.innerHTML = `
            <div class="data-gate">
                <div class="data-gate-icon">🛒</div>
                <div class="data-gate-title">No History Yet</div>
                <div class="data-gate-text">
                    Log your first purchase to see your history build up here!
                </div>
            </div>
        `;
        return;
    }
    
    const categoryIcons = { 'Coffee': '☕', 'Food': '🥐', 'Drinks': '🥤', 'Default': '🛒' };

    purchases.forEach(purchase => {
        const itemElement = document.createElement('div');
        itemElement.className = 'history-item';
        
        const formattedDate = purchase.purchaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const mainItemName = purchase.items.length > 1 ? `${purchase.items[0].name} & more` : purchase.items[0].name;
        const category = purchase.items[0]?.category || 'Default';

        itemElement.innerHTML = `
            <div class="history-item-icon">${categoryIcons[category] || categoryIcons['Default']}</div>
            <div class="history-item-details">
                <div class="history-item-name">${mainItemName}</div>
                <div class="history-item-date">${purchase.store} on ${formattedDate}</div>
            </div>
            <div class="history-item-price">$${purchase.total.toFixed(2)}</div>
        `;
        historyList.appendChild(itemElement);
    });
}

function renderInsights(purchases) {
    if (!insightsList) return;
    insightsList.innerHTML = '';

    if (purchases.length === 0) {
        insightsList.innerHTML = `
            <div class="data-gate">
                <div class="data-gate-icon">💡</div>
                <div class="data-gate-title">Unlock Insights</div>
                <div class="data-gate-text">
                    Start logging purchases to discover your spending habits.
                </div>
            </div>
        `;
        return;
    }

    const allItems = purchases.flatMap(p => p.items);

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
    const weeklySpending = purchases
        .filter(p => p.purchaseDate > oneWeekAgo)
        .reduce((sum, p) => sum + p.total, 0);

    const insight2 = document.createElement('li');
    insight2.className = 'insight-item';
    insight2.innerHTML = `<span class="insight-icon">💸</span><span class="insight-text">You've spent $${weeklySpending.toFixed(2)} in the last 7 days.</span>`;
    insightsList.appendChild(insight2);

    // Insight 3: Most expensive time of day
    const spendingByTime = {
        "Morning": 0,
        "Afternoon": 0,
        "Evening": 0,
        "Late Night": 0
    };

    purchases.forEach(p => {
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
        insight3.innerHTML = `<span class="insight-icon">${timeEmoji}</span><span class="insight-text">${topTime} seems to be your prime spending time.</span>`;
        insightsList.appendChild(insight3);
    }
}

function renderChart(userData, purchases) {
    if (!spendingChartCanvas) return;
    const chartContainer = spendingChartCanvas.parentElement;
    const currentBalance = userData.balances?.credits || 0;

    // 1. Aggregate purchases by day
    const spendingByDay = {};
    purchases.forEach(p => {
        const day = p.purchaseDate.toISOString().split('T')[0];
        if (!spendingByDay[day]) {
            spendingByDay[day] = 0;
        }
        spendingByDay[day] += p.total;
    });
    const uniqueSpendingDays = Object.keys(spendingByDay).sort();

    // 2. Prediction Gate: Wait for at least 3 unique days of data
    if (uniqueSpendingDays.length < 3) {
        const daysNeeded = 3 - uniqueSpendingDays.length;
        chartContainer.innerHTML = `
            <div class="data-gate">
                <div class="data-gate-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>
                </div>
                <div class="data-gate-title">Unlock Your Forecast</div>
                <div class="data-gate-text">
                    Log your spending for <strong>${daysNeeded} more day${daysNeeded > 1 ? 's' : ''}</strong> to see your projection. The more you log, the smarter it gets!
                </div>
            </div>
        `;
        return;
    }

    // 3. Reconstruct actual balance history on a daily basis
    const totalSpent = purchases.reduce((sum, p) => sum + p.total, 0);
    let runningBalance = currentBalance + totalSpent;
    
    const labels = [];
    const actualData = [];

    uniqueSpendingDays.forEach(day => {
        runningBalance -= spendingByDay[day];
        labels.push(day);
        actualData.push(runningBalance);
    });

    // 4. Calculate new average daily spending
    const avgDailySpending = totalSpent / uniqueSpendingDays.length;

    if (avgDailySpending <= 0) {
        chartContainer.innerHTML = '<p style="text-align:center; padding: 2rem;">Your balance is safe! No recent spending detected.</p>';
        return;
    }

    // 5. Create detailed projection
    const lastActualBalance = actualData[actualData.length - 1];
    const lastActualDate = new Date(uniqueSpendingDays[uniqueSpendingDays.length - 1]);

    const projectionData = new Array(actualData.length - 1).fill(null);
    projectionData.push(lastActualBalance);

    let projectedBalance = lastActualBalance;
    let dayCounter = 1;
    let zeroDate = lastActualDate;

    while (projectedBalance > 0) {
        const nextDay = new Date(lastActualDate);
        nextDay.setDate(lastActualDate.getDate() + dayCounter);
        
        labels.push(nextDay.toISOString().split('T')[0]);
        projectedBalance -= avgDailySpending;
        projectionData.push(Math.max(0, projectedBalance));
        
        if (projectedBalance <= 0) {
            zeroDate = nextDay;
        }
        dayCounter++;
    }

    // 6. Render the chart
    if (spendingChart) spendingChart.destroy();
    if (!document.getElementById('spending-chart')) {
        const newCanvas = document.createElement('canvas');
        newCanvas.id = 'spending-chart';
        chartContainer.innerHTML = '';
        chartContainer.appendChild(newCanvas);
        spendingChartCanvas = newCanvas;
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
                    label: 'Projected Balance',
                    data: projectionData,
                    borderColor: '#E74C3C',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    fill: { target: 'origin', above: 'rgba(231, 76, 60, 0.1)' },
                    borderDash: [5, 5],
                    borderWidth: 3,
                    tension: 0.1,
                    pointRadius: 5,
                    pointStyle: 'rectRot',
                    pointBackgroundColor: '#E74C3C',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Projected to reach $0 around ${zeroDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
                    font: { size: 16, family: "'Patrick Hand', cursive" },
                    color: 'var(--text-primary)',
                    padding: { bottom: 15 }
                },
                legend: { display: true, position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: $${Number(context.raw).toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', tooltipFormat: 'MMM d' },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { callback: (value) => '$' + value }
                }
            }
        }
    });
}

// --- Run the app ---
document.addEventListener('DOMContentLoaded', main);

// --- Additional Styles ---
const style = document.createElement('style');
style.textContent = `
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