import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, query, orderBy, getDocs, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- DOM Elements ---
let loadingIndicator, dashboardContainer, pageTitle, welcomeMessage, userAvatar, avatarButton,
    creditsBalanceEl, diningBalanceEl, swipesBalanceEl, bonusBalanceEl,
    creditsTitleEl, diningTitleEl, swipesTitleEl, bonusTitleEl, // Added for editable titles
    swipesCard, bonusCard, logoutButton, tabItems,
    mainSections, leaderboardList, publicLeaderboardContainer, publicLeaderboardCheckbox,
    weatherWidget, pfpModalOverlay, pfpPreview, pfpUploadInput, pfpSaveButton,
    pfpCloseButton, pfpError, mapOpener, mapModalOverlay, mapModal, mapCloseButton, mapRenderTarget,
    newspaperDate;

// --- App State ---
let map = null;
let currentUser = null;
let selectedPfpFile = null;
let firebaseServices = null;

// --- Main App Initialization ---
async function main() {
    try {
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            throw new Error('Could not load Firebase configuration.');
        }
        const firebaseConfig = await response.json();
        
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const storage = getStorage(app);
        firebaseServices = { auth, db, storage };

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                checkProfile();
            } else {
                window.location.href = "login.html";
            }
        });

        setupEventListeners();

    } catch (error) {
        console.error("Fatal Error:", error);
        if (loadingIndicator) {
            loadingIndicator.textContent = "Failed to load application. Please try again later.";
        }
    }
}

// --- App Logic ---
async function checkProfile() {
    const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
        renderDashboard(userDoc.data());
    } else {
        window.location.href = "questionnaire.html";
    }
}

function renderDashboard(userData) {
    const { balances, displayName, photoURL, showOnWallOfFame, university, balanceTitles } = userData;
    
    welcomeMessage.textContent = `Welcome back, ${displayName}!`;
    updateAvatar(photoURL, displayName);
    publicLeaderboardCheckbox.checked = !!showOnWallOfFame;
    
    updateBalancesUI(balances);
    // NEW: Update titles from saved data, or use defaults
    if (balanceTitles) {
        creditsTitleEl.textContent = balanceTitles.credits || 'Campus Credits';
        diningTitleEl.textContent = balanceTitles.dining || 'Dining Dollars';
        swipesTitleEl.textContent = balanceTitles.swipes || 'Meal Swipes';
        bonusTitleEl.textContent = balanceTitles.bonus || 'Bonus Swipes';
    }

    fetchAndRenderWeather(university);
    
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
    
    // NEW: Assigning title elements for editing
    creditsTitleEl = document.querySelector('#credits-card .item-title');
    diningTitleEl = document.querySelector('#dining-card .item-title');
    swipesTitleEl = document.querySelector('#swipes-card .item-title');
    bonusTitleEl = document.querySelector('#bonus-card .item-title');

    swipesCard = document.getElementById('swipes-card');
    bonusCard = document.getElementById('bonus-card');
    logoutButton = document.querySelector('.tab-item[href="login.html"]');
    tabItems = document.querySelectorAll('.tab-item');
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
    mapOpener = document.getElementById('map-opener');
    mapModalOverlay = document.getElementById('map-modal-overlay');
    mapModal = document.getElementById('map-modal');
    mapCloseButton = document.getElementById('map-close-button');
    mapRenderTarget = document.getElementById('map-render-target');
    newspaperDate = document.getElementById('newspaper-date');
}

function setupEventListeners() {
    // ... (existing listeners)
    if (avatarButton) avatarButton.addEventListener('click', () => pfpModalOverlay.classList.remove('hidden'));
    if (pfpCloseButton) pfpCloseButton.addEventListener('click', closeModal);
    if (pfpModalOverlay) pfpModalOverlay.addEventListener('click', (e) => {
        if (e.target === pfpModalOverlay) closeModal();
    });
    if (pfpUploadInput) pfpUploadInput.addEventListener('change', handlePfpUpload);
    if (pfpSaveButton) pfpSaveButton.addEventListener('click', () => savePfp(firebaseServices.storage, firebaseServices.db));

    if (logoutButton) logoutButton.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = "login.html";
    });

    if (tabItems) tabItems.forEach(tab => {
        tab.addEventListener('click', (e) => handleTabClick(e, firebaseServices.db));
    });
    
    if (publicLeaderboardCheckbox) publicLeaderboardCheckbox.addEventListener('change', (e) => handlePublicToggle(e, firebaseServices.db));

    if (mapOpener) mapOpener.addEventListener('click', openMapModal);
    if (mapCloseButton) mapCloseButton.addEventListener('click', closeMapModal);
    if (mapModalOverlay) mapModalOverlay.addEventListener('click', (e) => {
        if(e.target === mapModalOverlay) closeMapModal();
    });

    // NEW: Setup listeners for editable titles
    setupEditableTitles();
}

// --- NEW FEATURE: EDITABLE TITLES ---

/**
 * Sets up the event listeners for making balance titles editable.
 */
