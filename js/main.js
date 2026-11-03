// Page navigation and content loading
const pages = {
    'about': 'pages/about.html',
    'projects': 'pages/projects.html',
    'gallery': 'pages/gallery.html',
    'calendar': 'pages/calendar.html',
    'materials': 'pages/materials.html'
};

// Load navigation component
async function loadNav() {
    const navContainer = document.getElementById('nav-container');
    try {
        const response = await fetch('components/nav.html');
        if (!response.ok) throw new Error('Nav not found');
        const html = await response.text();
        navContainer.innerHTML = html;
        
        // Reapply translations to nav after loading
        if (window.languageSwitcher) {
            window.languageSwitcher.reapply();
        }
    } catch (error) {
        console.error('Error loading navigation:', error);
    }
}

// Load footer component
async function loadFooter() {
    const footerContainer = document.getElementById('footer-container');
    try {
        const response = await fetch('components/footer.html');
        if (!response.ok) throw new Error('Footer not found');
        const html = await response.text();
        footerContainer.innerHTML = html;
        
        // Reapply translations to footer after loading
        if (window.languageSwitcher) {
            window.languageSwitcher.reapply();
        }
    } catch (error) {
        console.error('Error loading footer:', error);
    }
}

// Update slider position and width
function updateSlider(activeLink) {
    const nav = activeLink.closest('nav');
    const navRect = nav.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    
    const left = linkRect.left - navRect.left;
    const width = linkRect.width;
    
    nav.style.setProperty('--slider-left', `${left}px`);
    nav.style.setProperty('--slider-width', `${width}px`);
}

async function loadPage(pageName, itemId) {
    const content = document.getElementById('content');

    if (!itemId) window.projectsModule?.closeModal();
    try {
        const response = await fetch(pages[pageName]);
        if (!response.ok) throw new Error('Page not found');
        
        const html = await response.text();
        content.innerHTML = html;
        document.body.classList.toggle('calendar-page', pageName === 'calendar');
        document.body.classList.toggle('about-page', pageName === 'about');
        document.body.classList.toggle('projects-page', pageName === 'projects');
        document.body.classList.toggle('gallery-view', pageName === 'gallery');
        document.body.classList.toggle('materials-view', pageName === 'materials');
        
        // Initialize projects module if on the projects page
        if (pageName === 'projects' && window.projectsModule) {
            await window.projectsModule.init();
            if (itemId) window.projectsModule.openById(itemId);
        }

        if (pageName === 'about' && window.aboutModule) {
            await window.aboutModule.init();
        }

        if (pageName === 'calendar' && window.calendarModule) {
            await window.calendarModule.init();
        }

        if (pageName === 'gallery' && window.galleryModule) {
            await window.galleryModule.init();
        }

        if (pageName === 'materials' && window.materialsModule) {
            await window.materialsModule.init();
        }
        
        // Reapply translations to new content
        if (window.languageSwitcher) {
            window.languageSwitcher.reapply();
        }
        
        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${pageName}`) {
                link.classList.add('active');
                // Update slider position after a small delay to ensure nav is rendered
                setTimeout(() => updateSlider(link), 50);
            }
        });
        
        // Update page title
        document.title = `${pageName.charAt(0).toUpperCase() + pageName.slice(1)} - Community Garden`;
        
    } catch (error) {
        content.innerHTML = '<p>Error loading page. Please try again.</p>';
        console.error('Error loading page:', error);
    }
}

// Handle navigation
function handleNavigation() {
    const [hash, itemId] = (window.location.hash.slice(1) || 'about').split('/');
    if (pages[hash]) {
        loadPage(hash, itemId ? decodeURIComponent(itemId) : undefined);
    } else {
        loadPage('about');
    }
}

// Event listeners
window.addEventListener('hashchange', handleNavigation);
window.addEventListener('DOMContentLoaded', async () => {
    await loadNav();
    await loadFooter();
    handleNavigation();
    updateLogoState();
});

// Logo expand/collapse based on page and scroll
function expandedHeaderHeight(header) {
    // Measured with the logo expanded so the content offset never depends on the scroll position.
    const wasExpanded = header.classList.contains('logo-expanded');
    header.classList.add('logo-expanded');
    const height = header.offsetHeight;
    header.classList.toggle('logo-expanded', wasExpanded);
    return height;
}

function updateLogoState() {
    const header = document.querySelector('header');
    if (!header) return;
    const hash = (window.location.hash.slice(1) || 'about').split('/')[0];
    const isAbout = hash === 'about';
    // Hysteresis keeps the header from flickering around a single threshold.
    const wasExpanded = header.classList.contains('logo-expanded');
    const atTop = window.scrollY < (wasExpanded ? 50 : 10);
    header.classList.toggle('logo-expanded', isAbout && atTop);

    // Content offset stays constant while the header collapses, so the page doesn't jump.
    const main = document.querySelector('main');
    if (main) {
        // The projects tabs sit as far below the divider as the main nav sits above it (header padding, 1rem).
        const gap = isAbout ? 48 : ['calendar', 'gallery', 'materials'].includes(hash) ? 40 : hash === 'projects' ? 16 : 128;
        const height = isAbout ? expandedHeaderHeight(header) : header.offsetHeight;
        main.style.marginTop = (height + gap) + 'px';
    }
}

window.addEventListener('scroll', updateLogoState, { passive: true });
window.addEventListener('hashchange', updateLogoState);

// Update slider on window resize
window.addEventListener('resize', () => {
    const activeLink = document.querySelector('.nav-link.active');
    if (activeLink) {
        updateSlider(activeLink);
    }
});

// Prevent default link behavior and handle navigation
document.addEventListener('click', (e) => {
    const dialogTrigger = e.target.closest('[data-dialog-open]');
    if (dialogTrigger) {
        document.getElementById(dialogTrigger.dataset.dialogOpen)?.showModal();
        return;
    }

    const dialogClose = e.target.closest('[data-dialog-close]');
    if (dialogClose) {
        dialogClose.closest('dialog')?.close();
        return;
    }

    if (e.target.matches('[data-dialog-backdrop-close]')) {
        e.target.close();
        return;
    }

    if (e.target.matches('.nav-link')) {
        e.preventDefault();
        const hash = e.target.getAttribute('href');
        window.location.hash = hash;
    }
});