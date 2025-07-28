import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, runTransaction, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

async function main() {
    // --- Firebase Initialization ---
    let app, auth, db;
    try {
        // Securely fetch the Firebase config from our Netlify function
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            throw new Error('Could not load app configuration.');
        }
        const firebaseConfig = await response.json();
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Firebase Initialized!");
    } catch (error) {
        console.error("Error initializing Firebase:", error);
        document.getElementById('questionnaire-error').textContent = "Could not connect to services. Please refresh.";
        return;
    }

    // --- Default Data for Denison University ---
    const denisonDefaults = {
        Freshman:  { credits: 50, dining: 375, swipes: 15, bonus: 4 },
        Sophomore: { credits: 100, dining: 835, swipes: 8, bonus: 7 },
        Junior:    { credits: 100, dining: 835, swipes: 8, bonus: 7 },
        Senior:    { credits: 1000, dining: 2200, swipes: 0, bonus: 0 }
    };

    // --- Profanity List ---
    const profanityList = ["fuck", "shit", "asshole", "bitch", "cunt", "dick", "nigger", "nigga", "faggot", "retard", "slut", "whore"];

    // --- DOM Elements ---
    const nameInput = document.getElementById('name-input');
    const universityInput = document.getElementById('university-input');
    const balanceTypeSection = document.getElementById('balance-type-section');
    const yearOptions = document.querySelectorAll('.selector-option[data-year]');
    const yearSelectorContainer = document.querySelector('.year-selector-container');
    const yearSelectorBg = document.getElementById('year-selector-bg');
    const spentMoneySection = document.getElementById('spent-money-section');
    const spentYesBtn = document.getElementById('spent-yes');
    const spentNoBtn = document.getElementById('spent-no');
    const spentSelectorContainer = document.querySelector('.spent-selector-container');
    const spentMoneyBg = document.getElementById('spent-money-bg');
    const balanceInputsContainer = document.getElementById('balance-inputs-container');
    const saveButton = document.getElementById('save-button');
    const errorMessage = document.getElementById('questionnaire-error');
    
    const menuOptions = document.querySelectorAll('.menu-option');
    const customBalanceContainer = document.getElementById('custom-balance-container');
    const addCustomTenderBtn = document.getElementById('add-custom-tender');
    const addCustomSwipesBtn = document.getElementById('add-custom-swipes');

    const mainSwipeResetToggleSection = document.getElementById('main-swipe-reset-toggle-section');
    const mainSwipeResetYesBtn = document.getElementById('main-swipe-reset-yes');
    const mainSwipeResetNoBtn = document.getElementById('main-swipe-reset-no');
    const mainSwipeResetToggleContainer = mainSwipeResetToggleSection.querySelector('.swipe-reset-toggle-container');
    const mainSwipeResetToggleBg = document.getElementById('main-swipe-reset-toggle-bg');
    const mainSwipeResetDaySection = document.getElementById('main-swipe-reset-day-section');
    const mainDayOptions = mainSwipeResetDaySection.querySelectorAll('.selector-option[data-day]');
    const mainDaySelectorContainer = mainSwipeResetDaySection.querySelector('.day-selector-container');
    const mainDaySelectorBg = document.getElementById('main-day-selector-bg');

    let selectedYear = 'Freshman';
    let hasSpentMoney = false;
    let currentUser = null;
    let isDenison = true;
    let activeBalanceTypes = [];
    let customBalanceCount = 0;
    let mainSwipesResetWeekly = false;
    let mainSwipeResetDay = 'Sunday';

    // --- Auth Listener ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            console.log("User is logged in:", currentUser);
            if (currentUser.displayName) {
                nameInput.value = currentUser.displayName;
            }
            validateForm();
        } else {
            console.log("No user logged in, redirecting to login.");
            window.location.href = "login.html";
        }
    });
    
    // --- Form Validation ---
    function validateForm() {
        let isValid = true;
        if (nameInput.value.trim().length < 3) isValid = false;
        if (universityInput.value.trim().length < 2) isValid = false;
        if (!isDenison && activeBalanceTypes.length === 0) isValid = false;

        if (balanceInputsContainer.classList.contains('show')) {
            const balanceInputs = balanceInputsContainer.querySelectorAll('.balance-input');
            if (!isDenison && activeBalanceTypes.length === 0) isValid = false;
            for (const input of balanceInputs) {
                if (input.offsetParent !== null && input.value.trim() === '') {
                    isValid = false;
                    break;
                }
            }
        }
        saveButton.disabled = !isValid;
    }

    // --- University Input Handler ---
    universityInput.addEventListener('input', () => {
        const university = universityInput.value.trim().toLowerCase();
        isDenison = university.includes('denison') || university === '';
        
        balanceTypeSection.classList.toggle('hidden', isDenison);
        spentMoneySection.classList.toggle('hidden', !isDenison);

        if (isDenison) {
            menuOptions.forEach(option => option.classList.add('selected'));
            customBalanceContainer.innerHTML = '';
            customBalanceCount = 0;
            balanceInputsContainer.classList.toggle('show', hasSpentMoney);
        } else {
            menuOptions.forEach(option => option.classList.remove('selected'));
            hasSpentMoney = true;
            balanceInputsContainer.classList.add('show');
        }
        updateBalanceInputs();
        validateForm();
    });

    universityInput.addEventListener('blur', () => {
        if (isDenison) universityInput.value = 'Denison University';
        validateForm();
    });
    
    nameInput.addEventListener('input', validateForm);
    menuOptions.forEach(option => option.addEventListener('click', () => {
        option.classList.toggle('selected');
        updateBalanceInputs();
        validateForm();
    }));

    // --- Add Custom Balance Handler ---
    function addCustomBalanceRow(balanceType) {
        customBalanceCount++;
        const customRow = document.createElement('div');
        customRow.className = 'custom-balance-row';
        customRow.dataset.customId = customBalanceCount;
        
        const placeholder = balanceType === 'money' ? 'e.g., Flex Points' : 'e.g., Guest Swipes';
        let content = `<div class="custom-balance-row-main"><input type="text" placeholder="${placeholder}" class="form-input custom-balance-input" data-balance-type="${balanceType}"><button type="button" class="remove-custom-btn">×</button></div>`;

        if (balanceType === 'count') {
            content += `<div class="custom-swipe-reset-section show"><h2 class="section-title">Does this reset weekly?</h2><div class="selector-container swipe-reset-toggle-container"><div class="selector-bg"></div><div class="selector-option" data-reset-choice="no">No</div><div class="selector-option" data-reset-choice="yes">Yes</div></div></div>`;
        }
        customRow.innerHTML = content;
        customBalanceContainer.appendChild(customRow);
        
        const input = customRow.querySelector('input');
        const removeBtn = customRow.querySelector('.remove-custom-btn');
        
        input.addEventListener('input', () => { updateBalanceInputs(); validateForm(); });
        removeBtn.addEventListener('click', () => { customRow.remove(); updateBalanceInputs(); validateForm(); });

        if (balanceType === 'count') {
            const yesBtn = customRow.querySelector('[data-reset-choice="yes"]');
            const noBtn = customRow.querySelector('[data-reset-choice="no"]');
            const toggleContainer = customRow.querySelector('.swipe-reset-toggle-container');
            const toggleBg = customRow.querySelector('.selector-bg');
            
            customRow.dataset.resetsWeekly = 'false';
            moveSlider(noBtn, toggleContainer, toggleBg);

            yesBtn.addEventListener('click', () => { customRow.dataset.resetsWeekly = 'true'; moveSlider(yesBtn, toggleContainer, toggleBg); updateBalanceInputs(); validateForm(); });
            noBtn.addEventListener('click', () => { customRow.dataset.resetsWeekly = 'false'; moveSlider(noBtn, toggleContainer, toggleBg); updateBalanceInputs(); validateForm(); });
        }
        updateBalanceInputs();
        validateForm();
    }

    addCustomTenderBtn.addEventListener('click', () => addCustomBalanceRow('money'));
    addCustomSwipesBtn.addEventListener('click', () => addCustomBalanceRow('count'));

    // --- Update Balance Inputs Based on Selected Types ---
    function updateBalanceInputs() {
        activeBalanceTypes = [];
        if (isDenison) {
            activeBalanceTypes = [
                { id: 'credits', label: 'Campus Credits', type: 'money' }, { id: 'dining', label: 'Dining Dollars', type: 'money' },
                { id: 'swipes', label: 'Meal Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' }, { id: 'bonus', label: 'Bonus Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' }
            ];
        } else {
            menuOptions.forEach(option => {
                if (option.classList.contains('selected')) {
                    const type = option.dataset.balanceType;
                    const isSwipe = type === 'swipes' || type === 'bonus';
                    const balanceData = { id: type, label: option.querySelector('.menu-label').textContent, type: isSwipe ? 'count' : 'money' };
                    if (isSwipe) {
                        balanceData.resetsWeekly = mainSwipesResetWeekly;
                        balanceData.resetDay = mainSwipesResetWeekly ? mainSwipeResetDay : null;
                    }
                    activeBalanceTypes.push(balanceData);
                }
            });
            document.querySelectorAll('.custom-balance-row').forEach(row => {
                const input = row.querySelector('.custom-balance-input');
                if (input.value.trim()) {
                    const balanceData = { id: `custom${row.dataset.customId}`, label: input.value.trim(), type: input.dataset.balanceType };
                    if (balanceData.type === 'count') {
                        balanceData.resetsWeekly = row.dataset.resetsWeekly === 'true';
                    }
                    activeBalanceTypes.push(balanceData);
                }
            });
        }
        const standardSwipesSelected = activeBalanceTypes.some(b => b.id === 'swipes' || b.id === 'bonus');
        mainSwipeResetToggleSection.classList.toggle('show', !isDenison && standardSwipesSelected);
        mainSwipeResetDaySection.classList.toggle('show', !isDenison && standardSwipesSelected && mainSwipesResetWeekly);
        if (hasSpentMoney) renderBalanceInputs();
    }

    // --- Render Dynamic Balance Inputs ---
    function renderBalanceInputs() {
        const balanceGrid = balanceInputsContainer.querySelector('.balance-grid');
        balanceGrid.innerHTML = '';
        activeBalanceTypes.forEach(balanceType => {
            if (isDenison && selectedYear === 'Senior' && balanceType.type === 'count') return;
            const inputGroup = document.createElement('div');
            inputGroup.innerHTML = `<label for="balance-${balanceType.id}">${balanceType.label}</label><input type="number" id="balance-${balanceType.id}" class="form-input balance-input" data-balance-id="${balanceType.id}">`;
            const input = inputGroup.querySelector('input');
            input.placeholder = isDenison ? (denisonDefaults[selectedYear][balanceType.id]?.toFixed(balanceType.type === 'money' ? 2 : 0) || '0') : (balanceType.type === 'money' ? '0.00' : '0');
            input.step = balanceType.type === 'count' ? "1" : "0.01";
            input.addEventListener('input', validateForm);
            balanceGrid.appendChild(inputGroup);
        });
        validateForm();
    }
    
    // --- UI Logic & Event Listeners ---
    function moveSlider(targetElement, container, background) {
        if (!targetElement || !container || !background) return;
        requestAnimationFrame(() => {
            const containerRect = container.getBoundingClientRect();
            const targetRect = targetElement.getBoundingClientRect();
            if (targetRect.width === 0) return;
            background.style.transform = `translate(${targetRect.left - containerRect.left}px, ${targetRect.top - containerRect.top}px)`;
            background.style.width = `${targetRect.width}px`;
            background.style.height = `${targetRect.height}px`;
            container.querySelectorAll('.selector-option').forEach(opt => opt.classList.remove('active'));
            targetElement.classList.add('active');
        });
    }

    yearOptions.forEach(option => option.addEventListener('click', () => { selectedYear = option.dataset.year; moveSlider(option, yearSelectorContainer, yearSelectorBg); if (hasSpentMoney) renderBalanceInputs(); validateForm(); }));
    mainDayOptions.forEach(option => option.addEventListener('click', () => { mainSwipeResetDay = option.dataset.day; moveSlider(option, mainDaySelectorContainer, mainDaySelectorBg); updateBalanceInputs(); validateForm(); }));
    mainSwipeResetYesBtn.addEventListener('click', () => { mainSwipesResetWeekly = true; mainSwipeResetDaySection.classList.add('show'); moveSlider(mainSwipeResetYesBtn, mainSwipeResetToggleContainer, mainSwipeResetToggleBg); moveSlider(mainDaySelectorContainer.querySelector(`[data-day="${mainSwipeResetDay}"]`), mainDaySelectorContainer, mainDaySelectorBg); updateBalanceInputs(); validateForm(); });
    mainSwipeResetNoBtn.addEventListener('click', () => { mainSwipesResetWeekly = false; mainSwipeResetDaySection.classList.remove('show'); moveSlider(mainSwipeResetNoBtn, mainSwipeResetToggleContainer, mainSwipeResetToggleBg); updateBalanceInputs(); validateForm(); });
    spentYesBtn.addEventListener('click', () => { if (isDenison) { hasSpentMoney = true; balanceInputsContainer.classList.add('show'); moveSlider(spentYesBtn, spentSelectorContainer, spentMoneyBg); updateBalanceInputs(); validateForm(); } });
    spentNoBtn.addEventListener('click', () => { if (isDenison) { hasSpentMoney = false; balanceInputsContainer.classList.remove('show'); moveSlider(spentNoBtn, spentSelectorContainer, spentMoneyBg); } validateForm(); });

    // --- Firestore: Check if Display Name is Taken ---
    async function isDisplayNameTaken(displayName, uid) {
        const lowerCaseName = displayName.toLowerCase().trim();
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("displayName_lowercase", "==", lowerCaseName));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            return false;
        }
        const doc = querySnapshot.docs[0];
        return doc.data().uid !== uid;
    }
    
    // *** ADDED THIS FUNCTION BACK IN ***
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

    // --- Save Logic ---
    saveButton.addEventListener('click', async () => {
        if (!currentUser || saveButton.disabled) return;
        errorMessage.classList.add('hidden');
        saveButton.textContent = "Saving...";
        saveButton.disabled = true;

        try {
            const displayName = nameInput.value.trim();
            const university = isDenison ? "Denison University" : universityInput.value.trim();

            const nameValidationError = validateInput(displayName, "Name", 3, 15);
            if (nameValidationError) throw new Error(nameValidationError);

            const universityValidationError = validateInput(university, "University", 2, 50);
            if(universityValidationError) throw new Error(universityValidationError);

            if (await isDisplayNameTaken(displayName, currentUser.uid)) {
                throw new Error("That name is already taken. Please choose another.");
            }

            let finalBalances = {};
            if (hasSpentMoney) {
                balanceInputsContainer.querySelectorAll('.balance-input').forEach(input => {
                    const balanceId = input.dataset.balanceId;
                    const balanceTypeInfo = activeBalanceTypes.find(b => b.id === balanceId);
                    if (balanceTypeInfo) {
                        finalBalances[balanceId] = balanceTypeInfo.type === 'money' ? parseFloat(input.value) || 0 : parseInt(input.value) || 0;
                    }
                });
            } else if (isDenison) {
                const defaults = denisonDefaults[selectedYear];
                finalBalances = { credits: defaults.credits, dining: defaults.dining, swipes: selectedYear !== 'Senior' ? defaults.swipes : 0, bonus: selectedYear !== 'Senior' ? defaults.bonus : 0 };
            }

            const userDocumentData = {
                displayName: displayName,
                displayName_lowercase: displayName.toLowerCase(),
                university: university,
                isDenisonStudent: isDenison,
                photoURL: currentUser.photoURL || `https://placehold.co/100x100/EBF2FA/74809D?text=${displayName.substring(0,2).toUpperCase()}`,
                classYear: selectedYear,
                balanceTypes: activeBalanceTypes,
                balances: finalBalances,
                uid: currentUser.uid,
                email: currentUser.email,
                createdAt: new Date(),
            };

            const userDocRef = doc(db, "users", currentUser.uid);
            await setDoc(userDocRef, userDocumentData);
            
            await updateProfile(auth.currentUser, { displayName: displayName });

            saveButton.textContent = "Success!";
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 500);

        } catch (error) {
            errorMessage.textContent = error.message || "Could not save profile.";
            errorMessage.classList.remove('hidden');
            saveButton.textContent = "Place my Order!";
            validateForm();
            console.error("Save error:", error);
        }
    });

    // --- Initialize Page State ---
    function initializePage() {
        requestAnimationFrame(() => {
            moveSlider(yearOptions[0], yearSelectorContainer, yearSelectorBg);
            moveSlider(spentNoBtn, spentSelectorContainer, spentMoneyBg);
            moveSlider(mainSwipeResetNoBtn, mainSwipeResetToggleContainer, mainSwipeResetToggleBg);
        });
        updateBalanceInputs();
        validateForm();
        window.addEventListener('resize', () => {
            clearTimeout(window.resizeTimer);
            window.resizeTimer = setTimeout(() => {
                document.querySelectorAll('.selector-container').forEach(container => {
                    const activeOption = container.querySelector('.selector-option.active');
                    const bg = container.querySelector('.selector-bg');
                    if(activeOption && bg) moveSlider(activeOption, container, bg);
                });
            }, 100);
        });
    }
    initializePage();
}
document.addEventListener('DOMContentLoaded', main);
