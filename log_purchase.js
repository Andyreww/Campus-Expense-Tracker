import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, getDocs, query, Timestamp, deleteDoc, orderBy, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Main App Initialization ---
async function main() {
    // These variables are expected to be provided by the hosting environment.
    const firebaseConfig = JSON.parse(__firebase_config);
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    // Initialize Firebase with the secure config
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    // --- IMPROVED DEPARTMENT MAP ---
    const departmentMap = {
        // Add more mappings as you discover department IDs
        "1544840": "Dips & Spreads",
        "1544841": "Dips & Spreads",
        "1547128": "Dips & Spreads",
        "1547131": "Dips & Spreads",
        "1457139": "Beverages",
        // Add categories based on common patterns in item names
        "default": {
            "snacks": ["chips", "cookie", "cracker", "pretzel", "popcorn", "nuts", "trail mix"],
            "drinks": ["water", "soda", "juice", "coffee", "tea", "energy", "sport", "milk"],
            "candy": ["chocolate", "candy", "gummy", "mint", "sweet"],
            "fresh": ["fruit", "vegetable", "salad", "produce"],
            "dairy": ["cheese", "yogurt", "butter", "cream"],
            "frozen": ["ice cream", "frozen", "popsicle"],
            "bakery": ["bread", "bagel", "muffin", "donut", "cake"],
            "meal": ["sandwich", "wrap", "pizza", "pasta", "soup"]
        }
    };

    // --- STATE ---
    let currentUser = null;
    let allItems = [];
    let cart = [];
    let subscriptions = [];
    let purchaseHistory = [];
    let userBalance = 0;
    const paymentType = 'credits';
    let unsubscribeUserDoc = null;
    let currentCategory = 'All';
    let itemToSubscribe = null;

    // --- DOM ELEMENTS ---
    const balanceDisplay = document.getElementById('current-balance-display');
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
    const monthlySubCostEl = document.getElementById('monthly-sub-cost');
    const weeksLeftEl = document.getElementById('weeks-left');
    const historyList = document.getElementById('history-list');
    const modal = document.getElementById('sub-confirm-modal');
    const modalItemName = document.getElementById('modal-item-name');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const storeSelect = document.getElementById('store-select');

    // --- AUTH ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            init(); // This is the main entry point after auth
        } else {
            // If no user is signed in, try to sign in with the token if available.
            if (initialAuthToken) {
                signInWithCustomToken(auth, initialAuthToken).catch(error => {
                    console.error("Custom token sign-in failed:", error);
                    // If token fails, redirect to login as a fallback.
                    window.location.href = "login.html";
                });
            } else {
                // If no token, the user must log in manually.
                window.location.href = "login.html";
            }
        }
    });


    // --- INITIALIZATION ---
    async function init() {
        listenToUserData();
        setupEventListeners();
        renderCart(); // Render empty cart initially
        await loadStoreData(); // This will now render items as soon as they're ready
        await loadSubscriptions();
        await loadPurchaseHistory();
        // Render data that depends on async calls
        renderSubscriptions();
        renderHistory();
        calculateProjection();
    }

    // --- DATA LOADING ---
    function listenToUserData() {
        if (unsubscribeUserDoc) unsubscribeUserDoc();
        const userDocRef = doc(db, "users", currentUser.uid);
        unsubscribeUserDoc = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                userBalance = docSnap.data().balances[paymentType] || 0;
                updateBalanceDisplay(false);
                calculateProjection();
            }
        });
    }

    function detectCategory(item, departmentId) {
        if (departmentId && departmentMap[departmentId]) {
            return departmentMap[departmentId];
        }
        const itemNameLower = item.name.toLowerCase();
        const categories = departmentMap.default;
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => itemNameLower.includes(keyword))) {
                return category.charAt(0).toUpperCase() + category.slice(1);
            }
        }
        return 'Miscellaneous';
    }

    async function loadStoreData() {
        try {
            const response = await fetch('full_store_prices.json');
            const rawItems = await response.json();
            allItems = rawItems.map(item => {
                const regularPrice = parseFloat(item.regular_price.replace('$', ''));
                const salePrice = item.sale_price ? parseFloat(item.sale_price.replace('$', '')) : null;
                const departmentId = item.department && item.department.length > 0 ? item.department[0] : null;
                const category = detectCategory(item, departmentId);

                return {
                    name: item.name,
                    price: salePrice ?? regularPrice,
                    onSale: salePrice !== null,
                    originalPrice: regularPrice,
                    category: category,
                    emoji: getEmojiForItem(item.name, category)
                };
            });
            renderCategories();
            renderItems(); // Render items immediately after processing
        } catch (error) {
            console.error("Could not load store data:", error);
            itemListContainer.innerHTML = '<p class="loading-message">Could not load items. Make sure full_store_prices.json exists.</p>';
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

    // --- RENDERING ---
    function renderCategories() {
        const categories = ['All', ...new Set(allItems.map(item => item.category).sort())];
        categorySidebar.innerHTML = '';
        categories.forEach(category => {
            const link = document.createElement('a');
            link.className = 'category-link';
            link.textContent = category;
            link.dataset.category = category;
            if (category === currentCategory) {
                link.classList.add('active');
            }
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

        if (categoryFilter !== 'All') {
            itemsToDisplay = itemsToDisplay.filter(item => item.category === categoryFilter);
        }

        if (searchFilter) {
            itemsToDisplay = itemsToDisplay.filter(item => item.name.toLowerCase().includes(searchFilter.toLowerCase()));
        }

        itemsToDisplay.slice(0, 100).forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';

            card.innerHTML = `
                <div class="item-emoji">${item.emoji}</div>
                <div class="item-name">${item.name}</div>
                <div class="item-price-tag">
                    <span class="item-price">$${item.price.toFixed(2)}</span>
                    ${item.onSale ? `<span class="item-original-price">$${item.originalPrice.toFixed(2)}</span>` : ''}
                </div>
                ${item.onSale ? '<div class="sale-badge">SALE</div>' : ''}
            `;

            card.addEventListener('click', () => addItemToCart(item));
            itemListContainer.appendChild(card);
        });

        if (itemsToDisplay.length === 0) {
            itemListContainer.innerHTML = '<p class="empty-message">No items found. Try a different search or category!</p>';
        }
    }

    function renderCart(animatedItemName = null) {
        cartItemsContainer.innerHTML = '';

        // Always calculate total first
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        cartTotalEl.textContent = `$${total.toFixed(2)}`;

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = `
                <div class="empty-basket">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"><path d="M5 6m0 1a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z"></path><path d="M10 6v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3"></path></svg>
                    <p>Your basket is empty!</p>
                    <span>Click items to add them</span>
                </div>
            `;
            logPurchaseBtn.disabled = true;
        } else {
            cart.forEach(item => {
                const div = document.createElement('div');
                div.className = 'cart-item';
                if (item.name === animatedItemName) {
                    div.classList.add('slide-in');
                }
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
                    <div class="cart-item-price">$${(item.price * item.quantity).toFixed(2)}</div>
                    <div class="cart-item-actions">
                        <button class="add-to-subs-btn" data-name="${item.name}" title="Add to weekly subscriptions">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"></path><path d="M12 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        </button>
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

        if (activeSubs.length === 0) {
            activeSubsList.innerHTML = '<p class="empty-message">No weekly favorites yet!</p>';
        } else {
            activeSubs.forEach(sub => {
                // FIX: Use quantity to calculate total price for subscription
                const quantity = sub.quantity || 1;
                const subTotal = (sub.item.price * quantity).toFixed(2);
                const displayName = quantity > 1 ? `${sub.item.name} (x${quantity})` : sub.item.name;

                const div = document.createElement('div');
                div.className = 'sub-item';
                div.innerHTML = `
                    <div class="cart-item-emoji">${sub.item.emoji}</div>
                    <div>
                        <div class="cart-item-name">${displayName}</div>
                        <div class="sub-duration">Every week</div>
                    </div>
                    <div class="cart-item-price">$${subTotal}</div>
                    <button class="end-sub-btn" data-id="${sub.id}">End</button>
                `;
                activeSubsList.appendChild(div);
            });
        }

        if (pastSubs.length === 0) {
            pastSubsList.innerHTML = '<p class="empty-message">No past subscriptions</p>';
        } else {
            pastSubs.forEach(sub => {
                const startDate = sub.startDate.toDate();
                const endDate = sub.endDate.toDate();
                const weeksActive = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 7)));
                
                const quantity = sub.quantity || 1;
                const subTotal = (sub.item.price * quantity).toFixed(2);
                const displayName = quantity > 1 ? `${sub.item.name} (x${quantity})` : sub.item.name;

                const div = document.createElement('div');
                div.className = 'sub-item ended';
                div.innerHTML = `
                    <div class="cart-item-emoji">${sub.item.emoji}</div>
                    <div>
                        <div class="cart-item-name">${displayName}</div>
                        <div class="sub-duration">Was active for ${weeksActive} week(s)</div>
                    </div>
                    <div class="cart-item-price">$${subTotal}</div>
                `;
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
                const purchaseDiv = document.createElement('div');
                purchaseDiv.className = 'history-purchase';
                purchaseDiv.innerHTML = `
                    <div class="history-purchase-header">
                        <span>${purchase.store}</span>
                        <span>-$${purchase.total.toFixed(2)}</span>
                    </div>
                    <ul class="history-item-list">${itemsHtml}</ul>
                `;
                groupDiv.appendChild(purchaseDiv);
            });
            historyList.appendChild(groupDiv);
        }
    }

    function updateBalanceDisplay(animate = false) {
        balanceDisplay.textContent = `$${userBalance.toFixed(2)}`;
        if (animate) {
            const walletContainer = document.querySelector('.wallet-container');
            walletContainer.classList.remove('hit');
            void walletContainer.offsetWidth;
            walletContainer.classList.add('hit');
            setTimeout(() => walletContainer.classList.remove('hit'), 600);
        }
    }

    function addItemToCart(item) {
        const existingItem = cart.find(cartItem => cartItem.name === item.name);
        if (existingItem) {
            existingItem.quantity++;
            renderCart(); // No animation
        } else {
            cart.push({ ...item, quantity: 1 });
            renderCart(item.name); // Animate this new item
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
            if (cartItem.quantity <= 0) {
                removeItemFromCart(itemName);
            } else {
                renderCart();
            }
        }
    }

    async function addSubscription(itemToSub) {
        const subsRef = collection(db, "users", currentUser.uid, "subscriptions");
        
        // FIX: Include the quantity from the cart when creating a subscription.
        await addDoc(subsRef, {
            item: {
                name: itemToSub.name,
                price: itemToSub.price,
                emoji: itemToSub.emoji,
                onSale: itemToSub.onSale,
                originalPrice: itemToSub.originalPrice
            },
            quantity: itemToSub.quantity, // Save the quantity
            frequency: 'weekly',
            status: 'active',
            startDate: Timestamp.now()
        });
        removeItemFromCart(itemToSub.name);
        await loadSubscriptions();
        renderSubscriptions();
        calculateProjection();
    }

    async function endSubscription(subId) {
        const subDocRef = doc(db, "users", currentUser.uid, "subscriptions", subId);
        await updateDoc(subDocRef, {
            status: 'ended',
            endDate: Timestamp.now()
        });
        await loadSubscriptions();
        renderSubscriptions();
        calculateProjection();
    }

    async function logPurchase() {
        if (cart.length === 0) return;
        const totalCost = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (totalCost > userBalance) {
            // A non-blocking notification is better than alert()
            console.warn("Not enough funds!");
            // You could show a custom modal here instead.
            return;
        }

        logPurchaseBtn.disabled = true;
        logPurchaseBtn.innerHTML = `<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; margin-right: 0.5rem;"></span> Processing...`;

        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const newBalance = userBalance - totalCost;

            const userDoc = await getDoc(userDocRef);
            const userData = userDoc.data() || {};
            let { currentStreak = 0, longestStreak = 0, lastLogDate = null } = userData;

            // --- STREAK LOGIC ---
            // This logic correctly ensures the streak is only incremented once per calendar day.
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Set to midnight to compare dates only

            if (lastLogDate) {
                const lastDate = lastLogDate.toDate();
                lastDate.setHours(0, 0, 0, 0); // Also set to midnight

                const diffTime = today - lastDate;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays === 1) {
                    // Last purchase was yesterday, continue the streak.
                    currentStreak++;
                } else if (diffDays > 1) {
                    // It's been more than a day, reset the streak.
                    currentStreak = 1;
                }
                // If diffDays is 0, it's a purchase on the same day, so we do nothing to the streak.
            } else {
                // This is the very first purchase.
                currentStreak = 1;
            }

            if (currentStreak > longestStreak) {
                longestStreak = currentStreak;
            }

            const purchaseRef = collection(db, "users", currentUser.uid, "purchases");
            const storeName = storeSelect ? storeSelect.options[storeSelect.selectedIndex].text : "Ross Market";
            await addDoc(purchaseRef, {
                items: cart.map(({ emoji, category, ...rest }) => rest), // Don't save emoji/category to db
                total: totalCost,
                store: storeName,
                purchaseDate: Timestamp.now()
            });

            await updateDoc(userDocRef, {
                [`balances.${paymentType}`]: newBalance,
                currentStreak: currentStreak,
                longestStreak: longestStreak,
                lastLogDate: Timestamp.now() // Update the last log date to today
            });

            userBalance = newBalance;
            updateBalanceDisplay(true);

            if (userData.showOnWallOfFame && currentUser?.uid) {
                try {
                    const wallOfFameDocRef = doc(db, "wallOfFame", currentUser.uid);
                    await setDoc(wallOfFameDocRef, {
                        displayName: currentUser.displayName || "Anonymous",
                        photoURL: currentUser.photoURL || "",
                        currentStreak: currentStreak
                    }, { merge: true });
                } catch (wallError) {
                    console.warn("Could not update wall of fame:", wallError);
                }
            }

            cart = [];
            await loadPurchaseHistory();
            renderCart();
            renderHistory();

        } catch (error) {
            console.error("Error logging purchase:", error);
            // You could show a custom error modal here.
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

        // FIX: Use quantity to calculate the true weekly cost
        const weeklyCost = subscriptions
            .filter(s => s.status === 'active')
            .reduce((sum, sub) => sum + (sub.item.price * (sub.quantity || 1)), 0); // Default to 1 for old subs

        const projectedMonthlyCost = weeklyCost * weeksLeft;
        const projectedBalance = userBalance - projectedMonthlyCost;

        weeklySubCostEl.textContent = `$${weeklyCost.toFixed(2)}`;
        weeksLeftEl.textContent = weeksLeft;
        projectedBalanceEl.textContent = `$${projectedBalance.toFixed(2)}`;
    }

    function getEmojiForItem(name, category = '') {
        const lowerName = name.toLowerCase();
        const lowerCat = category.toLowerCase();

        if (lowerCat.includes('beverage') || lowerCat.includes('drink')) return '🥤';
        if (lowerCat.includes('snack')) return '🥨';
        if (lowerCat.includes('candy')) return '🍬';
        if (lowerCat.includes('fresh') || lowerCat.includes('produce')) return '🥗';
        if (lowerCat.includes('dairy')) return '🧀';
        if (lowerCat.includes('frozen')) return '🍦';
        if (lowerCat.includes('bakery')) return '🥐';
        if (lowerCat.includes('meal')) return '🍱';

        const keywords = {
            '☕': ['coffee', 'latte', 'espresso', 'cappuccino', 'mocha'],'🍵': ['tea', 'chai'],'🥤': ['soda', 'coke', 'pepsi', 'sprite', 'fanta'],'🧃': ['juice', 'smoothie'],'💧': ['water', 'aqua', 'dasani', 'evian', 'fiji'],'🥛': ['milk'],'🍺': ['beer'],'🍷': ['wine'],'🍾': ['champagne', 'prosecco'],'⚡': ['energy', 'monster', 'red bull', 'rockstar'],'🏃': ['gatorade', 'powerade', 'sport'],'🍔': ['burger'],'🍟': ['fries', 'french fry'],'🍕': ['pizza'],'🥪': ['sandwich', 'sub', 'wrap', 'panini'],'🌮': ['taco', 'burrito', 'quesadilla'],'🍝': ['pasta', 'spaghetti', 'noodle'],'🍜': ['soup', 'ramen', 'pho'],'🥗': ['salad'],'🍗': ['chicken', 'wing'],'🍖': ['meat', 'steak', 'beef', 'pork'],'🐟': ['fish', 'salmon', 'tuna', 'seafood'],'🍞': ['bread', 'toast'],'🥐': ['croissant', 'pastry'],'🥯': ['bagel'],'🧁': ['cupcake', 'muffin'],'🍰': ['cake'],'🍪': ['cookie', 'oreo', 'biscuit'],'🍩': ['donut', 'doughnut'],'🍫': ['chocolate', 'hershey', 'snickers', 'kit kat', 'twix'],'🍬': ['candy', 'sweet', 'lollipop', 'gummy'],'🍭': ['lollipop', 'sucker'],'🍿': ['popcorn', 'pop corn'],'🥨': ['pretzel'],'🥜': ['nut', 'peanut', 'almond', 'cashew'],'🌰': ['chestnut'],'🥔': ['potato', 'chip'],'🧀': ['cheese', 'cheddar', 'mozzarella'],'🥚': ['egg'],'🥓': ['bacon'],'🥞': ['pancake', 'waffle'],'🍦': ['ice cream', 'gelato'],'🧊': ['ice', 'frozen'],'🍎': ['apple'],'🍊': ['orange', 'citrus'],'🍌': ['banana'],'🍓': ['strawberry', 'berry'],'🍇': ['grape'],'🥕': ['carrot'],'🥦': ['broccoli'],'🌽': ['corn'],'🥒': ['cucumber', 'pickle'],'🍅': ['tomato'],'🥑': ['avocado', 'guac'],'🌶️': ['pepper', 'spicy', 'hot'],'🧂': ['salt', 'seasoning'],'🍯': ['honey'],'🥫': ['can', 'soup', 'beans'],'🍱': ['bento', 'meal', 'lunch'],'🥡': ['takeout', 'chinese'],'🧋': ['boba', 'bubble tea'],
        };

        for (const emoji in keywords) {
            if (keywords[emoji].some(keyword => lowerName.includes(keyword))) {
                return emoji;
            }
        }

        return '📦';
    }

    function setupEventListeners() {
        itemSearchInput.addEventListener('input', () => renderItems(itemSearchInput.value, currentCategory));

        cartItemsContainer.addEventListener('click', e => {
            const removeBtn = e.target.closest('.remove-item-btn');
            const subsBtn = e.target.closest('.add-to-subs-btn');
            const increaseBtn = e.target.closest('.increase-btn');
            const decreaseBtn = e.target.closest('.decrease-btn');

            if (removeBtn) removeItemFromCart(removeBtn.dataset.name);
            if (increaseBtn) changeQuantity(increaseBtn.dataset.name, 1);
            if (decreaseBtn) changeQuantity(decreaseBtn.dataset.name, -1);

            if (subsBtn) {
                const itemName = subsBtn.dataset.name;
                const item = cart.find(i => i.name === itemName);
                if (item) {
                    itemToSubscribe = item;
                    modalItemName.textContent = item.name;
                    modal.classList.remove('hidden');
                }
            }
        });

        logPurchaseBtn.addEventListener('click', logPurchase);

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

        modalConfirmBtn.addEventListener('click', () => {
            if (itemToSubscribe) addSubscription(itemToSubscribe);
            itemToSubscribe = null;
            modal.classList.add('hidden');
        });

        modalCancelBtn.addEventListener('click', () => {
            itemToSubscribe = null;
            modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                itemToSubscribe = null;
                modal.classList.add('hidden');
            }
        });
    }

}

main().catch(error => {
    console.error("Fatal Error initializing log purchase page:", error);
    document.body.innerHTML = '<p class="loading-message">Could not connect to services. Please check your connection and try again.</p>';
});
