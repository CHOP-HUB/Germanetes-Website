// Projects module — renders project grid cards and detail modal
(function () {
    'use strict';

    let projectsData = [];
    let currentLang = 'ca';

    // Get current language from the language switcher
    function getLang() {
        if (window.languageSwitcher && window.languageSwitcher.getCurrentLang) {
            return window.languageSwitcher.getCurrentLang();
        }
        return localStorage.getItem('preferredLanguage') || 'ca';
    }

    // Localized text helper — accepts a { ca, es, en } object or plain string
    function t(obj) {
        if (!obj) return '';
        if (typeof obj === 'string') return obj;
        const lang = getLang();
        return obj[lang] || obj['ca'] || obj['en'] || '';
    }

    // Convert plain text with newlines into HTML paragraphs
    function paragraphs(text) {
        if (!text) return '';
        return text
            .split(/\n\s*\n/)          // split on blank lines → paragraphs
            .map(p => p.trim())
            .filter(Boolean)
            .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    // Fetch project data from API (falls back to static JSON)
    async function fetchProjects() {
        try {
            const res = await fetch('/api/projects');
            if (!res.ok) throw new Error('API not available');
            projectsData = await res.json();
            return projectsData;
        } catch (err) {
            console.warn('API unavailable, falling back to static JSON:', err.message);
            try {
                const res = await fetch('data/projects.json');
                if (!res.ok) throw new Error('Failed to load projects');
                projectsData = await res.json();
                return projectsData;
            } catch (fallbackErr) {
                console.error('Error loading projects:', fallbackErr);
                return [];
            }
        }
    }

    // Create a project card DOM element
    function createCard(project) {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.dataset.projectId = project.id;

        const imgWrap = document.createElement('div');
        imgWrap.className = 'card-img-wrap';

        const img = document.createElement('img');
        img.src = project.thumbnail || '';
        img.alt = t(project.title);
        img.loading = 'lazy';
        imgWrap.appendChild(img);

        const info = document.createElement('div');
        info.className = 'card-info';

        const title = document.createElement('span');
        title.className = 'card-title';
        title.textContent = t(project.title);

        const desc = document.createElement('span');
        desc.className = 'card-desc';
        desc.textContent = t(project.shortDescription);

        info.appendChild(title);
        info.appendChild(desc);
        card.appendChild(imgWrap);
        card.appendChild(info);

        card.addEventListener('click', () => openModal(project));

        return card;
    }

    // Add empty filler cells to complete the last row
    function addFillerCells(grid, itemCount) {
        const style = getComputedStyle(grid);
        const cols = style.gridTemplateColumns.split(' ').length;
        const remainder = itemCount % cols;
        if (remainder === 0) return;
        const fillersNeeded = cols - remainder;
        for (let i = 0; i < fillersNeeded; i++) {
            const filler = document.createElement('div');
            filler.className = 'project-card filler';
            grid.appendChild(filler);
        }
    }

    // Render all project grids on the page
    function renderGrids() {
        const grids = document.querySelectorAll('.project-grid[data-category]');
        grids.forEach(grid => {
            const category = grid.dataset.category;
            const filtered = projectsData.filter(p => p.category === category);
            grid.innerHTML = '';

            if (filtered.length === 0) {
                const section = grid.closest('.projects-section');
                if (section) section.style.display = 'none';
                return;
            }

            const section = grid.closest('.projects-section');
            if (section) section.style.display = '';

            filtered.forEach(project => {
                grid.appendChild(createCard(project));
            });

            addFillerCells(grid, filtered.length);
        });
    }

    // Re-render all card texts (called on language change)
    function updateCardTexts() {
        document.querySelectorAll('.project-card').forEach(card => {
            const id = card.dataset.projectId;
            const project = projectsData.find(p => p.id === id);
            if (!project) return;

            const titleEl = card.querySelector('.card-title');
            const descEl = card.querySelector('.card-desc');
            const imgEl = card.querySelector('img');

            if (titleEl) titleEl.textContent = t(project.title);
            if (descEl) descEl.textContent = t(project.shortDescription);
            if (imgEl) imgEl.alt = t(project.title);
        });
    }

    // ── Modal ──────────────────────────────────────────────

    function getOrCreateModal() {
        let modal = document.getElementById('project-modal');
        if (modal) return modal;

        // Create modal structure
        modal = document.createElement('div');
        modal.id = 'project-modal';
        modal.className = 'project-modal hidden';

        modal.innerHTML = `
            <div class="project-modal-backdrop"></div>
            <div class="project-modal-content">
                <button class="modal-close" aria-label="Close">&times;</button>
                <div class="modal-body"></div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        modal.querySelector('.project-modal-backdrop').addEventListener('click', closeModal);
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });

        return modal;
    }

    function openModal(project) {
        const modal = getOrCreateModal();
        const body = modal.querySelector('.modal-body');

        // Build modal content
        let html = '';

        // Title
        html += `<h2 class="modal-project-title">${t(project.title)}</h2>`;

        // Thumbnail at top
        if (project.thumbnail) {
            html += `<img class="modal-hero-img" src="${project.thumbnail}" alt="${t(project.title)}">`;
        }

        // Description
        if (project.detail && project.detail.description) {
            html += `<div class="modal-description">${paragraphs(t(project.detail.description))}</div>`;
        }

        // Gallery images
        if (project.detail && project.detail.images && project.detail.images.length > 0) {
            html += '<div class="modal-gallery">';
            project.detail.images.forEach(img => {
                const src = typeof img === 'string' ? img : img.src;
                const caption = typeof img === 'string' ? '' : t(img.caption);
                html += `<figure class="modal-gallery-item">`;
                html += `<img src="${src}" alt="${caption}" loading="lazy">`;
                if (caption) html += `<figcaption>${caption}</figcaption>`;
                html += `</figure>`;
            });
            html += '</div>';
        }

        body.innerHTML = html;

        // Show
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.add('visible');
        });
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        const modal = document.getElementById('project-modal');
        if (!modal) return;

        modal.classList.remove('visible');
        // Wait for transition to finish before hiding
        setTimeout(() => {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }, 300);
    }

    // ── Public API ─────────────────────────────────────────

    async function init() {
        await fetchProjects();
        renderGrids();
    }

    // Expose for use by main.js
    window.projectsModule = {
        init,
        updateCardTexts,
        renderGrids
    };
})();
