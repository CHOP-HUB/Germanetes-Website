// Gallery page: renders the photo grid and the enlarged view.
(function () {
    'use strict';

    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const API_ORIGIN = isLiveServer ? 'http://localhost:3000' : location.origin;
    let items = [];

    function language() {
        return window.languageSwitcher?.getCurrentLang?.() || localStorage.getItem('preferredLanguage') || 'ca';
    }

    function captionOf(item) {
        const caption = item.caption || {};
        return caption[language()] || caption.ca || caption.es || caption.en || '';
    }

    function assetUrl(path) {
        return path && path.startsWith('/uploads/') ? `${API_ORIGIN}${path}` : path;
    }

    function getDialog() {
        let dialog = document.getElementById('gallery-dialog');
        if (dialog) return dialog;

        dialog = document.createElement('dialog');
        dialog.id = 'gallery-dialog';
        dialog.className = 'gallery-dialog';
        dialog.innerHTML = `
            <button type="button" class="gallery-dialog-close">&times;</button>
            <figure>
                <img alt="">
                <figcaption></figcaption>
            </figure>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', event => {
            if (event.target === dialog || event.target.closest('.gallery-dialog-close')) dialog.close();
        });
        return dialog;
    }

    function openPhoto(item) {
        const dialog = getDialog();
        const caption = captionOf(item);
        const image = dialog.querySelector('img');
        image.src = assetUrl(item.src);
        image.alt = caption;
        dialog.querySelector('figcaption').textContent = caption;
        dialog.querySelector('figcaption').hidden = !caption;
        dialog.querySelector('.gallery-dialog-close').setAttribute(
            'aria-label', window.languageSwitcher?.getText?.('gallery.close') || 'Tanca la foto'
        );
        dialog.showModal();
    }

    function render() {
        const grid = document.getElementById('gallery-grid');
        if (!grid) return;
        grid.replaceChildren();
        document.getElementById('gallery-empty').hidden = items.length > 0;

        items.forEach(item => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = `gallery-tile size-${item.size}`;
            const image = document.createElement('img');
            image.src = assetUrl(item.src);
            image.alt = captionOf(item);
            image.loading = 'lazy';
            tile.appendChild(image);
            tile.addEventListener('click', () => openPhoto(item));
            grid.appendChild(tile);
        });
    }

    async function init() {
        try {
            const response = await fetch(`${API_ORIGIN}/api/gallery`);
            if (!response.ok) throw new Error(`Gallery API returned ${response.status}`);
            items = await response.json();
        } catch (error) {
            console.error('Unable to load the gallery:', error);
            items = [];
        }
        render();
    }

    // Registered once so captions follow the language selector.
    document.addEventListener('site-language-changed', render);

    window.galleryModule = { init };
})();
