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

    // Returns the 11-character video id of a YouTube watch, share, shorts or embed link.
    function youtubeId(value) {
        const text = String(value || '').trim();
        if (/^[\w-]{11}$/.test(text)) return text;
        try {
            const url = new URL(text);
            const host = url.hostname.replace(/^(www|m)\./, '');
            let id = '';
            if (host === 'youtu.be') id = url.pathname.slice(1);
            else if (['youtube.com', 'youtube-nocookie.com'].includes(host)) {
                const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
                id = match ? match[1] : url.searchParams.get('v') || '';
            }
            return /^[\w-]{11}$/.test(id) ? id : null;
        } catch {
            return null;
        }
    }

    function videoElement(id) {
        const wrapper = document.createElement('div');
        wrapper.className = 'project-video';
        wrapper.dataset.youtube = id;
        wrapper.contentEditable = 'false';
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube-nocookie.com/embed/${id}`;
        frame.title = 'YouTube';
        frame.loading = 'lazy';
        frame.allow = 'accelerometer; encrypted-media; picture-in-picture; fullscreen';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.allowFullscreen = true;
        wrapper.appendChild(frame);
        return wrapper;
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
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node.tagName === 'DIV' && node.classList.contains('project-video')) {
                    const id = youtubeId(node.dataset.youtube);
                    if (id) destination.appendChild(videoElement(id));
                    return;
                }
                if (blockedTags.has(node.tagName)) return;
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
        youtubeId,
        imagePath,
        referencedImages
    };
})();
