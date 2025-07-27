import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, getDocs, query, Timestamp, deleteDoc, orderBy, getDoc, setDoc, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
        let userBalances = {};
        let unsubscribeUserDoc = null;
        let currentCategory = 'All';
        let itemToSubscribe = null;
        let customStores = [];
        let currentStoreId = 'ross'; // 'ross' for the default market
        let currentStoreCurrency = 'dollars'; // Default currency
        let walletToAnimate = null; // Used to trigger wallet shake animation

        // --- DOM ELEMENTS ---
        const header = document.querySelector('.shop-header');
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
        const projectedBalanceEl = document.getElementById('projected-balance');
        const weeklySubCostEl = document.getElementById('weekly-sub-cost');
        const weeksLeftEl = document.getElementById('weeks-left');
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
        
        // Delete Store Modal
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
            // iOS scroll fix
            if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                document.addEventListener('touchmove', function(e) {
                    if (e.target.closest('.item-shelves') || 
                        e.target.closest('.basket-paper') || 
                        e.target.closest('.subs-paper') || 
                        e.target.closest('.history-paper') ||
                        e.target.closest('.custom-options')) {
                        e.stopPropagation();
                    }
                }, { passive: true });
                
                // Fix for iOS bounce scrolling
                const itemShelves = document.querySelector('.item-shelves');
                if (itemShelves) {
                    itemShelves.style.webkitOverflowScrolling = 'touch';
                    itemShelves.style.overflowY = 'scroll';
                }
            }
            
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
            calculateProjection();
        }

        // --- DATA LOADING & MANAGEMENT ---
        function listenToUserData() {
            if (unsubscribeUserDoc) unsubscribeUserDoc();
            const userDocRef = doc(db, "users", currentUser.uid);
            unsubscribeUserDoc = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    userBalances = docSnap.data().balances || {};
                    renderAllWallets(walletToAnimate); // Pass animation trigger
                    walletToAnimate = null; // Reset trigger after use
                    calculateProjection();
                }
            });
        }
        
        async function loadCustomStores() {
            if (!currentUser) return;
            const storesRef = collection(db, "users", currentUser.uid, "customStores");
            const q = query(storesRef, orderBy("name"));
            const querySnapshot = await getDocs(q);
            
            customStores = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            while (storeSelect.options.length > 1) {
                storeSelect.remove(1);
            }
            
            customStores.forEach(store => {
                const option = document.createElement('option');
                option.value = store.id;
                option.textContent = store.name;
                storeSelect.appendChild(option);
            });

            const createOption = document.createElement('option');
            createOption.value = 'create-new';
            createOption.textContent = '＋ Create New Store';
            storeSelect.appendChild(createOption);
            
            rebuildCustomOptions();
        }
        
        async function handleStoreChange() {
            const selectedValue = storeSelect.value;

            if (selectedValue === 'create-new') {
                createStoreModal.classList.remove('hidden');
                storeSelect.value = currentStoreId; // Revert to previous selection
                rebuildCustomOptions();
                return;
            }

            currentStoreId = selectedValue;
            cart = [];
            renderCart();

            if (currentStoreId === 'ross') {
                currentStoreCurrency = 'dollars';
                customStoreActions.classList.add('hidden');
                categorySidebar.classList.remove('hidden');
                await loadRossStoreData();
            } else {
                const store = customStores.find(s => s.id === currentStoreId);
                if (store) {
                    currentStoreCurrency = store.currency;
                    customStoreActions.classList.remove('hidden');
                    categorySidebar.classList.add('hidden'); // No categories for custom stores
                    await loadCustomStoreItems(currentStoreId);
                }
            }
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
                        emoji: getEmojiForItem(item.name)
                    };
                });
                renderCategories();
                renderItems();
                
                // Ensure scroll is properly initialized after content loads
                setTimeout(() => {
                    if (itemListContainer) {
                        itemListContainer.scrollTop = 1; // Trigger iOS to recognize scrollable content
                        itemListContainer.scrollTop = 0;
                    }
                }, 100);
            } catch (error) {
                console.error("Could not load Ross Market data:", error);
                itemListContainer.innerHTML = '<p class="empty-message">Could not load items for Ross Market.</p>';
            }
        }

        async function loadCustomStoreItems(storeId) {
            itemListContainer.innerHTML = `<div class="loading-message"><div class="loading-spinner"></div><p>Loading your items...</p></div>`;
            
            try {
                const itemsRef = collection(db, "users", currentUser.uid, "customStores", storeId, "items");
                const q = query(itemsRef, orderBy("name"));
                
                let querySnapshot;
                try {
                    querySnapshot = await getDocs(q);
                } catch (orderError) {
                    // If ordering fails (might happen with empty collection), try without ordering
                    console.log("Order query failed, trying without order:", orderError);
                    querySnapshot = await getDocs(itemsRef);
                }
                
                if (querySnapshot.empty) {
                    allItems = [];
                    itemListContainer.innerHTML = '<p class="empty-message">No items yet. Click "Add New Item" to get started!</p>';
                    return;
                }
                
                const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                allItems = items.map(item => ({
                    ...item,
                    emoji: getEmojiForItem(item.name)
                }));
                
                renderItems();
                
                // Ensure scroll is properly initialized after content loads
                setTimeout(() => {
                    if (itemListContainer) {
                        itemListContainer.scrollTop = 1; // Trigger iOS to recognize scrollable content
                        itemListContainer.scrollTop = 0;
                    }
                }, 100);
            } catch (error) {
                console.error("Error loading custom store items:", error);
                console.error("Error details:", error.code, error.message);
                allItems = [];
                itemListContainer.innerHTML = '<p class="empty-message">No items yet. Click "Add New Item" to get started!</p>';
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

        // --- FREQUENT PURCHASE WIDGET ---
        async function checkAndCreateFrequentWidget(db, storeName) {
            if (!currentUser || cart.length === 0) return;
        
            try {
                const widgetsRef = collection(db, "users", currentUser.uid, "quickLogWidgets");
                const widgetsSnapshot = await getDocs(widgetsRef);
        
                // Check if we have reached the max number of widgets (3)
                if (widgetsSnapshot.size >= 3) {
                    return;
                }
        
                // Determine balance type based on current store context
                let balanceTypeToDebit;
                if (currentStoreId === 'ross') {
                    balanceTypeToDebit = 'credits';
                } else {
                    switch (currentStoreCurrency) {
                        case 'dollars':
                            balanceTypeToDebit = 'dining';
                            break;
                        case 'swipes':
                            balanceTypeToDebit = 'swipes';
                            break;
                        case 'bonus_swipes':
                            balanceTypeToDebit = 'bonus';
                            break;
                        default:
                            balanceTypeToDebit = 'credits'; // Fallback just in case
                    }
                }
        
                // For each item in the cart, check if it should become a widget
                for (const cartItem of cart) {
                    // Check if a widget for this item already exists
                    let widgetExists = false;
                    widgetsSnapshot.forEach(doc => {
                        if (doc.data().itemName === cartItem.name) {
                            widgetExists = true;
                        }
                    });
                    
                    if (widgetExists) {
                        continue; // Skip this item
                    }
        
                    // Count past purchases of this specific item
                    const purchasesRef = collection(db, "users", currentUser.uid, "purchases");
                    const allPurchasesSnapshot = await getDocs(purchasesRef);
                    
                    let purchaseCount = 0;
                    allPurchasesSnapshot.forEach(doc => {
                        const purchase = doc.data();
                        // Check if this purchase contains the item
                        if (purchase.items && Array.isArray(purchase.items)) {
                            purchase.items.forEach(item => {
                                if (item.name === cartItem.name) {
                                    purchaseCount += item.quantity || 1;
                                }
                            });
                        }
                    });
        
                    // Add current purchase quantity
                    purchaseCount += cartItem.quantity;
        
                    // If the item has been purchased enough times, create the widget
                    const FREQUENCY_THRESHOLD = 3;
                    if (purchaseCount >= FREQUENCY_THRESHOLD) {
                        await addDoc(widgetsRef, {
                            itemName: cartItem.name,
                            itemPrice: cartItem.price,
                            storeName: storeName,
                            currency: currentStoreCurrency, // For display
                            balanceType: balanceTypeToDebit,  // For logic
                            createdAt: Timestamp.now()
                        });
                        console.log(`Created frequent widget for ${cartItem.name} after ${purchaseCount} purchases`);
                        
                        // Check if we've reached the limit
                        const updatedSnapshot = await getDocs(widgetsRef);
                        if (updatedSnapshot.size >= 3) {
                            break;
                        }
                    }
                }
            } catch (error) {
                console.error("Error checking/creating frequent widget:", error);
            }
        }

        // --- RENDERING ---
        function renderAllWallets(animatedWallet = null) {
            const walletWrapper = document.getElementById('wallets-group');
            if (!walletWrapper) return;
            walletWrapper.innerHTML = '';

            const diningDollars = userBalances.dining || 0;
            const diningWallet = document.createElement('div');
            diningWallet.className = 'wallet-container';
            diningWallet.id = 'dining-dollars-wallet';
            diningWallet.innerHTML = `<div class="wallet-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="18" height="12" rx="2" fill="#4CAF50" /><circle cx="12" cy="12" r="3" fill="#FFFDF7"/><path d="M12 10.5V13.5M13 11.5H11" stroke="#4A2C2A" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="wallet-details"><div class="wallet-label">Dining Dollars</div><div class="wallet-amount">$${diningDollars.toFixed(2)}</div></div>`;
            walletWrapper.appendChild(diningWallet);

            const credits = userBalances.credits || 0;
            const creditsWallet = document.createElement('div');
            creditsWallet.className = 'wallet-container';
            creditsWallet.id = 'campus-credits-wallet';
            creditsWallet.innerHTML = `<div class="wallet-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 8.5C18 5.46243 15.3137 3 12 3C8.68629 3 6 5.46243 6 8.5C6 10.4462 6.94878 12.1643 8.40993 13.2218C8.43542 13.2403 8.46154 13.2579 8.48828 13.2747L9 13.5858V16.5C9 17.0523 9.44772 17.5 10 17.5H14C14.5523 17.5 15 17.0523 15 16.5V13.5858L15.5117 13.2747C15.5385 13.2579 15.5646 13.2403 15.5901 13.2218C17.0512 12.1643 18 10.4462 18 8.5Z" fill="#D97706"/><path d="M12 21C13.1046 21 14 20.1046 14 19H10C10 20.1046 10.8954 21 12 21Z" fill="#FBBF24"/><path d="M12 5.5L13.5 8.5L16.5 9L14.5 11L15 14L12 12.5L9 14L9.5 11L7.5 9L10.5 8.5L12 5.5Z" fill="#FBBF24"/></svg></div><div class="wallet-details"><div class="wallet-label">Campus Credits</div><div class="wallet-amount">$${credits.toFixed(2)}</div></div>`;
            walletWrapper.appendChild(creditsWallet);

            if (animatedWallet === 'dining') {
                diningWallet.classList.add('hit');
            } else if (animatedWallet === 'credits') {
                creditsWallet.classList.add('hit');
            }
        }

        function renderCategories() {
            const categories = ['All', ...new Set(allItems.map(item => item.category).sort())];
            categorySidebar.innerHTML = '';
            categories.forEach(category => {
                const link = document.createElement('a');
                link.className = 'category-link';
                link.textContent = category;
                link.dataset.category = category;
                if (category === currentCategory) link.classList.add('active');
                link.addEventListener('click', () => {
                    currentCategory = category;
                    document.querySelectorAll('.category-link').forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                    renderItems(itemSearchInput.value, currentCategory);
                });
                categorySidebar.appendChild(link);
            });
        }

        function renderItems(searchFilter = '', categoryFilter = 'All') {
            itemListContainer.innerHTML = '';
            itemListContainer.classList.remove('loading-message');

            let itemsToDisplay = allItems;

            if (categoryFilter !== 'All' && currentStoreId === 'ross') {
                itemsToDisplay = itemsToDisplay.filter(item => item.category === categoryFilter);
            }

            if (searchFilter) {
                itemsToDisplay = itemsToDisplay.filter(item => item.name.toLowerCase().includes(searchFilter.toLowerCase()));
            }

            if (itemsToDisplay.length === 0) {
                itemListContainer.innerHTML = '<p class="empty-message">No items found. Try a different search or add one to your store!</p>';
                return;
            }

            itemsToDisplay.slice(0, 100).forEach(item => {
                const card = document.createElement('div');
                card.className = 'item-card';
                const priceLabel = getPriceLabel(item.price, currentStoreCurrency);

                card.innerHTML = `
                    <div class="item-emoji">${item.emoji}</div>
                    <div class="item-name">${item.name}</div>
                    <div class="item-price-tag">
                        <span class="item-price">${priceLabel}</span>
                        ${(item.onSale && currentStoreId === 'ross') ? `<span class="item-original-price">${item.originalPrice.toFixed(2)}</span>` : ''}
                    </div>
                    ${(item.onSale && currentStoreId === 'ross') ? '<div class="sale-badge">SALE</div>' : ''}
                `;

                card.addEventListener('click', () => addItemToCart(item));
                itemListContainer.appendChild(card);
            });
            
            // Force iOS to recognize scrollable content
            if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                itemListContainer.style.webkitOverflowScrolling = 'touch';
                itemListContainer.style.overflowY = 'scroll';
                // Force a reflow to ensure iOS picks up the changes
                itemListContainer.scrollTop = 0;
            }
        }

        function renderCart(animatedItemName = null) {
            cartItemsContainer.innerHTML = '';
            const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            cartTotalEl.textContent = getPriceLabel(total, currentStoreCurrency);

            if (cart.length === 0) {
                cartItemsContainer.innerHTML = `<div class="empty-basket"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"><path d="M5 6m0 1a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z"></path><path d="M10 6v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3"></path></svg><p>Your basket is empty!</p><span>Click items to add them</span></div>`;
                logPurchaseBtn.disabled = true;
            } else {
                cart.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'cart-item';
                    if (item.name === animatedItemName) div.classList.add('slide-in');
                    
                    div.innerHTML = `
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
                            ${currentStoreId === 'ross' ? `<button class="add-to-subs-btn" data-name="${item.name}" title="Add to weekly subscriptions"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"></path><path d="M12 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line></svg></button>` : ''}
                            <button class="remove-item-btn" data-name="${item.name}" title="Remove from cart">×</button>
                        </div>
                    `;
                    cartItemsContainer.appendChild(div);
                });
                logPurchaseBtn.disabled = false;
            }
        }
        
        function renderSubscriptions() {
            activeSubsList.innerHTML = '';
            pastSubsList.innerHTML = '';

            const activeSubs = subscriptions.filter(s => s.status === 'active');
            const pastSubs = subscriptions.filter(s => s.status === 'ended');

            if (activeSubs.length === 0) activeSubsList.innerHTML = '<p class="empty-message">No weekly favorites yet!</p>';
            else {
                activeSubs.forEach(sub => {
                    const div = document.createElement('div');
                    div.className = 'sub-item';
                    div.innerHTML = `<div class="cart-item-emoji">${sub.item.emoji}</div><div><div class="cart-item-name">${sub.item.name}</div><div class="sub-duration">Every week</div></div><div class="cart-item-price">$${sub.item.price.toFixed(2)}</div><button class="end-sub-btn" data-id="${sub.id}">End</button>`;
                    activeSubsList.appendChild(div);
                });
            }

            if (pastSubs.length === 0) pastSubsList.innerHTML = '<p class="empty-message">No past subscriptions</p>';
            else {
                pastSubs.forEach(sub => {
                    const div = document.createElement('div');
                    div.className = 'sub-item ended';
                    div.innerHTML = `<div class="cart-item-emoji">${sub.item.emoji}</div><div><div class="cart-item-name">${sub.item.name}</div><div class="sub-duration">Ended</div></div><div class="cart-item-price">$${sub.item.price.toFixed(2)}</div>`;
                    pastSubsList.appendChild(div);
                });
            }
        }

        function renderHistory() {
            historyList.innerHTML = '';
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

            for (const date in groupedByDate) {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'history-group';
                groupDiv.innerHTML = `<h3 class="history-date">${date}</h3>`;

                groupedByDate[date].forEach(purchase => {
                    const itemsHtml = purchase.items.map(item => `<li>${item.quantity > 1 ? `${item.name} (x${item.quantity})` : item.name}</li>`).join('');
                    const currency = purchase.currency || 'dollars';
                    const totalLabel = getPriceLabel(purchase.total, currency);
                    
                    const purchaseDiv = document.createElement('div');
                    purchaseDiv.className = 'history-purchase';
                    purchaseDiv.innerHTML = `
                        <div class="history-purchase-header">
                            <span>${purchase.store}</span>
                            <span>-${totalLabel}</span>
                        </div>
                        <ul class="history-item-list">${itemsHtml}</ul>
                    `;
                    groupDiv.appendChild(purchaseDiv);
                });
                historyList.appendChild(groupDiv);
            }
        }

        // --- ACTIONS & EVENT HANDLERS ---
        function addItemToCart(item) {
            const existingItem = cart.find(cartItem => cartItem.name === item.name);
            if (existingItem) {
                existingItem.quantity++;
                renderCart();
            } else {
                cart.push({ ...item, quantity: 1 });
                renderCart(item.name);
            }
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
                quantity: itemToSub.quantity, status: 'active', startDate: Timestamp.now()
            });
            removeItemFromCart(itemToSub.name);
            await loadSubscriptions();
            renderSubscriptions();
            calculateProjection();
        }

        async function endSubscription(subId) {
            await updateDoc(doc(db, "users", currentUser.uid, "subscriptions", subId), {
                status: 'ended', endDate: Timestamp.now()
            });
            await loadSubscriptions();
            renderSubscriptions();
            calculateProjection();
        }

        async function deleteCustomStore(storeId) {
            try {
                // First check if items subcollection exists and delete all items
                const itemsRef = collection(db, "users", currentUser.uid, "customStores", storeId, "items");
                try {
                    const itemsSnapshot = await getDocs(itemsRef);
                    if (!itemsSnapshot.empty) {
                        const deletePromises = [];
                        itemsSnapshot.forEach(docSnapshot => {
                            deletePromises.push(deleteDoc(docSnapshot.ref));
                        });
                        await Promise.all(deletePromises);
                        console.log(`Deleted ${deletePromises.length} items from store ${storeId}`);
                    }
                } catch (itemsError) {
                    console.log("No items to delete or error accessing items:", itemsError);
                }

                // Delete the store document
                const storeDocRef = doc(db, "users", currentUser.uid, "customStores", storeId);
                await deleteDoc(storeDocRef);
                console.log(`Deleted store ${storeId}`);

                // Reset to Ross Market
                storeSelect.value = 'ross';
                currentStoreId = 'ross';
                
                // Reload custom stores and switch to Ross
                await loadCustomStores();
                await handleStoreChange();
                
            } catch (error) {
                console.error("Error deleting custom store:", error);
                console.error("Error details:", error.code, error.message);
                alert(`Failed to delete store: ${error.message || 'Unknown error'}`);
            }
        }

        async function logPurchase() {
            if (cart.length === 0) return;
            const totalCost = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
            // Balance Check
            if (currentStoreId === 'ross' && totalCost > (userBalances.credits || 0)) {
                alert("Not enough Campus Credits!");
                return;
            }
            if (currentStoreId !== 'ross' && currentStoreCurrency === 'dollars' && totalCost > (userBalances.dining || 0)) {
                alert("Not enough Dining Dollars!");
                return;
            }
            if (currentStoreCurrency === 'swipes' && totalCost > (userBalances.swipes || 0)) {
                alert("Not enough Meal Swipes!");
                return;
            }
            if (currentStoreCurrency === 'bonus_swipes' && totalCost > (userBalances.bonus || 0)) {
                alert("Not enough Bonus Swipes!");
                return;
            }
        
            logPurchaseBtn.disabled = true;
            logPurchaseBtn.innerHTML = `<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; margin-right: 0.5rem;"></span> Processing...`;
        
            try {
                const userDocRef = doc(db, "users", currentUser.uid);
                const storeName = storeSelect.options[storeSelect.selectedIndex].text;
        
                // Add to purchase history
                await addDoc(collection(db, "users", currentUser.uid, "purchases"), {
                    items: cart.map(({ emoji, category, ...rest }) => rest),
                    total: totalCost,
                    store: storeName,
                    currency: currentStoreCurrency,
                    purchaseDate: Timestamp.now()
                });
        
                // Update Balances based on currency type
                if (currentStoreId === 'ross') {
                    // This is for Campus Credits
                    walletToAnimate = 'credits';
                    const newBalance = (userBalances.credits || 0) - totalCost;
                    const userDocSnap = await getDoc(userDocRef);
                    const { currentStreak = 0, longestStreak = 0, lastLogDate = null } = userDocSnap.data() || {};
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    let newCurrentStreak = currentStreak;
        
                    if (lastLogDate) {
                        const lastDate = lastLogDate.toDate(); lastDate.setHours(0, 0, 0, 0);
                        const diffDays = Math.ceil((today - lastDate) / (1000 * 60 * 60 * 24));
                        if (diffDays === 1) newCurrentStreak++;
                        else if (diffDays > 1) newCurrentStreak = 1;
                    } else {
                        newCurrentStreak = 1;
                    }
        
                    await updateDoc(userDocRef, {
                        'balances.credits': newBalance,
                        currentStreak: newCurrentStreak,
                        longestStreak: Math.max(longestStreak, newCurrentStreak),
                        lastLogDate: Timestamp.now()
                    });
                } else {
                    // This is for custom stores
                    let updateData = {};
                    
                    if (currentStoreCurrency === 'dollars') {
                        walletToAnimate = 'dining';
                        const newDiningBalance = (userBalances.dining || 0) - totalCost;
                        updateData['balances.dining'] = newDiningBalance;
                    } else if (currentStoreCurrency === 'swipes') {
                        const newSwipesBalance = (userBalances.swipes || 0) - totalCost;
                        updateData['balances.swipes'] = newSwipesBalance;
                    } else if (currentStoreCurrency === 'bonus_swipes') {
                        const newBonusBalance = (userBalances.bonus || 0) - totalCost;
                        updateData['balances.bonus'] = newBonusBalance;
                    }
                    
                    await updateDoc(userDocRef, updateData);
                }
                
                // Check for frequent purchases and create widgets
                await checkAndCreateFrequentWidget(db, storeName);
                
                cart = [];
                await loadPurchaseHistory();
                renderCart();
                renderHistory();
        
            } catch (error) {
                console.error("Error logging purchase:", error);
                alert("Failed to log purchase. Please try again.");
            } finally {
                logPurchaseBtn.disabled = false;
                logPurchaseBtn.innerHTML = `<span>Checkout</span><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
            }
        }

        function calculateProjection() {
            const today = new Date();
            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            const daysLeft = (endOfMonth.getDate() - today.getDate());
            const weeksLeft = daysLeft > 0 ? Math.ceil(daysLeft / 7) : 0;

            const weeklyCost = subscriptions
                .filter(s => s.status === 'active')
                .reduce((sum, sub) => sum + (sub.item.price * (sub.quantity || 1)), 0);

            const projectedMonthlyCost = weeklyCost * weeksLeft;
            const projectedBalance = (userBalances.credits || 0) - projectedMonthlyCost;

            weeklySubCostEl.textContent = `$${weeklyCost.toFixed(2)}`;
            weeksLeftEl.textContent = weeksLeft;
            projectedBalanceEl.textContent = `$${projectedBalance.toFixed(2)}`;
        }

        // --- HELPERS ---
        function getPriceLabel(price, currency) {
            switch (currency) {
                case 'dollars': return `$${price.toFixed(2)}`;
                case 'swipes': return `${price} Swipe${price !== 1 ? 's' : ''}`;
                case 'bonus_swipes': return `${price} Bonus Swipe${price !== 1 ? 's' : ''}`;
                default: return `$${price.toFixed(2)}`;
            }
        }
        
        function detectCategory(item) {
            const departmentMap = {"1544840": "Dips & Spreads", "1544841": "Dips & Spreads", "1457139": "Beverages"};
            const departmentId = item.department && item.department.length > 0 ? item.department[0] : null;
            if (departmentId && departmentMap[departmentId]) return departmentMap[departmentId];
            
            const itemNameLower = item.name.toLowerCase();
            const categories = { "snacks": ["chip", "cookie", "cracker"], "drinks": ["water", "soda", "juice"], "candy": ["chocolate", "candy"], "fresh": ["fruit", "vegetable"], "dairy": ["cheese", "yogurt"], "frozen": ["ice cream", "frozen"], "bakery": ["bread", "bagel"], "meal": ["sandwich", "wrap", "pizza"] };
            for (const [category, keywords] of Object.entries(categories)) {
                if (keywords.some(keyword => itemNameLower.includes(keyword))) return category.charAt(0).toUpperCase() + category.slice(1);
            }
            return 'Miscellaneous';
        }

        function getEmojiForItem(name) {
            const lowerName = name.toLowerCase();
            const keywords = {
                // Drinks
                '☕': ['coffee', 'latte', 'espresso', 'cappuccino', 'mocha'],
                '🍵': ['tea', 'matcha'],
                '🥤': ['soda', 'coke', 'pepsi', 'sprite', 'fanta', 'dr pepper'],
                '🧃': ['juice', 'lemonade', 'smoothie'],
                '💧': ['water', 'dasani', 'fiji', 'smartwater'],
                '🥛': ['milk', 'cream'],
                '🍺': ['beer'],
                '🍷': ['wine'],
                '🍹': ['cocktail'],
        
                // Meals & Main Courses
                '🍔': ['burger', 'cheeseburger'],
                '🍕': ['pizza', 'calzone'],
                '🥪': ['sandwich', 'sub', 'wrap', 'panini', 'blt'],
                '🥙': ['gyro', 'kebab', 'shawarma'],
                '🌮': ['taco', 'burrito', 'quesadilla'],
                '🌭': ['hot dog', 'sausage'],
                '🍜': ['ramen', 'pho', 'noodle', 'pasta', 'spaghetti'],
                '🍣': ['sushi', 'sashimi', 'nigiri'],
                '🥗': ['salad', 'caesar', 'cobb'],
                '🍲': ['soup', 'stew', 'chili'],
                '🍗': ['chicken wing', 'fried chicken', 'nugget'],
                '': ['egg', 'omelette', 'breakfast'],
        
                // Snacks
                '🍪': ['cookie', 'biscuit'],
                '🍫': ['chocolate', 'candy', 'snickers', 'm&m', 'kitkat', 'hershey'],
                '🥨': ['pretzel', 'chip', 'doritos', 'lays', 'cheetos', 'fritos'],
                '🍿': ['popcorn'],
                '🍩': ['donut', 'doughnut'],
                '🍰': ['cake', 'cupcake', 'cheesecake'],
                '🍦': ['ice cream', 'gelato', 'sorbet', 'froyo'],
                '🥜': ['nut', 'peanut', 'almond', 'cashew'],
                '🧀': ['cheese', 'cheez-it'],
                '🥣': ['cereal', 'oatmeal'],
                '🥖': ['bread', 'baguette', 'croissant'],
                '🥯': ['bagel'],
        
                // Fruits & Veggies
                '🍎': ['apple'],
                '🍌': ['banana'],
                '🍇': ['grape'],
                '🍓': ['strawberry', 'berry'],
                '🍊': ['orange', 'mandarin'],
                '🍉': ['watermelon'],
                '🥑': ['avocado', 'guacamole'],
                '🥕': ['carrot'],
                '🥦': ['broccoli'],
                '🍅': ['tomato'],
        
                // Misc
                '💊': ['medicine', 'advil', 'tylenol', 'pill'],
                '🍬': ['mint', 'gum'],
                '🍱': ['meal', 'bento', 'combo']
            };
        
            for (const emoji in keywords) {
                if (keywords[emoji].some(keyword => lowerName.includes(keyword))) {
                    return emoji;
                }
            }
            return '📦'; // Default emoji
        }
        
        // --- NEW DROPDOWN LOGIC ---
        function setupCustomSelect() {
            const trigger = customSelectWrapper.querySelector('.select-trigger');
            
            trigger.addEventListener('click', () => {
                customSelectWrapper.classList.toggle('open');
            });

            window.addEventListener('click', (e) => {
                if (!customSelectWrapper.contains(e.target)) {
                    customSelectWrapper.classList.remove('open');
                }
            });
        }

        function rebuildCustomOptions() {
            const optionsContainer = customSelectWrapper.querySelector('.custom-options');
            const triggerSpan = customSelectWrapper.querySelector('.select-trigger span');
            optionsContainer.innerHTML = '';

            Array.from(storeSelect.options).forEach((option, index) => {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'custom-option';
                
                if (option.value === 'create-new') {
                    optionDiv.classList.add('create-new-option');
                    optionDiv.innerHTML = option.textContent;
                } else if (index > 0 && option.value !== 'create-new') {
                    // Custom store with delete button
                    optionDiv.innerHTML = `
                        <span class="option-text">${option.textContent}</span>
                        <button class="delete-store-btn" data-store-id="${option.value}" data-store-name="${option.textContent}" title="Delete store">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    `;
                } else {
                    optionDiv.textContent = option.textContent;
                }
                
                optionDiv.dataset.value = option.value;
                
                if (option.value === storeSelect.value) {
                    optionDiv.classList.add('selected');
                    triggerSpan.textContent = option.textContent;
                }

                // Click handler for the option (not delete button)
                const clickHandler = (e) => {
                    if (!e.target.closest('.delete-store-btn')) {
                        storeSelect.value = option.value;
                        storeSelect.dispatchEvent(new Event('change'));
                        
                        triggerSpan.textContent = option.textContent;
                        customSelectWrapper.querySelector('.custom-option.selected')?.classList.remove('selected');
                        optionDiv.classList.add('selected');
                        customSelectWrapper.classList.remove('open');
                    }
                };
                
                optionDiv.addEventListener('click', clickHandler);
                optionsContainer.appendChild(optionDiv);
            });

            // Add event listeners for delete buttons
            optionsContainer.querySelectorAll('.delete-store-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const storeId = btn.dataset.storeId;
                    const storeName = btn.dataset.storeName;
                    
                    deleteStoreNameEl.textContent = storeName;
                    deleteStoreModal.classList.remove('hidden');
                    deleteStoreModal.dataset.storeId = storeId;
                    customSelectWrapper.classList.remove('open');
                });
            });
        }

        function setupEventListeners() {
            // iOS-specific scroll handling
            if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                // Prevent body scroll when touching inside scrollable areas
                document.body.addEventListener('touchstart', function(e) {
                    if (e.target.closest('.item-shelves') || 
                        e.target.closest('.basket-paper') || 
                        e.target.closest('.custom-options')) {
                        document.body.style.overflow = 'hidden';
                    }
                }, { passive: true });
                
                document.body.addEventListener('touchend', function(e) {
                    document.body.style.overflow = '';
                }, { passive: true });
                
                // Fix for iOS momentum scrolling
                const scrollableElements = ['.item-shelves', '.basket-paper', '.subs-paper', '.history-paper', '.custom-options'];
                scrollableElements.forEach(selector => {
                    const element = document.querySelector(selector);
                    if (element) {
                        element.addEventListener('touchstart', function() {
                            const top = this.scrollTop;
                            const totalScroll = this.scrollHeight;
                            const currentScroll = top + this.offsetHeight;
                            
                            if (top === 0) {
                                this.scrollTop = 1;
                            } else if (currentScroll === totalScroll) {
                                this.scrollTop = top - 1;
                            }
                        }, { passive: true });
                    }
                });
            }
            
            storeSelect.addEventListener('change', handleStoreChange);
            itemSearchInput.addEventListener('input', () => renderItems(itemSearchInput.value, currentCategory));
            logPurchaseBtn.addEventListener('click', logPurchase);
            cartItemsContainer.addEventListener('click', e => {
                const removeBtn = e.target.closest('.remove-item-btn');
                const subsBtn = e.target.closest('.add-to-subs-btn');
                const increaseBtn = e.target.closest('.increase-btn');
                const decreaseBtn = e.target.closest('.decrease-btn');
                if (removeBtn) removeItemFromCart(removeBtn.dataset.name);
                if (increaseBtn) changeQuantity(increaseBtn.dataset.name, 1);
                if (decreaseBtn) changeQuantity(decreaseBtn.dataset.name, -1);
                if (subsBtn) {
                    const item = cart.find(i => i.name === subsBtn.dataset.name);
                    if (item) {
                        itemToSubscribe = item;
                        subModalItemName.textContent = item.name;
                        subModal.classList.remove('hidden');
                    }
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
            activeSubsList.addEventListener('click', e => {
                const endBtn = e.target.closest('.end-sub-btn');
                if (endBtn) endSubscription(endBtn.dataset.id);
            });

            // Modal Listeners
            const closeCreateStoreModal = () => {
                createStoreModal.classList.add('hidden');
                newStoreNameInput.value = '';
                newStoreCurrencyInput.value = 'dollars';
                rebuildCustomOptions();
            };

            cancelStoreBtn.addEventListener('click', closeCreateStoreModal);
            createStoreModal.addEventListener('click', (e) => {
                if (e.target === createStoreModal) {
                    closeCreateStoreModal();
                }
            });

            subModalCancelBtn.addEventListener('click', () => subModal.classList.add('hidden'));
            subModal.addEventListener('click', (e) => { if (e.target === subModal) subModal.classList.add('hidden'); });
            subModalConfirmBtn.addEventListener('click', () => {
                if (itemToSubscribe) addSubscription(itemToSubscribe);
                itemToSubscribe = null;
                subModal.classList.add('hidden');
            });
            
            createStoreBtn.addEventListener('click', async () => {
                const name = newStoreNameInput.value.trim();
                const currency = newStoreCurrencyInput.value;
                if (!name) return alert("Please enter a store name.");
                
                createStoreBtn.disabled = true;
                createStoreBtn.textContent = 'Creating...';
                
                try {
                    // Create the custom store document
                    const storeData = { 
                        name: name, 
                        currency: currency,
                        createdAt: Timestamp.now() // Add timestamp
                    };
                    
                    const customStoresRef = collection(db, "users", currentUser.uid, "customStores");
                    const newStoreRef = await addDoc(customStoresRef, storeData);
                    
                    console.log(`Created store ${name} with ID: ${newStoreRef.id}`);
                    
                    newStoreNameInput.value = '';
                    newStoreCurrencyInput.value = 'dollars';
                    createStoreModal.classList.add('hidden');
                    
                    await loadCustomStores();
                    storeSelect.value = newStoreRef.id;
                    storeSelect.dispatchEvent(new Event('change'));
                    rebuildCustomOptions();
                } catch (error) {
                    console.error("Error creating store:", error);
                    console.error("Error details:", error.code, error.message);
                    alert(`Failed to create store: ${error.message || 'Unknown error'}`);
                } finally {
                    createStoreBtn.disabled = false;
                    createStoreBtn.textContent = 'Create Store';
                }
            });
            
            // Delete Store Modal Listeners
            deleteStoreCancelBtn.addEventListener('click', () => {
                deleteStoreModal.classList.add('hidden');
            });
            
            deleteStoreModal.addEventListener('click', (e) => {
                if (e.target === deleteStoreModal) {
                    deleteStoreModal.classList.add('hidden');
                }
            });
            
            deleteStoreConfirmBtn.addEventListener('click', async () => {
                const storeId = deleteStoreModal.dataset.storeId;
                if (!storeId) {
                    console.error("No store ID found for deletion");
                    return;
                }
                
                console.log(`Attempting to delete store with ID: ${storeId}`);
                
                deleteStoreConfirmBtn.disabled = true;
                deleteStoreConfirmBtn.textContent = 'Deleting...';
                
                try {
                    await deleteCustomStore(storeId);
                    deleteStoreModal.classList.add('hidden');
                    delete deleteStoreModal.dataset.storeId; // Clear the stored ID
                } catch (error) {
                    console.error("Delete failed:", error);
                } finally {
                    deleteStoreConfirmBtn.disabled = false;
                    deleteStoreConfirmBtn.textContent = 'Delete Store';
                }
            });
            
            addNewItemBtn.addEventListener('click', () => {
                const isSwipes = currentStoreCurrency.includes('swipes');
                newItemPriceInput.step = isSwipes ? '1' : '0.01';
                newItemPriceInput.placeholder = isSwipes ? 'e.g., 1' : 'e.g., 2.50';
                newItemPriceLabel.textContent = `Price (${getPriceLabel(1, currentStoreCurrency).replace(/1\s?/, '')})`;
                addItemModal.classList.remove('hidden');
                newItemNameInput.focus();
            });
            cancelItemBtn.addEventListener('click', () => {
                addItemModal.classList.add('hidden');
                newItemNameInput.value = '';
                newItemPriceInput.value = '';
            });
            addItemModal.addEventListener('click', (e) => { 
                if (e.target === addItemModal) {
                    addItemModal.classList.add('hidden');
                    newItemNameInput.value = '';
                    newItemPriceInput.value = '';
                }
            });
            addItemBtn.addEventListener('click', async () => {
                const name = newItemNameInput.value.trim();
                let price = parseFloat(newItemPriceInput.value);
                if (!name || isNaN(price) || price <= 0) return alert("Please enter a valid name and positive price.");
                if (currentStoreCurrency.includes('swipes') && price % 1 !== 0) return alert("Swipes must be whole numbers.");
                
                addItemBtn.disabled = true;
                addItemBtn.textContent = 'Adding...';
                
                try {
                    // Ensure the store exists and get reference to items subcollection
                    const itemsCollectionRef = collection(db, "users", currentUser.uid, "customStores", currentStoreId, "items");
                    
                    // Add the new item
                    const newItemRef = await addDoc(itemsCollectionRef, { 
                        name: name, 
                        price: price,
                        createdAt: Timestamp.now() // Add timestamp for ordering
                    });
                    
                    console.log(`Added item ${name} with ID: ${newItemRef.id}`);
                    
                    newItemNameInput.value = ''; 
                    newItemPriceInput.value = '';
                    addItemModal.classList.add('hidden');
                    await loadCustomStoreItems(currentStoreId);
                } catch (error) {
                    console.error("Error adding item:", error);
                    console.error("Error details:", error.code, error.message);
                    alert(`Failed to add item: ${error.message || 'Unknown error'}`);
                } finally {
                    addItemBtn.disabled = false;
                    addItemBtn.textContent = 'Add Item';
                }
            });
        }

    } catch (error) {
        console.error("Fatal Error initializing log purchase page:", error);
        document.body.innerHTML = '<p class="loading-message">Could not connect to services. Please check your connection and try again.</p>';
    }
}

main();