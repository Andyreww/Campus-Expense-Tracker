// --- IMPORTS ---
// We ONLY import what we need: the central Firebase promise and the logout function.
import { firebaseReady, logout } from './auth.js';
// We still need these for Firestore/Storage operations within this file.
import { doc, getDoc, updateDoc, collection, query, orderBy, getDocs, setDoc, deleteDoc, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";


// --- DOM Elements ---
let loadingIndicator, dashboardContainer, pageTitle, welcomeMessage, userAvatar, avatarButton,
    creditsBalanceEl, diningBalanceEl, swipesBalanceEl, bonusBalanceEl,
    swipesCard, bonusCard, logoutButton, tabItems,
    mainSections, leaderboardList, publicLeaderboardContainer, publicLeaderboardCheckbox,
    weatherWidget, pfpModalOverlay, pfpPreview, pfpUploadInput, pfpSaveButton,
    pfpCloseButton, pfpError, mapOpener, mapModalOverlay, mapModal, mapCloseButton, mapRenderTarget,
    newspaperDate, fabContainer, mainFab, customLogBtn, customLogModal, customLogForm,
    customItemName, customItemPrice, customItemStore, customLogCancel, customLogClose;

// --- App State ---
let map = null;
let currentUser = null;
let selectedPfpFile = null;
let firebaseServices = null;
// We no longer need authUnsubscribe as it's handled globally in auth.js

// --- Main App Initialization ---
async function main() {
    assignDOMElements();
    try {
        // --- REFACTORED FIREBASE INITIALIZATION ---
        // Wait for the central auth module to give us the Firebase services.
        const services = await firebaseReady;
        if (!services.auth || !services.db || !services.storage) {
            throw new Error('Firebase services could not be initialized.');
        }
        firebaseServices = services;
        
        // The auth guard in auth.js will redirect if the user is not logged in.
        // If the script reaches this point, we can assume we have a user.
        currentUser = firebaseServices.auth.currentUser;
        if (!currentUser) {
            // This is a fallback safety net. The guard in auth.js should have already redirected.
            console.error("Dashboard loaded without a user. This should not happen. Redirecting...");
            window.location.replace('/login.html');
            return;
        }

        // --- Profile check remains the same ---
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
    const userDocRef = doc(firebaseServices.db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
        renderDashboard(userDoc.data());
    } else {
        // If no profile exists, the guard in auth.js should have already redirected.
        // This is a fallback.
        window.location.href = "questionnaire.html";
    }
}

function renderDashboard(userData) {
    const { balances, displayName, photoURL, showOnWallOfFame, university } = userData;
    
    welcomeMessage.innerHTML = `<span class="wave">👋</span> Welcome back, <span class="user-name">${displayName}</span>!`;
    updateAvatar(photoURL, displayName);
    publicLeaderboardCheckbox.checked = !!showOnWallOfFame;
    
    updateBalancesUI(balances);
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
    
    setupEventListeners();
    handleInitialTab();
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
    fabContainer = document.getElementById('fab-container');
    mainFab = document.getElementById('main-fab');
    customLogBtn = document.getElementById('custom-log-btn');
    customLogModal = document.getElementById('custom-log-modal');
    customLogForm = document.getElementById('custom-log-form');
    customItemName = document.getElementById('custom-item-name');
    customItemPrice = document.getElementById('custom-item-price');
    customItemStore = document.getElementById('custom-item-store');
    customLogCancel = document.getElementById('custom-log-cancel');
    customLogClose = document.getElementById('custom-log-close');
}

function setupEventListeners() {
    const { db, storage } = firebaseServices;

    if (avatarButton) avatarButton.addEventListener('click', () => pfpModalOverlay.classList.remove('hidden'));
    if (pfpCloseButton) pfpCloseButton.addEventListener('click', closeModal);
    if (pfpModalOverlay) pfpModalOverlay.addEventListener('click', (e) => {
        if (e.target === pfpModalOverlay) closeModal();
    });
    if (pfpUploadInput) pfpUploadInput.addEventListener('change', handlePfpUpload);
    if (pfpSaveButton) pfpSaveButton.addEventListener('click', () => savePfp(storage, db));

    // --- REFACTORED LOGOUT HANDLER ---
    // This is now incredibly simple. We just call the imported `logout` function.
    if (logoutButton) {
        logoutButton.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent the link from navigating
            logout(); // Call the central, reliable logout function
        });
    }

    if (tabItems) tabItems.forEach(tab => {
        // Make sure not to override the logout button's new listener
        if (tab !== logoutButton) {
           tab.addEventListener('click', (e) => handleTabClick(e, db));
        }
    });
    
    if (publicLeaderboardCheckbox) publicLeaderboardCheckbox.addEventListener('change', (e) => handlePublicToggle(e, db));

    // Map Modal Listeners
    if (mapOpener) mapOpener.addEventListener('click', openMapModal);
    if (mapCloseButton) mapCloseButton.addEventListener('click', closeMapModal);
    if (mapModalOverlay) mapModalOverlay.addEventListener('click', (e) => {
        if(e.target === mapModalOverlay) closeMapModal();
    });

    // FAB Container Listeners
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

    // Custom Log Modal Listeners
    if (customLogBtn) customLogBtn.addEventListener('click', () => {
        customLogModal.classList.remove('hidden');
        customItemName.focus();
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
}

function handleTabClick(e, db) {
    const tab = e.currentTarget;
    if (tab.dataset.section) {
        e.preventDefault();
        const targetSectionId = tab.dataset.section;
        switchTab(targetSectionId, db);
    }
}

function switchTab(sectionId, db) {
    const targetTab = document.querySelector(`.tab-item[data-section="${sectionId}"]`);
    const targetSection = document.getElementById(sectionId);

    if (targetTab && targetSection) {
        tabItems.forEach(t => t.classList.remove('active'));
        mainSections.forEach(s => s.classList.remove('active'));

        targetTab.classList.add('active');
        targetSection.classList.add('active');

        if (sectionId === 'leaderboard-section') {
            publicLeaderboardContainer.classList.remove('hidden');
            if (db) {
                fetchAndRenderLeaderboard(db);
            }
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
    }
}

function openMapModal() {
    if (!map) {
        initializeMap();
    }
    mapModalOverlay.classList.remove('hidden');
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 300);
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

function closeCustomLogModal() {
    customLogModal.classList.add('hidden');
    customLogForm.reset();
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

async function logCustomPurchase(db) {
    if (!currentUser) return;

    const itemName = customItemName.value.trim();
    const itemPrice = parseFloat(customItemPrice.value);
    const storeName = customItemStore.value;

    if (!itemName || isNaN(itemPrice) || itemPrice <= 0) {
        alert('Please fill in all fields correctly');
        return;
    }

    const userDocRef = doc(db, "users", currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    const currentBalance = userData.balances.credits;

    if (itemPrice > currentBalance) {
        alert("Not enough credits!");
        return;
    }

    const submitBtn = customLogForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite;"></span> Logging...';

    try {
        let { currentStreak = 0, longestStreak = 0, lastLogDate = null } = userData;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (lastLogDate) {
            const lastDate = lastLogDate.toDate();
            lastDate.setHours(0, 0, 0, 0);
            const diffTime = today - lastDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                currentStreak++;
            } else if (diffDays > 1) {
                currentStreak = 1;
            }
        } else {
            currentStreak = 1;
        }

        if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
        }

        const purchaseRef = collection(db, "users", currentUser.uid, "purchases");
        await addDoc(purchaseRef, {
            items: [{ name: itemName, price: itemPrice, quantity: 1 }],
            total: itemPrice,
            store: storeName,
            purchaseDate: Timestamp.now(),
            isCustom: true
        });

        const newBalance = currentBalance - itemPrice;
        await updateDoc(userDocRef, {
            "balances.credits": newBalance,
            currentStreak: currentStreak,
            longestStreak: longestStreak,
            lastLogDate: Timestamp.now()
        });

        if (userData.showOnWallOfFame && currentUser?.uid) {
            const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
            await setDoc(wallOfFameDocRef, {
                displayName: currentUser.displayName || "Anonymous",
                photoURL: currentUser.photoURL || "",
                currentStreak: currentStreak
            }, { merge: true });
        }

        creditsBalanceEl.textContent = `$${newBalance.toFixed(2)}`;
        const walletContainer = document.querySelector('.wallet-container, .table-item.item-credits');
        if (walletContainer) {
            walletContainer.classList.add('hit');
            setTimeout(() => walletContainer.classList.remove('hit'), 600);
        }

        closeCustomLogModal();
        
        const successMsg = document.createElement('div');
        successMsg.className = 'custom-log-success';
        successMsg.textContent = `✓ Logged: ${itemName}`;
        document.body.appendChild(successMsg);
        setTimeout(() => successMsg.remove(), 3000);

    } catch (error) {
        console.error("Error logging custom purchase:", error);
        alert("Failed to log purchase. Please try again.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Log Purchase</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
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
            if (user.id === currentUser.uid) {
                item.classList.add('current-user');
            }

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
    
    const apiUrl = `/.netlify/functions/getWeather?university=${encodeURIComponent(location)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || `Error: ${response.status}`);
        
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
    
    map = L.map('map-render-target', {
        scrollWheelZoom: false,
        zoomControl: true
    }).setView([40.069, -82.52], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    const coffeeIcon = L.divIcon({
        html: '<div style="background: #4CAF50; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">☕</div>',
        iconSize: [30, 30],
        className: 'custom-div-icon'
    });

    L.marker([40.069, -82.52], { icon: coffeeIcon }).addTo(map)
        .bindPopup('Aura Café - Main Campus');
    L.marker([40.072, -82.525], { icon: coffeeIcon }).addTo(map)
        .bindPopup('The Daily Grind - Student Union');
    L.marker([40.065, -82.518], { icon: coffeeIcon }).addTo(map)
        .bindPopup('Bean There - Library');

    setTimeout(() => {
        map.invalidateSize();
    }, 100);
}

// Add keyframe animations to the page
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
`;
document.head.appendChild(style);


// --- Run the app ---
document.addEventListener('DOMContentLoaded', main);
