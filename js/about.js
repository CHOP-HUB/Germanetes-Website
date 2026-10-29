// About (landing) page module — renders the project list from the CMS API
(function () {
    'use strict';

    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const API_ORIGIN = isLiveServer ? 'http://localhost:3000' : location.origin;
    const LISTED_CATEGORIES = ['permanent', 'temporal'];

    let projects = [];

    function getLang() {
        if (window.languageSwitcher && window.languageSwitcher.getCurrentLang) {
            return window.languageSwitcher.getCurrentLang();
        }
        return localStorage.getItem('preferredLanguage') || 'ca';
    }

    function t(obj) {
        if (!obj) return '';
        if (typeof obj === 'string') return obj;
        return obj[getLang()] || obj.ca || obj.en || '';
    }

    function render() {
        const list = document.getElementById('about-project-list');
        if (!list) return;

        list.replaceChildren(...projects.map(project => {
            const item = document.createElement('li');

            const link = document.createElement('a');
            link.href = `#projects/${encodeURIComponent(project.id)}`;
            link.textContent = t(project.title);
            item.appendChild(link);

            const description = t(project.shortDescription);
            if (description) {
                const text = document.createElement('span');
                text.className = 'about-project-desc';
                text.textContent = description;
                item.appendChild(text);
            }
            return item;
        }));
    }

    async function init() {
        try {
            const res = await fetch(`${API_ORIGIN}/api/projects`);
            if (!res.ok) throw new Error(`API returned ${res.status}`);
            const all = await res.json();
            projects = all.filter(project => LISTED_CATEGORIES.includes(project.category));
        } catch (err) {
            console.error('Error loading projects for the about page:', err);
            projects = [];
        }
        render();
    }

    document.addEventListener('site-language-changed', render);

    window.aboutModule = { init };
})();
