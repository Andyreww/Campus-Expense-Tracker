import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, getDocs, query, Timestamp, deleteDoc, orderBy, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Main App Initialization ---
async function main() {
    try {
        // Securely fetch the Firebase config from our Netlify function
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            throw new Error('Could not load app configuration.');
        }
        const firebaseConfig = await response.json();

        // Initialize Firebase with the secure config
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        // --- DEPARTMENT MAP ---
        const departmentMap = {
            "1544840": "Dips & Spreads", "1544841": "Dips & Spreads",
            "1547128": "Dips & Spreads", "1547131": "Dips & Spreads",
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
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        const tabIndicator = document.querySelector('.tab-indicator');
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
            await loadStoreData();
            await loadSubscriptions();
            await loadPurchaseHistory();
            renderAll();
            requestAnimationFrame(() => {
                const activeTab = document.querySelector('.tab-btn.active');
                if (activeTab) moveTabIndicator(activeTab);
            });
        }

        // --- DATA LOADING ---
        function listenToUserData() {
            if (unsubscribeUserDoc) unsubscribeUserDoc();
            const userDocRef = doc(db, "users", currentUser.uid);
            unsubscribeUserDoc = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    userBalance = docSnap.data().balances[paymentType] || 0;
                    updateBalanceDisplay();
                    calculateProjection();
                }
            });
        }

        async function loadStoreData() {
            try {
                const response = await fetch('full_store_prices.json');
                const rawItems = await response.json();
                allItems = rawItems.map(item => {
                    const regularPrice = parseFloat(item.regular_price.replace('$', ''));
                    const salePrice = item.sale_price ? parseFloat(item.sale_price.replace('$', '')) : null;
                    const departmentId = item.department && item.department.length > 0 ? item.department[0] : null;
                    const category = departmentMap[departmentId] || 'Miscellaneous';
                    
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
            } catch (error) {
                console.error("Could not load store data:", error);
                itemListContainer.innerHTML = '<p class="loading-text">Could not load items. Make sure full_store_prices.json exists.</p>';
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
        function renderAll() {
            renderItems();
            renderCart();
            renderSubscriptions();
            renderHistory();
        }
        
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
            
            let itemsToDisplay = allItems;

            if (categoryFilter !== 'All') {
                itemsToDisplay = itemsToDisplay.filter(item => item.category === categoryFilter);
            }

            if (searchFilter) {
                itemsToDisplay = itemsToDisplay.filter(item => item.name.toLowerCase().includes(searchFilter.toLowerCase()));
            }
            
            itemsToDisplay.slice(0, 100).forEach(item => {
                const row = document.createElement('div');
                row.className = 'item-row';
                row.innerHTML = `<div class="item-row-details"><div class="item-row-name">${item.name}</div><div class="item-row-price-container"><span class="item-row-price">$${item.price.toFixed(2)}</span>${item.onSale ? `<span class="item-row-original-price">$${item.originalPrice.toFixed(2)}</span>` : ''}</div></div>${item.onSale ? '<div class="sale-tag">SALE</div>' : ''}`;
                row.addEventListener('click', () => addItemToCart(item));
                itemListContainer.appendChild(row);
            });
        }

        function renderCart() {
            cartItemsContainer.innerHTML = '';
            if (cart.length === 0) {
                cartItemsContainer.innerHTML = '<p class="empty-message">Your cart is empty. Tap an item to add it!</p>';
                logPurchaseBtn.disabled = true;
                return;
            }

            cart.forEach(item => {
                const div = document.createElement('div');
                div.className = 'cart-item';
                div.dataset.itemId = item.id;
                div.innerHTML = `<div class="cart-item-emoji">${item.emoji}</div><div class="cart-item-details"><div class="cart-item-name">${item.name}</div></div><div class="cart-item-price">$${item.price.toFixed(2)}</div><button class="add-to-subs-btn" data-id="${item.id}" title="Add to weekly subscriptions"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 2.7a2.7 2.7 0 0 1 3.8 0L22 4.9a2.7 2.7 0 0 1 0 3.8L13.4 17a2 2 0 0 1-1.4.6H8.5a1 1 0 0 1-1-1v-3.5a2 2 0 0 1 .6-1.4z"></path><path d="M8.5 2.5a1 1 0 0 0-1 1v2.5"></path><path d="M3.5 8a1 1 0 0 0 1 1h2.5"></path><path d="M12.5 21.5a1 1 0 0 0 1-1v-2.5"></path><path d="M18 12.5a1 1 0 0 0-1-1h-2.5"></path></svg></button><button class="remove-item-btn" data-id="${item.id}" title="Remove from cart">&times;</button>`;
                cartItemsContainer.appendChild(div);
            });

            const total = cart.reduce((sum, item) => sum + item.price, 0);
            cartTotalEl.textContent = `$${total.toFixed(2)}`;
            logPurchaseBtn.disabled = false;
        }

        function renderSubscriptions() {
            activeSubsList.innerHTML = '';
            pastSubsList.innerHTML = '';
            
            const activeSubs = subscriptions.filter(s => s.status === 'active');
            const pastSubs = subscriptions.filter(s => s.status === 'ended');

            if (activeSubs.length === 0) {
                activeSubsList.innerHTML = '<p class="empty-message">No active subscriptions.</p>';
            } else {
                activeSubs.forEach(sub => {
                    const div = document.createElement('div');
                    div.className = 'sub-item';
                    div.innerHTML = `<div class="cart-item-emoji">${sub.item.emoji}</div><div class="cart-item-details"><div class="cart-item-name">${sub.item.name}</div></div><div class="cart-item-price">$${sub.item.price.toFixed(2)}</div><button class="end-sub-btn" data-id="${sub.id}">End</button>`;
                    activeSubsList.appendChild(div);
                });
            }

            if (pastSubs.length === 0) {
                pastSubsList.innerHTML = '<p class="empty-message">No past subscriptions.</p>';
            } else {
                pastSubs.forEach(sub => {
                    const startDate = sub.startDate.toDate();
                    const endDate = sub.endDate.toDate();
                    const weeksActive = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 7)));
                    const div = document.createElement('div');
                    div.className = 'sub-item ended';
                    div.innerHTML = `<div class="cart-item-emoji">${sub.item.emoji}</div><div class="cart-item-details"><div class="cart-item-name">${sub.item.name}</div><div class="sub-duration">Active for ${weeksActive} week(s)</div></div><div class="cart-item-price">$${sub.item.price.toFixed(2)}</div>`;
                    pastSubsList.appendChild(div);
                });
            }
        }

        function renderHistory() {
            historyList.innerHTML = '';
            if (purchaseHistory.length === 0) {
                historyList.innerHTML = '<p class="empty-message">No purchase history found.</p>';
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
                    const itemsHtml = purchase.items.map(item => `<li>${item.name}</li>`).join('');
                    const purchaseDiv = document.createElement('div');
                    purchaseDiv.className = 'history-purchase';
                    purchaseDiv.innerHTML = `<div class="history-purchase-header"><span>${purchase.store}</span><span>-$${purchase.total.toFixed(2)}</span></div><ul class="history-item-list">${itemsHtml}</ul>`;
                    groupDiv.appendChild(purchaseDiv);
                });
                historyList.appendChild(groupDiv);
            }
        }

        function updateBalanceDisplay() {
            balanceDisplay.textContent = `$${userBalance.toFixed(2)}`;
        }

        function addItemToCart(item) {
            cart.push({ ...item, id: Date.now() });
            renderCart();
        }

        function removeItemFromCart(id) {
            cart = cart.filter(item => item.id !== id);
            renderCart();
        }

        async function addSubscription(itemToSub) {
            const subsRef = collection(db, "users", currentUser.uid, "subscriptions");
            await addDoc(subsRef, {
                item: { name: itemToSub.name, price: itemToSub.price, emoji: itemToSub.emoji, onSale: itemToSub.onSale, originalPrice: itemToSub.originalPrice },
                frequency: 'weekly',
                status: 'active',
                startDate: Timestamp.now()
            });
            removeItemFromCart(itemToSub.id);
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
            const totalCost = cart.reduce((sum, item) => sum + item.price, 0);
            if (totalCost > userBalance) {
                alert("Not enough funds!");
                return;
            }

            logPurchaseBtn.disabled = true;
            logPurchaseBtn.innerHTML = `<div class="spinner"></div> Logging...`;

            try {
                const userDocRef = doc(db, "users", currentUser.uid);
                const newBalance = userBalance - totalCost;
                
                const userDoc = await getDoc(userDocRef);
                const userData = userDoc.data();
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
                    items: cart.map(({ emoji, id, ...rest }) => rest),
                    total: totalCost,
                    store: "Ross Market",
                    purchaseDate: Timestamp.now()
                });

                await updateDoc(userDocRef, { 
                    [`balances.${paymentType}`]: newBalance,
                    currentStreak: currentStreak,
                    longestStreak: longestStreak,
                    lastLogDate: Timestamp.now()
                });
                
                cart = [];
                await loadPurchaseHistory();
                renderAll();

            } catch (error) {
                console.error("Error logging purchase:", error);
                alert("Failed to log purchase. Please try again.");
            } finally {
                logPurchaseBtn.disabled = false;
                logPurchaseBtn.innerHTML = `<span>Log Purchase</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="M12 5l7 7-7 7"></path></svg>`;
            }
        }

        function calculateProjection() {
            const today = new Date();
            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            const daysLeft = (endOfMonth.getDate() - today.getDate());
            const weeksLeft = daysLeft > 0 ? Math.ceil(daysLeft / 7) : 0;

            const weeklyCost = subscriptions.filter(s => s.status === 'active').reduce((sum, sub) => sum + sub.item.price, 0);
            const projectedMonthlyCost = weeklyCost * weeksLeft;
            const projectedBalance = userBalance - projectedMonthlyCost;

            weeklySubCostEl.textContent = `$${weeklyCost.toFixed(2)}`;
            weeksLeftEl.textContent = weeksLeft;
            monthlySubCostEl.textContent = `$${projectedMonthlyCost.toFixed(2)}`;
            projectedBalanceEl.textContent = `$${projectedBalance.toFixed(2)}`;
        }

        function getEmojiForItem(name, category = '') {
            const lowerName = name.toLowerCase();
            const lowerCat = category.toLowerCase();
            if (lowerCat.includes('drink')) return '🥤';
            if (lowerCat.includes('snack')) return '🥨';
            if (lowerCat.includes('frozen')) return '🍦';
            const keywords = {'⚡️':['monster','red bull'],'☕️':['coffee','starbucks'],'💧':['water','essentia'],'🥤':['soda','coke','pepsi'],'🧃':['juice','snapple'],'🥛':['milk'],'🍔':['burger'],'🍟':['fries'],'🥪':['sandwich','sub','wrap'],'🍗':['chicken'],'🍝':['pasta','ramen'],'🥗':['salad'],'🍩':['donut'],'🍪':['cookie','oreo'],'🍫':['chocolate','kitkat'],'🍬':['candy','gummy'],'🍰':['cake'],'🍦':['ice cream'],'🥜':['peanut','nuts'],'🧀':['cheese','cheez-it'],};
            for (const emoji in keywords) {
                if (keywords[emoji].some(keyword => lowerName.includes(keyword))) return emoji;
            }
            return '🛒';
        }

        function setupEventListeners() {
            itemSearchInput.addEventListener('input', () => renderItems(itemSearchInput.value, currentCategory));
            
            cartItemsContainer.addEventListener('click', e => {
                const removeBtn = e.target.closest('.remove-item-btn');
                const subsBtn = e.target.closest('.add-to-subs-btn');
                if (removeBtn) removeItemFromCart(Number(removeBtn.dataset.id));
                if (subsBtn) {
                    const itemId = Number(subsBtn.dataset.id);
                    const item = cart.find(i => i.id === itemId);
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
                    moveTabIndicator(btn);
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

            let resizeTimer;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    const activeTab = document.querySelector('.tab-btn.active');
                    if(activeTab) moveTabIndicator(activeTab);
                }, 100);
            });
        }

        function moveTabIndicator(activeBtn) {
            if (!activeBtn || !tabIndicator) return;
            const offset = activeBtn.offsetLeft;
            const width = activeBtn.offsetWidth;
            tabIndicator.style.width = `${width}px`;
            tabIndicator.style.transform = `translateX(${offset}px)`;
        }

    } catch (error) {
        console.error("Fatal Error initializing log purchase page:", error);
        // You can add a user-facing error message here if you want
    }
}

// Start the application
main();
