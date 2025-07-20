import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, query, orderBy, getDocs, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCPQe0CL9FmUu2auma8s5Zkh9hCIV41jfg",
  authDomain: "big-red-balance.firebaseapp.com",
  projectId: "big-red-balance",
  storageBucket: "big-red-balance.firebasestorage.app",
  messagingSenderId: "100680274894",
  appId: "1:100680274894:web:527953526eeffb00e9d19f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- DOM Elements ---
const loadingIndicator = document.getElementById('loading-indicator');
const dashboardContainer = document.getElementById('dashboard-container');
const pageTitle = document.getElementById('page-title');
const welcomeMessage = document.getElementById('welcome-message');
const userAvatar = document.getElementById('user-avatar');
const avatarButton = document.getElementById('avatar-button');
const classYearDisplay = document.getElementById('class-year-display');
const creditsBalanceEl = document.getElementById('credits-balance');
const diningBalanceEl = document.getElementById('dining-balance');
const swipesBalanceEl = document.getElementById('swipes-balance');
const bonusBalanceEl = document.getElementById('bonus-balance');
const swipesCard = document.getElementById('swipes-card');
const bonusCard = document.getElementById('bonus-card');
const locationListContainer = document.getElementById('location-list');
const logoutButton = document.querySelector('.tab-item[href="login.html"]');
const editableTitles = document.querySelectorAll('[data-title-key]');
const tabItems = document.querySelectorAll('.tab-item');
const mainSections = document.querySelectorAll('.main-section');
const leaderboardList = document.getElementById('leaderboard-list');
const publicLeaderboardContainer = document.getElementById('public-leaderboard-container');
const publicLeaderboardCheckbox = document.getElementById('public-leaderboard-checkbox');
const weatherWidget = document.getElementById('weather-widget');

// --- PFP Modal Elements ---
const pfpModalOverlay = document.getElementById('pfp-modal-overlay');
const pfpModal = document.getElementById('pfp-modal');
const pfpPreview = document.getElementById('pfp-preview');
const pfpUploadInput = document.getElementById('pfp-upload-input');
const pfpSaveButton = document.getElementById('pfp-save-button');
const pfpCloseButton = document.getElementById('pfp-close-button');
const pfpError = document.getElementById('pfp-error');

let map = null;
let currentUser = null;
let selectedPfpFile = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const userDocRef = doc(db, "users", user.uid);

        const checkProfile = async (retries = 3, delay = 500) => {
            for (let i = 0; i < retries; i++) {
                const docSnap = await getDoc(userDocRef);
                if (docSnap.exists()) {
                    renderDashboard(docSnap.data());
                    loadingIndicator.style.display = 'none';
                    dashboardContainer.style.display = 'block';
                    initializeMap();
                    return;
                }
                await new Promise(res => setTimeout(res, delay));
            }
            window.location.href = "questionnaire.html";
        };

        checkProfile();

    } else {
        window.location.href = "login.html";
    }
});

function renderDashboard(userData) {
    // We assume 'university' is a field in the user's document from the questionnaire
    const { classYear, balances, displayName, photoURL, customTitles, showOnWallOfFame, university } = userData;
    
    welcomeMessage.textContent = `Welcome back, ${displayName}!`;
    updateAvatar(photoURL, displayName);
    publicLeaderboardCheckbox.checked = showOnWallOfFame;
    
    classYearDisplay.textContent = classYear;
    
    updateBalancesUI(classYear, balances);
    updateTitlesUI(customTitles);
    fetchAndRenderWeather(university);
    renderLocationList();
    fetchAndRenderLeaderboard();
}