function setupEditableTitles() {
    const titles = [
        { el: creditsTitleEl, key: 'credits' },
        { el: diningTitleEl, key: 'dining' },
        { el: swipesTitleEl, key: 'swipes' },
        { el: bonusTitleEl, key: 'bonus' }
    ];

    titles.forEach(({ el, key }) => {
        if (el) {
            let originalText = el.textContent;

            el.addEventListener('click', () => {
                originalText = el.textContent; // Store original text on click
                el.contentEditable = true;
                el.focus();
                el.classList.add('editing'); // Optional: for styling
                document.execCommand('selectAll', false, null); // Select all text
            });

            el.addEventListener('blur', () => {
                el.contentEditable = false;
                el.classList.remove('editing');
                const newText = el.textContent.trim();
                if (newText && newText !== originalText) {
                    updateTitleInFirestore(key, newText);
                } else {
                    el.textContent = originalText; // Revert if empty or unchanged
                }
            });

            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault(); // Prevent new line
                    el.blur(); // Trigger save
                } else if (e.key === 'Escape') {
                    el.textContent = originalText; // Revert on escape
                    el.blur();
                }
            });
        }
    });
}

/**
 * Updates the custom title in the user's Firestore document.
 * @param {string} titleKey - The key for the title (e.g., 'credits', 'dining').
 * @param {string} newTitle - The new text for the title.
 */
async function updateTitleInFirestore(titleKey, newTitle) {
    if (!currentUser || !firebaseServices.db) return;
    const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
    try {
        // Use dot notation to update a field within a map
        await updateDoc(userDocRef, {
            [`balanceTitles.${titleKey}`]: newTitle
        });
    } catch (error) {
        console.error("Error updating title:", error);
        // Optional: show an error to the user
    }
}


// --- EXISTING FUNCTIONS (some may be condensed for brevity) ---

function openMapModal() {
    if (!map) initializeMap();
    mapModalOverlay.classList.remove('hidden');
    setTimeout(() => map && map.invalidateSize(), 300);
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
    reader.onload = (event) => pfpPreview.src = event.target.result;
    reader.readAsDataURL(file);
}

async function savePfp(storage, db) {
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
}

function handleTabClick(e, db) {
    const tab = e.currentTarget;
    if (tab.href.endsWith('#')) {
        e.preventDefault();
        const targetSectionId = tab.dataset.section;
        if (!targetSectionId) return;

        tabItems.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        mainSections.forEach(s => s.classList.remove('active'));
        document.getElementById(targetSectionId).classList.add('active');

        if (targetSectionId === 'leaderboard-section') {
            publicLeaderboardContainer.classList.remove('hidden');
            fetchAndRenderLeaderboard(db);
        } else {
            publicLeaderboardContainer.classList.add('hidden');
        }
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
            
            item.innerHTML = `
                <span class="leaderboard-rank">#${index + 1}</span>
                <img src="${avatarSrc}" alt="${user.displayName}" class="leaderboard-avatar">
                <span class="leaderboard-name">${user.displayName}</span>
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
                const { displayName, photoURL, currentStreak } = userDoc.data();
                await setDoc(wallOfFameDocRef, { displayName, photoURL, currentStreak: currentStreak || 0 });
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

async function fetchAndRenderWeather(university) {
    const location = university || 'Granville, OH';
    if (!weatherWidget) return;
    weatherWidget.innerHTML = `<div class="spinner"></div>`;
    
    try {
        const data = { main: { temp: 72.5 }, weather: [{ description: "partly cloudy", icon: "02d" }], name: "Aura University" };
        const temp = Math.round(data.main.temp);
        const description = data.weather[0].description;
        const iconCode = data.weather[0].icon;
        const locationName = data.name;

        weatherWidget.innerHTML = `
            <div class="weather-content">
                <img src="https://openweathermap.org/img/wn/${iconCode}@2x.png" alt="${description}" class="weather-icon">
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

function initializeMap() {
    if (!mapRenderTarget || map) return;
    
    mapRenderTarget.style.width = '100%';
    mapRenderTarget.style.height = '100%';
    
    map = L.map('map-render-target', { scrollWheelZoom: false, zoomControl: true }).setView([40.069, -82.52], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    const coffeeIcon = L.divIcon({
        html: '<div style="background: #4CAF50; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">☕</div>',
        iconSize: [30, 30],
        className: 'custom-div-icon'
    });

    L.marker([40.069, -82.52], { icon: coffeeIcon }).addTo(map).bindPopup('Aura Café - Main Campus');
    L.marker([40.072, -82.525], { icon: coffeeIcon }).addTo(map).bindPopup('The Daily Grind - Student Union');
    L.marker([40.065, -82.518], { icon: coffeeIcon }).addTo(map).bindPopup('Bean There - Library');

    setTimeout(() => map.invalidateSize(), 100);
}

// --- Run the app ---
document.addEventListener('DOMContentLoaded', () => {
    assignDOMElements();
    main();
});
