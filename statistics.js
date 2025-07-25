import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- DOM Elements ---
let loadingIndicator, statsContainer, pageTitle, welcomeMessage, userAvatar, avatarButton,
    historyList, insightsList, spendingChartCanvas;

// --- App State ---
let currentUser = null;
let firebaseServices = null;
let spendingChart = null; // To hold the chart instance

// --- Main App Initialization ---
async function main() {
    assignDOMElements();
    
    try {
        // --- LIVE FIREBASE PATH ---
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            throw new Error('Could not load app configuration. Falling back to mock data.');
        }
        const firebaseConfig = await response.json();

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        firebaseServices = { auth, db };

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                init(); // Initialize with live data
            } else {
                window.location.href = "login.html";
            }
        });
    } catch (error) {
        console.warn(error.message);
        console.warn("Falling back to local mock mode.");
        initializeWithMockData();
    }
}

// --- App Logic ---

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
}

// Initializes the page with live data from Firebase
async function init() {
    const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
    const purchasesRef = collection(firebaseServices.db, "users", currentUser.uid, "purchases");
    const q = query(purchasesRef, orderBy("purchaseDate", "desc"));

    const [userDocSnap, purchasesSnap] = await Promise.all([
        getDoc(userDocRef),
        getDocs(q)
    ]);

    if (!userDocSnap.exists()) {
        console.error("User document not found!");
        window.location.href = "login.html";
        return;
    }

    const userData = userDocSnap.data();
    const purchaseHistory = purchasesSnap.docs.map(doc => {
        const data = doc.data();
        return { ...data, purchaseDate: data.purchaseDate.toDate() };
    });

    renderAllComponents(userData, purchaseHistory);
}

// Initializes the page with local mock data for testing
function initializeWithMockData() {
    const mockUser = {
        displayName: "Test User",
        photoURL: "",
        balances: {
            credits: 42.00,
            dining: 18.50,
            swipes: 5,
            bonus: 12.75
        }
    };
    const mockHistory = [
        { items: [{ name: 'Iced Coffee', quantity: 1, category: 'Coffee' }], total: 4.50, purchaseDate: new Date('2025-07-24'), store: 'Ross Market' },
        { items: [{ name: 'Avocado Toast', quantity: 1, category: 'Food' }], total: 8.75, purchaseDate: new Date('2025-07-23'), store: 'The Nest' },
        { items: [{ name: 'Energy Drink', quantity: 1, category: 'Drinks' }], total: 3.25, purchaseDate: new Date('2025-07-22'), store: 'Ross Market' },
        { items: [{ name: 'Bagel & Cream Cheese', quantity: 1, category: 'Food' }], total: 3.50, purchaseDate: new Date('2025-07-21'), store: 'Curtis Dining' },
        { items: [{ name: 'Iced Coffee', quantity: 1, category: 'Coffee' }], total: 4.50, purchaseDate: new Date('2025-07-20'), store: 'Ross Market' },
    ];
    renderAllComponents(mockUser, mockHistory);
}

// Renders all parts of the page with whatever data it's given
function renderAllComponents(userData, purchaseHistory) {
    renderHeader(userData);
    renderHistory(purchaseHistory);
    renderInsights(purchaseHistory);
    renderChart(userData, purchaseHistory); // Pass both user and purchase data

    loadingIndicator.classList.add('hidden');
    statsContainer.style.display = 'block';
}


function renderHeader(userData) {
    welcomeMessage.textContent = `A look at your spending habits, ${userData.displayName || 'friend'}...`;
    updateAvatar(userData.photoURL, userData.displayName);
}

function updateAvatar(photoURL, displayName) {
    if (photoURL) {
        userAvatar.src = photoURL;
    } else {
        const initial = displayName ? displayName.charAt(0).toUpperCase() : '?';
        const svg = `<svg width="56" height="56" xmlns="http://www.w3.org/2000/svg"><rect width="56" height="56" rx="28" ry="28" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="28" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
        userAvatar.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    }
}

function renderHistory(purchases) {
    if (!historyList) return;
    historyList.innerHTML = '';

    if (purchases.length === 0) {
        historyList.innerHTML = '<p style="text-align: center; padding: 1rem;">No purchase history yet. Go buy something!</p>';
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

    if (purchases.length === 0) return;

    // Insight 1: Most frequent purchase (Corrected Logic)
    const allItems = purchases.flatMap(p => p.items);
    const purchaseCounts = allItems.reduce((acc, item) => {
        acc[item.name] = (acc[item.name] || 0) + item.quantity;
        return acc;
    }, {});

    const countsArray = Object.entries(purchaseCounts);
    if (countsArray.length > 0) {
        // Find the item with the highest count
        const [mostFrequentItem] = countsArray.reduce((max, current) => 
            current[1] > max[1] ? current : max, 
            countsArray[0]
        );
        
        const insight1 = document.createElement('li');
        insight1.className = 'insight-item';
        insight1.textContent = `Your usual seems to be the ${mostFrequentItem}.`;
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
    insight2.textContent = `You've spent $${weeklySpending.toFixed(2)} in the last 7 days.`;
    insightsList.appendChild(insight2);
}

function renderChart(userData, purchases) {
    if (!spendingChartCanvas) return;
    const chartContainer = spendingChartCanvas.parentElement;
    const currentBalance = userData.balances?.credits || 0;

    // 1. Aggregate purchases by day
    const spendingByDay = {};
    purchases.forEach(p => {
        const day = p.purchaseDate.toISOString().split('T')[0]; // Group by YYYY-MM-DD
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
            <div class="forecast-gate">
                <div class="forecast-gate-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>
                </div>
                <div class="forecast-gate-title">Unlock Your Forecast</div>
                <div class="forecast-gate-text">
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
        labels.push(day); // Use the YYYY-MM-DD string for labels
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
