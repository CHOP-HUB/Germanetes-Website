// Monthly bulletin: Google Calendar month view plus the uploaded bulletin page
(function () {
    'use strict';

    const isLiveServer = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5500';
    const API_ORIGIN = isLiveServer ? 'http://localhost:3000' : location.origin;
    const locales = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB' };
    const palette = ['#78bd72', '#ff9d3c', '#efc94c', '#ca83d7', '#65afd0', '#e27e72'];
    let displayedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let currentEvents = [];
    let maskImage = null;
    let bulletins = {};

    function language() {
        return window.languageSwitcher?.getCurrentLang?.() || localStorage.getItem('preferredLanguage') || 'ca';
    }

    function translation(key, fallback) {
        return window.languageSwitcher?.getText?.(`calendar.${key}`) || fallback;
    }

    function dateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function monthRange(month) {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const offset = (first.getDay() + 6) % 7;
        const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - offset);
        const days = Math.ceil((offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7;
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
        return { start, end, days };
    }

    function eventColor(category) {
        const key = category || 'activities';
        let hash = 0;
        for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0;
        return palette[(hash >>> 0) % palette.length];
    }

    function formatDay(date) {
        return new Intl.DateTimeFormat(locales[language()] || locales.ca, {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        }).format(date);
    }

    function formatTime(event) {
        if (event.allDay) return translation('allDay', 'All day');
        const start = new Date(event.start);
        const end = new Date(event.end);
        const timeZone = event.timeZone || 'Europe/Madrid';
        const formatter = new Intl.DateTimeFormat(locales[language()] || locales.ca, {
            hour: '2-digit', minute: '2-digit', timeZone
        });
        return `${formatter.format(start)}–${formatter.format(end)}`;
    }

    function addCalendarDays(date, days) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    }

    async function loadEvents(range) {
        const query = new URLSearchParams({ start: dateKey(range.start), end: dateKey(range.end) });
        const response = await fetch(`${API_ORIGIN}/api/calendar/events?${query}`);
        if (!response.ok) throw new Error(`Calendar API returned ${response.status}`);
        return response.json();
    }

    async function loadMaskImage() {
        try {
            const response = await fetch(`${API_ORIGIN}/api/projects`);
            if (!response.ok) throw new Error(`Projects API returned ${response.status}`);
            const projects = await response.json();
            const imagePaths = [...new Set(projects.flatMap(project => [
                project.thumbnail,
                ...(project.detail?.images || []).map(image => typeof image === 'string' ? image : image.src)
            ]).filter(Boolean))];
            const imageUrls = imagePaths.map(path => {
                const url = new URL(path, API_ORIGIN);
                if (url.origin !== new URL(API_ORIGIN).origin) return null;
                if (!url.pathname.startsWith('/uploads/') && !url.pathname.startsWith('/assets/images/')) return null;
                return url.href;
            }).filter(Boolean);
            if (!imageUrls.length) return;

            let previousImage = '';
            try {
                previousImage = sessionStorage.getItem('calendar-background-image') || '';
            } catch {}
            const choices = imageUrls.filter(url => url !== previousImage);
            const selectedImage = (choices.length ? choices : imageUrls)[Math.floor(Math.random() * (choices.length || imageUrls.length))];

            const image = new Image();
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
                image.src = selectedImage;
            });

            if (!document.body.classList.contains('calendar-page')) return;
            maskImage = { url: selectedImage, width: image.naturalWidth, height: image.naturalHeight };
            alignMask();
            try {
                sessionStorage.setItem('calendar-background-image', selectedImage);
            } catch {}
        } catch (error) {
            console.warn('Unable to load the calendar mask image:', error);
        }
    }

    function monthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    // Scale the photo to cover the whole board, then offset it per cell so the squares reveal one continuous picture.
    function alignMask() {
        const board = document.getElementById('calendar-board');
        if (!board || !maskImage) return;
        const { offsetWidth: width, offsetHeight: height } = board;
        if (!width || !height) return;
        const scale = Math.max(width / maskImage.width, height / maskImage.height);
        const scaledWidth = maskImage.width * scale;
        const scaledHeight = maskImage.height * scale;
        const shiftX = (width - scaledWidth) / 2;
        const shiftY = (height - scaledHeight) / 2;
        board.querySelectorAll('.calendar-day').forEach(cell => {
            cell.style.backgroundImage = `url(${JSON.stringify(maskImage.url)})`;
            cell.style.backgroundSize = `${scaledWidth}px ${scaledHeight}px`;
            cell.style.backgroundPosition = `${shiftX - cell.offsetLeft}px ${shiftY - cell.offsetTop}px`;
        });
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
    }

    function renderBulletin() {
        const image = document.getElementById('bulletin-image');
        const empty = document.getElementById('bulletin-empty');
        if (!image || !empty) return;
        // Until the first bulletin is uploaded, show the bundled example.
        const src = bulletins[monthKey(displayedMonth)] || (Object.keys(bulletins).length ? '' : 'assets/images/butlleti-example.png');
        image.hidden = !src;
        empty.hidden = Boolean(src);
        if (src) {
            image.src = new URL(src, API_ORIGIN).href;
            image.alt = document.getElementById('calendar-month-title').textContent;
        } else {
            image.removeAttribute('src');
        }
    }

    function renderLegend(events) {
        const legend = document.getElementById('calendar-legend');
        const categories = [...new Set(events.map(event => event.category).filter(Boolean))];
        legend.replaceChildren();
        categories.slice(0, 6).forEach(category => {
            const item = document.createElement('span');
            item.className = 'calendar-legend-item';
            item.style.setProperty('--event-color', eventColor(category));
            item.textContent = category;
            legend.appendChild(item);
        });
    }

    function showEvent(event) {
        const detail = document.getElementById('calendar-event-detail');
        document.getElementById('calendar-detail-date').textContent = formatDay(new Date(event.start));
        document.getElementById('calendar-detail-title').textContent = event.title || translation('untitled', 'Untitled event');
        document.getElementById('calendar-detail-time').textContent = formatTime(event);
        document.getElementById('calendar-detail-location').textContent = event.location || '';
        document.getElementById('calendar-detail-location').hidden = !event.location;
        document.getElementById('calendar-detail-description').textContent = event.description || '';
        detail.hidden = false;
        detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function renderBoard(range, payload) {
        const board = document.getElementById('calendar-board');
        const monthTitle = document.getElementById('calendar-month-title');
        const status = document.getElementById('calendar-status');
        const locale = locales[language()] || locales.ca;

        monthTitle.textContent = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(displayedMonth);
        monthTitle.textContent = monthTitle.textContent.charAt(0).toLocaleUpperCase(locale) + monthTitle.textContent.slice(1);
        document.getElementById('calendar-previous').setAttribute('aria-label', translation('previous', 'Previous month'));
        document.getElementById('calendar-next').setAttribute('aria-label', translation('next', 'Next month'));
        board.replaceChildren();

        const weekdayStart = new Date(Date.UTC(2024, 0, 1));
        for (let index = 0; index < 7; index++) {
            const weekday = document.createElement('div');
            weekday.className = 'calendar-weekday';
            weekday.setAttribute('role', 'columnheader');
            weekday.textContent = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
                .format(new Date(weekdayStart.getTime() + index * 86400000));
            board.appendChild(weekday);
        }

        const eventsByDate = new Map();
        currentEvents = payload.events || [];
        currentEvents.forEach((event, index) => {
            if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
            eventsByDate.get(event.date).push({ ...event, index });
        });

        for (let index = 0; index < range.days; index++) {
            const date = addCalendarDays(range.start, index);
            const key = dateKey(date);
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            cell.setAttribute('role', 'gridcell');
            cell.setAttribute('aria-label', formatDay(date));
            if (date.getMonth() !== displayedMonth.getMonth()) cell.classList.add('outside-month');
            if (key === dateKey(new Date())) cell.classList.add('is-today');

            const number = document.createElement('span');
            number.className = 'calendar-day-number';
            number.textContent = String(date.getDate());
            cell.appendChild(number);

            (eventsByDate.get(key) || []).forEach(event => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'calendar-event';
                button.dataset.eventIndex = String(event.index);
                button.style.setProperty('--event-color', eventColor(event.category));
                button.title = `${event.title || translation('untitled', 'Untitled event')} · ${formatTime(event)}`;
                button.textContent = event.title || translation('untitled', 'Untitled event');
                cell.appendChild(button);
            });
            board.appendChild(cell);
        }

        renderLegend(currentEvents);
        renderBulletin();
        alignMask();
        if (payload.configured === false) {
            status.textContent = translation('notConfigured', 'The calendar feed has not been connected yet.');
        } else if (payload.stale) {
            status.textContent = translation('stale', 'Showing the last saved calendar update.');
        } else if (!currentEvents.length) {
            status.textContent = translation('noEvents', 'No events this month.');
        } else {
            status.textContent = '';
        }
    }

    async function render() {
        const range = monthRange(displayedMonth);
        const status = document.getElementById('calendar-status');
        status.textContent = translation('loading', 'Loading calendar…');
        document.getElementById('calendar-event-detail').hidden = true;
        try {
            const payload = await loadEvents(range);
            renderBoard(range, payload);
        } catch (error) {
            console.error('Unable to load Google Calendar events:', error);
            currentEvents = [];
            renderBoard(range, { events: [] });
            status.textContent = translation('error', 'Unable to load calendar events.');
        }
    }

    function init() {
        const section = document.querySelector('.events-calendar');
        if (!section) return;

        document.getElementById('calendar-previous').addEventListener('click', () => {
            displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1);
            render();
        });
        document.getElementById('calendar-next').addEventListener('click', () => {
            displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1);
            render();
        });
        document.getElementById('calendar-today').addEventListener('click', () => {
            const now = new Date();
            displayedMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            render();
        });
        document.getElementById('calendar-detail-close').addEventListener('click', () => {
            document.getElementById('calendar-event-detail').hidden = true;
        });
        document.getElementById('calendar-board').addEventListener('click', event => {
            const button = event.target.closest('[data-event-index]');
            if (!button) return;
            const selected = currentEvents[Number(button.dataset.eventIndex)];
            if (selected) showEvent(selected);
        });

        document.removeEventListener('site-language-changed', render);
        document.addEventListener('site-language-changed', render);
        if ('ResizeObserver' in window) new ResizeObserver(alignMask).observe(document.getElementById('calendar-board'));
        loadMaskImage();
        loadBulletins().then(renderBulletin);
        render();
    }

    window.calendarModule = { init };
})();
