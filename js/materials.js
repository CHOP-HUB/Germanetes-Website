// Materials page: a Finder-style list view of the folders and files stored on the site.
(function () {
    'use strict';

    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const API_ORIGIN = isLiveServer ? 'http://localhost:3000' : location.origin;
    const locales = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB' };
    const fallbackKinds = { folder: 'Carpeta', pdf: 'Document PDF', image: 'Imatge', document: 'Document', spreadsheet: 'Full de càlcul', presentation: 'Presentació', text: 'Text', archive: 'Arxiu ZIP', file: 'Fitxer' };
    const kindByExtension = {
        pdf: 'pdf', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
        doc: 'document', docx: 'document', odt: 'document',
        xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet',
        ppt: 'presentation', pptx: 'presentation', odp: 'presentation',
        txt: 'text', csv: 'text', zip: 'archive'
    };
    let nodes = [];
    const expanded = new Set();

    function language() {
        return window.languageSwitcher?.getCurrentLang?.() || localStorage.getItem('preferredLanguage') || 'ca';
    }

    function text(key, fallback) {
        return window.languageSwitcher?.getText?.(`materials.${key}`) || fallback;
    }

    function nameOf(node) {
        return node.name[language()] || node.name.ca || node.name.es || node.name.en || '';
    }

    function kindOf(node) {
        const key = node.type === 'folder' ? 'folder' : (kindByExtension[node.ext] || 'file');
        return text(`kinds.${key}`, fallbackKinds[key]);
    }

    function formatDate(value) {
        const date = new Date(`${value.replace(' ', 'T')}Z`);
        return new Intl.DateTimeFormat(locales[language()] || locales.ca, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    }

    function formatSize(bytes) {
        const number = new Intl.NumberFormat(locales[language()] || locales.ca, { maximumFractionDigits: 1 });
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
        return `${number.format(bytes / 1024 / 1024)} MB`;
    }

    function fileUrl(node) {
        return `${API_ORIGIN}${node.src}`;
    }

    function childrenOf(parentId) {
        const collator = new Intl.Collator(locales[language()] || locales.ca, { numeric: true, sensitivity: 'base' });
        return nodes
            .filter(node => node.parentId === parentId)
            .sort((a, b) => (a.type === b.type ? collator.compare(nameOf(a), nameOf(b)) : a.type === 'folder' ? -1 : 1));
    }

    function createCell(className, content) {
        const cell = document.createElement('span');
        cell.className = className;
        cell.textContent = content;
        return cell;
    }

    function createRow(node, depth, stripe) {
        const isFolder = node.type === 'folder';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `finder-row ${isFolder ? 'is-folder' : 'is-file'}${stripe ? ' is-striped' : ''}`;
        row.style.setProperty('--depth', depth);

        const name = document.createElement('span');
        name.className = 'finder-name';
        const disclosure = document.createElement('span');
        disclosure.className = 'finder-disclosure';
        disclosure.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('span');
        icon.className = 'finder-icon';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'finder-label';
        label.textContent = nameOf(node);
        name.append(disclosure, icon, label);

        row.append(
            name,
            createCell('finder-date', formatDate(node.updatedAt)),
            createCell('finder-size', isFolder ? '—' : formatSize(node.size)),
            createCell('finder-kind', kindOf(node))
        );

        if (isFolder) {
            const open = expanded.has(node.id);
            row.classList.toggle('is-open', open);
            row.setAttribute('aria-expanded', String(open));
            row.addEventListener('click', () => {
                if (expanded.has(node.id)) expanded.delete(node.id); else expanded.add(node.id);
                render();
                document.querySelector(`.finder-row[data-id="${node.id}"]`)?.focus();
            });
        } else {
            row.addEventListener('click', () => openFile(node));
        }
        row.dataset.id = node.id;
        return row;
    }

    function render() {
        const body = document.getElementById('finder-body');
        if (!body) return;
        body.replaceChildren();

        if (!nodes.length) {
            const empty = document.createElement('p');
            empty.className = 'finder-empty';
            empty.textContent = text('empty', 'Encara no hi ha cap material.');
            body.appendChild(empty);
            return;
        }

        let rowIndex = 0;
        const addLevel = (parentId, depth) => {
            for (const node of childrenOf(parentId)) {
                body.appendChild(createRow(node, depth, rowIndex++ % 2 === 1));
                if (node.type === 'folder' && expanded.has(node.id)) {
                    if (nodes.some(child => child.parentId === node.id)) {
                        addLevel(node.id, depth + 1);
                    } else {
                        const empty = document.createElement('div');
                        empty.className = 'finder-row finder-note';
                        empty.style.setProperty('--depth', depth + 1);
                        empty.append(createCell('finder-name', text('emptyFolder', 'Carpeta buida')));
                        body.appendChild(empty);
                    }
                }
            }
        };
        addLevel(null, 0);
    }

    function downloadName(node) {
        return `${nameOf(node).replace(/[\\/:*?"<>|]/g, '-')}.${node.ext}`;
    }

    function getDialog() {
        let dialog = document.getElementById('materials-dialog');
        if (dialog) return dialog;

        dialog = document.createElement('dialog');
        dialog.id = 'materials-dialog';
        dialog.className = 'materials-dialog';
        dialog.innerHTML = `
            <div class="materials-dialog-bar">
                <span class="materials-dialog-title"></span>
                <a class="materials-dialog-download"></a>
                <button type="button" class="materials-dialog-close">&times;</button>
            </div>
            <div class="materials-dialog-body"></div>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', event => {
            if (event.target === dialog || event.target.closest('.materials-dialog-close')) dialog.close();
        });
        // Stop a playing/loaded preview once the dialog closes.
        dialog.addEventListener('close', () => dialog.querySelector('.materials-dialog-body').replaceChildren());
        return dialog;
    }

    function openFile(node) {
        const isPreviewable = node.ext === 'pdf' || kindByExtension[node.ext] === 'image';
        if (!isPreviewable) {
            const link = document.createElement('a');
            link.href = fileUrl(node);
            link.download = downloadName(node);
            document.body.appendChild(link);
            link.click();
            link.remove();
            return;
        }

        const dialog = getDialog();
        dialog.querySelector('.materials-dialog-title').textContent = nameOf(node);
        const download = dialog.querySelector('.materials-dialog-download');
        download.href = fileUrl(node);
        download.download = downloadName(node);
        download.textContent = text('download', 'Descarrega');
        dialog.querySelector('.materials-dialog-close').setAttribute('aria-label', text('close', 'Tanca la vista prèvia'));

        const body = dialog.querySelector('.materials-dialog-body');
        const viewer = document.createElement(node.ext === 'pdf' ? 'iframe' : 'img');
        viewer.src = fileUrl(node);
        viewer.title = viewer.alt = nameOf(node);
        body.replaceChildren(viewer);
        dialog.showModal();
    }

    async function init() {
        try {
            const response = await fetch(`${API_ORIGIN}/api/materials`);
            if (!response.ok) throw new Error(`Materials API returned ${response.status}`);
            nodes = await response.json();
        } catch (error) {
            console.error('Unable to load the materials:', error);
            nodes = [];
        }
        render();
    }

    // Registered once so names, dates and kinds follow the language selector.
    document.addEventListener('site-language-changed', render);

    window.materialsModule = { init };
})();
