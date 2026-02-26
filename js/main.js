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

async function loadPage(pageName) {
    const content = document.getElementById('content');
    
    try {
        const response = await fetch(pages[pageName]);
        if (!response.ok) throw new Error('Page not found');
        
        const html = await response.text();
        content.innerHTML = html;
        
        // Initialize projects module if on the projects page
        if (pageName === 'projects' && window.projectsModule) {
            await window.projectsModule.init();
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
    const hash = window.location.hash.slice(1) || 'about';
    if (pages[hash]) {
        loadPage(hash);
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
function updateLogoState() {
    const header = document.querySelector('header');
    if (!header) return;
    const hash = window.location.hash.slice(1) || 'about';
    const isAbout = hash === 'about';
    const atTop = window.scrollY < 50;
    header.classList.toggle('logo-expanded', isAbout && atTop);

    // Adjust main top margin to match header height
    requestAnimationFrame(() => {
        const main = document.querySelector('main');
        if (main) {
            main.style.marginTop = (header.offsetHeight + 128) + 'px';
        }
    });
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
    if (e.target.matches('.nav-link')) {
        e.preventDefault();
        const hash = e.target.getAttribute('href');
        window.location.hash = hash;
    }
});