function updateAvatar(photoURL, displayName) {
    if (photoURL) {
        userAvatar.src = photoURL;
        pfpPreview.src = photoURL;
    } else {
        const initial = displayName.charAt(0).toUpperCase();
        const svg = `<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="24" ry="24" fill="#0EA5E9"/><text x="50%" y="50%" font-family="Poppins, sans-serif" font-size="24" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
        const svgUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
        userAvatar.src = svgUrl;
        pfpPreview.src = svgUrl;
    }
}

function updateTitlesUI(customTitles) {
    if (!customTitles) return;
    editableTitles.forEach(titleEl => {
        const key = titleEl.dataset.titleKey;
        if (customTitles[key]) {
            titleEl.textContent = customTitles[key];
        }
    });
}

// --- PFP Modal Logic ---
avatarButton.addEventListener('click', () => {
    pfpModalOverlay.classList.remove('hidden');
});

function closeModal() {
    pfpModalOverlay.classList.add('hidden');
    pfpUploadInput.value = ''; // Reset file input
    selectedPfpFile = null;
    pfpError.classList.add('hidden');
}
pfpCloseButton.addEventListener('click', closeModal);
pfpModalOverlay.addEventListener('click', (e) => {
    if (e.target === pfpModalOverlay) {
        closeModal();
    }
});

pfpUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        pfpError.textContent = 'Please select an image file.';
        pfpError.classList.remove('hidden');
        return;
    }
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
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
});

pfpSaveButton.addEventListener('click', async () => {
    if (!selectedPfpFile || !currentUser) return;

    pfpSaveButton.disabled = true;
    pfpSaveButton.textContent = 'Uploading...';
    pfpError.classList.add('hidden');

    try {
        const storageRef = ref(storage, `profile_pictures/${currentUser.uid}`);
        const snapshot = await uploadBytes(storageRef, selectedPfpFile);
        const downloadURL = await getDownloadURL(snapshot.ref);

        await updateProfile(currentUser, { photoURL: downloadURL });
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, { photoURL: downloadURL });

        updateAvatar(downloadURL, currentUser.displayName);
        closeModal();

    } catch (error) {
        console.error("PFP Upload Error:", error);
        pfpError.textContent = 'Upload failed. Please try again.';
        pfpError.classList.remove('hidden');
    } finally {
        pfpSaveButton.disabled = false;
        pfpSaveButton.textContent = 'Save Changes';
    }
});


// --- Logout Logic ---
logoutButton.addEventListener('click', (e) => {
    e.preventDefault();
    signOut(auth).then(() => {
        window.location.href = "login.html";
    }).catch((error) => {
        console.error("Logout Error:", error);
    });
});

// --- Editable Titles Logic ---
editableTitles.forEach(titleEl => {
    titleEl.addEventListener('blur', async (e) => {
        const key = e.target.dataset.titleKey;
        const newTitle = e.target.textContent.trim();

        if (!newTitle) {
            // Restore default if empty
            e.target.textContent = e.target.id.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
            return;
        }

        if (currentUser) {
            const userDocRef = doc(db, "users", currentUser.uid);
            try {
                await updateDoc(userDocRef, {
                    [`customTitles.${key}`]: newTitle
                });
            } catch (error) {
                console.error("Error updating title:", error);
                // Optionally show an error to the user
            }
        }
    });
});

// --- Tab Navigation ---
tabItems.forEach(tab => {
    tab.addEventListener('click', (e) => {
        if (tab.href.endsWith('#')) { // Prevent navigation for non-logout tabs
            e.preventDefault();
            const targetSectionId = tab.dataset.section;
            if (!targetSectionId) return;

            tabItems.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            mainSections.forEach(s => s.classList.remove('active'));
            const targetSection = document.getElementById(targetSectionId);
            targetSection.classList.add('active');

            // Update Header Title and toggle visibility of leaderboard container
            if (targetSectionId === 'leaderboard-section') {
                pageTitle.textContent = 'Streak Leaderboard';
                welcomeMessage.style.opacity = '0';
                publicLeaderboardContainer.classList.remove('hidden');
            } else {
                pageTitle.textContent = 'Your Funds';
                welcomeMessage.style.opacity = '1';
                publicLeaderboardContainer.classList.add('hidden');
            }
        }
    });
});

// --- Leaderboard Logic ---
async function fetchAndRenderLeaderboard() {
    leaderboardList.innerHTML = '<div class="spinner"></div>';
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("currentStreak", "desc"));
    
    try {
        const querySnapshot = await getDocs(q);
        const users = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        leaderboardList.innerHTML = '';
        users.forEach((user, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item liquid-glass';
            if (user.id === currentUser.uid) {
                item.classList.add('current-user');
            }

            const initial = user.displayName.charAt(0).toUpperCase();
            const svgAvatar = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" ry="20" fill="#0EA5E9"/><text x="50%" y="50%" font-family="Poppins, sans-serif" font-size="20" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
            const avatarSrc = user.photoURL || `data:image/svg+xml;base64,${btoa(svgAvatar)}`;

            let rankBadge = `<span class="leaderboard-rank">#${index + 1}</span>`;
            if (index === 0) rankBadge = `<span class="leaderboard-rank rank-badge" style="color: var(--accent-gold);">🥇</span>`;
            if (index === 1) rankBadge = `<span class="leaderboard-rank rank-badge" style="color: var(--accent-silver);">🥈</span>`;
            if (index === 2) rankBadge = `<span class="leaderboard-rank rank-badge" style="color: var(--accent-bronze);">🥉</span>`;

            const streak = user.currentStreak || 0;
            let streakText = `${streak}-day streak!`;
            let flameClass = 'sm';

            if (streak >= 30) {
                streakText = "ON FIRE!";
                flameClass = 'xl';
            } else if (streak >= 14) {
                flameClass = 'lg';
            } else if (streak >= 7) {
                flameClass = 'md';
            }
            
            const fireSVG = streak > 0 ? `<svg class="streak-fire ${flameClass}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2.25c-3.87 3.87-6.75 8.62-6.75 12.375 0 3.7275 3.0225 6.75 6.75 6.75s6.75-3.0225 6.75-6.75c0-3.75-2.88-8.505-6.75-12.375z" stroke="url(#flameGradient)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <defs><linearGradient id="flameGradient" x1="12" y1="2" x2="12" y2="21" gradientUnits="userSpaceOnUse"><stop stop-color="#FFC107"/><stop offset="1" stop-color="#FF5722"/></linearGradient></defs>
            </svg>` : '';

            item.innerHTML = `
                ${rankBadge}
                <img src="${avatarSrc}" alt="${user.displayName}" class="leaderboard-avatar">
                <span class="leaderboard-name">${user.displayName}</span>
                <div class="leaderboard-streak">
                    ${fireSVG}
                    ${streakText}
                </div>
            `;
            leaderboardList.appendChild(item);
        });

        // Update Wall of Fame if user is public
        const currentUserData = users.find(u => u.id === currentUser.uid);
        if (currentUserData && currentUserData.showOnWallOfFame) {
            const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
            const { displayName, photoURL, currentStreak } = currentUserData;
            await setDoc(wallOfFameDocRef, { displayName, photoURL, currentStreak: currentStreak || 0 });
        }

    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        leaderboardList.innerHTML = '<p>Could not load leaderboard.</p>';
    }
}

