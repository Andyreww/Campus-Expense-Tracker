// Ultra-optimized script.js - Maximum performance with deferred loading

// Defer Firebase completely - only load when actually needed
let firebaseModule = null;
let firestoreModule = null;
let threeModule = null;

// Lazy load Firebase auth module
const getFirebaseAuth = async () => {
    if (!firebaseModule) {
        const { firebaseReady } = await import('./auth.js');
        firebaseModule = await firebaseReady;
    }
    return firebaseModule;
};

// Lazy load Firestore only when Wall of Fame is visible
const getFirestore = async () => {
    if (!firestoreModule) {
        firestoreModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    }
    return firestoreModule;
};

// Lazy load Three.js only if needed
const getThree = async () => {
    if (!threeModule) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
        document.head.appendChild(script);
        await new Promise(resolve => script.onload = resolve);
        threeModule = window.THREE;
    }
    return threeModule;
};

// Critical above-the-fold initialization
function initCritical() {
    // Fix CLS immediately by setting dimensions
    const heroSignboard = document.querySelector('.hero-signboard');
    if (heroSignboard) {
        heroSignboard.style.minHeight = '400px';
        heroSignboard.style.contain = 'layout';
    }
    
    // Cache critical DOM elements
    const elements = {
        desktopLoginBtn: document.getElementById('desktop-login-button'),
        userAvatarLink: document.getElementById('user-avatar-link'),
        userAvatarImg: document.getElementById('user-avatar-img'),
        heroCtaButton: document.getElementById('hero-cta-button'),
        menuButton: document.getElementById('mobile-menu-button'),
        mobileMenu: document.getElementById('mobile-menu'),
        mobileMenuOverlay: document.getElementById('mobile-menu-overlay'),
        header: document.getElementById('main-header')
    };
    
    // Setup critical mobile menu (no Firebase needed)
    setupCriticalMenu(elements);
    
    // Setup optimized scroll (passive, debounced)
    setupOptimizedScroll(elements);
    
    return elements;
}

// Setup basic menu without Firebase
function setupCriticalMenu(elements) {
    const { menuButton, mobileMenu, mobileMenuOverlay } = elements;
    
    if (menuButton) {
        menuButton.addEventListener('click', () => {
            const isOpen = mobileMenu?.classList.contains('is-open');
            toggleMobileMenu(!isOpen, elements);
        }, { passive: true });
    }
    
    if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener('click', () => {
            toggleMobileMenu(false, elements);
        }, { passive: true });
    }

    // Close the mobile menu when any link inside it is clicked (navigation)
    if (mobileMenu) {
        mobileMenu.addEventListener('click', (e) => {
            const target = e.target;
            if (target && target.closest('a')) {
                toggleMobileMenu(false, elements);
            }
        });
    }
}

// Sync header scrolled state with current scroll position
function syncHeaderScrolled(elements) {
    const { header } = elements;
    if (!header) return;
    header.classList.toggle('header-scrolled', window.scrollY > 50);
}

function toggleMobileMenu(open, elements) {
    const { mobileMenu, mobileMenuOverlay, menuButton } = elements;
    if (!mobileMenu || !mobileMenuOverlay) return;
    
    const action = open ? 'add' : 'remove';
    mobileMenu.classList[action]('is-open');
    mobileMenuOverlay.classList[action]('is-open');
    document.body.style.overflow = open ? 'hidden' : '';
    
    if (menuButton) {
        menuButton.innerHTML = open ? 
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 18"/></svg>' :
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    }
}

// Ensure any transient menus are closed (useful on BFCache restore or breakpoint changes)
function closeAllMenus(elements) {
    // Close unscrolled mobile menu
    toggleMobileMenu(false, elements);

    // Close scrolled mobile dropdown if present
    const scrolledMenuPanel = document.getElementById('scrolled-menu-panel');
    const scrolledMenuTrigger = document.getElementById('scrolled-menu-trigger');
    if (scrolledMenuPanel) scrolledMenuPanel.classList.remove('is-open');
    if (scrolledMenuTrigger) scrolledMenuTrigger.classList.remove('is-open');
}

