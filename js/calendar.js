// Monthly bulletin: the uploaded bulletin page with month navigation
(function () {
    'use strict';

    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const API_ORIGIN = isLiveServer ? 'http://localhost:3000' : location.origin;
    const locales = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB' };
    let displayedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let bulletins = {};
    let bulletinsLoaded = false;

    function language() {
        return window.languageSwitcher?.getCurrentLang?.() || localStorage.getItem('preferredLanguage') || 'ca';
    }

    function translation(key, fallback) {
        return window.languageSwitcher?.getText?.(`calendar.${key}`) || fallback;
    }

    function monthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    async function loadBulletins() {
        try {
            const response = await fetch(`${API_ORIGIN}/api/bulletins`);
            if (!response.ok) throw new Error(`Bulletins API returned ${response.status}`);
            bulletins = await response.json();
        } catch (error) {
            console.warn('Unable to load bulletins:', error);
            bulletins = {};
        }
        bulletinsLoaded = true;
    }

    function renderBulletin() {
        const image = document.getElementById('bulletin-image');
        const empty = document.getElementById('bulletin-empty');
        if (!image || !empty) return;
        // Show nothing until the bulletins have loaded, so no wrong image or message flashes.
        const src = bulletinsLoaded ? bulletins[monthKey(displayedMonth)] : '';
        image.hidden = !src;
        empty.hidden = !bulletinsLoaded || Boolean(src);
        if (src) {
            image.src = new URL(src, API_ORIGIN).href;
            image.alt = document.getElementById('calendar-month-title').textContent;
        } else {
            image.removeAttribute('src');
        }
    }

    // The newest month that has a bulletin; before the first upload it is the current month.
    function latestMonthStart() {
        const keys = Object.keys(bulletins).sort();
        if (!keys.length) {
            const now = new Date();
            return new Date(now.getFullYear(), now.getMonth(), 1);
        }
        const [year, month] = keys[keys.length - 1].split('-').map(Number);
        return new Date(year, month - 1, 1);
    }

    function render() {
        const locale = locales[language()] || locales.ca;
        const title = document.getElementById('calendar-month-title');
        const formatted = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(displayedMonth);
        title.textContent = formatted.charAt(0).toLocaleUpperCase(locale) + formatted.slice(1);
        document.getElementById('calendar-previous').setAttribute('aria-label', translation('previous', 'Previous month'));
        document.getElementById('calendar-next').setAttribute('aria-label', translation('next', 'Next month'));
        // There is nothing newer than the latest bulletin, so the next arrow disappears there.
        document.getElementById('calendar-next').style.visibility = displayedMonth >= latestMonthStart() ? 'hidden' : 'visible';
        renderBulletin();
    }

    function init() {
        const section = document.querySelector('.events-calendar');
        if (!section) return;

        document.getElementById('calendar-previous').addEventListener('click', () => {
            displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1);
            render();
        });
        document.getElementById('calendar-next').addEventListener('click', () => {
            if (displayedMonth >= latestMonthStart()) return;
            displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1);
            render();
        });
        document.getElementById('calendar-today').addEventListener('click', () => {
            displayedMonth = latestMonthStart();
            render();
        });
        document.removeEventListener('site-language-changed', render);
        document.addEventListener('site-language-changed', render);
        render();
        loadBulletins().then(() => {
            displayedMonth = latestMonthStart();
            render();
        });
    }

    window.calendarModule = { init };
})();