publicLeaderboardCheckbox.addEventListener('change', async (e) => {
    if (!currentUser) return;
    const isChecked = e.target.checked;
    const userDocRef = doc(db, "users", currentUser.uid);
    const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);

    try {
        // Update the private user document
        await updateDoc(userDocRef, { showOnWallOfFame: isChecked });

        if (isChecked) {
            // If checked, get the user's data and copy it to the public collection
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const { displayName, photoURL, currentStreak } = userDoc.data();
                await setDoc(wallOfFameDocRef, {
                    displayName,
                    photoURL,
                    currentStreak: currentStreak || 0
                });
            }
        } else {
            // If unchecked, delete them from the public collection
            await deleteDoc(wallOfFameDocRef);
        }
    } catch (error) {
        console.error("Error updating public leaderboard status:", error);
    }
});


// --- UI Functions ---
function updateBalancesUI(year, balances) {
    creditsBalanceEl.textContent = `$${balances.credits.toFixed(2)}`;
    diningBalanceEl.textContent = `$${balances.dining.toFixed(2)}`;
    const showSwipes = year !== 'Senior';
    swipesCard.classList.toggle('hidden', !showSwipes);
    bonusCard.classList.toggle('hidden', !showSwipes);
    if (showSwipes) {
        swipesBalanceEl.textContent = balances.swipes;
        bonusBalanceEl.textContent = balances.bonus;
    }
};

