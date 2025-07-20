import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, query, where, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

// --- Default Data (Updated Names) ---
const defaultBalances = {
    Freshman:  { credits: 50, dining: 375, swipes: 15, bonus: 4 },
    Sophomore: { credits: 100, dining: 835, swipes: 8, bonus: 7 },
    Junior:    { credits: 100, dining: 835, swipes: 8, bonus: 7 },
    Senior:    { credits: 1000, dining: 2200, swipes: 0, bonus: 0 }
};

// --- Profanity List (Shortened for brevity) ---
const profanityList = ["fuck", "shit", "asshole", "bitch", "cunt", "dick", "nigger", "nigga", "faggot", "retard", "slut", "whore"];

// --- DOM Elements ---
const nameInput = document.getElementById('name-input');
const universityInput = document.getElementById('university-input');
const yearOptions = document.querySelectorAll('.selector-option[data-year]');
const yearSelectorContainer = document.querySelector('.year-selector-container');
const yearSelectorBg = document.getElementById('year-selector-bg');
const spentYesBtn = document.getElementById('spent-yes');
const spentNoBtn = document.getElementById('spent-no');
const spentSelectorContainer = document.querySelector('.spent-selector-container');
const spentMoneyBg = document.getElementById('spent-money-bg');
const balanceInputsContainer = document.getElementById('balance-inputs-container');
const saveButton = document.getElementById('save-button');
const errorMessage = document.getElementById('questionnaire-error');
const creditsInput = document.getElementById('credits-input');
const diningInput = document.getElementById('dining-input');
const swipesInputGroup = document.getElementById('swipes-input-group');
const bonusInputGroup = document.getElementById('bonus-input-group');
const swipesInput = document.getElementById('swipes-input');
const bonusInput = document.getElementById('bonus-input');

let selectedYear = 'Freshman';
let hasSpentMoney = false;
let currentUser = null;

// --- Auth Listener ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        if (user.displayName) {
            nameInput.value = user.displayName;
        }
    } else {
        window.location.href = "login.html";
    }
});

// --- Validation Logic ---
async function isDisplayNameTaken(displayName) {
    const lowerCaseName = displayName.toLowerCase().trim();
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("displayName_lowercase", "==", lowerCaseName));
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
}

function validateInput(name, fieldName, min, max) {
    const trimmed = name.trim();
    if (trimmed.length < min) return `${fieldName} must be at least ${min} characters long.`;
    if (trimmed.length > max) return `${fieldName} cannot be more than ${max} characters.`;
    if (!isNaN(trimmed)) return `${fieldName} cannot be just numbers.`;
    
    if (fieldName === 'Name') {
        const normalizedName = trimmed.toLowerCase().replace(/\s/g, '');
        for (const badWord of profanityList) {
            if (normalizedName.includes(badWord)) {
                return "Please choose a more appropriate name.";
            }
        }
    }
    return null;
}

// --- UI Logic & Event Listeners ---
function moveSlider(targetElement, container, background) {
    const containerRect = container.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    
    const newLeft = targetRect.left - containerRect.left;
    const newTop = targetRect.top - containerRect.top;

    background.style.transform = `translate(${newLeft}px, ${newTop}px)`;
    background.style.width = `${targetRect.width}px`;
    background.style.height = `${targetRect.height}px`;
    
    container.querySelectorAll('.selector-option').forEach(opt => opt.classList.remove('active'));
    targetElement.classList.add('active');
}

function updatePlaceholders() {
    const defaults = defaultBalances[selectedYear];
    creditsInput.placeholder = defaults.credits.toFixed(2);
    diningInput.placeholder = defaults.dining.toFixed(2);
    swipesInput.placeholder = defaults.swipes;
    bonusInput.placeholder = defaults.bonus;
    const isSenior = selectedYear === 'Senior';
    swipesInputGroup.style.display = isSenior ? 'none' : 'block';
    bonusInputGroup.style.display = isSenior ? 'none' : 'block';
}

