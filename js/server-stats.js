// Footer "Servidor solar" figures: uptime and power from the server, page size measured in this browser.
(function () {
    'use strict';

    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const API_ORIGIN = isLiveServer ? 'http://localhost:3000' : location.origin;
    const REFRESH_MS = 60 * 1000;
    const locales = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB' };
    let stats = null;
    let sizeTimer = null;

    function locale() {
        return locales[localStorage.getItem('preferredLanguage')] || locales.ca;
    }

    function setText(id, text) {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    }

    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days) return `${days} d ${hours} h`;
        return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
    }

    function formatSize(bytes) {
        const megabytes = bytes / (1024 * 1024);
        const number = new Intl.NumberFormat(locale(), { maximumFractionDigits: megabytes < 10 ? 1 : 0 });
        return megabytes >= 0.1 ? `${number.format(megabytes)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
    }

    // Everything the browser downloaded for the current page; body sizes as sent over the wire, so a warm cache doesn't hide the real weight.
    function updatePageSize() {
        const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')];
        const bytes = entries.reduce((sum, entry) => sum + (entry.encodedBodySize || entry.transferSize || 0), 0);
        if (bytes) setText('stats-page-size', formatSize(bytes));
    }

    function schedulePageSize() {
        clearTimeout(sizeTimer);
        sizeTimer = setTimeout(updatePageSize, 400);
    }

    function renderServerStats() {
        if (!stats) return;
        if (Number.isFinite(stats.uptimeSeconds)) setText('stats-uptime', formatUptime(stats.uptimeSeconds));

        const sourceRow = document.getElementById('stats-source-row');
        if (sourceRow) {
            const label = stats.source && window.languageSwitcher?.getText?.(`footer.stats.source_${stats.source}`);
            sourceRow.hidden = !label;
            if (label) {
                setText('stats-source', label);
                sourceRow.querySelector('.stats-dot').dataset.source = stats.source;
            }
        }

        const powerRow = document.getElementById('stats-power-row');
        if (powerRow) {
            powerRow.hidden = !Number.isFinite(stats.powerWatts);
            if (!powerRow.hidden) setText('stats-power', `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(stats.powerWatts)} W`);
        }
    }

    async function refresh() {
        try {
            const response = await fetch(`${API_ORIGIN}/api/server-stats`);
            if (!response.ok) throw new Error(`Stats API returned ${response.status}`);
            stats = await response.json();
            renderServerStats();
        } catch (error) {
            console.warn('Unable to load server stats:', error);
        }
    }

    function init() {
        refresh();
        updatePageSize();
        if ('PerformanceObserver' in window) {
            new PerformanceObserver(schedulePageSize).observe({ type: 'resource', buffered: false });
        }
        setInterval(refresh, REFRESH_MS);
        document.addEventListener('site-language-changed', () => { renderServerStats(); updatePageSize(); });
    }

    window.serverStats = { init };
})();
