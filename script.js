import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {

    // --- Fetch Firebase Config from Netlify Function and Initialize Firebase ---
    let auth, db;
    try {
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            throw new Error('Failed to load Firebase config.');
        }
        const firebaseConfig = await response.json();

        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        
        // Set auth persistence to session only
        try {
            await setPersistence(auth, browserSessionPersistence);
        } catch (error) {
            console.warn("Could not set auth persistence:", error);
        }
    } catch (error) {
        console.error("Error initializing Firebase with Netlify config:", error);
        // Continue script execution even if Firebase fails
    }

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

    // --- Auth State Logic ---
    let currentUser = null;
    let authStateHandled = false; // Prevent double handling
    
    if (auth) {
        onAuthStateChanged(auth, async (user) => {
            // Prevent double handling
            if (authStateHandled && user?.uid === currentUser?.uid) return;
            authStateHandled = true;
            
            if (user) {
                // Set currentUser globally for use elsewhere
                currentUser = user;
                // User is signed in
                if (desktopLoginBtn) desktopLoginBtn.classList.add('hidden');
                if (userAvatarLink) userAvatarLink.classList.remove('hidden');
                if (heroCtaButton) heroCtaButton.href = 'dashboard.html';
                
                if (user.photoURL && userAvatarImg) {
                    userAvatarImg.src = user.photoURL;
                } else if (userAvatarImg) {
                    const initial = (user.displayName || user.email).charAt(0).toUpperCase();
                    const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" ry="20" fill="#0EA5E9"/><text x="50%" y="50%" font-family="Poppins, sans-serif" font-size="20" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                    userAvatarImg.src = `data:image/svg+xml;base64,${btoa(svg)}`;
                }

                // --- Wall of Fame Opt-In Logic ---
                if (db) {
                    try {
                        const userDocRef = collection(db, "users");
                        const userQuery = query(userDocRef, where("uid", "==", user.uid));
                        const userSnapshot = await getDocs(userQuery);
                        if (!userSnapshot.empty) {
                            const userData = userSnapshot.docs[0].data();
                            if (userData.showOnWallOfFame) {
                                const wallOfFameRef = collection(db, "wallOfFame");
                                // Use setDoc to update or create the wallOfFame entry for this user
                                const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
                                await setDoc(doc(wallOfFameRef, user.uid), {
                                    displayName: user.displayName || "Anonymous",
                                    photoURL: user.photoURL || "",
                                    currentStreak: userData.currentStreak || 0
                                }, { merge: true });
                            }
                        }
                    } catch (error) {
                        console.error("Error updating wall of fame:", error);
                    }
                }
            } else {
                // User is signed out
                currentUser = null;
                if (desktopLoginBtn) desktopLoginBtn.classList.remove('hidden');
                if (userAvatarLink) userAvatarLink.classList.add('hidden');
                if (heroCtaButton) heroCtaButton.href = 'login.html';
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
                const svgAvatar = `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="32" ry="32" fill="#0EA5E9"/><text x="50%" y="50%" font-family="Poppins, sans-serif" font-size="32" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
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

    if (db) {
        fetchWallOfFame();
    }


    // --- Mobile Menu Logic ---
    function openMenu() {
        if (mobileMenu && mobileMenuOverlay && menuButton) {
            mobileMenu.classList.add('is-open');
            mobileMenuOverlay.classList.add('is-open');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
            menuButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
        }
    }

    function closeMenu() {
        if (mobileMenu && mobileMenuOverlay && menuButton) {
            mobileMenu.classList.remove('is-open');
            mobileMenuOverlay.classList.remove('is-open');
            document.body.style.overflow = ''; // Restore scrolling
            menuButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`;
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
    
    // --- 3D Tilt Effect for Cards & Buttons ---
    const tiltElements = document.querySelectorAll('.feature-card, .back-to-top-button');
    tiltElements.forEach(element => {
        element.addEventListener('mousemove', (e) => {
            const rect = element.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = (y - centerY) / 10; // Adjust divisor for sensitivity
            const rotateY = (x - centerX) / -10; // Adjust divisor for sensitivity

            element.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;
            
            // For the radial gradient border effect
            element.style.setProperty('--x', `${(x / rect.width) * 100}%`);
            element.style.setProperty('--y', `${(y / rect.height) * 100}%`);
        });

        element.addEventListener('mouseleave', () => {
            element.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale(1)';
        });
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

    // Apply the fade-in effect to feature cards and how-it-works steps
    document.querySelectorAll('.feature-card, .step-item, .wall-of-fame-card').forEach(el => {
        el.classList.add('fade-in-element'); // Add class for initial styles
        fadeInObserver.observe(el);
    });

    // --- How It Works Video Interaction (Autoplay on Scroll) ---
    const stepItems = document.querySelectorAll('.step-item');

    // This function is called when a video's visibility changes
    const handleVideoIntersection = (entries, observer) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('.step-video');
            if (!video) return;

            if (entry.isIntersecting) {
                // The item is in view, play the video
                video.play().catch(error => {
                    // This can happen if the video isn't muted or another error occurs
                    console.error("Video autoplay failed:", error);
                });
            } else {
                // The item is out of view, pause it
                video.pause();
            }
        });
    };

    // Create a single observer to watch all the video sections
    const videoObserver = new IntersectionObserver(handleVideoIntersection, {
        threshold: 0.5 // Start playing when 50% of the item is visible
    });

    // Tell the observer to watch each step item and prepare its video for autoplay
    stepItems.forEach(item => {
        const video = item.querySelector('.step-video');
        if (video) {
            // MUTE the video for autoplay to work! This is super important.
            video.muted = true;
            // This attribute helps with inline playback on iOS
            video.setAttribute('playsinline', '');
        }
        // Start observing the parent item
        videoObserver.observe(item);
    });

});