// --- Weather Widget ---
async function fetchAndRenderWeather(university) {
    if (!university || !weatherWidget) return;

    // IMPORTANT: Replace with your own OpenWeatherMap API key.
    // You can get a free one at https://openweathermap.org/appid
    const apiKey = 'YOUR_API_KEY_HERE'; 

    if (apiKey === 'YOUR_API_KEY_HERE') {
        weatherWidget.innerHTML = `<p class="weather-error">Please add an OpenWeatherMap API key in dashboard.js</p>`;
        return;
    }
    
    weatherWidget.innerHTML = `<div class="spinner"></div>`;

    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${university}&appid=${apiKey}&units=imperial`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`City not found or API error (${response.status})`);
        }
        const data = await response.json();

        const temp = Math.round(data.main.temp);
        const description = data.weather[0].description;
        const iconCode = data.weather[0].icon;
        const locationName = data.name;

        const iconSvg = getWeatherIcon(iconCode);

        weatherWidget.innerHTML = `
            <div class="weather-content">
                <div class="weather-icon">${iconSvg}</div>
                <div class="weather-details">
                    <div class="weather-temp">${temp}°F</div>
                    <div class="weather-location">${locationName}</div>
                    <div class="weather-description">${description}</div>
                </div>
            </div>
        `;

    } catch (error) {
        console.error("Weather fetch error:", error);
        weatherWidget.innerHTML = `<p class="weather-error">Could not load weather data.</p>`;
    }
}

function getWeatherIcon(iconCode) {
    // A simple mapping of OpenWeatherMap icon codes to custom SVGs
    const iconMap = {
        // Day
        '01d': `<svg viewBox="0 0 64 64"><g><circle cx="32" cy="32" r="10" fill="#FFD700" stroke="#FFD700" stroke-width="2"></circle><path d="M32 15 V 5 M32 59 V 49 M49 32 H 59 M5 32 H 15 M45.2 45.2 L 52.3 52.3 M11.7 11.7 L 18.8 18.8 M11.7 52.3 L 18.8 45.2 M45.2 18.8 L 52.3 11.7" fill="none" stroke="#FFD700" stroke-linecap="round" stroke-width="3"></path></g></svg>`,
        '02d': `<svg viewBox="0 0 64 64"><g><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#FFD700" stroke="#fff" stroke-linejoin="round" stroke-width="1.2"></path><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#C6DEFF" stroke="#fff" stroke-linejoin="round" stroke-width="1.2" transform="translate(5, 5) scale(0.8)"></path></g></svg>`,
        '03d': `<svg viewBox="0 0 64 64"><g><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#C6DEFF" stroke="#fff" stroke-linejoin="round" stroke-width="1.2"></path></g></svg>`,
        '04d': `<svg viewBox="0 0 64 64"><g><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#C6DEFF" stroke="#fff" stroke-linejoin="round" stroke-width="1.2"></path><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#B0C4DE" stroke="#fff" stroke-linejoin="round" stroke-width="1.2" transform="translate(5, 5) scale(0.8)"></path></g></svg>`,
        '09d': `<svg viewBox="0 0 64 64"><g><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#B0C4DE" stroke="#fff" stroke-linejoin="round" stroke-width="1.2"></path><path d="M24 48 l-4 8 M32 48 l-4 8 M40 48 l-4 8" fill="none" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"></path></g></svg>`,
        '10d': `<svg viewBox="0 0 64 64"><g><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#C6DEFF" stroke="#fff" stroke-linejoin="round" stroke-width="1.2" transform="translate(5, 5) scale(0.8)"></path><path d="M24 48 l-4 8 M32 48 l-4 8" fill="none" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"></path></g></svg>`,
        '11d': `<svg viewBox="0 0 64 64"><g><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#8B949E" stroke="#fff" stroke-linejoin="round" stroke-width="1.2"></path><path d="M32 48 l-4 8 l6 -4 l-4 8" fill="none" stroke="#FFD700" stroke-width="3" stroke-linecap="round"></path></g></svg>`,
        '13d': `<svg viewBox="0 0 64 64"><g><path d="M46.5 31.5h-1.3c-1.8-8.2-9-14-17.7-14-8.1 0-15.1 5-17.2 12.3h-1.3C4.8 30.1 1 34.4 1 39.5c0 5.2 4.2 9.5 9.4 9.5h29.2c5.2 0 9.4-4.2 9.4-9.5 0-4.9-3.7-8.9-8.5-9.4z" fill="#C6DEFF" stroke="#fff" stroke-linejoin="round" stroke-width="1.2"></path><path d="M24 48 l-2 2 l2 2 l-2 2 l2 2 M32 48 l-2 2 l2 2 l-2 2 l2 2 M40 48 l-2 2 l2 2 l-2 2 l2 2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"></path></g></svg>`,
        '50d': `<svg viewBox="0 0 64 64"><g><path d="M5 25 H 59 M5 35 H 59 M5 45 H 59" fill="none" stroke="#B0C4DE" stroke-width="4" stroke-linecap="round"></path></g></svg>`,
    };
    // Use night icons as fallback for day icons if not specifically defined
    const nightCode = iconCode.replace('d', 'n');
    return iconMap[iconCode] || iconMap[nightCode] || iconMap['01d']; // Default to sunny icon
}


