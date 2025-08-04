// Import the central firebaseReady promise from auth.js, which is now the single source of truth.
import { firebaseReady } from './auth.js';
// We still need these for Firestore queries on the landing page.
import { getFirestore, collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {

    // --- Get Firebase services from the central auth module ---
    // This removes the duplicate, conflicting Firebase initialization that was here before.
    const { auth, db } = await firebaseReady;

    // --- DOM Elements ---
    const desktopLoginBtn = document.getElementById('desktop-login-button');
    const userAvatarLink = document.getElementById('user-avatar-link');
    const userAvatarImg = document.getElementById('user-avatar-img');
    const heroCtaButton = document.getElementById('hero-cta-button');
    const wallOfFameList = document.getElementById('wall-of-fame-list');
    const menuButton = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const menuLinks = document.querySelectorAll('.mobile-menu-link, .mobile-menu-button');
    const header = document.getElementById('main-header');
    const toTopWrapper = document.getElementById('back-to-top-wrapper');
    const scrolledMenuTrigger = document.getElementById('scrolled-menu-trigger');
    const scrolledMenuPanel = document.getElementById('scrolled-menu-panel');
    const scrolledCtaButton = document.getElementById('scrolled-cta-button');

    // --- Auth State Logic ---
    // The main onAuthStateChanged in auth.js handles routing.
    // This listener ONLY handles updating the UI for this specific page (index.html).
    if (auth) {
        auth.onAuthStateChanged(user => {
            const isLoggedIn = !!user; // True if user is not null, false otherwise

            // **THE FIX**: This logic is now simplified and more robust.
            // It toggles the visibility of all relevant buttons based on a single boolean.
            desktopLoginBtn?.classList.toggle('hidden', isLoggedIn);
            userAvatarLink?.classList.toggle('hidden', !isLoggedIn);

            // IMPROVED FIX: Better mobile dropdown handling for logged-in users
            if (scrolledMenuPanel) {
                // Remove any existing user info or dashboard link
                const existingUserInfo = scrolledMenuPanel.querySelector('.scrolled-user-info');
                const existingDashboardLink = scrolledMenuPanel.querySelector('#scrolled-dashboard-link');
                
                if (existingUserInfo) existingUserInfo.remove();
                if (existingDashboardLink) existingDashboardLink.remove();

                if (isLoggedIn) {
                    // Hide the Get Started button for logged-in users
                    if (scrolledCtaButton) {
                        scrolledCtaButton.style.display = 'none';
                    }

                    // Create user info section
                    const userInfoDiv = document.createElement('div');
                    userInfoDiv.className = 'scrolled-user-info';
                    userInfoDiv.style.cssText = `
                        display: flex;
                        align-items: center;
                        gap: 0.75rem;
                        padding: 0.75rem 1rem;
                        margin-top: 0.5rem;
                        border-top: 1px solid rgba(255,255,255,0.2);
                    `;

                    // Create avatar
                    const avatar = document.createElement('img');
                    avatar.style.cssText = `
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        border: 2px solid var(--bg-primary);
                    `;

                    if (user.photoURL) {
                        avatar.src = user.photoURL;
                    } else {
                        const initial = (user.displayName || user.email).charAt(0).toUpperCase();
                        const svg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="16" ry="16" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="16" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                        avatar.src = `data:image/svg+xml;base64,${btoa(svg)}`;
                    }

                    // Create user name/email
                    const userText = document.createElement('span');
                    userText.style.cssText = `
                        color: var(--bg-primary);
                        font-size: 0.9rem;
                        font-weight: 600;
                        text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        flex: 1;
                    `;
                    userText.textContent = user.displayName || user.email.split('@')[0];

                    userInfoDiv.appendChild(avatar);
                    userInfoDiv.appendChild(userText);

                    // Create dashboard link
                    const dashboardLink = document.createElement('a');
                    dashboardLink.id = 'scrolled-dashboard-link';
                    dashboardLink.href = 'dashboard.html';
                    dashboardLink.className = 'desktop-cta-button';
                    dashboardLink.textContent = 'Go to Dashboard';
                    dashboardLink.style.cssText = `
                        text-align: center;
                        margin-top: 0.5rem;
                        display: block;
                    `;

                    // Add both to the panel
                    scrolledMenuPanel.appendChild(userInfoDiv);
                    scrolledMenuPanel.appendChild(dashboardLink);
                } else {
                    // Show the Get Started button for logged-out users
                    if (scrolledCtaButton) {
                        scrolledCtaButton.style.display = 'block';
                    }
                }
            }

            // Update the unscrolled mobile menu
            const mobileMenuButton = document.querySelector('.mobile-menu-button');
            if (mobileMenuButton) {
                if (isLoggedIn) {
                    mobileMenuButton.href = 'dashboard.html';
                    mobileMenuButton.textContent = 'Go to Dashboard';
                } else {
                    mobileMenuButton.href = 'login.html';
                    mobileMenuButton.textContent = 'Get Started';
                }
            }

            if (isLoggedIn) {
                // --- UI for LOGGED IN user ---
                heroCtaButton.href = 'dashboard.html';
                
                // Update avatar image
                if (user.photoURL && userAvatarImg) {
                    userAvatarImg.src = user.photoURL;
                } else if (userAvatarImg) {
                    const initial = (user.displayName || user.email).charAt(0).toUpperCase();
                    const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" ry="20" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="20" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                    userAvatarImg.src = `data:image/svg+xml;base64,${btoa(svg)}`;
                }
            } else {
                // --- UI for LOGGED OUT user ---
                heroCtaButton.href = 'login.html';
            }
        });
    }

    // --- Wall of Fame Logic ---
    const fetchWallOfFame = async () => {
        if (!db || !wallOfFameList) return;
        
        try {
            const wallOfFameRef = collection(db, "wallOfFame");
            const q = query(wallOfFameRef, 
                orderBy("currentStreak", "desc"), 
                limit(5)
            );
            const querySnapshot = await getDocs(q);
            
            wallOfFameList.innerHTML = ''; // Clear loading text

            if (querySnapshot.empty) {
                wallOfFameList.innerHTML = '<p class="loading-text">Be the first to get on the Wall of Fame!</p>';
                return;
            }

            querySnapshot.forEach(doc => {
                const user = doc.data();
                const card = document.createElement('div');
                card.className = 'fame-player-card';

                const initial = user.displayName.charAt(0).toUpperCase();
                const svgAvatar = `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="32" ry="32" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="32" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                const avatarSrc = user.photoURL || `data:image/svg+xml;base64,${btoa(svgAvatar)}`;

                card.innerHTML = `
                    <img src="${avatarSrc}" alt="${user.displayName}" class="fame-avatar">
                    <span class="fame-name">${user.displayName}</span>
                    <span class="fame-streak">🔥 ${user.currentStreak || 0}-day streak</span>
                `;
                wallOfFameList.appendChild(card);
            });

        } catch (error) {
            console.error("Error fetching Wall of Fame:", error);
            if (wallOfFameList) {
                wallOfFameList.innerHTML = '<p class="loading-text">Could not load top players right now.</p>';
            }
        }
    };

    // We can only fetch if the database connection from auth.js is successful.
    if (db) {
        fetchWallOfFame();
    }


    // --- Mobile Menu Logic ---
    function openMenu() {
        if (mobileMenu && mobileMenuOverlay && menuButton) {
            mobileMenu.classList.add('is-open');
            mobileMenuOverlay.classList.add('is-open');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
            menuButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 18"/></svg>`;
        }
    }

    function closeMenu() {
        if (mobileMenu && mobileMenuOverlay && menuButton) {
            mobileMenu.classList.remove('is-open');
            mobileMenuOverlay.classList.remove('is-open');
            document.body.style.overflow = ''; // Restore scrolling
            menuButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;
        }
    }

    if (menuButton) {
        menuButton.addEventListener('click', () => {
            mobileMenu.classList.contains('is-open') ? closeMenu() : openMenu();
        });
    }
    if (mobileMenuOverlay) mobileMenuOverlay.addEventListener('click', closeMenu);
    menuLinks.forEach(link => link.addEventListener('click', closeMenu));

    // --- Scrolled Mobile Dropdown Logic ---
    const toggleScrolledMenu = (forceClose = false) => {
        if (scrolledMenuPanel) {
            if (forceClose || scrolledMenuPanel.classList.contains('is-open')) {
                scrolledMenuPanel.classList.remove('is-open');
                if (scrolledMenuTrigger) scrolledMenuTrigger.classList.remove('is-open');
            } else {
                scrolledMenuPanel.classList.add('is-open');
                if (scrolledMenuTrigger) scrolledMenuTrigger.classList.add('is-open');
            }
        }
    };
    if (scrolledMenuTrigger) {
        scrolledMenuTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleScrolledMenu();
        });
    }
    window.addEventListener('click', (e) => {
        if (scrolledMenuPanel && !scrolledMenuPanel.contains(e.target) && scrolledMenuTrigger && !scrolledMenuTrigger.contains(e.target)) {
            toggleScrolledMenu(true);
        }
    });

    // --- Header & Back to Top Button Logic ---
    let isTicking = false; 
    
    const handleScroll = () => {
        if (header) {
            if (window.scrollY > 50) {
                header.classList.add('header-scrolled');
            } else {
                header.classList.remove('header-scrolled');
                toggleScrolledMenu(true);
            }
        }
        if (toTopWrapper) {
            if (window.scrollY > 300) {
                toTopWrapper.classList.add('is-visible');
            } else {
                toTopWrapper.classList.remove('is-visible');
            }
        }
    };

    window.addEventListener('scroll', () => {
        if (!isTicking) {
            window.requestAnimationFrame(() => {
                handleScroll();
                isTicking = false;
            });
            isTicking = true;
        }
    });

    // --- Fade-in Animation on Scroll ---
    const fadeInObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                fadeInObserver.unobserve(entry.target);
            }
        });
    }, { 
        threshold: 0.1 
    });

    document.querySelectorAll('.step-item, .wall-of-fame-card, .faq-board').forEach(el => {
        el.classList.add('fade-in-element');
        fadeInObserver.observe(el);
    });

    // --- FIX 2: Mobile Video Solution - No Freezing ---
    const stepItems = document.querySelectorAll('.step-item');
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
        // Mobile approach: Click to play
        stepItems.forEach((item, index) => {
            const video = item.querySelector('.step-video');
            const container = item.querySelector('.step-visual');
            if (!video || !container) return;

            // Prevent any autoplay attempts
            video.removeAttribute('autoplay');
            video.removeAttribute('loop');
            video.style.display = 'none';
            
            // Create a preview container with paper texture feel
            const preview = document.createElement('div');
            preview.style.cssText = `
                width: 100%;
                height: 100%;
                position: absolute;
                top: 0;
                left: 0;
                background-color: #F0EAD6;
                background-image: 
                    repeating-linear-gradient(
                        45deg,
                        transparent,
                        transparent 10px,
                        rgba(255,255,255,.03) 10px,
                        rgba(255,255,255,.03) 20px
                    ),
                    repeating-linear-gradient(
                        -45deg,
                        transparent,
                        transparent 10px,
                        rgba(0,0,0,.03) 10px,
                        rgba(0,0,0,.03) 20px
                    );
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.3s ease;
            `;
            
            // Add play button with coffee cup feel
            const playButton = document.createElement('div');
            playButton.style.cssText = `
                width: 64px;
                height: 64px;
                background: #FFFDF7;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 3px 10px rgba(74, 44, 42, 0.2);
                transition: all 0.2s ease;
                position: relative;
                z-index: 1;
            `;
            
            playButton.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5V19L19 12L8 5Z" fill="#4CAF50"/>
                </svg>
            `;
            
            preview.appendChild(playButton);
            container.appendChild(preview);
            
            // Click handler
            preview.addEventListener('click', () => {
                preview.style.opacity = '0';
                setTimeout(() => {
                    preview.remove();
                    video.style.display = 'block';
                    video.setAttribute('loop', '');
                    video.play();
                }, 300);
            });
            
            // Hover effect
            preview.addEventListener('mouseenter', () => {
                playButton.style.transform = 'scale(1.05)';
                playButton.style.boxShadow = '0 4px 15px rgba(74, 44, 42, 0.25)';
            });
            preview.addEventListener('mouseleave', () => {
                playButton.style.transform = 'scale(1)';
                playButton.style.boxShadow = '0 3px 10px rgba(74, 44, 42, 0.2)';
            });
        });
    } else {
        // Desktop: Keep original autoplay behavior
        const handleVideoIntersection = (entries, observer) => {
            entries.forEach(entry => {
                const video = entry.target.querySelector('.step-video');
                if (!video) return;

                if (entry.isIntersecting) {
                    video.play().catch(error => {
                        console.error("Video autoplay failed:", error);
                    });
                } else {
                    video.pause();
                }
            });
        };

        const videoObserver = new IntersectionObserver(handleVideoIntersection, {
            threshold: 0.5 
        });

        stepItems.forEach(item => {
            const video = item.querySelector('.step-video');
            if (video) {
                video.muted = true;
                video.setAttribute('playsinline', '');
            }
            videoObserver.observe(item);
        });
    }
});