import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
        onAuthStateChanged(auth, (user) => {
            if (user) {
                desktopLoginBtn.classList.add('hidden');
                userAvatarLink.classList.remove('hidden');
                heroCtaButton.href = 'dashboard.html';
                
                if (user.photoURL) {
                    userAvatarImg.src = user.photoURL;
                } else {
                    const initial = (user.displayName || user.email).charAt(0).toUpperCase();
                    const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" ry="20" fill="#0EA5E9"/><text x="50%" y="50%" font-family="Poppins, sans-serif" font-size="20" fill="#FFFFFF" text-anchor="middle" dy=".3em">${initial}</text></svg>`;
                    userAvatarImg.src = `data:image/svg+xml;base64,${btoa(svg)}`;
                }
            } else {
                desktopLoginBtn.classList.remove('hidden');
                userAvatarLink.classList.add('hidden');
                heroCtaButton.href = 'login.html';
            }
        });

        // --- Wall of Fame Logic ---
        const fetchWallOfFame = async () => {
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
                wallOfFameList.innerHTML = '<p class="loading-text">Could not load top players right now.</p>';
            }
        };

        fetchWallOfFame();

        // --- Mobile Menu & Other UI Logic ---
        function openMenu() {
            mobileMenu.classList.add('is-open');
            mobileMenuOverlay.classList.add('is-open');
            document.body.style.overflow = 'hidden';
            menuButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
        }

        function closeMenu() {
            mobileMenu.classList.remove('is-open');
            mobileMenuOverlay.classList.remove('is-open');
            document.body.style.overflow = '';
            menuButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`;
        }

        menuButton.addEventListener('click', () => {
            mobileMenu.classList.contains('is-open') ? closeMenu() : openMenu();
        });
        mobileMenuOverlay.addEventListener('click', closeMenu);
        menuLinks.forEach(link => link.addEventListener('click', closeMenu));
        
        const toggleScrolledMenu = (forceClose = false) => {
            if (scrolledMenuPanel) {
                if (forceClose || scrolledMenuPanel.classList.contains('is-open')) {
                    scrolledMenuPanel.classList.remove('is-open');
                    scrolledMenuTrigger.classList.remove('is-open');
                } else {
                    scrolledMenuPanel.classList.add('is-open');
                    scrolledMenuTrigger.classList.add('is-open');
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

        let isTicking = false; 
        
        const handleScroll = () => {
            if (window.scrollY > 50) {
                header.classList.add('header-scrolled');
            } else {
                header.classList.remove('header-scrolled');
                toggleScrolledMenu(true);
            }
            if (window.scrollY > 300) {
                toTopWrapper.classList.add('is-visible');
            } else {
                toTopWrapper.classList.remove('is-visible');
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
        
        const tiltElements = document.querySelectorAll('.feature-card, .back-to-top-button');
        tiltElements.forEach(element => {
            element.addEventListener('mousemove', (e) => {
                const rect = element.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                const rotateX = (y - centerY) / 10;
                const rotateY = (x - centerX) / -10;

                element.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;
                
                element.style.setProperty('--x', `${(x / rect.width) * 100}%`);
                element.style.setProperty('--y', `${(y / rect.height) * 100}%`);
            });

            element.addEventListener('mouseleave', () => {
                element.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale(1)';
            });
        });

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    observer.unobserve(entry.target);
                }
            });
        }, { 
            threshold: 0.1 
        });

        document.querySelectorAll('.feature-card, .step-item, .wall-of-fame-card').forEach(el => {
            el.classList.add('fade-in-element');
            observer.observe(el);
        });

        const stepItems = document.querySelectorAll('.step-item');

        stepItems.forEach(item => {
            const video = item.querySelector('.step-video');
            if (video) {
                item.addEventListener('mouseenter', () => {
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(error => {});
                    }
                });

                item.addEventListener('mouseleave', () => {
                    video.pause();
                });

                let isPlaying = false;
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (isPlaying) {
                        video.pause();
                    } else {
                        video.play();
                    }
                    isPlaying = !isPlaying;
                });
            }
        });
    
    } catch (error) {
        console.error("Fatal Error initializing landing page:", error);
        const wallOfFameList = document.getElementById('wall-of-fame-list');
        if (wallOfFameList) {
            wallOfFameList.innerHTML = '<p class="loading-text">Services are currently unavailable.</p>';
        }
    }
}

// Start the application after the DOM is loaded
document.addEventListener('DOMContentLoaded', main);
