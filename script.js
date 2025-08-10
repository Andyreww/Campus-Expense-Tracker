// Optimized script.js - Lazy loading and performance improvements
import { firebaseReady } from './auth.js';

// Lazy load Firestore only when needed
let firestoreModule = null;
const getFirestore = async () => {
    if (!firestoreModule) {
        firestoreModule = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
    }
    return firestoreModule;
};

document.addEventListener('DOMContentLoaded', async () => {
    // Cache DOM elements once
    const elements = {
        desktopLoginBtn: document.getElementById('desktop-login-button'),
        userAvatarLink: document.getElementById('user-avatar-link'),
        userAvatarImg: document.getElementById('user-avatar-img'),
        heroCtaButton: document.getElementById('hero-cta-button'),
        wallOfFameList: document.getElementById('wall-of-fame-list'),
        menuButton: document.getElementById('mobile-menu-button'),
        mobileMenu: document.getElementById('mobile-menu'),
        mobileMenuOverlay: document.getElementById('mobile-menu-overlay'),
        header: document.getElementById('main-header'),
        toTopWrapper: document.getElementById('back-to-top-wrapper'),
        scrolledMenuTrigger: document.getElementById('scrolled-menu-trigger'),
        scrolledMenuPanel: document.getElementById('scrolled-menu-panel'),
        scrolledCtaButton: document.getElementById('scrolled-cta-button')
    };

    // --- Optimized Auth State Logic ---
    const { auth, db } = await firebaseReady;
    
    if (auth) {
        // Use a single auth listener with optimized DOM updates
        auth.onAuthStateChanged(user => {
            requestAnimationFrame(() => {
                updateUIForAuthState(user, elements);
            });
        });
    }

    // --- Defer Wall of Fame loading ---
    if (db && elements.wallOfFameList) {
        // Use Intersection Observer to lazy load Wall of Fame
        const wallObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                fetchWallOfFame(db, elements.wallOfFameList);
                wallObserver.disconnect();
            }
        }, { rootMargin: '100px' });
        
        wallObserver.observe(elements.wallOfFameList);
    }

    // --- Mobile Menu Logic (simplified) ---
    setupMobileMenu(elements);

    // --- Optimized Scroll Handling ---
    setupScrollHandlers(elements);

    // --- Lazy load animations ---
    requestIdleCallback(() => {
        setupFadeInAnimations();
        setupVideoHandlers();
    });
});

// Separate function for auth UI updates
function updateUIForAuthState(user, elements) {
    const isLoggedIn = !!user;
    
    // Batch DOM updates
    if (elements.desktopLoginBtn) {
        elements.desktopLoginBtn.classList.toggle('hidden', isLoggedIn);
    }
    if (elements.userAvatarLink) {
        elements.userAvatarLink.classList.toggle('hidden', !isLoggedIn);
    }

    // Update mobile dropdown
    updateScrolledMenu(user, elements);
    
    // Update mobile menu button
    const mobileMenuButton = document.querySelector('.mobile-menu-button');
    if (mobileMenuButton) {
        mobileMenuButton.href = isLoggedIn ? 'dashboard.html' : 'login.html';
        mobileMenuButton.textContent = isLoggedIn ? 'Go to Dashboard' : 'Get Started';
    }

    if (elements.heroCtaButton) {
        elements.heroCtaButton.href = isLoggedIn ? 'dashboard.html' : 'login.html';
    }

    // Update avatar
    if (isLoggedIn && elements.userAvatarImg) {
        if (user.photoURL) {
            elements.userAvatarImg.src = user.photoURL;
        } else {
            elements.userAvatarImg.src = generateAvatarDataURL(user.displayName || user.email);
        }
    }
}

// Optimized scrolled menu update
function updateScrolledMenu(user, elements) {
    if (!elements.scrolledMenuPanel) return;
    
    // Clear existing content
    const existingContent = elements.scrolledMenuPanel.querySelectorAll('.scrolled-user-info, #scrolled-dashboard-link');
    existingContent.forEach(el => el.remove());
    
    if (user) {
        // Hide Get Started button
        if (elements.scrolledCtaButton) {
            elements.scrolledCtaButton.style.display = 'none';
        }
        
        // Create user info in one go
        const fragment = document.createDocumentFragment();
        
        const userInfoDiv = document.createElement('div');
        userInfoDiv.className = 'scrolled-user-info';
        userInfoDiv.style.cssText = `
            display: flex; align-items: center; gap: 0.75rem;
            padding: 0.75rem 1rem; margin-top: 0.5rem;
            border-top: 1px solid rgba(255,255,255,0.2);
        `;
        
        const avatar = document.createElement('img');
        avatar.style.cssText = 'width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--bg-primary);';
        avatar.src = user.photoURL || generateAvatarDataURL(user.displayName || user.email);
        
        const userText = document.createElement('span');
        userText.style.cssText = `
            color: var(--bg-primary); font-size: 0.9rem; font-weight: 600;
            text-shadow: 1px 1px 1px rgba(0,0,0,0.2); white-space: nowrap;
            overflow: hidden; text-overflow: ellipsis; flex: 1;
        `;
        userText.textContent = user.displayName || user.email.split('@')[0];
        
        userInfoDiv.appendChild(avatar);
        userInfoDiv.appendChild(userText);
        
        const dashboardLink = document.createElement('a');
        dashboardLink.id = 'scrolled-dashboard-link';
        dashboardLink.href = 'dashboard.html';
        dashboardLink.className = 'desktop-cta-button';
        dashboardLink.textContent = 'Go to Dashboard';
        dashboardLink.style.cssText = 'text-align: center; margin-top: 0.5rem; display: block;';
        
        fragment.appendChild(userInfoDiv);
        fragment.appendChild(dashboardLink);
        elements.scrolledMenuPanel.appendChild(fragment);
    } else {
        // Show Get Started button
        if (elements.scrolledCtaButton) {
            elements.scrolledCtaButton.style.display = 'block';
        }
    }
}

