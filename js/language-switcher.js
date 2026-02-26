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

    const loadLanguage = (language) => {
        fetch(`./lang/${language}.json`)
            .then(response => response.json())
            .then(translations => {
                currentTranslations = translations;
                applyTranslations();
                document.documentElement.lang = language;
            })
            .catch(error => console.error('Error loading language:', error));
    };

    const applyTranslations = () => {
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
        const savedLanguage = localStorage.getItem('preferredLanguage') || 'ca';
        loadLanguage(savedLanguage);

        // Update button text
        const currentLangBtn = document.querySelector('.current-lang');
        if (currentLangBtn) {
            currentLangBtn.textContent = languages[savedLanguage];
        }

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
        getCurrentLang: () => localStorage.getItem('preferredLanguage') || 'ca'
    };
})();

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', languageSwitcher.init);

// Re-apply translations when new content is loaded dynamically
if (typeof window !== 'undefined') {
    window.languageSwitcher = languageSwitcher;
}