// --- Map & Location Data ---
const paymentTypes = {
    credits: { name: 'Campus Credits', color: '#F43F5E' },
    dining:  { name: 'Dining Dollars', color: '#38BDF8' },
    swipes:  { name: 'Meal Swipes',    color: '#22C55E' },
    bonus:   { name: 'Bonus Swipes',   color: '#F97316' }
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

function renderLocationList() {
    const groupedLocations = locations.reduce((acc, location) => {
        const key = location.accepts.sort().join(',');
        if (!acc[key]) { acc[key] = []; }
        acc[key].push(location.name);
        return acc;
    }, {});
    let listHtml = '';
    for (const key in groupedLocations) {
        const paymentKeys = key.split(',');
        const locationNames = groupedLocations[key];
        const paymentTypesHtml = paymentKeys.map(k => `<div class="payment-type-tag"><div class="payment-dot" style="background-color: ${paymentTypes[k].color};"></div><span>${paymentTypes[k].name}</span></div>`).join('');
        const locationNamesHtml = locationNames.map(name => `<li>${name}</li>`).join('');
        listHtml += `<div class="location-group-card"><div class="location-group-header">${paymentTypesHtml}</div><ul class="location-group-list">${locationNamesHtml}</ul></div>`;
    }
    locationListContainer.innerHTML = listHtml;
};

function initializeMap() {
    const mapElement = document.getElementById('map');
    if (!mapElement || map) return;
    const mapCenter = [40.069, -82.52];
    map = L.map('map', { scrollWheelZoom: false }).setView(mapCenter, 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20 }).addTo(map);
    
    const createCustomMarkerIcon = (colorKeys) => {
        const dotsSvg = colorKeys.map((key, index) => `<circle cx="${13 + index * 9}" cy="18" r="4" fill="${paymentTypes[key].color}" stroke="#0D1117" stroke-width="1.5" />`).join('');
        const iconSvg = `<svg width="40" height="48" viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 48L22.2361 43.5279C27.8637 32.2721 36 22.3405 36 16C36 7.16344 28.8366 0 20 0C11.1634 0 4 7.16344 4 16C4 22.3405 12.1363 32.2721 17.7639 43.5279L20 48Z" fill="#161B22" stroke="#38BDF8" stroke-width="2"/><circle cx="20" cy="16" r="12" fill="#0D1117" opacity="0.5"/>${dotsSvg}</svg>`;
        return L.divIcon({ className: 'custom-map-marker', html: iconSvg, iconSize: [40, 48], iconAnchor: [20, 48], popupAnchor: [0, -48] });
    };

    locations.forEach(location => {
        const icon = createCustomMarkerIcon(location.accepts);
        const paymentsHtml = location.accepts.map(key => `<li><span class="payment-dot" style="background-color: ${paymentTypes[key].color};"></span>${paymentTypes[key].name}</li>`).join('');
        const popupContent = `<div class="popup-title">${location.name}</div><div class="popup-address">${location.address}</div><ul class="popup-payments-list">${paymentsHtml}</ul>`;
        L.marker(location.coords, { icon: icon }).addTo(map).bindPopup(popupContent);
    });
};