// Ultra-optimized scroll with RAF and debouncing
function setupOptimizedScroll(elements) {
    let ticking = false;
    let lastScrollY = 0;
    
    const updateScroll = () => {
        const scrollY = window.scrollY;
        
        // Always re-evaluate header state to avoid sticky state on slow scroll
        if (elements.header) {
            const isScrolled = scrollY > 50; // threshold remains the same visually
            const currently = elements.header.classList.contains('header-scrolled');
            if (currently !== isScrolled) {
                elements.header.classList.toggle('header-scrolled', isScrolled);
            }
        }
        
        const toTopWrapper = document.getElementById('back-to-top-wrapper');
        if (toTopWrapper && Math.abs(scrollY - lastScrollY) > 10) {
            toTopWrapper.classList.toggle('is-visible', scrollY > 300);
        }
        
        lastScrollY = scrollY;
        ticking = false;
    };
    
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(updateScroll);
            ticking = true;
        }
    }, { passive: true });
}

// Defer auth setup until actually needed
async function setupAuthWhenReady(elements) {
    try {
        const firebaseHandles = await getFirebaseAuth();
        const auth = await firebaseHandles.auth;
        
        if (!auth) return;
        
        const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
        
        onAuthStateChanged(auth, user => {
            // Use RAF for DOM updates
            requestAnimationFrame(() => {
                updateUIForAuth(user, elements);
            });
        });
    } catch (error) {
        console.log('Auth not needed on this page');
    }
}

function updateUIForAuth(user, elements) {
    const isLoggedIn = !!user;
    
    // Batch all DOM updates
    requestAnimationFrame(() => {
        if (elements.desktopLoginBtn) {
            elements.desktopLoginBtn.classList.toggle('hidden', isLoggedIn);
        }
        if (elements.userAvatarLink) {
            elements.userAvatarLink.classList.toggle('hidden', !isLoggedIn);
        }
        if (elements.heroCtaButton) {
            elements.heroCtaButton.href = isLoggedIn ? 'dashboard.html' : 'login.html';
        }
        
        // Update avatar if logged in (cache-first, then background revalidate)
        if (isLoggedIn && elements.userAvatarImg) {
            const img = elements.userAvatarImg;
            img.crossOrigin = 'anonymous';
            const AVATAR_CACHE_KEY = 'avatarCache:v1';
            const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
            const getCached = () => {
                try {
                    const raw = localStorage.getItem(AVATAR_CACHE_KEY);
                    if (!raw) return null;
                    const parsed = JSON.parse(raw);
                    if (!parsed || !parsed.url || !parsed.dataUrl || !parsed.ts) return null;
                    return parsed;
                } catch { return null; }
            };
            const setCached = (url, dataUrl) => {
                try { localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify({ url, dataUrl, ts: Date.now() })); } catch {}
            };
            const fetchAsDataURL = async (url) => {
                const controller = new AbortController();
                const to = setTimeout(() => controller.abort(), 6000);
                try {
                    const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal: controller.signal });
                    if (!res.ok) throw new Error('Avatar fetch failed: ' + res.status);
                    const blob = await res.blob();
                    if (blob.size > 600000) return null; // skip very large
                    const reader = new FileReader();
                    const dataUrl = await new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    return dataUrl;
                } finally { clearTimeout(to); }
            };

            const cached = getCached();
            const now = Date.now();
            const photoURL = user.photoURL || '';
            const fresh = cached && cached.url === photoURL && (now - cached.ts) < AVATAR_TTL_MS;
            if (photoURL && fresh) {
                img.src = cached.dataUrl;
            } else if (photoURL) {
                img.src = photoURL;
                // Revalidate in background
                (async () => {
                    try {
                        const dataUrl = await fetchAsDataURL(photoURL);
                        if (dataUrl) setCached(photoURL, dataUrl);
                    } catch {}
                })();
            } else {
                const initial = (user.displayName || user.email).charAt(0).toUpperCase();
                const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito" font-size="20" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
            }
        }
        
        // Update mobile menu button
        const mobileMenuButton = document.querySelector('.mobile-menu-button');
        if (mobileMenuButton) {
            mobileMenuButton.href = isLoggedIn ? 'dashboard.html' : 'login.html';
            mobileMenuButton.textContent = isLoggedIn ? 'Go to Dashboard' : 'Get Started';
        }
        
        // Handle scrolled menu
        updateScrolledMenu(user);
    });
}

