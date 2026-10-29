// Helpers shared by the gallery and materials admin pages.
(function () {
    'use strict';

    // Previewing through Live Server talks to Express directly.
    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const API_ORIGIN = isLiveServer ? 'http://localhost:3000' : location.origin;

    function apiFetch(path, options = {}) {
        return fetch(`${API_ORIGIN}/api${path}`, { ...options, credentials: 'include' });
    }

    async function apiJson(path, options) {
        const response = await apiFetch(path, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
        return data;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function assetUrl(path) {
        return path && path.startsWith('/') ? `${API_ORIGIN}${path}` : (path || '');
    }

    function toast(message, isError) {
        const element = document.getElementById('toast');
        element.textContent = message;
        element.classList.toggle('error', Boolean(isError));
        element.classList.add('show');
        clearTimeout(element._timer);
        element._timer = setTimeout(() => element.classList.remove('show'), 3500);
    }

    function formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    window.adminTools = { apiFetch, apiJson, escapeHtml, assetUrl, toast, formatSize };
})();