// Helper function to generate avatar
function generateAvatarDataURL(name) {
    const initial = name.charAt(0).toUpperCase();
    const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito" font-size="20" fill="#FFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Optimized Wall of Fame fetching
async function fetchWallOfFame(db, wallOfFameList) {
    try {
        const { collection, query, where, orderBy, limit, getDocs } = await getFirestore();
        
        const wallOfFameRef = collection(db, "wallOfFame");
        const q = query(wallOfFameRef, orderBy("currentStreak", "desc"), limit(5));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            wallOfFameList.innerHTML = '<p class="loading-text">Be the first to get on the Wall of Fame!</p>';
            return;
        }

        // Build all cards at once
        const fragment = document.createDocumentFragment();
        querySnapshot.forEach(doc => {
            const user = doc.data();
            const card = document.createElement('div');
            card.className = 'fame-player-card';
            
            const avatarSrc = user.photoURL || generateAvatarDataURL(user.displayName);
            card.innerHTML = `
                <img src="${avatarSrc}" alt="${user.displayName}" class="fame-avatar" loading="lazy">
                <span class="fame-name">${user.displayName}</span>
                <span class="fame-streak">🔥 ${user.currentStreak || 0}-day streak</span>
            `;
            fragment.appendChild(card);
        });
        
        wallOfFameList.innerHTML = '';
        wallOfFameList.appendChild(fragment);
        
    } catch (error) {
        console.error("Error fetching Wall of Fame:", error);
        wallOfFameList.innerHTML = '<p class="loading-text">Could not load top players right now.</p>';
    }
}

// Setup mobile menu with event delegation
function setupMobileMenu(elements) {
    const { menuButton, mobileMenu, mobileMenuOverlay, scrolledMenuTrigger, scrolledMenuPanel } = elements;
    
    if (menuButton) {
        menuButton.addEventListener('click', () => {
            const isOpen = mobileMenu?.classList.contains('is-open');
            toggleMobileMenu(!isOpen, elements);
        });
    }
    
    if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener('click', () => toggleMobileMenu(false, elements));
    }
    
    // Scrolled menu with event delegation
    if (scrolledMenuTrigger) {
        scrolledMenuTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            scrolledMenuPanel?.classList.toggle('is-open');
            scrolledMenuTrigger.classList.toggle('is-open');
        });
    }
    
    // Close on outside click
    document.addEventListener('click', (e) => {
        if (scrolledMenuPanel && !scrolledMenuPanel.contains(e.target) && 
            scrolledMenuTrigger && !scrolledMenuTrigger.contains(e.target)) {
            scrolledMenuPanel.classList.remove('is-open');
            scrolledMenuTrigger.classList.remove('is-open');
        }
    });
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

// Optimized scroll handling with passive listeners
function setupScrollHandlers(elements) {
    let scrollTimer = null;
    let lastScrollY = 0;
    
    const handleScroll = () => {
        const scrollY = window.scrollY;
        
        // Only update if scroll changed significantly
        if (Math.abs(scrollY - lastScrollY) < 5) return;
        lastScrollY = scrollY;
        
        if (elements.header) {
            elements.header.classList.toggle('header-scrolled', scrollY > 50);
            if (scrollY <= 50 && elements.scrolledMenuPanel) {
                elements.scrolledMenuPanel.classList.remove('is-open');
                if (elements.scrolledMenuTrigger) {
                    elements.scrolledMenuTrigger.classList.remove('is-open');
                }
            }
        }
        
        if (elements.toTopWrapper) {
            elements.toTopWrapper.classList.toggle('is-visible', scrollY > 300);
        }
    };
    
    // Debounced scroll handler
    window.addEventListener('scroll', () => {
        if (scrollTimer) return;
        scrollTimer = requestAnimationFrame(() => {
            handleScroll();
            scrollTimer = null;
        });
    }, { passive: true });
}

// Lazy load fade-in animations
function setupFadeInAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, { 
        threshold: 0.1,
        rootMargin: '50px'
    });
    
    document.querySelectorAll('.step-item, .wall-of-fame-card, .faq-board').forEach(el => {
        el.classList.add('fade-in-element');
        observer.observe(el);
    });
}

// Optimized video handling
function setupVideoHandlers() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const stepItems = document.querySelectorAll('.step-item');
    
    if (isMobile) {
        // Simple click-to-play for mobile
        stepItems.forEach(item => {
            const video = item.querySelector('.step-video');
            const container = item.querySelector('.step-visual');
            if (!video || !container) return;
            
            video.removeAttribute('autoplay');
            video.removeAttribute('loop');
            video.pause();
            
            // Simple play button overlay
            const playBtn = document.createElement('div');
            playBtn.className = 'video-play-overlay';
            playBtn.innerHTML = '▶';
            playBtn.style.cssText = `
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                width: 60px; height: 60px; background: rgba(255,255,255,0.9);
                border-radius: 50%; display: flex; align-items: center;
                justify-content: center; cursor: pointer; font-size: 24px;
            `;
            
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
        const videoObserver = new IntersectionObserver((entries) => {
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
        
        stepItems.forEach(item => {
            const video = item.querySelector('.step-video');
            if (video) {
                video.muted = true;
                video.setAttribute('playsinline', '');
                videoObserver.observe(item);
            }
        });
    }
}