function updateScrolledMenu(user) {
    const scrolledMenuPanel = document.getElementById('scrolled-menu-panel');
    const scrolledCtaButton = document.getElementById('scrolled-cta-button');
    const scrolledMenuTrigger = document.getElementById('scrolled-menu-trigger');
    
    if (!scrolledMenuPanel) return;
    
    // Clear existing content
    const existingContent = scrolledMenuPanel.querySelectorAll('.scrolled-user-info, #scrolled-dashboard-link');
    existingContent.forEach(el => el.remove());
    
    if (user) {
        if (scrolledCtaButton) scrolledCtaButton.style.display = 'none';
        
        const userInfo = document.createElement('div');
        userInfo.className = 'scrolled-user-info';
        userInfo.innerHTML = `
            <img src="${user.photoURL || 'data:image/svg+xml;base64,' + btoa(`<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="16" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito" font-size="16" fill="#FFF" text-anchor="middle" dy=".3em">${(user.displayName || user.email).charAt(0).toUpperCase()}</text></svg>`)}" 
                 style="width: 32px; height: 32px; border-radius: 50%;">
            <span style="color: var(--bg-primary); font-size: 0.9rem;">${user.displayName || user.email.split('@')[0]}</span>
        `;
        
        const dashboardLink = document.createElement('a');
        dashboardLink.href = 'dashboard.html';
        dashboardLink.id = 'scrolled-dashboard-link';
        dashboardLink.className = 'desktop-cta-button';
        dashboardLink.textContent = 'Go to Dashboard';
        
        scrolledMenuPanel.appendChild(userInfo);
        scrolledMenuPanel.appendChild(dashboardLink);
    } else {
        if (scrolledCtaButton) scrolledCtaButton.style.display = 'block';
    }
    
    // Setup scrolled menu trigger (guard against duplicate binds)
    if (scrolledMenuTrigger && !scrolledMenuTrigger.dataset.bound) {
        scrolledMenuTrigger.dataset.bound = '1';
        scrolledMenuTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            scrolledMenuPanel?.classList.toggle('is-open');
            scrolledMenuTrigger.classList.toggle('is-open');
        });
    }

    // Close scrolled panel when clicking any link inside it
    if (scrolledMenuPanel && !scrolledMenuPanel.dataset.linkbound) {
        scrolledMenuPanel.dataset.linkbound = '1';
        scrolledMenuPanel.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link) {
                scrolledMenuPanel.classList.remove('is-open');
                if (scrolledMenuTrigger) scrolledMenuTrigger.classList.remove('is-open');
            }
        });
    }

    // Global click-away and Escape to close when open (bind once)
    if (scrolledMenuPanel && !document.documentElement.dataset.scrolledMenuDismissBound) {
        document.documentElement.dataset.scrolledMenuDismissBound = '1';
        document.addEventListener('click', (e) => {
            if (!scrolledMenuPanel.classList.contains('is-open')) return;
            const target = e.target;
            if (scrolledMenuPanel.contains(target)) return;
            if (scrolledMenuTrigger && scrolledMenuTrigger.contains(target)) return;
            scrolledMenuPanel.classList.remove('is-open');
            if (scrolledMenuTrigger) scrolledMenuTrigger.classList.remove('is-open');
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && scrolledMenuPanel.classList.contains('is-open')) {
                scrolledMenuPanel.classList.remove('is-open');
                if (scrolledMenuTrigger) scrolledMenuTrigger.classList.remove('is-open');
            }
        });
    }
}

// Lazy load Wall of Fame only when visible
async function setupWallOfFame() {
    const wallOfFameList = document.getElementById('wall-of-fame-list');
    if (!wallOfFameList) return;

    // Show skeleton loader first
    let skeletonHTML = '';
    for (let i = 0; i < 3; i++) {
        skeletonHTML += `
            <div class="fame-player-card">
                <div class="skeleton skeleton-avatar" style="width: 35px; height: 35px; margin-right: 0.75rem;"></div>
                <div class="skeleton skeleton-text" style="flex-grow: 1; height: 1em;"></div>
                <div class="skeleton skeleton-text" style="width: 80px; height: 1em; margin-left: 1rem;"></div>
            </div>
        `;
    }
    wallOfFameList.innerHTML = skeletonHTML;

    try {
        // Import Firestore functions
        const { collection, query, orderBy, limit, getDocs } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
        
        // Get Firebase connection handles
        const firebaseHandles = await getFirebaseAuth();
        // Await the db promise from the getter to ensure the connection is ready
        const db = await firebaseHandles.db;

        if (!db) {
            wallOfFameList.innerHTML = '<p class="loading-text">Could not connect to leaderboard.</p>';
            return;
        }
        
        const wallOfFameRef = collection(db, "wallOfFame");
    // Prefer leaderboardScore (may include half-day boosts), fallback to currentStreak
    const q = query(wallOfFameRef, orderBy("leaderboardScore", "desc"), limit(5));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            wallOfFameList.innerHTML = '<p class="loading-text">Be the first to get on the Wall of Fame!</p>';
            return;
        }
        
        // Clear skeleton loader and show real data
        wallOfFameList.innerHTML = ''; 
        
        querySnapshot.forEach(doc => {
            const user = doc.data();
            const card = document.createElement('div');
            card.className = 'fame-player-card';
            
            // Add a check for displayName to prevent errors if it's missing
            const displayName = user.displayName || 'Anonymous';
            const initial = displayName.charAt(0).toUpperCase();
            const svgAvatar = `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="32" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito" font-size="32" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
            const avatarSrc = user.photoURL || `data:image/svg+xml;base64,${btoa(svgAvatar)}`;
            
            const score = (typeof user.leaderboardScore === 'number') ? user.leaderboardScore : (user.currentStreak || 0);
            const scoreLabel = Number.isInteger(score) ? `${score}` : `${score}`; // allow 0.5 to show
            card.innerHTML = `
                <img src="${avatarSrc}" alt="${displayName}" class="fame-avatar" loading="lazy">
                <span class="fame-name">${displayName}</span>
                <span class="fame-streak">🔥 ${scoreLabel}-day streak</span>
            `;
            wallOfFameList.appendChild(card);
        });
        
    } catch (error) {
        console.error("Wall of Fame error:", error);
        wallOfFameList.innerHTML = '<p class="loading-text">Could not load top players right now.</p>';
    }
}

