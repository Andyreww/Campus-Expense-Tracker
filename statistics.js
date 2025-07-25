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