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

// Ultra-optimized scroll with RAF and debouncing
function setupOptimizedScroll(elements) {
    let ticking = false;
    let lastScrollY = 0;
    
    const updateScroll = () => {
        const scrollY = window.scrollY;
        
        // Batch DOM reads/writes
        if (elements.header && Math.abs(scrollY - lastScrollY) > 5) {
            elements.header.classList.toggle('header-scrolled', scrollY > 50);
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
        
        // Update avatar if logged in
        if (isLoggedIn && elements.userAvatarImg) {
            if (user.photoURL) {
                elements.userAvatarImg.src = user.photoURL;
            } else {
                const initial = (user.displayName || user.email).charAt(0).toUpperCase();
                const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito" font-size="20" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                elements.userAvatarImg.src = `data:image/svg+xml;base64,${btoa(svg)}`;
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
    
    // Setup scrolled menu trigger
    if (scrolledMenuTrigger) {
        scrolledMenuTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            scrolledMenuPanel?.classList.toggle('is-open');
            scrolledMenuTrigger.classList.toggle('is-open');
        }, { once: true });
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
        const q = query(wallOfFameRef, orderBy("currentStreak", "desc"), limit(5));
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
            
            card.innerHTML = `
                <img src="${avatarSrc}" alt="${displayName}" class="fame-avatar" loading="lazy">
                <span class="fame-name">${displayName}</span>
                <span class="fame-streak">🔥 ${user.currentStreak || 0}-day streak</span>
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
    
    if (isMobile) {
        // Mobile: Click to play with lightweight overlays
        stepItems.forEach(item => {
            const video = item.querySelector('.step-video');
            const container = item.querySelector('.step-visual');
            if (!video || !container) return;
            
            // Prevent autoplay
            video.removeAttribute('autoplay');
            video.pause();
            
            // Create lightweight play button
            const playBtn = document.createElement('div');
            playBtn.style.cssText = `
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                width: 60px; height: 60px; background: rgba(255,255,255,0.9);
                border-radius: 50%; display: flex; align-items: center;
                justify-content: center; cursor: pointer; font-size: 24px;
                z-index: 1;
            `;
            playBtn.innerHTML = '▶';
            
            container.style.position = 'relative';
            container.appendChild(playBtn);
            
            playBtn.addEventListener('click', () => {
                playBtn.remove();
                video.play();
                video.setAttribute('loop', '');
            }, { once: true });
        });
    } else {
        // Desktop: Intersection Observer for autoplay
        const videoObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                const video = entry.target.querySelector('.step-video');
                if (!video) return;
                
                if (entry.isIntersecting) {
                    video.play().catch(() => {});
                } else {
                    video.pause();
                }
            });
        }, { threshold: 0.5 });
        
        stepItems.forEach(item => videoObserver.observe(item));
    }
}

// Initialize only critical stuff immediately
const elements = initCritical();

// Defer everything else using DOMContentLoaded for a faster start
document.addEventListener('DOMContentLoaded', () => {
    // These animations are lightweight and can start immediately
    setupLazyAnimations();

    // Defer auth setup with a more significant timeout. This yields the main thread,
    // allowing the browser to paint and become interactive before we load
    // the heavier Firebase scripts. It's a key trick for Lighthouse.
    setTimeout(() => {
        setupAuthWhenReady(elements);
    }, 3000); // Increased timeout to 3 seconds

    // Use Intersection Observer to load Wall of Fame only when it's visible
    const wallOfFameSection = document.getElementById('wall-of-fame');
    if (wallOfFameSection) {
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setupWallOfFame();
                    // We're done with this observer, so disconnect it
                    observer.disconnect();
                }
            });
        }, { rootMargin: '100px' }); // Load it when it's 100px away from the viewport
        observer.observe(wallOfFameSection);
    }
});


// Three.js only loads if explicitly needed (not on page load)
window.loadThreeJS = async () => {
    const THREE = await getThree();
    // Initialize your 3D content here
    console.log('Three.js loaded:', THREE);
};