// Lazy load animations and videos
function setupLazyAnimations() {
    // Fade-in animations
    const fadeObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '50px' });
    
    document.querySelectorAll('.step-item, .wall-of-fame-card, .faq-board').forEach(el => {
        el.classList.add('fade-in-element');
        fadeObserver.observe(el);
    });
    
    // Setup video handlers
    setupVideoHandlers();
}

// Optimized video handling
function setupVideoHandlers() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const stepItems = document.querySelectorAll('.step-item');
    
    if (!stepItems.length) return;
    
    // Unified: Click-to-play on both mobile and desktop, no autoplay
    stepItems.forEach(item => {
        const video = item.querySelector('.step-video');
        const container = item.querySelector('.step-visual');
        if (!video || !container) return;

        // Ensure paused initially
        video.removeAttribute('autoplay');
        video.pause();
        container.classList.toggle('is-playing', !video.paused);

        const toggle = async () => {
            try {
                if (video.paused) {
                    await video.play();
                } else {
                    video.pause();
                }
            } catch (_) {}
            container.classList.toggle('is-playing', !video.paused);
        };

        container.addEventListener('click', toggle);
        video.addEventListener('ended', () => {
            container.classList.remove('is-playing');
        });
    });
}

// Initialize only critical stuff immediately
const elements = initCritical();
// On initial load, ensure all menus are closed in case of stale DOM classes
closeAllMenus(elements);
// Also sync header visuals once on load
syncHeaderScrolled(elements);

