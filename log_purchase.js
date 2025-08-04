import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, getDocs, query, Timestamp, deleteDoc, orderBy, getDoc, setDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Main App Initialization ---
async function main() {
    try {
        // Fetch Firebase config from Netlify function
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            throw new Error('Could not load app configuration.');
        }
        const firebaseConfig = await response.json();

        // Initialize Firebase with the secure config
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        // --- STATE ---
        let currentUser = null;
        let allItems = []; // Holds items for the currently selected store
        let cart = [];
        let subscriptions = [];
        let purchaseHistory = [];
        let userProfile = {}; // Will hold balances and other user-specific data
        let userBalanceTypes = []; // User's balance type configurations
        let isDenisonStudent = true; // Track if user is from Denison
        let unsubscribeUserDoc = null;
        let currentCategory = 'All';
        let itemToSubscribe = null;
        let customStores = [];
        let currentStoreId = 'ross'; // 'ross' for the default market
        let currentStoreCurrency = 'dollars'; // Default currency
        let walletToAnimate = null; // Used to trigger wallet shake animation
        let selectedPaymentBalance = null; // Track which balance user wants to pay with

        // Campus restaurants that accept credits (only for Denison students)
        const CAMPUS_RESTAURANTS = [
            { id: 'dragon-village', name: 'Dragon Village', file: 'DV_price.json' },
            { id: 'three-tigers', name: 'Three Tigers', file: 'TTigers_price.json' },
            { id: 'harvest-pizza', name: 'Harvest Pizza', file: 'harvest_price.json' },
            { id: 'pochos', name: "Pocho's", file: 'pochos_price.json' },
            { id: 'granville-pub', name: 'Granville Pub', file: 'pub_price.json' },
            { id: 'the-station', name: 'The Station', file: 'station_price.json' },
            { id: 'whitts', name: "Whitt's", file: 'whitts_price.json' }
        ];

        // --- DOM ELEMENTS ---
        const itemSearchInput = document.getElementById('item-search');
        const categorySidebar = document.getElementById('category-sidebar');
        const itemListContainer = document.getElementById('item-list');
        const cartItemsContainer = document.getElementById('cart-items');
        const cartTotalEl = document.getElementById('cart-total');
        const logPurchaseBtn = document.getElementById('log-purchase-btn');
        const tabBtns = document.querySelectorAll('.basket-tab');
        const tabContents = document.querySelectorAll('.tab-panel');
        const activeSubsList = document.getElementById('active-subs-list');
        const pastSubsList = document.getElementById('past-subs-list');
        const historyList = document.getElementById('history-list');
        const storeSelect = document.getElementById('store-select');
        const customSelectWrapper = document.querySelector('.custom-select-wrapper');
        
        // Modals
        const subModal = document.getElementById('sub-confirm-modal');
        const subModalItemName = document.getElementById('modal-item-name');
        const subModalCancelBtn = document.getElementById('modal-cancel-btn');
        const subModalConfirmBtn = document.getElementById('modal-confirm-btn');

        const createStoreModal = document.getElementById('create-store-modal');
        const createStoreBtn = document.getElementById('modal-create-store-btn');
        const cancelStoreBtn = document.getElementById('modal-cancel-store-btn');
        const newStoreNameInput = document.getElementById('new-store-name');
        const newStoreCurrencyInput = document.getElementById('new-store-currency');

        const addItemModal = document.getElementById('add-item-modal');
        const addItemBtn = document.getElementById('modal-add-item-btn');
        const cancelItemBtn = document.getElementById('modal-cancel-item-btn');
        const newItemNameInput = document.getElementById('new-item-name');
        const newItemPriceInput = document.getElementById('new-item-price');
        const newItemPriceLabel = document.getElementById('new-item-price-label');

        const customStoreActions = document.getElementById('custom-store-actions');
        const addNewItemBtn = document.getElementById('add-new-item-btn');
        
        const deleteStoreModal = document.getElementById('delete-store-modal');
        const deleteStoreNameEl = document.getElementById('delete-store-name');
        const deleteStoreCancelBtn = document.getElementById('delete-store-cancel-btn');
        const deleteStoreConfirmBtn = document.getElementById('delete-store-confirm-btn');

        // --- AUTH ---
        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                init();
            } else {
                window.location.href = "login.html";
            }
        });

        // --- INITIALIZATION ---
        async function init() {
            listenToUserData();
            setupEventListeners();
            setupCustomSelect();
            await loadCustomStores();
            await handleStoreChange();
            await loadSubscriptions();
            await loadPurchaseHistory();
            renderCart();
            renderSubscriptions();
            renderHistory();
            updateWeeklySubsView();
        }

        // --- DATA LOADING & MANAGEMENT ---
        function listenToUserData() {
            if (unsubscribeUserDoc) unsubscribeUserDoc();
            const userDocRef = doc(db, "users", currentUser.uid);
            unsubscribeUserDoc = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    userProfile = docSnap.data();
                    userBalanceTypes = userProfile.balanceTypes || [];
                    isDenisonStudent = userProfile.isDenisonStudent !== false; // Default to true for backward compatibility
                    
                    // Set default payment balance if not set
                    if (!selectedPaymentBalance && userBalanceTypes.length > 0) {
                        // For Denison students at Ross Market or campus restaurants, default to credits
                        if (isDenisonStudent && (currentStoreId === 'ross' || CAMPUS_RESTAURANTS.some(r => r.id === currentStoreId))) {
                            selectedPaymentBalance = 'credits';
                        } else {
                            // Otherwise prefer money type balances
                            const moneyBalance = userBalanceTypes.find(bt => bt.type === 'money');
                            selectedPaymentBalance = moneyBalance ? moneyBalance.id : userBalanceTypes[0].id;
                        }
                    }
                    
                    renderAllWallets(walletToAnimate);
                    walletToAnimate = null;
                    updateWeeklySubsView();
                    updateStoreCurrencyOptions(); // Update currency dropdown based on balance types
                }
            });
        }
        
        async function loadCustomStores() {
            if (!currentUser) return;
            const storesRef = collection(db, "users", currentUser.uid, "customStores");
            const q = query(storesRef, orderBy("name"));
            const querySnapshot = await getDocs(q);
            
            customStores = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Clear existing options
            while (storeSelect.options.length > 0) {
                storeSelect.remove(0);
            }
            
            // Only add Ross Market and campus restaurants for Denison students
            if (isDenisonStudent) {
                const rossOption = document.createElement('option');
                rossOption.value = 'ross';
                rossOption.textContent = 'Ross Market';
                storeSelect.appendChild(rossOption);
                
                // Add campus restaurants
                CAMPUS_RESTAURANTS.forEach(restaurant => {
                    const option = document.createElement('option');
                    option.value = restaurant.id;
                    option.textContent = restaurant.name;
                    storeSelect.appendChild(option);
                });
            }
            
            // Add custom stores
            customStores.forEach(store => {
                const option = document.createElement('option');
                option.value = store.id;
                option.textContent = store.name;
                storeSelect.appendChild(option);
            });

            // Add create new option
            const createOption = document.createElement('option');
            createOption.value = 'create-new';
            createOption.textContent = '＋ Create New Store';
            storeSelect.appendChild(createOption);
            
            // If no Ross Market and no custom stores, default to create new
            if (!isDenisonStudent && customStores.length === 0) {
                currentStoreId = 'create-new';
                createStoreModal.classList.remove('hidden');
            } else if (!isDenisonStudent && customStores.length > 0) {
                // Default to first custom store
                currentStoreId = customStores[0].id;
                storeSelect.value = currentStoreId;
            }
            
            rebuildCustomOptions();
        }
        
        async function handleStoreChange() {
            const selectedValue = storeSelect.value;
        
            if (selectedValue === 'create-new') {
                createStoreModal.classList.remove('hidden');
                // Revert to previous store if exists
                if (currentStoreId !== 'create-new') {
                    storeSelect.value = currentStoreId;
                }
                rebuildCustomOptions();
                return;
            }
        
            currentStoreId = selectedValue;
            cart = [];
            renderCart();
        
            // Check if it's a campus restaurant
            const isCampusRestaurant = CAMPUS_RESTAURANTS.some(r => r.id === currentStoreId);
            
            if (currentStoreId === 'ross' || isCampusRestaurant) {
                currentStoreCurrency = 'dollars'; // Ross and campus restaurants items are priced in dollars
                if (isDenisonStudent) {
                    selectedPaymentBalance = 'credits'; // But paid for with credits for Denison users
                }
                customStoreActions.classList.add('hidden');
                categorySidebar.classList.remove('hidden');
                
                if (currentStoreId === 'ross') {
                    await loadRossStoreData();
                } else {
                    await loadCampusRestaurantData(currentStoreId);
                }
            } else {
                const store = customStores.find(s => s.id === currentStoreId);
                if (store) {
                    let storeBalanceId = store.currency;
        
                    // --- BACKWARD COMPATIBILITY & MAPPING ---
                    // For old Denison stores that saved 'dollars' instead of 'dining'
                    if (isDenisonStudent && storeBalanceId === 'dollars') {
                        storeBalanceId = 'dining';
                    }
        
                    currentStoreCurrency = storeBalanceId; // This is the ID of the balance to use
                    selectedPaymentBalance = storeBalanceId; // Lock payment to this balance
                    
                    customStoreActions.classList.remove('hidden');
                    categorySidebar.classList.add('hidden');
                    await loadCustomStoreItems(currentStoreId);
                }
            }
            // This needs to be called AFTER the state is updated
            renderAllWallets(); 
            rebuildCustomOptions();
        }
        
        async function loadRossStoreData() {
            itemListContainer.innerHTML = `<div class="loading-message"><div class="loading-spinner"></div><p>Stocking the shelves...</p></div>`;
            try {
                const response = await fetch('full_store_prices.json');
                const rawItems = await response.json();
                allItems = rawItems.map(item => {
                    const regularPrice = parseFloat(item.regular_price.replace('$', ''));
                    const salePrice = item.sale_price ? parseFloat(item.sale_price.replace('$', '')) : null;
                    return {
                        name: item.name,
                        price: salePrice ?? regularPrice,
                        onSale: salePrice !== null,
                        originalPrice: regularPrice,
                        category: detectCategory(item),
                        emoji: getEmojiForItem(item.name),
                        priceType: 'money' // Ross Market items are always money-based
                    };
                });
                renderCategories();
                renderItems();
            } catch (error) {
                console.error("Could not load Ross Market data:", error);
                itemListContainer.innerHTML = '<p class="empty-message">Could not load items for Ross Market.</p>';
            }
        }

        async function loadCampusRestaurantData(restaurantId) {
            itemListContainer.innerHTML = `<div class="loading-message"><div class="loading-spinner"></div><p>Loading menu...</p></div>`;
            
            const restaurant = CAMPUS_RESTAURANTS.find(r => r.id === restaurantId);
            if (!restaurant) {
                itemListContainer.innerHTML = '<p class="empty-message">Restaurant not found.</p>';
                return;
            }
            
            try {
                const response = await fetch(restaurant.file);
                const data = await response.json();
                
                // Parse different restaurant formats
                switch (restaurantId) {
                    case 'china-garden':
                        allItems = parseChinaGarden(data);
                        break;
                    case 'three-tigers':
                        allItems = parseThreeTigers(data);
                        break;
                    case 'harvest-pizza':
                        allItems = parseHarvestPizza(data);
                        break;
                    case 'pochos':
                        allItems = parsePochos(data);
                        break;
                    case 'granville-pub':
                        allItems = parseGranvillePub(data);
                        break;
                    case 'the-station':
                        allItems = parseTheStation(data);
                        break;
                    case 'whitts':
                        allItems = parseWhitts(data);
                        break;
                    default:
                        allItems = [];
                }
                
                renderCategories();
                renderItems();
            } catch (error) {
                console.error(`Could not load ${restaurant.name} data:`, error);
                itemListContainer.innerHTML = `<p class="empty-message">Could not load items for ${restaurant.name}.</p>`;
            }
        }

        // Parser functions for each restaurant
        function parseChinaGarden(data) {
            const items = [];
            const menu = data.menu;
            
            // Iterate through all menu sections
            Object.entries(menu).forEach(([sectionKey, section]) => {
                const sectionName = formatSectionName(sectionKey);
                
                if (Array.isArray(section)) {
                    // Direct array of items (like fried_rice)
                    section.forEach(item => {
                        items.push(...createItemVariants(item, sectionName, 'china-garden'));
                    });
                } else if (section.items) {
                    // Section with items array
                    section.items.forEach(item => {
                        items.push(...createItemVariants(item, sectionName, 'china-garden'));
                    });
                }
            });
            
            return items;
        }

        function parseThreeTigers(data) {
            const items = [];
            const menu = data.menu;
            
            // Parse shareables
            if (menu.shareables) {
                menu.shareables.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Shareables',
                        emoji: getEmojiForItem(item.name),
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse OG Street Food
            if (menu.og_street_food?.items) {
                menu.og_street_food.items.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'OG Street Food',
                        emoji: getEmojiForItem(item.name),
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse steamed buns
            if (menu.steamed_buns?.items) {
                menu.steamed_buns.items.forEach(item => {
                    items.push({
                        name: item.name,
                        price: 5, // Single price
                        category: 'Steamed Buns',
                        emoji: '🥟',
                        priceType: 'money',
                        description: item.description
                    });
                    items.push({
                        name: `${item.name} (3 pack)`,
                        price: 14, // 3 for 14
                        category: 'Steamed Buns',
                        emoji: '🥟',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse handhelds
            if (menu.handhelds?.items) {
                menu.handhelds.items.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Handhelds',
                        emoji: getEmojiForItem(item.name),
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse salads
            if (menu.salads?.items) {
                menu.salads.items.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price || 16, // Cobb salad has no price in JSON
                        category: 'Salads',
                        emoji: '🥗',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse kids menu
            if (menu.kids?.items) {
                menu.kids.items.forEach(item => {
                    items.push({
                        name: `Kids ${item.name}`,
                        price: menu.kids.price,
                        category: 'Kids Menu',
                        emoji: '🧒',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse desserts
            if (menu.desserts?.items) {
                menu.desserts.items.forEach(item => {
                    items.push({
                        name: item.name,
                        price: menu.desserts.price,
                        category: 'Desserts',
                        emoji: '🍰',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            return items;
        }

        function parseHarvestPizza(data) {
            const items = [];
            const menu = data.menu;
            
            // Parse small plates
            if (menu.small_plates) {
                menu.small_plates.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Small Plates',
                        emoji: '🍽️',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse salads with size options
            if (menu.salads?.items) {
                menu.salads.items.forEach(item => {
                    if (item.price?.small) {
                        items.push({
                            name: `${item.name} (Small)`,
                            price: item.price.small,
                            category: 'Salads',
                            emoji: '🥗',
                            priceType: 'money',
                            description: item.description
                        });
                        items.push({
                            name: `${item.name} (Large)`,
                            price: item.price.large,
                            category: 'Salads',
                            emoji: '🥗',
                            priceType: 'money',
                            description: item.description
                        });
                    } else if (item.price) {
                        items.push({
                            name: item.name,
                            price: item.price,
                            category: 'Salads',
                            emoji: '🥗',
                            priceType: 'money',
                            description: item.description
                        });
                    }
                });
            }
            
            // Parse pizzas
            if (menu.pizzas) {
                menu.pizzas.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Pizzas',
                        emoji: '🍕',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse lunch special
            if (menu.lunch_special) {
                items.push({
                    name: menu.lunch_special.name,
                    price: menu.lunch_special.price,
                    category: 'Specials',
                    emoji: '🍽️',
                    priceType: 'money',
                    description: menu.lunch_special.description
                });
            }
            
            // Parse handhelds
            if (menu.handhelds) {
                menu.handhelds.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Handhelds',
                        emoji: getEmojiForItem(item.name),
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse desserts
            if (menu.desserts) {
                menu.desserts.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Desserts',
                        emoji: '🍰',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse kids menu
            if (menu.kids) {
                menu.kids.forEach(item => {
                    items.push({
                        name: `Kids ${item.name}`,
                        price: item.price,
                        category: 'Kids Menu',
                        emoji: '🧒',
                        priceType: 'money'
                    });
                });
            }
            
            // Parse drinks
            if (menu.drinks) {
                menu.drinks.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Drinks',
                        emoji: '🥤',
                        priceType: 'money'
                    });
                });
            }
            
            return items;
        }

        function parsePochos(data) {
            const items = [];
            const menu = data.menu;
            
            // Parse starters
            if (menu.starters) {
                menu.starters.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Starters',
                        emoji: '🍽️',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse soups and salads
            if (menu.soups_and_salads) {
                menu.soups_and_salads.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Soups & Salads',
                        emoji: item.name.includes('Salad') ? '🥗' : '🍲',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse bowls
            if (menu.bowls) {
                // Base bowl price
                items.push({
                    name: 'Bowl (Base)',
                    price: menu.bowls.price,
                    category: 'Bowls',
                    emoji: '🥙',
                    priceType: 'money',
                    description: menu.bowls.description
                });
            }
            
            // Parse specialties
            if (menu.specialties) {
                // Fajitas
                if (menu.specialties.fajitas?.options) {
                    menu.specialties.fajitas.options.forEach(option => {
                        items.push({
                            name: `${option.item} Fajitas`,
                            price: option.price,
                            category: 'Fajitas',
                            emoji: '🌮',
                            priceType: 'money',
                            description: menu.specialties.fajitas.description
                        });
                    });
                }
                
                // Burritos
                if (menu.specialties.burritos) {
                    menu.specialties.burritos.forEach(item => {
                        items.push({
                            name: item.name,
                            price: item.price,
                            category: 'Burritos',
                            emoji: '🌯',
                            priceType: 'money',
                            description: item.description
                        });
                    });
                }
                
                // Quesadillas
                if (menu.specialties.quesadillas) {
                    menu.specialties.quesadillas.forEach(item => {
                        items.push({
                            name: item.name,
                            price: item.price,
                            category: 'Quesadillas',
                            emoji: '🧀',
                            priceType: 'money',
                            description: item.description
                        });
                    });
                }
                
                // Enchiladas
                if (menu.specialties.enchiladas) {
                    menu.specialties.enchiladas.forEach(item => {
                        items.push({
                            name: item.name,
                            price: item.price,
                            category: 'Enchiladas',
                            emoji: '🌮',
                            priceType: 'money',
                            description: item.description
                        });
                    });
                }
            }
            
            // Parse seafood
            if (menu.seafood) {
                menu.seafood.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Seafood',
                        emoji: '🦐',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse steaks
            if (menu.steaks) {
                menu.steaks.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Steaks',
                        emoji: '🥩',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse chicken
            if (menu.chicken) {
                menu.chicken.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Chicken',
                        emoji: '🍗',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse street tacos
            if (menu.street_tacos) {
                menu.street_tacos.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Street Tacos',
                        emoji: '🌮',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse kids menu
            if (menu.childrens_menu?.items) {
                menu.childrens_menu.items.forEach(item => {
                    items.push({
                        name: `Kids ${item.name}`,
                        price: item.price,
                        category: 'Kids Menu',
                        emoji: '🧒',
                        priceType: 'money'
                    });
                });
            }
            
            // Parse desserts
            if (menu.dessert_menu) {
                menu.dessert_menu.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Desserts',
                        emoji: '🍰',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            return items;
        }

        function parseGranvillePub(data) {
            const items = [];
            const menu = data.menu;
            
            // Parse starters
            if (menu.starters) {
                menu.starters.forEach(item => {
                    if (typeof item.price === 'object') {
                        // Items with size options
                        Object.entries(item.price).forEach(([size, price]) => {
                            items.push({
                                name: `${item.name} (${formatSizeName(size)})`,
                                price: price,
                                category: 'Starters',
                                emoji: '🍽️',
                                priceType: 'money',
                                description: item.description
                            });
                        });
                    } else {
                        items.push({
                            name: item.name,
                            price: item.price,
                            category: 'Starters',
                            emoji: '🍽️',
                            priceType: 'money',
                            description: item.description
                        });
                    }
                });
            }
            
            // Parse tenders and wings
            if (menu.tenders_and_wings?.items) {
                menu.tenders_and_wings.items.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Tenders & Wings',
                        emoji: '🍗',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse burgers
            if (menu.flame_grilled_burgers?.items) {
                menu.flame_grilled_burgers.items.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Burgers',
                        emoji: '🍔',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse salads
            if (menu.salads) {
                menu.salads.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Salads',
                        emoji: '🥗',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse flatbread pizzas
            if (menu.flatbread_pizzas) {
                menu.flatbread_pizzas.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Flatbread Pizzas',
                        emoji: '🍕',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse bowls and plates
            if (menu.bowls_and_plates) {
                menu.bowls_and_plates.forEach(item => {
                    if (typeof item.price === 'object') {
                        Object.entries(item.price).forEach(([size, price]) => {
                            items.push({
                                name: `${item.name} (${formatSizeName(size)})`,
                                price: price,
                                category: 'Bowls & Plates',
                                emoji: '🍲',
                                priceType: 'money',
                                description: item.description
                            });
                        });
                    } else {
                        items.push({
                            name: item.name,
                            price: item.price,
                            category: 'Bowls & Plates',
                            emoji: '🍽️',
                            priceType: 'money',
                            description: item.description
                        });
                    }
                });
            }
            
            // Parse sandwiches
            if (menu.sandwiches) {
                menu.sandwiches.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Sandwiches',
                        emoji: '🥪',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            // Parse sides
            if (menu.sides) {
                menu.sides.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Sides',
                        emoji: '🍟',
                        priceType: 'money'
                    });
                });
            }
            
            // Parse desserts
            if (menu.dessert) {
                menu.dessert.forEach(item => {
                    items.push({
                        name: item.name,
                        price: item.price,
                        category: 'Desserts',
                        emoji: '🍰',
                        priceType: 'money',
                        description: item.description
                    });
                });
            }
            
            return items;
        }

        function parseTheStation(data) {
            const items = [];
            const sections = data.sections;
            
            Object.entries(sections).forEach(([sectionKey, section]) => {
                const categoryName = formatSectionName(sectionKey);
                
                if (section.items) {
                    section.items.forEach(item => {
                        items.push({
                            name: item.name,
                            price: item.price,
                            category: categoryName,
                            emoji: getEmojiForItem(item.name),
                            priceType: 'money',
                            description: item.description
                        });
                    });
                }
            });
            
            return items;
        }

        function parseWhitts(data) {
            const items = [];
            
            // Parse custards
            if (data.custards) {
                data.custards.forEach(item => {
                    if (item.sizes) {
                        Object.entries(item.sizes).forEach(([size, price]) => {
                            const priceNum = parseFloat(price.replace('$', ''));
                            items.push({
                                name: `${item.name} (${size})`,
                                price: priceNum,
                                category: 'Custards',
                                emoji: '🍦',
                                priceType: 'money'
                            });
                        });
                    }
                });
            }
            
            // Parse favorites
            if (data.favorites) {
                data.favorites.forEach(item => {
                    if (item.price) {
                        if (typeof item.price === 'string') {
                            // Handle range prices by taking the lower bound
                            const priceNum = parseFloat(item.price.replace('$', '').split(' ')[0]);
                            items.push({
                                name: item.name,
                                price: priceNum,
                                category: 'Favorites',
                                emoji: '🍨',
                                priceType: 'money'
                            });
                        } else {
                            const priceNum = parseFloat(item.price);
                            items.push({
                                name: item.name,
                                price: priceNum,
                                category: 'Favorites',
                                emoji: '🍨',
                                priceType: 'money'
                            });
                        }
                    } else if (item.sizes) {
                        Object.entries(item.sizes).forEach(([size, price]) => {
                            const priceNum = parseFloat(price.replace('$', ''));
                            items.push({
                                name: `${item.name} (${size})`,
                                price: priceNum,
                                category: 'Favorites',
                                emoji: '🥤',
                                priceType: 'money'
                            });
                        });
                    }
                });
            }
            
            // Parse specialty sundaes
            if (data.specialties) {
                const sundaeBase = data.specialties.find(item => item.name === 'Specialty Sundae');
                if (sundaeBase && sundaeBase.sizes) {
                    // Get all specialty flavors
                    const flavors = data.specialties.filter(item => item.name !== 'Specialty Sundae' && !item.sizes);
                    
                    flavors.forEach(flavor => {
                        Object.entries(sundaeBase.sizes).forEach(([size, price]) => {
                            const priceNum = parseFloat(price.replace('$', ''));
                            items.push({
                                name: `${flavor.name} Sundae (${size})`,
                                price: priceNum,
                                category: 'Specialty Sundaes',
                                emoji: '🍨',
                                priceType: 'money',
                                description: flavor.description
                            });
                        });
                    });
                }
            }
            
            return items;
        }

        // Helper function to create item variants for different price structures
        function createItemVariants(item, category, restaurantType) {
            const variants = [];
            
            if (typeof item.price === 'number') {
                // Simple price
                variants.push({
                    name: item.name,
                    price: item.price,
                    category: category,
                    emoji: getEmojiForItem(item.name),
                    priceType: 'money'
                });
            } else if (typeof item.price === 'object') {
                // Size-based pricing
                Object.entries(item.price).forEach(([size, price]) => {
                    variants.push({
                        name: `${item.name} (${formatSizeName(size)})`,
                        price: price,
                        category: category,
                        emoji: getEmojiForItem(item.name),
                        priceType: 'money'
                    });
                });
            }
            
            return variants;
        }

        // Helper to format section names
        function formatSectionName(key) {
            return key.split('_').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');
        }

        // Helper to format size names
        function formatSizeName(size) {
            const sizeMap = {
                'half_pound': 'Half Pound',
                'full_pound': 'Full Pound',
                'pint': 'Pint',
                'quart': 'Quart',
                'small': 'Small',
                'large': 'Large',
                'cup': 'Cup',
                'bowl': 'Bowl'
            };
            return sizeMap[size] || size.charAt(0).toUpperCase() + size.slice(1);
        }

        async function loadCustomStoreItems(storeId) {
            itemListContainer.innerHTML = `<div class="loading-message"><div class="loading-spinner"></div><p>Loading your items...</p></div>`;
            try {
                const itemsRef = collection(db, "users", currentUser.uid, "customStores", storeId, "items");
                const q = query(itemsRef, orderBy("name"));
                const querySnapshot = await getDocs(q);
                
                if (querySnapshot.empty) {
                    allItems = [];
                    itemListContainer.innerHTML = '<p class="empty-message">No items yet. Click "Add New Item" to get started!</p>';
                    return;
                }
                
                const store = customStores.find(s => s.id === storeId);
                const storeCurrency = store?.currency || 'dollars';
                
                // Determine if store uses money or count type
                let itemPriceType = 'money';
                if (storeCurrency !== 'dollars') {
                    const balanceType = userBalanceTypes.find(bt => bt.id === storeCurrency);
                    if (balanceType && balanceType.type === 'count') {
                        itemPriceType = 'count';
                    }
                }
                
                const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                allItems = items.map(item => ({
                    ...item,
                    emoji: getEmojiForItem(item.name),
                    priceType: itemPriceType
                }));
                
                renderItems();
            } catch (error) {
                console.error("Error loading custom store items:", error);
                allItems = [];
                itemListContainer.innerHTML = '<p class="empty-message">Error loading items. Please try again.</p>';
            }
        }

        async function loadSubscriptions() {
            const subsRef = collection(db, "users", currentUser.uid, "subscriptions");
            const q = query(subsRef, orderBy("startDate", "desc"));
            const querySnapshot = await getDocs(q);
            subscriptions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        async function loadPurchaseHistory() {
            const historyRef = collection(db, "users", currentUser.uid, "purchases");
            const q = query(historyRef, orderBy("purchaseDate", "desc"));
            const querySnapshot = await getDocs(q);
            purchaseHistory = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        async function checkAndCreateFrequentWidget(db, storeName) {
            if (!currentUser || cart.length === 0) return;
            try {
                const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
                const widgetsSnapshot = await getDocs(widgetsRef);
                if (widgetsSnapshot.size >= 3) return;
        
                let balanceTypeToDebit = selectedPaymentBalance || 'credits';
        
                for (const cartItem of cart) {
                    let widgetExists = widgetsSnapshot.docs.some(doc => doc.data().itemName === cartItem.name);
                    if (widgetExists) continue;
        
                    const purchasesRef = collection(db, "users", currentUser.uid, "purchases");
                    const allPurchasesSnapshot = await getDocs(purchasesRef);
                    let purchaseCount = allPurchasesSnapshot.docs.reduce((count, doc) => {
                        const items = doc.data().items || [];
                        const item = items.find(i => i.name === cartItem.name);
                        return count + (item ? item.quantity : 0);
                    }, 0);
                    purchaseCount += cartItem.quantity;
        
                    const FREQUENCY_THRESHOLD = 3;
                    if (purchaseCount >= FREQUENCY_THRESHOLD) {
                        await addDoc(widgetsRef, {
                            itemName: cartItem.name,
                            itemPrice: cartItem.price,
                            storeName: storeName,
                            currency: currentStoreCurrency,
                            balanceType: balanceTypeToDebit,
                            createdAt: Timestamp.now()
                        });
                        const updatedSnapshot = await getDocs(widgetsRef);
                        if (updatedSnapshot.size >= 3) break;
                    }
                }
            } catch (error) {
                console.error("Error checking/creating frequent widget:", error);
            }
        }

        // --- UPDATE STORE CURRENCY OPTIONS ---
        function updateStoreCurrencyOptions() {
            if (!newStoreCurrencyInput) return;
            
            newStoreCurrencyInput.innerHTML = '';
            
            // For ALL users, iterate through their defined balance types
            // This makes the logic consistent and removes the isDenisonStudent fork
            if (userBalanceTypes && userBalanceTypes.length > 0) {
                userBalanceTypes.forEach(balanceType => {
                    // Skip the generic 'credits' balance for Denison students, as it's not a real currency for a store
                    if (isDenisonStudent && balanceType.id === 'credits') {
                        return;
                    }

                    const option = document.createElement('option');
                    option.value = balanceType.id; // The value is the unique balance ID
                    
                    if (balanceType.type === 'money') {
                        option.textContent = `${balanceType.label} ($)`;
                    } else {
                        option.textContent = balanceType.label;
                    }
                    newStoreCurrencyInput.appendChild(option);
                });
            }
            
            // If after filtering, there are no options, show a message/default
            if (newStoreCurrencyInput.options.length === 0) {
                newStoreCurrencyInput.innerHTML = '<option value="" disabled>No balances available to create a store</option>';
            }
        }

        // --- RENDERING ---
        function renderAllWallets(animatedWallet = null) {
            const walletWrapper = document.getElementById('wallets-group');
            const userBalances = userProfile.balances || {};
            if (!walletWrapper) return;
            walletWrapper.innerHTML = '';
        
            let availableBalanceTypes = [];
            let isSelectorLocked = false;
        
            // Check if it's a campus restaurant
            const isCampusRestaurant = CAMPUS_RESTAURANTS.some(r => r.id === currentStoreId);
            
            if (currentStoreId === 'ross' || isCampusRestaurant) {
                if (isDenisonStudent) {
                    availableBalanceTypes = userBalanceTypes.filter(bt => bt.id === 'credits');
                    isSelectorLocked = true;
                } else {
                    // This case is for a non-Denison user, who shouldn't see Ross Market or campus restaurants anyway,
                    // but as a fallback, we show all their balances, unlocked.
                    availableBalanceTypes = userBalanceTypes;
                }
            } else { // It's a custom store
                // For custom stores, the selector is always locked to the designated balance.
                // selectedPaymentBalance is already set correctly in handleStoreChange.
                availableBalanceTypes = userBalanceTypes.filter(bt => bt.id === selectedPaymentBalance);
                isSelectorLocked = true;
            }
        
            // Create custom payment selector
            const paymentSelector = document.createElement('div');
            paymentSelector.className = 'custom-payment-wrapper';
            paymentSelector.innerHTML = `
                <div class="payment-selector-trigger">
                    <span class="payment-label">Pay with:</span>
                    <div class="payment-display">
                        <span class="payment-value"></span>
                        ${!isSelectorLocked ? '<div class="payment-arrow"></div>' : ''}
                    </div>
                </div>
                <div class="payment-options">
                    ${availableBalanceTypes.map(bt => {
                        const balance = userBalances[bt.id] || 0;
                        const displayValue = bt.type === 'money' ? `$${balance.toFixed(2)}` : balance;
                        return `<div class="payment-option" data-balance-id="${bt.id}">
                            <span class="option-label">${bt.label}</span>
                            <span class="option-balance">${displayValue}</span>
                        </div>`;
                    }).join('')}
                </div>
            `;
            walletWrapper.appendChild(paymentSelector);
        
            // Setup payment selector functionality
            const trigger = paymentSelector.querySelector('.payment-selector-trigger');
            const optionsContainer = paymentSelector.querySelector('.payment-options');
            const displayValue = paymentSelector.querySelector('.payment-value');
            
            // Set initial display
            updatePaymentDisplay();
            
            function updatePaymentDisplay() {
                const selected = userBalanceTypes.find(bt => bt.id === selectedPaymentBalance);
                if (selected) {
                    const balance = userBalances[selected.id] || 0;
                    const displayText = selected.type === 'money' ? `$${balance.toFixed(2)}` : `${balance}`;
                    displayValue.textContent = `${selected.label} (${displayText})`;
                } else {
                    displayValue.textContent = "No balance available";
                }
            }
            
            if (!isSelectorLocked) {
                trigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    paymentSelector.classList.toggle('open');
                });
            
                paymentSelector.querySelectorAll('.payment-option').forEach(option => {
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const balanceId = option.dataset.balanceId;
                        selectedPaymentBalance = balanceId;
                        paymentSelector.classList.remove('open');
                        updatePaymentDisplay();
                        
                        // Clear cart if switching between money and count types
                        const newBalanceType = userBalanceTypes.find(bt => bt.id === balanceId);
                        if (cart.length > 0 && newBalanceType) {
                            const cartHasMoneyItems = cart.some(item => item.priceType === 'money');
                            const switchingToCount = newBalanceType.type === 'count';
                            
                            if ((cartHasMoneyItems && switchingToCount) || (!cartHasMoneyItems && !switchingToCount)) {
                                cart = [];
                                renderCart();
                                showSimpleAlert('Cart cleared due to payment type change');
                            }
                        }
                        
                        renderAllWallets();
                    });
                });
            } else {
                trigger.style.cursor = 'default';
            }
        
            // Desktop only: Display wallet cards
            const isMobile = window.innerWidth <= 640;
            if (!isMobile) {
                const moneyBalances = userBalanceTypes.filter(bt => bt.type === 'money').slice(0, 2);
                
                moneyBalances.forEach(balanceType => {
                    const balance = userBalances[balanceType.id] || 0;
                    const isSelected = balanceType.id === selectedPaymentBalance;
                    
                    const walletEl = document.createElement('div');
                    walletEl.className = `wallet-container ${isSelected ? 'selected-wallet' : ''}`;
                    if (animatedWallet === balanceType.id) walletEl.classList.add('hit');
                    
                    // Create appropriate icon based on balance type
                    let iconSvg;
                    if (isDenisonStudent) {
                        // Use existing icons for Denison balances
                        if (balanceType.id === 'credits') {
                            iconSvg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="18" height="12" rx="2" fill="#4CAF50" /><circle cx="12" cy="12" r="3" fill="#FFFDF7"/><path d="M12 10.5V13.5M13 11.5H11" stroke="#4A2C2A" stroke-width="1.5" stroke-linecap="round"/></svg>`;
                        } else if (balanceType.id === 'dining') {
                            iconSvg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 8.5C18 5.46243 15.3137 3 12 3C8.68629 3 6 5.46243 6 8.5C6 10.4462 6.94878 12.1643 8.40993 13.2218C8.43542 13.2403 8.46154 13.2579 8.48828 13.2747L9 13.5858V16.5C9 17.0523 9.44772 17.5 10 17.5H14C14.5523 17.5 15 17.0523 15 16.5V13.5858L15.5117 13.2747C15.5385 13.2579 15.5646 13.2403 15.5901 13.2218C17.0512 12.1643 18 10.4462 18 8.5Z" fill="#D97706"/><path d="M12 21C13.1046 21 14 20.1046 14 19H10C10 20.1046 10.8954 21 12 21Z" fill="#FBBF24"/><path d="M12 5.5L13.5 8.5L16.5 9L14.5 11L15 14L12 12.5L9 14L9.5 11L7.5 9L10.5 8.5L12 5.5Z" fill="#FBBF24"/></svg>`;
                        } else {
                            // Generic money icon for other Denison balances
                            iconSvg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" fill="#45A049"/><text x="12" y="16" font-family="Arial" font-size="12" fill="white" text-anchor="middle">$</text></svg>`;
                        }
                    } else {
                        // Custom university - use a generic wallet icon
                        iconSvg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="7" width="16" height="10" rx="2" fill="#6B46C1"/><path d="M4 9h16" stroke="#8B5CF6" stroke-width="2"/><circle cx="12" cy="13" r="2" fill="#FDE68A"/></svg>`;
                    }
                    
                    // Truncate long labels
                    const displayLabel = balanceType.label.length > 15 
                        ? balanceType.label.substring(0, 12) + '...' 
                        : balanceType.label;
                    
                    walletEl.innerHTML = `
                        <div class="wallet-icon">${iconSvg}</div>
                        <div class="wallet-details">
                            <div class="wallet-label" title="${balanceType.label}">${displayLabel}</div>
                            <div class="wallet-amount">$${balance.toFixed(2)}</div>
                        </div>
                    `;
                    
                    walletWrapper.appendChild(walletEl);
                });
            }
            
            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                paymentSelector.classList.remove('open');
            });
        }

        function renderCategories() {
            const categories = ['All', ...new Set(allItems.map(item => item.category).sort())];
            categorySidebar.innerHTML = categories.map(category => `
                <a class="category-link ${category === currentCategory ? 'active' : ''}" data-category="${category}">${category}</a>
            `).join('');
        }

        function renderItems(searchFilter = '', categoryFilter = 'All') {
            itemListContainer.innerHTML = '';
            itemListContainer.classList.remove('loading-message');

            let itemsToDisplay = allItems
                .filter(item => categoryFilter === 'All' || item.category === categoryFilter)
                .filter(item => item.name.toLowerCase().includes(searchFilter.toLowerCase()));

            if (itemsToDisplay.length === 0) {
                itemListContainer.innerHTML = '<p class="empty-message">No items found. Try a different search!</p>';
                return;
            }

            // Check if current payment balance is count type
            const currentBalanceType = userBalanceTypes.find(bt => bt.id === selectedPaymentBalance);
            const isPaymentCountType = currentBalanceType && currentBalanceType.type === 'count';

            const fragment = document.createDocumentFragment();
            itemsToDisplay.slice(0, 100).forEach(item => {
                const card = document.createElement('div');
                card.className = 'item-card';
                
                // Disable money items if paying with count type
                const isDisabled = isPaymentCountType && item.priceType === 'money';
                if (isDisabled) {
                    card.classList.add('disabled-item');
                }
                
                // Check if it's a campus restaurant (all campus restaurants accept only credits)
                const isCampusRestaurant = CAMPUS_RESTAURANTS.some(r => r.id === currentStoreId);
                
                card.innerHTML = `
                    <div class="item-emoji">${item.emoji}</div>
                    <div class="item-name">${item.name}</div>
                    <div class="item-price-tag">
                        <span class="item-price">${getPriceLabel(item.price, currentStoreCurrency)}</span>
                        ${(item.onSale && currentStoreId === 'ross') ? `<span class="item-original-price">${item.originalPrice.toFixed(2)}</span>` : ''}
                    </div>
                    ${(item.onSale && currentStoreId === 'ross') ? '<div class="sale-badge">SALE</div>' : ''}
                    ${isDisabled ? '<div class="disabled-overlay">Requires money payment</div>' : ''}
                `;
                
                if (!isDisabled) {
                    card.addEventListener('click', () => addItemToCart(item));
                }
                
                fragment.appendChild(card);
            });
            itemListContainer.appendChild(fragment);
        }

        function renderCart(animatedItemName = null) {
            const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            cartTotalEl.textContent = getPriceLabel(total, currentStoreCurrency);

            if (cart.length === 0) {
                cartItemsContainer.innerHTML = `<div class="empty-basket"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"><path d="M5 6m0 1a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z"></path><path d="M10 6v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3"></path></svg><p>Your basket is empty!</p><span>Click items to add them</span></div>`;
                logPurchaseBtn.disabled = true;
            } else {
                // Check if we should show add to subs button (only for Ross Market, Denison students)
                const showSubsButton = currentStoreId === 'ross' && isDenisonStudent;
                
                cartItemsContainer.innerHTML = cart.map(item => `
                    <div class="cart-item ${item.name === animatedItemName ? 'slide-in' : ''}">
                        <div class="cart-item-emoji">${item.emoji}</div>
                        <div class="cart-item-name-and-qty">
                            <div class="cart-item-name">${item.name}</div>
                            <div class="cart-item-quantity">
                                <button class="quantity-btn decrease-btn" data-name="${item.name}">-</button>
                                <span class="quantity-display">${item.quantity}</span>
                                <button class="quantity-btn increase-btn" data-name="${item.name}">+</button>
                            </div>
                        </div>
                        <div class="cart-item-price">${getPriceLabel(item.price * item.quantity, currentStoreCurrency)}</div>
                        <div class="cart-item-actions">
                            ${showSubsButton ? `<button class="add-to-subs-btn" data-name="${item.name}" title="Add to weekly subscriptions"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"></path><path d="M12 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line></svg></button>` : ''}
                            <button class="remove-item-btn" data-name="${item.name}" title="Remove from cart">×</button>
                        </div>
                    </div>
                `).join('');
                logPurchaseBtn.disabled = false;
            }
        }
        
        function renderSubscriptions() {
            const activeSubs = subscriptions.filter(s => s.status === 'active');
            const pastSubs = subscriptions.filter(s => s.status === 'ended');

            activeSubsList.innerHTML = activeSubs.length === 0 ? '<p class="empty-message">No weekly favorites yet!</p>' : activeSubs.map(sub => `
                <div class="sub-item">
                    <div class="cart-item-emoji">${sub.item.emoji}</div>
                    <div>
                        <div class="cart-item-name">${sub.item.name} (x${sub.quantity || 1})</div>
                        <div class="sub-duration">Every week</div>
                    </div>
                    <div class="cart-item-price">$${(sub.item.price * (sub.quantity || 1)).toFixed(2)}</div>
                    <button class="end-sub-btn" data-id="${sub.id}">End</button>
                </div>
            `).join('');

            pastSubsList.innerHTML = pastSubs.length === 0 ? '<p class="empty-message">No past subscriptions</p>' : pastSubs.map(sub => `
                <div class="sub-item ended">
                    <div class="cart-item-emoji">${sub.item.emoji}</div>
                    <div>
                        <div class="cart-item-name">${sub.item.name}</div>
                        <div class="sub-duration">Ended</div>
                    </div>
                    <div class="cart-item-price">$${sub.item.price.toFixed(2)}</div>
                </div>
            `).join('');
        }

        function renderHistory() {
            if (purchaseHistory.length === 0) {
                historyList.innerHTML = '<p class="empty-message">No purchases yet!</p>';
                return;
            }

            const groupedByDate = purchaseHistory.reduce((acc, purchase) => {
                const date = purchase.purchaseDate.toDate().toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
                if (!acc[date]) acc[date] = [];
                acc[date].push(purchase);
                return acc;
            }, {});

            historyList.innerHTML = Object.entries(groupedByDate).map(([date, purchases]) => `
                <div class="history-group">
                    <h3 class="history-date">${date}</h3>
                    ${purchases.map(purchase => `
                        <div class="history-purchase">
                            <div class="history-purchase-header">
                                <span>${purchase.store}</span>
                                <span>-${getPriceLabel(purchase.total, purchase.currency || 'dollars')}</span>
                            </div>
                            <ul class="history-item-list">
                                ${purchase.items.map(item => `<li>${item.quantity > 1 ? `${item.name} (x${item.quantity})` : item.name}</li>`).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>
            `).join('');
        }

        // --- ACTIONS & EVENT HANDLERS ---
        function switchToTab(tabId) {
            tabBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });
            tabContents.forEach(content => {
                content.classList.toggle('active', content.id === `${tabId}-tab`);
            });
        }
        
        function addItemToCart(item) {
            // Check compatibility between item and payment type
            const currentBalanceType = userBalanceTypes.find(bt => bt.id === selectedPaymentBalance);
            if (currentBalanceType) {
                const isPaymentCountType = currentBalanceType.type === 'count';
                const isItemMoney = item.priceType === 'money';
                
                if (isPaymentCountType && isItemMoney) {
                    showSimpleAlert(`Cannot add $ items when paying with ${currentBalanceType.label}`);
                    return;
                }
            }
            
            const existingItem = cart.find(cartItem => cartItem.name === item.name);
            if (existingItem) {
                existingItem.quantity++;
                renderCart();
            } else {
                cart.push({ ...item, quantity: 1 });
                renderCart(item.name);
            }
            switchToTab('cart');
        }

        function removeItemFromCart(itemName) {
            cart = cart.filter(item => item.name !== itemName);
            renderCart();
        }

        function changeQuantity(itemName, change) {
            const cartItem = cart.find(item => item.name === itemName);
            if (cartItem) {
                cartItem.quantity += change;
                if (cartItem.quantity <= 0) removeItemFromCart(itemName);
                else renderCart();
            }
        }

        async function addSubscription(itemToSub) {
            await addDoc(collection(db, "users", currentUser.uid, "subscriptions"), {
                item: { name: itemToSub.name, price: itemToSub.price, emoji: itemToSub.emoji },
                quantity: itemToSub.quantity, 
                status: 'active', 
                startDate: Timestamp.now(),
                needsCatchUpPayment: true
            });
            removeItemFromCart(itemToSub.name);
            await loadSubscriptions();
            renderSubscriptions();
            updateWeeklySubsView();
        }

        async function endSubscription(subId) {
            const subToEnd = subscriptions.find(s => s.id === subId);
        
            if (subToEnd) {
                // If it was never paid for, just delete it.
                if (subToEnd.needsCatchUpPayment === true) {
                    await deleteDoc(doc(db, "users", currentUser.uid, "subscriptions", subId));
                } else {
                    // Otherwise, mark it as ended to show in history.
                    await updateDoc(doc(db, "users", currentUser.uid, "subscriptions", subId), {
                        status: 'ended', 
                        endDate: Timestamp.now()
                    });
                }
            } else {
                console.warn(`Could not find subscription with id ${subId} in local state. Deleting directly.`);
                await deleteDoc(doc(db, "users", currentUser.uid, "subscriptions", subId));
            }
        
            await loadSubscriptions();
            renderSubscriptions();
            updateWeeklySubsView();
        }

        async function deleteCustomStore(storeId) {
            try {
                const itemsRef = collection(db, "users", currentUser.uid, "customStores", storeId, "items");
                const itemsSnapshot = await getDocs(itemsRef);
                const deletePromises = itemsSnapshot.docs.map(docSnapshot => deleteDoc(docSnapshot.ref));
                await Promise.all(deletePromises);

                await deleteDoc(doc(db, "users", currentUser.uid, "customStores", storeId));

                // After deleting, check if there are any stores left
                await loadCustomStores();
                if (isDenisonStudent) {
                    storeSelect.value = 'ross';
                    currentStoreId = 'ross';
                } else if (customStores.length > 0) {
                    currentStoreId = customStores[0].id;
                    storeSelect.value = currentStoreId;
                } else {
                    // No stores left for custom university student
                    currentStoreId = 'create-new';
                    createStoreModal.classList.remove('hidden');
                }
                await handleStoreChange();
            } catch (error) {
                console.error("Error deleting custom store:", error);
                showSimpleAlert(`Failed to delete store: ${error.message || 'Unknown error'}`);
            }
        }

        async function logPurchase() {
            if (cart.length === 0 || !selectedPaymentBalance) return;
            
            const totalCost = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const userBalances = userProfile.balances || {};
            
            // Get the selected balance type info
            const selectedBalanceType = userBalanceTypes.find(bt => bt.id === selectedPaymentBalance);
            if (!selectedBalanceType) {
                showSimpleAlert('Please select a payment method');
                return;
            }
            
            const currentBalance = userBalances[selectedPaymentBalance] || 0;
            const balanceName = selectedBalanceType.label;
            
            if (totalCost > currentBalance) {
                showSimpleAlert(`Not enough ${balanceName}!`);
                return;
            }
        
            logPurchaseBtn.disabled = true;
            logPurchaseBtn.innerHTML = `<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; margin-right: 0.5rem;"></span> Processing...`;
        
            try {
                const userDocRef = doc(db, "users", currentUser.uid);
                const storeName = storeSelect.options[storeSelect.selectedIndex].text;
        
                await addDoc(collection(db, "users", currentUser.uid, "purchases"), {
                    items: cart.map(({ emoji, category, priceType, ...rest }) => rest),
                    total: totalCost,
                    store: storeName,
                    currency: currentStoreCurrency,
                    balanceType: selectedPaymentBalance,
                    purchaseDate: Timestamp.now()
                });
        
                let updateData = {};
                updateData[`balances.${selectedPaymentBalance}`] = currentBalance - totalCost;
                
                // Only update streak for Ross Market purchases by Denison students
                if (currentStoreId === 'ross' && isDenisonStudent) {
                    const { currentStreak = 0, longestStreak = 0, lastLogDate = null } = userProfile;
                    const today = new Date(); 
                    today.setHours(0, 0, 0, 0);
                    let newCurrentStreak = currentStreak;
                    if (lastLogDate) {
                        const lastDate = lastLogDate.toDate(); 
                        lastDate.setHours(0, 0, 0, 0);
                        const diffDays = Math.ceil((today - lastDate) / (1000 * 60 * 60 * 24));
                        if (diffDays === 1) newCurrentStreak++;
                        else if (diffDays > 1) newCurrentStreak = 1;
                    } else {
                        newCurrentStreak = 1;
                    }
                    updateData.currentStreak = newCurrentStreak;
                    updateData.longestStreak = Math.max(longestStreak, newCurrentStreak);
                    updateData.lastLogDate = Timestamp.now();
                }
                
                walletToAnimate = selectedPaymentBalance;
                await updateDoc(userDocRef, updateData);
                await checkAndCreateFrequentWidget(db, storeName);
                
                cart = [];
                await loadPurchaseHistory();
                renderCart();
                renderHistory();
        
            } catch (error) {
                console.error("Error logging purchase:", error);
                showSimpleAlert("Failed to log purchase. Please try again.");
            } finally {
                logPurchaseBtn.disabled = false;
                logPurchaseBtn.innerHTML = `<span>Checkout</span><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
            }
        }

        function updateWeeklySubsView() {
            const activeSubs = subscriptions.filter(s => s.status === 'active');
            const weeklyCost = activeSubs.reduce((sum, sub) => sum + (sub.item.price * (sub.quantity || 1)), 0);

            const weeklySubCostEl = document.getElementById('weekly-sub-cost');
            const chargeSubsBtn = document.getElementById('charge-subs-btn');
            
            if (!weeklySubCostEl || !chargeSubsBtn) return;

            // Only show weekly subscriptions for Denison students
            if (!isDenisonStudent) {
                document.getElementById('subs-tab').classList.add('hidden');
                // Hide the subscriptions tab button
                document.querySelector('[data-tab="subs"]').style.display = 'none';
                return;
            }

            const lastPayment = userProfile.subscriptionInfo?.lastPaymentDate?.toDate();
            const startOfWeek = getStartOfWeek();
            const hasPaidThisWeek = lastPayment && lastPayment >= startOfWeek;

            if (hasPaidThisWeek) {
                const newSubs = activeSubs.filter(s => s.needsCatchUpPayment === true);
                const newItemsCost = newSubs.reduce((sum, sub) => sum + (sub.item.price * (sub.quantity || 1)), 0);

                if (newItemsCost > 0) {
                    weeklySubCostEl.textContent = `$${newItemsCost.toFixed(2)}`;
                    chargeSubsBtn.disabled = false;
                    chargeSubsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14m-7-7h14"></path></svg><span>Pay for New Items</span>`;
                    chargeSubsBtn.dataset.mode = 'new_items';
                } else {
                    weeklySubCostEl.textContent = `$${weeklyCost.toFixed(2)}`;
                    chargeSubsBtn.disabled = true;
                    chargeSubsBtn.innerHTML = `<span>Paid This Week</span>`;
                    chargeSubsBtn.dataset.mode = 'paid';
                }
            } else {
                weeklySubCostEl.textContent = `$${weeklyCost.toFixed(2)}`;
                chargeSubsBtn.disabled = weeklyCost <= 0;
                chargeSubsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><span>Pay Weekly Bill</span>`;
                chargeSubsBtn.dataset.mode = 'full_bill';
            }
        }

        async function chargeWeeklySubscriptions() {
            const chargeSubsBtn = document.getElementById('charge-subs-btn');
            const mode = chargeSubsBtn.dataset.mode;
            if (mode === 'paid' || !mode) return;

            const userBalances = userProfile.balances || {};
            const activeSubs = subscriptions.filter(s => s.status === 'active');
            let subsToCharge;
            let purchaseStoreName;

            if (mode === 'new_items') {
                subsToCharge = activeSubs.filter(s => s.needsCatchUpPayment === true);
                purchaseStoreName = "New Weekly Items";
            } else { // mode === 'full_bill'
                subsToCharge = activeSubs;
                purchaseStoreName = "Weekly Bill";
            }

            if (subsToCharge.length === 0) return;

            const totalCost = subsToCharge.reduce((sum, sub) => sum + (sub.item.price * (sub.quantity || 1)), 0);

            // For subscriptions, always use credits for Denison students
            const paymentBalance = 'credits';
            if (totalCost > (userBalances[paymentBalance] || 0)) {
                showSimpleAlert("Not enough Campus Credits!");
                return;
            }

            chargeSubsBtn.disabled = true;
            chargeSubsBtn.innerHTML = `<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; margin-right: 0.5rem;"></span> Paying...`;

            try {
                // 1. Log the purchase
                const purchaseItems = subsToCharge.map(sub => ({
                    name: sub.item.name, price: sub.item.price, quantity: sub.quantity || 1
                }));
                await addDoc(collection(db, "users", currentUser.uid, "purchases"), {
                    items: purchaseItems, total: totalCost, store: purchaseStoreName, currency: "dollars", purchaseDate: Timestamp.now()
                });

                // 2. Update user balance and possibly payment date
                const userDocRef = doc(db, "users", currentUser.uid);
                const updateData = { 'balances.credits': (userBalances.credits || 0) - totalCost };
                if (mode === 'full_bill') {
                    updateData['subscriptionInfo.lastPaymentDate'] = Timestamp.now();
                }
                await updateDoc(userDocRef, updateData);
                walletToAnimate = 'credits';

                // 3. Batch update subscriptions to clear the flag
                const batch = writeBatch(db);
                subsToCharge.forEach(sub => {
                    const subRef = doc(db, "users", currentUser.uid, "subscriptions", sub.id);
                    batch.update(subRef, { needsCatchUpPayment: false });
                });
                await batch.commit();

                // 4. Reload local data and re-render
                await loadSubscriptions(); 
                await loadPurchaseHistory();
                renderHistory();
                renderSubscriptions(); 
                showSimpleAlert(`${purchaseStoreName} paid successfully!`);

            } catch (error) {
                console.error(`Error charging subscriptions (mode: ${mode}):`, error);
                showSimpleAlert("Failed to process payment. Please try again.");
            }
        }

        // --- HELPERS ---
        function getStartOfWeek() {
            const now = new Date();
            const dayOfWeek = now.getDay(); // Sunday = 0, Monday = 1, ...
            const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
            const startOfWeek = new Date(now.setDate(diff));
            startOfWeek.setHours(0, 0, 0, 0);
            return startOfWeek;
        }

        function getPriceLabel(price, currency) {
            // Check if it's a custom balance type
            if (currency !== 'dollars' && currency !== 'swipes' && currency !== 'bonus_swipes') {
                // It's a custom balance ID, find its type
                const balanceType = userBalanceTypes.find(bt => bt.id === currency);
                if (balanceType) {
                    if (balanceType.type === 'money') {
                        return `$${price.toFixed(2)}`;
                    } else {
                        return `${price} ${balanceType.label}${price !== 1 ? 's' : ''}`;
                    }
                }
            }
            
            // Default behavior for standard currencies
            switch (currency) {
                case 'dollars': return `$${price.toFixed(2)}`;
                case 'swipes': return `${price} Swipe${price !== 1 ? 's' : ''}`;
                case 'bonus_swipes': return `${price} Bonus Swipe${price !== 1 ? 's' : ''}`;
                default: return `$${price.toFixed(2)}`;
            }
        }

        function showSimpleAlert(message, title = "Heads up!") {
            let alertModal = document.getElementById('simple-alert-modal');
            if (!alertModal) {
                alertModal = document.createElement('div');
                alertModal.id = 'simple-alert-modal';
                alertModal.className = 'modal-overlay hidden';
                alertModal.innerHTML = `
                    <div class="modal-paper">
                        <div class="modal-pin"></div>
                        <h2 class="modal-title" id="simple-alert-title"></h2>
                        <p id="simple-alert-message"></p>
                        <div class="modal-actions">
                            <button id="simple-alert-ok-btn" class="modal-btn confirm">Got it</button>
                        </div>
                    </div>`;
                document.body.appendChild(alertModal);
                alertModal.querySelector('#simple-alert-ok-btn').addEventListener('click', () => alertModal.classList.add('hidden'));
                alertModal.addEventListener('click', (e) => { if (e.target === alertModal) alertModal.classList.add('hidden'); });
            }
            alertModal.querySelector('#simple-alert-title').textContent = title;
            alertModal.querySelector('#simple-alert-message').textContent = message;
            alertModal.classList.remove('hidden');
        }
        
        function detectCategory(item) {
            const departmentMap = {"1544840": "Dips & Spreads", "1544841": "Dips & Spreads", "1457139": "Beverages"};
            const departmentId = item.department && item.department.length > 0 ? item.department[0] : null;
            if (departmentId && departmentMap[departmentId]) return departmentMap[departmentId];
            const itemNameLower = item.name.toLowerCase();
            const categories = { "Snacks": ["chip", "cookie", "cracker"], "Drinks": ["water", "soda", "juice"], "Candy": ["chocolate", "candy"], "Fresh": ["fruit", "vegetable"], "Dairy": ["cheese", "yogurt"], "Frozen": ["ice cream", "frozen"], "Bakery": ["bread", "bagel"], "Meal": ["sandwich", "wrap", "pizza"] };
            for (const [category, keywords] of Object.entries(categories)) {
                if (keywords.some(keyword => itemNameLower.includes(keyword))) return category;
            }
            return 'Miscellaneous';
        }

        function getEmojiForItem(name) {
            const lowerName = name.toLowerCase();
            const keywords = { 
                '☕': ['coffee', 'latte', 'espresso', 'mocha'], 
                '🍵': ['tea', 'matcha'], 
                '🥤': ['soda', 'coke', 'pepsi', 'sprite', 'drink'], 
                '🧃': ['juice', 'lemonade'], 
                '💧': ['water'], 
                '🍔': ['burger', 'cheeseburger'], 
                '🍕': ['pizza'], 
                '🥪': ['sandwich', 'sub', 'wrap', 'club', 'melt'], 
                '🌮': ['taco', 'burrito', 'enchilada', 'fajita', 'quesadilla'], 
                '🍗': ['chicken', 'wing', 'tender'], 
                '🥩': ['steak', 'beef', 'ribeye', 'carne'], 
                '🦐': ['shrimp', 'camarones', 'seafood'], 
                '🍳': ['egg', 'breakfast'], 
                '🥓': ['bacon'], 
                '🍟': ['fries', 'tots', 'potato'], 
                '🥗': ['salad'], 
                '🍲': ['soup', 'chili', 'stew', 'consome', 'pozole'], 
                '🥟': ['dumpling', 'bun', 'sopes'], 
                '🌯': ['burrito', 'wrap'], 
                '🧀': ['cheese', 'queso'], 
                '🍦': ['ice cream', 'custard', 'sundae', 'cone'], 
                '🍨': ['sundae', 'parfait', 'float'], 
                '🍰': ['cake', 'dessert', 'brownie'], 
                '🍩': ['donut'], 
                '🍪': ['cookie'], 
                '🍫': ['chocolate', 'candy'], 
                '🥨': ['pretzel', 'chip'], 
                '🍿': ['popcorn'], 
                '🥖': ['bread', 'baguette'], 
                '🍎': ['apple'], 
                '🍌': ['banana'], 
                '🌽': ['corn'], 
                '🥕': ['carrot'], 
                '🥦': ['broccoli', 'veggie', 'vegetable'], 
                '🍽️': ['plate', 'platter', 'appetizer', 'starter', 'small plate'],
                '🥙': ['bowl', 'rice bowl'],
                '🧒': ['kid', 'child', 'children']
            };
            
            for (const emoji in keywords) {
                if (keywords[emoji].some(keyword => lowerName.includes(keyword))) return emoji;
            }
            return '📦';
        }
        
        function setupCustomSelect() {
            const trigger = customSelectWrapper.querySelector('.select-trigger');
            trigger.addEventListener('click', () => customSelectWrapper.classList.toggle('open'));
            window.addEventListener('click', (e) => {
                if (!customSelectWrapper.contains(e.target)) customSelectWrapper.classList.remove('open');
            });
        }

        function rebuildCustomOptions() {
            const optionsContainer = customSelectWrapper.querySelector('.custom-options');
            const triggerSpan = customSelectWrapper.querySelector('.select-trigger span');
            optionsContainer.innerHTML = '';

            Array.from(storeSelect.options).forEach(option => {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'custom-option';
                optionDiv.dataset.value = option.value;
                
                // Check if it's a campus restaurant
                const isCampusRestaurant = CAMPUS_RESTAURANTS.some(r => r.id === option.value);
                
                if (option.value === 'create-new') {
                    optionDiv.classList.add('create-new-option');
                    optionDiv.innerHTML = `<span>${option.textContent}</span>`;
                } else if (option.value !== 'ross' && !isCampusRestaurant) {
                    // Only allow deletion for custom stores, not campus restaurants
                    optionDiv.innerHTML = `
                        <span class="option-text">${option.textContent}</span>
                        <button class="delete-store-btn" data-store-id="${option.value}" data-store-name="${option.textContent}" title="Delete store"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
                } else {
                    optionDiv.innerHTML = `<span>${option.textContent}</span>`;
                }
                
                if (option.value === storeSelect.value) {
                    optionDiv.classList.add('selected');
                    triggerSpan.textContent = option.textContent;
                }
                optionsContainer.appendChild(optionDiv);
            });
        }

        function setupEventListeners() {
            storeSelect.addEventListener('change', handleStoreChange);
            itemSearchInput.addEventListener('input', () => renderItems(itemSearchInput.value, currentCategory));
            logPurchaseBtn.addEventListener('click', logPurchase);
            
            // Event Delegation for dynamic elements
            document.body.addEventListener('click', e => {
                // Category Links
                const categoryLink = e.target.closest('.category-link');
                if (categoryLink) {
                    currentCategory = categoryLink.dataset.category;
                    document.querySelectorAll('.category-link').forEach(l => l.classList.remove('active'));
                    categoryLink.classList.add('active');
                    renderItems(itemSearchInput.value, currentCategory);
                    return;
                }

                // Cart Buttons
                const cartActionsTarget = e.target.closest('.cart-item-actions button, .cart-item-quantity button');
                if (cartActionsTarget) {
                    const name = cartActionsTarget.dataset.name;
                    if (cartActionsTarget.classList.contains('remove-item-btn')) removeItemFromCart(name);
                    if (cartActionsTarget.classList.contains('increase-btn')) changeQuantity(name, 1);
                    if (cartActionsTarget.classList.contains('decrease-btn')) changeQuantity(name, -1);
                    if (cartActionsTarget.classList.contains('add-to-subs-btn')) {
                        const item = cart.find(i => i.name === name);
                        if (item) {
                            itemToSubscribe = item;
                            subModalItemName.textContent = item.name;
                            subModal.classList.remove('hidden');
                        }
                    }
                    return;
                }

                // Subscription Buttons
                const endSubBtn = e.target.closest('.end-sub-btn');
                if (endSubBtn) {
                    endSubscription(endSubBtn.dataset.id);
                    return;
                }

                const chargeSubsBtn = e.target.closest('#charge-subs-btn');
                if (chargeSubsBtn && !chargeSubsBtn.disabled) {
                    chargeWeeklySubscriptions();
                    return;
                }

                // Custom Select Dropdown
                const customOption = e.target.closest('.custom-option');
                if (customOption) {
                    const value = customOption.dataset.value;
                    if (!e.target.closest('.delete-store-btn')) {
                        storeSelect.value = value;
                        storeSelect.dispatchEvent(new Event('change'));
                        customSelectWrapper.classList.remove('open');
                    } else {
                        const storeId = e.target.closest('.delete-store-btn').dataset.storeId;
                        const storeName = e.target.closest('.delete-store-btn').dataset.storeName;
                        deleteStoreNameEl.textContent = storeName;
                        deleteStoreModal.dataset.storeId = storeId;
                        deleteStoreModal.classList.remove('hidden');
                        customSelectWrapper.classList.remove('open');
                    }
                    return;
                }
            });

            tabBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    tabBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    tabContents.forEach(c => c.classList.remove('active'));
                    document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
                });
            });

            // Modal Listeners
            const setupModal = (modal, cancelBtn, confirmBtn, action, closeAction) => {
                const close = () => {
                    if (closeAction) closeAction();
                    modal.classList.add('hidden');
                };
            
                if (cancelBtn) cancelBtn.addEventListener('click', close);
            
                if (confirmBtn) {
                    confirmBtn.addEventListener('click', async () => {
                        const result = await action();
                        if (result !== false) {
                            close();
                        }
                    });
                }
            
                modal.addEventListener('click', e => { if (e.target === modal) close(); });
            };

            setupModal(subModal, subModalCancelBtn, subModalConfirmBtn, () => {
                if (itemToSubscribe) addSubscription(itemToSubscribe);
                itemToSubscribe = null;
            });
            
            setupModal(createStoreModal, cancelStoreBtn, createStoreBtn, async () => {
                const name = newStoreNameInput.value.trim();
                if (!name) {
                    showSimpleAlert("Please enter a store name.");
                    return false;
                }
                createStoreBtn.disabled = true;
                try {
                    const newStoreRef = await addDoc(collection(db, "users", currentUser.uid, "customStores"), { name, currency: newStoreCurrencyInput.value, createdAt: Timestamp.now() });
                    await loadCustomStores();
                    storeSelect.value = newStoreRef.id;
                    storeSelect.dispatchEvent(new Event('change'));
                } catch(e) { 
                    console.error(e); 
                    showSimpleAlert('Failed to create store.');
                    return false;
                } finally { 
                    createStoreBtn.disabled = false; 
                }
            }, () => { newStoreNameInput.value = ''; newStoreCurrencyInput.value = 'dollars'; rebuildCustomOptions(); });
            
            setupModal(addItemModal, cancelItemBtn, addItemBtn, async () => {
                const name = newItemNameInput.value.trim();
                let price = parseFloat(newItemPriceInput.value);
                if (!name || isNaN(price) || price <= 0) {
                    showSimpleAlert("Please enter a valid name and positive price.");
                    return false;
                }
                addItemBtn.disabled = true;
                try {
                    await addDoc(collection(db, "users", currentUser.uid, "customStores", currentStoreId, "items"), { name, price, createdAt: Timestamp.now() });
                    await loadCustomStoreItems(currentStoreId);
                } catch(e) { 
                    console.error(e); 
                    showSimpleAlert('Failed to add item.');
                    return false;
                } finally { 
                    addItemBtn.disabled = false; 
                }
            }, () => { newItemNameInput.value = ''; newItemPriceInput.value = ''; });

            setupModal(deleteStoreModal, deleteStoreCancelBtn, deleteStoreConfirmBtn, async () => {
                const storeId = deleteStoreModal.dataset.storeId;
                if (!storeId) return;
                deleteStoreConfirmBtn.disabled = true;
                try {
                    await deleteCustomStore(storeId);
                } catch(e) { 
                    console.error(e); 
                } finally { 
                    deleteStoreConfirmBtn.disabled = false; 
                }
            });

            addNewItemBtn.addEventListener('click', () => {
                const isSwipes = currentStoreCurrency.includes('swipes') || (currentStoreCurrency !== 'dollars' && userBalanceTypes.find(bt => bt.id === currentStoreCurrency)?.type === 'count');
                newItemPriceInput.step = isSwipes ? '1' : '0.01';
                newItemPriceInput.placeholder = isSwipes ? 'e.g., 1' : 'e.g., 2.50';
                newItemPriceLabel.textContent = `Price (${getPriceLabel(1, currentStoreCurrency).replace(/1\s?/, '')})`;
                addItemModal.classList.remove('hidden');
                newItemNameInput.focus();
            });
        }

    } catch (error) {
        console.error("Fatal Error initializing log purchase page:", error);
        document.body.innerHTML = '<p class="loading-message">Could not connect to services. Please check your connection and try again.</p>';
    }
}

main();