yearOptions.forEach(option => {
    option.addEventListener('click', () => {
        selectedYear = option.dataset.year;
        moveSlider(option, yearSelectorContainer, yearSelectorBg);
        updatePlaceholders();
    });
});

const spentOptions = [spentNoBtn, spentYesBtn];
spentYesBtn.addEventListener('click', () => {
    hasSpentMoney = true;
    balanceInputsContainer.classList.add('show');
    moveSlider(spentYesBtn, spentSelectorContainer, spentMoneyBg);
});
spentNoBtn.addEventListener('click', () => {
    hasSpentMoney = false;
    balanceInputsContainer.classList.remove('show');
    moveSlider(spentNoBtn, spentSelectorContainer, spentMoneyBg);
});

// --- Save Logic ---
saveButton.addEventListener('click', async () => {
    if (!currentUser) return;

    errorMessage.classList.add('hidden');
    saveButton.textContent = "Saving...";
    saveButton.disabled = true;

    try {
        const displayName = nameInput.value;
        const university = universityInput.value;

        const nameError = validateInput(displayName, "Name", 3, 15);
        if (nameError) throw new Error(nameError);

        const universityError = validateInput(university, "University", 2, 50);
        if (universityError) throw new Error(universityError);
        
        const isTaken = await isDisplayNameTaken(displayName);
        if (isTaken) throw new Error("That name is already taken. Please choose another.");

        let finalBalances;
        const defaults = defaultBalances[selectedYear];

        if (hasSpentMoney) {
            finalBalances = {
                credits: parseFloat(creditsInput.value) || defaults.credits,
                dining: parseFloat(diningInput.value) || defaults.dining,
                swipes: selectedYear !== 'Senior' ? parseInt(swipesInput.value) || defaults.swipes : 0,
                bonus: selectedYear !== 'Senior' ? parseInt(bonusInput.value) || defaults.bonus : 0,
            };
        } else {
            finalBalances = defaults;
        }

        await updateProfile(currentUser, { displayName: displayName.trim() });
        const userDocRef = doc(db, "users", currentUser.uid);
        await setDoc(userDocRef, {
            displayName: displayName.trim(),
            displayName_lowercase: displayName.trim().toLowerCase(),
            university: university.trim(),
            photoURL: currentUser.photoURL,
            classYear: selectedYear,
            balances: finalBalances,
            uid: currentUser.uid,
            email: currentUser.email,
            // --- NEW STREAK FIELDS ---
            currentStreak: 0,
            longestStreak: 0,
            lastLogDate: null, // Set to null initially
            showOnWallOfFame: false // Default to private
        });

        // Add a small delay to give Firestore time to propagate the changes before redirecting
        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 500);

    } catch (error) {
        errorMessage.textContent = error.message || "Could not save profile. Please try again.";
        errorMessage.classList.remove('hidden');
        // Only reset the button if there was an error
        saveButton.textContent = "Save & Go to Dashboard";
        saveButton.disabled = false;
    }
});

// --- Initialize Page State ---
function initializePage() {
    // Use requestAnimationFrame to ensure layout is painted before we measure.
    requestAnimationFrame(() => {
        const initialYear = yearSelectorContainer.querySelector('.selector-option');
        const initialSpent = spentSelectorContainer.querySelector('.selector-option');
        if(initialYear) moveSlider(initialYear, yearSelectorContainer, yearSelectorBg);
        if(initialSpent) moveSlider(initialSpent, spentSelectorContainer, spentMoneyBg);
    });
    
    updatePlaceholders();

    // Re-calculate slider on window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const activeYear = document.querySelector('.year-selector-container .selector-option.active');
            const activeSpent = document.querySelector('.spent-selector-container .selector-option.active');
            if (activeYear) moveSlider(activeYear, yearSelectorContainer, yearSelectorBg);
            if (activeSpent) moveSlider(activeSpent, spentSelectorContainer, spentMoneyBg);
        }, 100);
    });
}

initializePage();