// Defer everything else using DOMContentLoaded for a faster start
document.addEventListener('DOMContentLoaded', () => {
    // These animations are lightweight and can start immediately
    setupLazyAnimations();

    // Ensure videos render a frame without autoplay
    document.querySelectorAll('.step-video').forEach(v => {
        try {
            v.removeAttribute('autoplay');
            v.pause();
            // load metadata and first frame
            v.load();
        } catch (_) {}
    });

    // Defer auth setup strictly to explicit user interaction (no idle/scroll)
    let authStarted = false;
    const startAuth = () => { if (!authStarted) { authStarted = true; setupAuthWhenReady(elements); } };
    window.addEventListener('pointerdown', startAuth, { once: true, passive: true, capture: true });
    window.addEventListener('keydown', startAuth, { once: true, passive: true, capture: true });
    const heroCTA = document.getElementById('hero-cta-button');
    if (heroCTA) heroCTA.addEventListener('click', startAuth, { once: true, passive: true, capture: true });

    // Load Wall of Fame on explicit user request to avoid loading Firestore in background
    const wallOfFameSection = document.getElementById('wall-of-fame');
    const wallOfFameList = document.getElementById('wall-of-fame-list');
    const saveData = navigator.connection && navigator.connection.saveData;
    const lowCore = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    if (wallOfFameSection && wallOfFameList) {
        const isMobileLayout = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
        if (saveData || lowCore) {
            wallOfFameList.innerHTML = '<p class="loading-text">Leaderboard disabled to save data/resources.</p>';
        } else if (isMobileLayout) {
            // Clear placeholder and render a centered mobile-only button
            wallOfFameList.innerHTML = '';
            const card = wallOfFameList.closest('.wall-of-fame-card');
            const holder = document.createElement('div');
            holder.className = 'wof-load-btn-container';
            const btn = document.createElement('button');
            btn.className = 'desktop-cta-button wof-load-btn';
            btn.textContent = 'Show Leaderboard';
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = 'Loading...';
                await setupWallOfFame();
                holder.remove();
            }, { once: true });
            holder.appendChild(btn);
            (card || wallOfFameList).appendChild(holder);
        } else {
            // Desktop: lazy-load when section becomes visible, but register IO after window load
            wallOfFameList.innerHTML = '';
            const registerIO = () => {
                if ('IntersectionObserver' in window) {
                    const io = new IntersectionObserver((entries, ob) => {
                        const e = entries[0];
                        if (e.isIntersecting) {
                            ob.disconnect();
                            setupWallOfFame();
                        }
                    }, { rootMargin: '100px' });
                    io.observe(wallOfFameSection);
                } else {
                    setTimeout(setupWallOfFame, 1200);
                }
            };
            if (document.readyState === 'complete') registerIO();
            else window.addEventListener('load', registerIO, { once: true });
        }
    }

    // Reveal mobile controls only on mobile viewports
    const unhideMobileControls = () => {
        const isMobile = window.matchMedia('(max-width: 767px)').matches;
        const mobileBtn = document.getElementById('mobile-menu-button');
        const scrolledContainer = document.getElementById('scrolled-menu-container');
        if (mobileBtn) mobileBtn.hidden = !isMobile;
        if (scrolledContainer) scrolledContainer.hidden = !isMobile;
    };
    unhideMobileControls();
    const mqMobile = window.matchMedia('(max-width: 767px)');
    const mqHandler = () => unhideMobileControls();
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', mqHandler);
    else mqMobile.addListener(mqHandler);
});


// Three.js only loads if explicitly needed (not on page load)
window.loadThreeJS = async () => {
    const THREE = await getThree();
    // Initialize your 3D content here
    console.log('Three.js loaded:', THREE);
};

// Close menus on BFCache restore and when viewport crosses into desktop
window.addEventListener('pageshow', (e) => {
    // e.persisted is true when restored from bfcache in some browsers
    closeAllMenus(elements);
    syncHeaderScrolled(elements);
});

// Watch for viewport changes; if desktop, force close mobile menus
(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (ev) => {
        if (ev.matches) closeAllMenus(elements);
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler); // Safari fallback
})();

// Also close menus when the page becomes visible again (history back/forward or tab switch)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // If we're on desktop now, ensure menus are closed
        if (window.matchMedia('(min-width: 768px)').matches) {
            closeAllMenus(elements);
        }
    // Always resync header scrolled state on return
    syncHeaderScrolled(elements);
    }
});
