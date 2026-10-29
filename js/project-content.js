// Sanitized project description formatting shared by the admin and public site.
(function () {
    'use strict';

    const allowedTags = new Set([
        'A', 'BR', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I',
        'BLOCKQUOTE', 'H3', 'H4', 'DIV', 'IMG'
    ]);
    const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH']);
    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const assetOrigin = isLiveServer ? 'http://localhost:3000' : location.origin;

    function safeLink(value) {
        try {
            const url = new URL(value, location.origin);
            return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url : null;
        } catch {
            return null;
        }
    }

    function safeImage(value) {
        try {
            const url = new URL(value, assetOrigin);
            if (url.origin !== new URL(assetOrigin).origin) return null;
            if (!url.pathname.startsWith('/uploads/') && !url.pathname.startsWith('/assets/images/')) return null;
            return url;
        } catch {
            return null;
        }
    }

    function sanitize(html) {
        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        const output = document.createElement('div');

        function copySafeNodes(source, destination) {
            source.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    destination.appendChild(document.createTextNode(node.textContent));
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE || blockedTags.has(node.tagName)) return;
                if (!allowedTags.has(node.tagName)) {
                    copySafeNodes(node, destination);
                    return;
                }

                const safeElement = document.createElement(node.tagName.toLowerCase());
                if (node.tagName === 'A') {
                    const rawHref = node.getAttribute('href') || '';
                    const href = safeLink(rawHref);
                    if (href) {
                        safeElement.setAttribute('href', /^[a-z][a-z\d+.-]*:/i.test(rawHref) ? href.href : rawHref);
                        if (node.getAttribute('target') === '_blank') {
                            safeElement.target = '_blank';
                            safeElement.rel = 'noopener noreferrer';
                        }
                    }
                }
                if (node.tagName === 'IMG') {
                    const src = safeImage(node.getAttribute('src') || '');
                    if (!src) return;
                    safeElement.src = src.href;
                    safeElement.alt = node.getAttribute('alt') || '';
                }
                if (node.tagName === 'DIV' && node.classList.contains('project-content-split')) {
                    safeElement.className = 'project-content-split';
                }
                copySafeNodes(node, safeElement);
                destination.appendChild(safeElement);
            });
        }

        copySafeNodes(template.content, output);
        return output.innerHTML;
    }

    function toHtml(value) {
        const text = String(value || '').trim();
        if (!text) return '';

        if (/<(?:p|ul|ol|li|div|blockquote|h[34]|img)\b/i.test(text)) {
            return sanitize(text);
        }

        return text
            .split(/\n\s*\n/)
            .map(paragraph => paragraph.trim())
            .filter(Boolean)
            .map(paragraph => `<p>${sanitize(paragraph.replace(/\n/g, '<br>'))}</p>`)
            .join('');
    }

    function toStoredHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = sanitize(html);
        template.content.querySelectorAll('img[src]').forEach(image => {
            const url = safeImage(image.getAttribute('src'));
            if (url) image.setAttribute('src', `${url.pathname}${url.search}${url.hash}`);
            else image.remove();
        });
        return template.innerHTML;
    }

    function imagePath(value) {
        return safeImage(value)?.pathname || '';
    }

    function referencedImages(html) {
        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        return new Set([...template.content.querySelectorAll('img[src]')]
            .map(image => imagePath(image.getAttribute('src')))
            .filter(Boolean));
    }

    window.projectContent = {
        sanitize,
        toHtml,
        toStoredHtml,
        safeLink,
        imagePath,
        referencedImages
    };
})();
