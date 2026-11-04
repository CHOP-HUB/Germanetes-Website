// Language switching functionality with support for nested translation keys

const languageSwitcher = (() => {
    const languages = {
        ca: 'CAT',
        es: 'ESP',
        en: 'ENG'
    };

    let currentTranslations = {};

    // Helper function to get nested property from object using dot notation
    const getNestedProperty = (obj, path) => {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    };

    let activeLanguage = 'ca';
    let loadToken = 0;

    const syncButton = () => {
        const currentLangBtn = document.querySelector('.current-lang');
        if (currentLangBtn) {
            currentLangBtn.textContent = languages[activeLanguage];
        }
    };

    const loadLanguage = (language) => {
        activeLanguage = language;
        syncButton();
        const token = ++loadToken;
        fetch(`./lang/${language}.json`, { cache: "no-cache" })
            .then(response => response.json())
            .then(translations => {
                if (token !== loadToken) return;
                currentTranslations = translations;
                applyTranslations();
                document.documentElement.lang = language;
                document.dispatchEvent(new CustomEvent('site-language-changed', { detail: { language } }));
            })
            .catch(error => console.error('Error loading language:', error));
    };

    const applyTranslations = () => {
        syncButton();
        // Handle data-i18n attributes (supports nested keys)
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = getNestedProperty(currentTranslations, key);
            if (translation) {
                element.innerHTML = translation;
            }
        });

        // Handle data-i18n-placeholder for form inputs
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = getNestedProperty(currentTranslations, key);
            if (translation) {
                element.placeholder = translation;
            }
        });

        // Handle data-i18n-title for title attributes
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const translation = getNestedProperty(currentTranslations, key);
            if (translation) {
                element.title = translation;
            }
        });

        document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
            const key = element.getAttribute('data-i18n-aria-label');
            const translation = getNestedProperty(currentTranslations, key);
            if (translation) {
                element.setAttribute('aria-label', translation);
            }
        });

        document.querySelectorAll('[data-i18n-alt]').forEach(element => {
            const key = element.getAttribute('data-i18n-alt');
            const translation = getNestedProperty(currentTranslations, key);
            if (translation) {
                element.alt = translation;
            }
        });

        // Update nav slider after translations (nav text may have changed width)
        setTimeout(() => {
            const activeLink = document.querySelector('.nav-link.active');
            if (activeLink && typeof updateSlider === 'function') {
                updateSlider(activeLink);
            }
        }, 50);
    };

    const changeLanguage = (language) => {
        if (languages[language]) {
            loadLanguage(language);
            localStorage.setItem('preferredLanguage', language);
            
            // Update dropdown button text
            const currentLangBtn = document.querySelector('.current-lang');
            if (currentLangBtn) {
                currentLangBtn.textContent = languages[language];
            }
        }
    };

    const init = () => {
        // Get saved language or default to Catalan
        const stored = localStorage.getItem('preferredLanguage');
        loadLanguage(languages[stored] ? stored : 'ca');

        // Set up language dropdown clicks
        document.addEventListener('click', (e) => {
            if (e.target.matches('[data-lang]')) {
                const lang = e.target.getAttribute('data-lang');
                changeLanguage(lang);
            }
        });
    };

    return {
        init,
        changeLanguage,
        reapply: applyTranslations,
        getText: key => getNestedProperty(currentTranslations, key),
        getCurrentLang: () => localStorage.getItem('preferredLanguage') || 'ca'
    };
})();

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', languageSwitcher.init);

// Re-apply translations when new content is loaded dynamically
if (typeof window !== 'undefined') {
    window.languageSwitcher = languageSwitcher;
}