import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, runTransaction, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

async function main() {
    // --- Firebase Initialization ---
    let app, auth, db;
    try {
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
        document.getElementById('questionnaire-error').classList.remove('hidden');
        document.getElementById('save-button').disabled = true;
        return;
    }

    // --- Constants ---
    const DENISON_DEFAULTS = {
        Freshman:  { credits: 50, dining: 375, swipes: 15, bonus: 4 },
        Sophomore: { credits: 100, dining: 835, swipes: 8, bonus: 7 },
        Junior:    { credits: 100, dining: 835, swipes: 8, bonus: 7 },
        Senior:    { credits: 1000, dining: 2200, swipes: 0, bonus: 0 }
    };

    const PROFANITY_LIST = ["fuck", "shit", "asshole", "bitch", "cunt", "dick", "nigger", "nigga", "faggot", "retard", "slut", "whore"];
    const SPECIAL_CHARS_REGEX = /[<>{}[\]\\\/]/g;
    const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // --- State Variables ---
    let selectedYear = 'Freshman';
    let hasSpentMoney = false;
    let currentUser = null;
    let isDenison = true;
    let activeBalanceTypes = [];
    let customBalanceCount = 0;
    let balanceResetSettings = {};

    // --- DOM Elements Cache ---
    const elements = {
        nameInput: document.getElementById('name-input'),
        universityInput: document.getElementById('university-input'),
        balanceTypeSection: document.getElementById('balance-type-section'),
        yearOptions: document.querySelectorAll('.selector-option[data-year]'),
        yearSelectorContainer: document.querySelector('.year-selector-container'),
        yearSelectorBg: document.getElementById('year-selector-bg'),
        spentMoneySection: document.getElementById('spent-money-section'),
        spentYesBtn: document.getElementById('spent-yes'),
        spentNoBtn: document.getElementById('spent-no'),
        spentSelectorContainer: document.querySelector('.spent-selector-container'),
        spentMoneyBg: document.getElementById('spent-money-bg'),
        balanceInputsContainer: document.getElementById('balance-inputs-container'),
        saveButton: document.getElementById('save-button'),
        errorMessage: document.getElementById('questionnaire-error'),
        menuOptions: document.querySelectorAll('.menu-option'),
        customBalanceContainer: document.getElementById('custom-balance-container'),
        addCustomTenderBtn: document.getElementById('add-custom-tender'),
        addCustomSwipesBtn: document.getElementById('add-custom-swipes'),
        mainSwipeResetToggleSection: document.getElementById('main-swipe-reset-toggle-section'),
        mainSwipeResetYesBtn: document.getElementById('main-swipe-reset-yes'),
        mainSwipeResetNoBtn: document.getElementById('main-swipe-reset-no'),
        mainSwipeResetToggleContainer: document.querySelector('#main-swipe-reset-toggle-section .swipe-reset-toggle-container'),
        mainSwipeResetToggleBg: document.getElementById('main-swipe-reset-toggle-bg'),
        mainSwipeResetDaySection: document.getElementById('main-swipe-reset-day-section'),
        mainDayOptions: document.querySelectorAll('#main-swipe-reset-day-section .selector-option[data-day]'),
        mainDaySelectorContainer: document.querySelector('#main-swipe-reset-day-section .day-selector-container'),
        mainDaySelectorBg: document.getElementById('main-day-selector-bg')
    };

    // --- Utility Functions ---
    function sanitizeInput(input) {
        return input.replace(SPECIAL_CHARS_REGEX, '').trim();
    }

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

    function showError(message) {
        elements.errorMessage.textContent = message;
        elements.errorMessage.classList.remove('hidden');
    }

    function hideError() {
        elements.errorMessage.classList.add('hidden');
    }

    // --- Auth Listener ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            console.log("User is logged in:", currentUser.uid);

            // Check if user data already exists in Firestore.
            const userDocRef = doc(db, "users", user.uid);
            try {
                const docSnap = await getDoc(userDocRef);
                if (docSnap.exists()) {
                    // If the document exists, the user has already completed the questionnaire.
                    console.log("User has already completed the questionnaire. Redirecting to dashboard.");
                    window.location.href = "dashboard.html";
                    return; // Stop executing the rest of the script.
                }
                // If doc doesn't exist, this is a new user, so we continue.
                console.log("New user detected. Proceeding with questionnaire.");
            } catch (error) {
                console.error("Error checking for existing user document:", error);
                showError("There was a problem verifying your account. Please refresh.");
                elements.saveButton.disabled = true;
                return;
            }

            // If we're here, it's a new user. Proceed with setup.
            if (currentUser.displayName) {
                elements.nameInput.value = currentUser.displayName;
            }
            // Now that we've confirmed it's a new user, initialize the page fully.
            initializePage(); 
            validateForm();
        } else {
            console.log("No user logged in, redirecting to login.");
            window.location.href = "login.html";
        }
    });

    // --- Validation Functions ---
    function validateInput(name, fieldName, min, max) {
        const trimmed = sanitizeInput(name);
        if (trimmed.length < min) return `${fieldName} must be at least ${min} characters long.`;
        if (trimmed.length > max) return `${fieldName} cannot be more than ${max} characters.`;
        if (!isNaN(trimmed)) return `${fieldName} cannot be just numbers.`;
        
        if (fieldName === 'Name') {
            const normalizedName = trimmed.toLowerCase().replace(/\s/g, '');
            for (const badWord of PROFANITY_LIST) {
                if (normalizedName.includes(badWord)) {
                    return "Please choose a more appropriate name.";
                }
            }
        }
        return null;
    }

    function validateForm() {
        let isValid = true;
        
        if (elements.nameInput.value.trim().length < 3) isValid = false;
        if (elements.universityInput.value.trim().length < 2) isValid = false;
        if (!isDenison && activeBalanceTypes.length === 0) isValid = false;

        if (elements.balanceInputsContainer.classList.contains('show')) {
            const balanceInputs = elements.balanceInputsContainer.querySelectorAll('.balance-input');
            for (const input of balanceInputs) {
                if (input.offsetParent !== null) {
                    const value = input.value.trim();
                    if (value === '') {
                        isValid = false;
                        break;
                    }
                    // Check for negative values
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue) && numValue < 0) {
                        isValid = false;
                        break;
                    }
                }
            }
        }
        
        elements.saveButton.disabled = !isValid;
    }

    // --- University Handler ---
    function handleUniversityChange() {
        const university = elements.universityInput.value.trim().toLowerCase();
        isDenison = university.includes('denison') || university === '';
        
        elements.balanceTypeSection.classList.toggle('hidden', isDenison);
        elements.spentMoneySection.classList.toggle('hidden', !isDenison);

        if (isDenison) {
            // Reset to Denison defaults
            elements.menuOptions.forEach(option => option.classList.add('selected'));
            elements.customBalanceContainer.innerHTML = '';
            customBalanceCount = 0;
            balanceResetSettings = {};
            elements.balanceInputsContainer.classList.toggle('show', hasSpentMoney);
        } else {
            // Clear selections for custom university
            elements.menuOptions.forEach(option => option.classList.remove('selected'));
            hasSpentMoney = true;
            elements.balanceInputsContainer.classList.add('show');
        }
        
        updateBalanceInputs();
        validateForm();
    }

    elements.universityInput.addEventListener('input', handleUniversityChange);
    elements.universityInput.addEventListener('blur', () => {
        if (isDenison) elements.universityInput.value = 'Denison University';
        validateForm();
    });

    // --- Balance Type Handlers ---
    elements.menuOptions.forEach(option => {
        option.addEventListener('click', () => {
            option.classList.toggle('selected');
            const balanceType = option.dataset.balanceType;
            
            // Show/hide reset sections for this balance type
            updateResetSections();
            updateBalanceInputs();
            validateForm();
        });
    });

    // --- Reset Section Management ---
    function updateResetSections() {
        const selectedTypes = Array.from(elements.menuOptions)
            .filter(opt => opt.classList.contains('selected'))
            .map(opt => opt.dataset.balanceType);
        
        // Show main reset section if any standard types are selected
        const showMainReset = selectedTypes.length > 0;
        elements.mainSwipeResetToggleSection.classList.toggle('show', !isDenison && showMainReset);
        
        // Update day selector visibility based on current selection
        if (balanceResetSettings.main?.resetsWeekly) {
            elements.mainSwipeResetDaySection.classList.add('show');
        }
    }

    // --- Main Reset Toggle Handlers ---
    elements.mainSwipeResetYesBtn.addEventListener('click', () => {
        balanceResetSettings.main = { resetsWeekly: true, resetDay: 'Sunday' };
        elements.mainSwipeResetDaySection.classList.add('show');
        moveSlider(elements.mainSwipeResetYesBtn, elements.mainSwipeResetToggleContainer, elements.mainSwipeResetToggleBg);
        moveSlider(elements.mainDaySelectorContainer.querySelector('[data-day="Sunday"]'), elements.mainDaySelectorContainer, elements.mainDaySelectorBg);
        updateBalanceInputs();
        validateForm();
    });

    elements.mainSwipeResetNoBtn.addEventListener('click', () => {
        balanceResetSettings.main = { resetsWeekly: false };
        elements.mainSwipeResetDaySection.classList.remove('show');
        moveSlider(elements.mainSwipeResetNoBtn, elements.mainSwipeResetToggleContainer, elements.mainSwipeResetToggleBg);
        updateBalanceInputs();
        validateForm();
    });

    elements.mainDayOptions.forEach(option => {
        option.addEventListener('click', () => {
            if (balanceResetSettings.main) {
                balanceResetSettings.main.resetDay = option.dataset.day;
            }
            moveSlider(option, elements.mainDaySelectorContainer, elements.mainDaySelectorBg);
            updateBalanceInputs();
            validateForm();
        });
    });

    // --- Add Custom Balance Handler ---
    function addCustomBalanceRow(balanceType) {
        customBalanceCount++;
        const customRow = document.createElement('div');
        customRow.className = 'custom-balance-row';
        customRow.dataset.customId = customBalanceCount;
        
        const placeholder = balanceType === 'money' ? 'e.g., Flex Points' : 'e.g., Guest Swipes';
        let content = `
            <div class="custom-balance-row-main">
                <input type="text" 
                       placeholder="${placeholder}" 
                       class="form-input custom-balance-input" 
                       data-balance-type="${balanceType}"
                       maxlength="30">
                <button type="button" class="remove-custom-btn">×</button>
            </div>`;

        // Add reset section for all custom types
        content += `
            <div class="custom-swipe-reset-section show">
                <h2 class="section-title">Does this reset weekly?</h2>
                <div class="selector-container swipe-reset-toggle-container">
                    <div class="selector-bg"></div>
                    <div class="selector-option" data-reset-choice="no">No</div>
                    <div class="selector-option" data-reset-choice="yes">Yes</div>
                </div>
                <div class="custom-reset-day-section">
                    <h2 class="section-title">Reset Day?</h2>
                    <div class="selector-container day-selector-container">
                        <div class="selector-bg"></div>
                        ${DAYS_OF_WEEK.map(day => `<div class="selector-option" data-day="${day}">${day.substring(0, 3)}</div>`).join('')}
                    </div>
                </div>
            </div>`;
        
        customRow.innerHTML = content;
        elements.customBalanceContainer.appendChild(customRow);
        
        // Setup event handlers
        const input = customRow.querySelector('input');
        const removeBtn = customRow.querySelector('.remove-custom-btn');
        const yesBtn = customRow.querySelector('[data-reset-choice="yes"]');
        const noBtn = customRow.querySelector('[data-reset-choice="no"]');
        const toggleContainer = customRow.querySelector('.swipe-reset-toggle-container');
        const toggleBg = toggleContainer.querySelector('.selector-bg');
        const daySection = customRow.querySelector('.custom-reset-day-section');
        const dayOptions = customRow.querySelectorAll('[data-day]');
        const daySelectorContainer = customRow.querySelector('.day-selector-container');
        const daySelectorBg = daySelectorContainer.querySelector('.selector-bg');
        
        // Initialize state
        customRow.dataset.resetsWeekly = 'false';
        moveSlider(noBtn, toggleContainer, toggleBg);
        daySection.style.display = 'none';
        
        // Event handlers
        input.addEventListener('input', () => {
            input.value = sanitizeInput(input.value);
            updateBalanceInputs();
            validateForm();
        });
        
        removeBtn.addEventListener('click', () => {
            customRow.remove();
            updateBalanceInputs();
            validateForm();
        });
        
        yesBtn.addEventListener('click', () => {
            customRow.dataset.resetsWeekly = 'true';
            customRow.dataset.resetDay = 'Sunday';
            daySection.style.display = 'block';
            moveSlider(yesBtn, toggleContainer, toggleBg);
            moveSlider(daySelectorContainer.querySelector('[data-day="Sunday"]'), daySelectorContainer, daySelectorBg);
            updateBalanceInputs();
            validateForm();
        });
        
        noBtn.addEventListener('click', () => {
            customRow.dataset.resetsWeekly = 'false';
            daySection.style.display = 'none';
            moveSlider(noBtn, toggleContainer, toggleBg);
            updateBalanceInputs();
            validateForm();
        });
        
        dayOptions.forEach(option => {
            option.addEventListener('click', () => {
                customRow.dataset.resetDay = option.dataset.day;
                moveSlider(option, daySelectorContainer, daySelectorBg);
                updateBalanceInputs();
                validateForm();
            });
        });
        
        updateBalanceInputs();
        validateForm();
    }

    elements.addCustomTenderBtn.addEventListener('click', () => addCustomBalanceRow('money'));
    elements.addCustomSwipesBtn.addEventListener('click', () => addCustomBalanceRow('count'));

    // --- Update Balance Inputs ---
    function updateBalanceInputs() {
        activeBalanceTypes = [];
        
        if (isDenison) {
            // Denison has fixed balance types with weekly reset for swipes
            activeBalanceTypes = [
                { id: 'credits', label: 'Campus Credits', type: 'money' },
                { id: 'dining', label: 'Dining Dollars', type: 'money' },
                { id: 'swipes', label: 'Meal Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' },
                { id: 'bonus', label: 'Bonus Swipes', type: 'count', resetsWeekly: true, resetDay: 'Sunday' }
            ];
        } else {
            // Get selected menu options
            elements.menuOptions.forEach(option => {
                if (option.classList.contains('selected')) {
                    const type = option.dataset.balanceType;
                    const label = option.querySelector('.menu-label').textContent;
                    const isCount = type === 'swipes' || type === 'bonus';
                    
                    const balanceData = {
                        id: type,
                        label: label,
                        type: isCount ? 'count' : 'money'
                    };
                    
                    // Apply reset settings if configured
                    if (balanceResetSettings.main?.resetsWeekly) {
                        balanceData.resetsWeekly = true;
                        balanceData.resetDay = balanceResetSettings.main.resetDay;
                    }
                    
                    activeBalanceTypes.push(balanceData);
                }
            });
            
            // Get custom balances
            document.querySelectorAll('.custom-balance-row').forEach(row => {
                const input = row.querySelector('.custom-balance-input');
                const customName = input.value.trim();
                
                if (customName) {
                    const balanceData = {
                        id: `custom${row.dataset.customId}`,
                        label: customName,
                        type: input.dataset.balanceType
                    };
                    
                    if (row.dataset.resetsWeekly === 'true') {
                        balanceData.resetsWeekly = true;
                        balanceData.resetDay = row.dataset.resetDay || 'Sunday';
                    }
                    
                    activeBalanceTypes.push(balanceData);
                }
            });
        }
        
        if (hasSpentMoney) {
            renderBalanceInputs();
        }
    }

    // --- Render Balance Inputs ---
    function renderBalanceInputs() {
        const balanceGrid = elements.balanceInputsContainer.querySelector('.balance-grid');
        balanceGrid.innerHTML = '';
        
        activeBalanceTypes.forEach(balanceType => {
            // Skip swipes for Denison seniors
            if (isDenison && selectedYear === 'Senior' && balanceType.type === 'count') return;
            
            const inputGroup = document.createElement('div');
            const inputId = `balance-${balanceType.id}`;
            const defaultValue = isDenison && DENISON_DEFAULTS[selectedYear][balanceType.id] 
                ? DENISON_DEFAULTS[selectedYear][balanceType.id].toFixed(balanceType.type === 'money' ? 2 : 0) 
                : '0';
            
            inputGroup.innerHTML = `
                <label for="${inputId}">${balanceType.label}</label>
                <input type="number" 
                       id="${inputId}" 
                       class="form-input balance-input" 
                       data-balance-id="${balanceType.id}"
                       placeholder="${defaultValue}"
                       step="${balanceType.type === 'count' ? '1' : '0.01'}"
                       min="0">`;
            
            const input = inputGroup.querySelector('input');
            input.addEventListener('input', () => {
                // Prevent negative values
                if (parseFloat(input.value) < 0) {
                    input.value = '0';
                }
                validateForm();
            });
            
            balanceGrid.appendChild(inputGroup);
        });
        
        validateForm();
    }

    // --- Year Selection ---
    elements.yearOptions.forEach(option => {
        option.addEventListener('click', () => {
            selectedYear = option.dataset.year;
            moveSlider(option, elements.yearSelectorContainer, elements.yearSelectorBg);
            if (hasSpentMoney) renderBalanceInputs();
            validateForm();
        });
    });

    // --- Spent Money Toggle ---
    elements.spentYesBtn.addEventListener('click', () => {
        if (isDenison) {
            hasSpentMoney = true;
            elements.balanceInputsContainer.classList.add('show');
            moveSlider(elements.spentYesBtn, elements.spentSelectorContainer, elements.spentMoneyBg);
            updateBalanceInputs();
            validateForm();
        }
    });

    elements.spentNoBtn.addEventListener('click', () => {
        if (isDenison) {
            hasSpentMoney = false;
            elements.balanceInputsContainer.classList.remove('show');
            moveSlider(elements.spentNoBtn, elements.spentSelectorContainer, elements.spentMoneyBg);
            validateForm();
        }
    });

    // --- Firestore Functions ---
    async function isDisplayNameTaken(displayName, uid) {
        try {
            const lowerCaseName = displayName.toLowerCase().trim();
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("displayName_lowercase", "==", lowerCaseName));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                return false;
            }
            
            const doc = querySnapshot.docs[0];
            return doc.data().uid !== uid;
        } catch (error) {
            console.error("Error checking display name:", error);
            throw new Error("Could not verify name availability. Please try again.");
        }
    }

    // --- Save Handler ---
    elements.saveButton.addEventListener('click', async () => {
        if (!currentUser || elements.saveButton.disabled) return;
        
        hideError();
        elements.saveButton.textContent = "Saving...";
        elements.saveButton.disabled = true;

        try {
            const displayName = sanitizeInput(elements.nameInput.value);
            const university = isDenison ? "Denison University" : sanitizeInput(elements.universityInput.value);

            // Validate inputs
            const nameValidationError = validateInput(displayName, "Name", 3, 15);
            if (nameValidationError) throw new Error(nameValidationError);

            const universityValidationError = validateInput(university, "University", 2, 50);
            if (universityValidationError) throw new Error(universityValidationError);

            // Check if name is taken
            if (await isDisplayNameTaken(displayName, currentUser.uid)) {
                throw new Error("That name is already taken. Please choose another.");
            }

            // Collect balances
            let finalBalances = {};
            if (hasSpentMoney) {
                elements.balanceInputsContainer.querySelectorAll('.balance-input').forEach(input => {
                    const balanceId = input.dataset.balanceId;
                    const balanceTypeInfo = activeBalanceTypes.find(b => b.id === balanceId);
                    if (balanceTypeInfo) {
                        const value = balanceTypeInfo.type === 'money' 
                            ? parseFloat(input.value) || 0 
                            : parseInt(input.value) || 0;
                        finalBalances[balanceId] = Math.max(0, value); // Ensure non-negative
                    }
                });
            } else if (isDenison) {
                const defaults = DENISON_DEFAULTS[selectedYear];
                finalBalances = {
                    credits: defaults.credits,
                    dining: defaults.dining,
                    swipes: selectedYear !== 'Senior' ? defaults.swipes : 0,
                    bonus: selectedYear !== 'Senior' ? defaults.bonus : 0
                };
            }

            // Create user document
            const userDocumentData = {
                displayName: displayName,
                displayName_lowercase: displayName.toLowerCase(),
                university: university,
                isDenisonStudent: isDenison,
                photoURL: currentUser.photoURL || `https://placehold.co/100x100/EBF2FA/74809D?text=${displayName.substring(0, 2).toUpperCase()}`,
                classYear: selectedYear,
                balanceTypes: activeBalanceTypes,
                balances: finalBalances,
                uid: currentUser.uid,
                email: currentUser.email,
                createdAt: new Date(),
                lastUpdated: new Date()
            };

            // Save to Firestore
            const userDocRef = doc(db, "users", currentUser.uid);
            await setDoc(userDocRef, userDocumentData);
            
            // Update auth profile
            await updateProfile(auth.currentUser, { displayName: displayName });

            elements.saveButton.textContent = "Success!";
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 500);

        } catch (error) {
            showError(error.message || "Could not save profile. Please try again.");
            elements.saveButton.textContent = "Place my Order!";
            validateForm();
            console.error("Save error:", error);
        }
    });

    // --- Initialize Page ---
    function initializePage() {
        // Set initial slider positions
        requestAnimationFrame(() => {
            moveSlider(elements.yearOptions[0], elements.yearSelectorContainer, elements.yearSelectorBg);
            moveSlider(elements.spentNoBtn, elements.spentSelectorContainer, elements.spentMoneyBg);
            moveSlider(elements.mainSwipeResetNoBtn, elements.mainSwipeResetToggleContainer, elements.mainSwipeResetToggleBg);
            
            // Initialize reset settings
            balanceResetSettings.main = { resetsWeekly: false };
        });
        
        // Initial form setup
        updateBalanceInputs();
        
        // Handle window resize
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                document.querySelectorAll('.selector-container').forEach(container => {
                    const activeOption = container.querySelector('.selector-option.active');
                    const bg = container.querySelector('.selector-bg');
                    if (activeOption && bg) {
                        moveSlider(activeOption, container, bg);
                    }
                });
            }, 100);
        });
        
        // Prevent form submission on enter
        elements.nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                validateForm();
            }
        });
        
        elements.universityInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                validateForm();
            }
        });
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', main);
