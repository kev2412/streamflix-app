let CONFIG = {
    server: "http://line.apexvisiontv.xyz",
    username: "f0868d829b",
    password: "3be1824d6f8e"
};

if (!CONFIG.server.startsWith('http://') && !CONFIG.server.startsWith('https://')) {
    CONFIG.server = 'http://' + CONFIG.server;
}
CONFIG.server = CONFIG.server.replace(/\/+$/, '');

let currentLevel = 'categories';
let currentTab = 0;
let rawCategories = [];
let displayedCategories = [];
let items = [];
let displayedItems = [];
let currentCategory = null;
let searchDebounce = null;
let renderLimit = 40;

let favorites = [];
try {
    favorites = JSON.parse(localStorage.getItem('streamflix_mobile_favs')) || [];
} catch(e) { favorites = []; }

function saveFavorites() {
    try { localStorage.setItem('streamflix_mobile_favs', JSON.stringify(favorites)); } catch(e) {}
}

const iosPlayer = document.getElementById('ios-player');
const gridContent = document.getElementById('grid-content');
const contentStage = document.getElementById('content-stage');
const viewName = document.getElementById('view-name');
const viewCounter = document.getElementById('view-counter');
const backBtn = document.getElementById('back-btn');
const searchInput = document.getElementById('search-input');

// Direkter Netzwerkabruf (CORS-Unterstützung)
function httpGet(directUrl) {
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', directUrl, true);
        xhr.timeout = 25000;
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); } 
                catch (e) { resolve([]); }
            } else resolve([]);
        };
        xhr.onerror = () => resolve([]);
        xhr.ontimeout = () => resolve([]);
        xhr.send();
    });
}

function onSearchInput(query) {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        const q = (query || '').trim().toLowerCase();
        if (currentLevel === 'categories') {
            displayedCategories = q ? rawCategories.filter(c => (c.category_name || '').toLowerCase().includes(q)) : [...rawCategories];
            viewCounter.innerText = displayedCategories.length + " Kategorien";
            renderCategories();
        } else {
            displayedItems = q ? items.filter(it => (it.name || it.title || '').toLowerCase().includes(q)) : [...items];
            viewCounter.innerText = displayedItems.length + " Treffer";
            renderLimit = 40;
            renderItems();
        }
    }, 150);
}

async function switchTab(tabIdx) {
    currentTab = tabIdx;
    currentLevel = 'categories';
    items = [];
    displayedItems = [];
    if (backBtn) backBtn.style.display = 'none';
    if (searchInput) searchInput.value = '';

    for (let i = 0; i < 3; i++) {
        const el = document.getElementById('tab-' + i);
        if (el) el.className = (i === currentTab) ? 'nav-tab active' : 'nav-tab';
    }

    const actions = ['get_live_categories', 'get_vod_categories', 'get_series_categories'];
    const titles = ['Live TV', 'Filme', 'Serien'];
    viewName.innerText = titles[currentTab];
    viewCounter.innerText = "Lade...";
    gridContent.innerHTML = '';

    const directUrl = CONFIG.server + "/player_api.php?username=" + encodeURIComponent(CONFIG.username) + "&password=" + encodeURIComponent(CONFIG.password) + "&action=" + actions[currentTab];
    const res = await httpGet(directUrl);
    let fetched = Array.isArray(res) ? res : [];

    if (currentTab === 0) {
        rawCategories = [
            { category_id: '__FAVORITES__', category_name: 'Favoriten (' + favorites.length + ')' },
            ...fetched
        ];
    } else if (currentTab === 1) {
        rawCategories = [
            { category_id: '__ALL_MOVIES__', category_name: 'ALLE FILME (Gesamtkatalog)' },
            ...fetched
        ];
    } else if (currentTab === 2) {
        rawCategories = [
            { category_id: '__ALL_SERIES__', category_name: 'ALLE SERIEN (Gesamtkatalog)' },
            ...fetched
        ];
    }

    displayedCategories = [...rawCategories];
    viewCounter.innerText = rawCategories.length + " Kategorien";
    renderCategories();
}

function renderCategories() {
    gridContent.innerHTML = '';
    const fragment = document.createDocumentFragment();

    displayedCategories.forEach((cat) => {
        const div = document.createElement('div');
        div.className = 'folder-card';
        const isSpecial = String(cat.category_id).startsWith('__');
        const iconHtml = isSpecial ? '<span class="folder-badge">&#9733;</span>' : '<span class="folder-badge">&#128193;</span>';
        
        div.innerHTML = iconHtml + '<div class="folder-name">' + (cat.category_name || 'Unbenannt') + '</div>';
        div.onclick = () => openCategory(cat);
        fragment.appendChild(div);
    });
    gridContent.appendChild(fragment);
}

async function openCategory(categoryObj) {
    if (!categoryObj) return;
    currentCategory = categoryObj;
    currentLevel = 'items';
    renderLimit = 40;
    if (backBtn) backBtn.style.display = 'block';
    if (searchInput) searchInput.value = '';
    viewName.innerText = currentCategory.category_name;
    gridContent.innerHTML = '';

    // 1. Favoriten
    if (currentCategory.category_id === '__FAVORITES__') {
        items = favorites;
        displayedItems = [...items];
        viewCounter.innerText = items.length + " Favoriten";
        renderItems();
        return;
    }

    // 2. Gesamtkatalog
    if (currentCategory.category_id === '__ALL_MOVIES__' || currentCategory.category_id === '__ALL_SERIES__') {
        const isMovie = (currentCategory.category_id === '__ALL_MOVIES__');
        const cacheKey = 'global_cat_' + (isMovie ? 'vod' : 'series');
        const cached = sessionStorage.getItem(cacheKey);

        if (cached) {
            items = JSON.parse(cached);
            displayedItems = [...items];
            viewCounter.innerText = items.length + " Titel";
            renderItems();
            return;
        }

        viewCounter.innerText = "Lade Katalog...";
        const actionName = isMovie ? 'get_vod_streams' : 'get_series';
        const realCategories = rawCategories.filter(c => !String(c.category_id).startsWith('__'));
        
        const batch = realCategories.slice(0, 10);
        const fetchPromises = batch.map(cat => {
            const url = CONFIG.server + "/player_api.php?username=" + encodeURIComponent(CONFIG.username) + "&password=" + encodeURIComponent(CONFIG.password) + "&action=" + actionName + "&category_id=" + encodeURIComponent(cat.category_id);
            return httpGet(url);
        });

        const results = await Promise.all(fetchPromises);
        let merged = [];
        results.forEach(res => {
            if (Array.isArray(res)) merged = merged.concat(res);
        });

        items = merged;
        try { sessionStorage.setItem(cacheKey, JSON.stringify(items)); } catch(e) {}

        displayedItems = [...items];
        viewCounter.innerText = items.length + " Titel";
        renderItems();
        return;
    }

    // 3. Einzelkategorie
    viewCounter.innerText = "Lade...";
    const actions = ['get_live_streams', 'get_vod_streams', 'get_series'];
    const directUrl = CONFIG.server + "/player_api.php?username=" + encodeURIComponent(CONFIG.username) + "&password=" + encodeURIComponent(CONFIG.password) + "&action=" + actions[currentTab] + "&category_id=" + encodeURIComponent(currentCategory.category_id);
    const res = await httpGet(directUrl);
    items = Array.isArray(res) ? res : [];
    displayedItems = [...items];
    viewCounter.innerText = items.length + " Einträge";
    renderItems();
}

function toggleFavorite(item, starEl, e) {
    e.stopPropagation();
    const favIdx = favorites.findIndex(f => f.stream_id === item.stream_id);
    if (favIdx > -1) {
        favorites.splice(favIdx, 1);
        starEl.classList.remove('is-favorite');
        starEl.innerHTML = '&#9734;';
    } else {
        favorites.push(item);
        starEl.classList.add('is-favorite');
        starEl.innerHTML = '&#9733;';
    }
    saveFavorites();
}

function renderItems() {
    gridContent.innerHTML = '';
    const isLive = (currentTab === 0);
    const slice = displayedItems.slice(0, renderLimit);
    const fragment = document.createDocumentFragment();

    slice.forEach((it) => {
        const div = document.createElement('div');
        if (isLive) {
            div.className = 'live-card';
            const isFav = favorites.some(f => f.stream_id === itemStreamId(it));
            const logo = it.stream_icon ? '<img class="live-logo" loading="lazy" src="' + it.stream_icon + '" onerror="this.style.display=\'none\'">' : '<div class="live-logo"></div>';
            
            div.innerHTML = logo + 
                '<div class="live-details"><div class="live-name">' + (it.name || '') + '</div><div class="live-sub">Tippen zum Starten</div></div>' +
                '<div class="fav-star-btn ' + (isFav ? 'is-favorite' : '') + '">' + (isFav ? '&#9733;' : '&#9734;') + '</div>';
            
            const starBtn = div.querySelector('.fav-star-btn');
            starBtn.onclick = (e) => toggleFavorite(it, starBtn, e);
        } else {
            div.className = 'media-card';
            const poster = it.stream_icon || it.cover || '';
            const posterImg = poster ? '<img class="media-poster" loading="lazy" src="' + poster + '" onerror="this.style.display=\'none\'">' : '<div class="media-poster"></div>';
            div.innerHTML = posterImg + '<div class="media-title">' + (it.name || it.title || '') + '</div>';
        }
        div.onclick = () => playMedia(it);
        fragment.appendChild(div);
    });
    gridContent.appendChild(fragment);
}

function itemStreamId(it) {
    return it.stream_id || it.id;
}

contentStage.onscroll = () => {
    if (currentLevel !== 'items') return;
    if (contentStage.scrollTop + contentStage.clientHeight >= contentStage.scrollHeight - 200) {
        if (renderLimit < displayedItems.length) {
            renderLimit += 40;
            renderItems();
        }
    }
};

function closePlayer() {
    if (iosPlayer) {
        iosPlayer.pause();
        iosPlayer.removeAttribute('src');
        iosPlayer.load();
        iosPlayer.style.display = 'none';
    }
}

function playMedia(it) {
    const isLive = (currentTab === 0);
    let streamUrl = '';

    if (isLive) {
        streamUrl = CONFIG.server + "/live/" + CONFIG.username + "/" + CONFIG.password + "/" + (it.stream_id || it.id) + ".m3u8";
    } else if (currentTab === 1) {
        const ext = it.container_extension || 'mp4';
        streamUrl = CONFIG.server + "/movie/" + CONFIG.username + "/" + CONFIG.password + "/" + (it.stream_id || it.id) + "." + ext;
    } else {
        streamUrl = CONFIG.server + "/series/" + CONFIG.username + "/" + CONFIG.password + "/" + (it.series_id || it.id) + ".mp4";
    }

    if (iosPlayer) {
        iosPlayer.style.display = 'block';
        iosPlayer.src = streamUrl;
        iosPlayer.play().then(() => {
            if (typeof iosPlayer.webkitEnterFullscreen === 'function') {
                iosPlayer.webkitEnterFullscreen();
            }
        }).catch(() => {});
    }
}

function handleBack() {
    if (currentLevel === 'items') {
        currentLevel = 'categories';
        if (backBtn) backBtn.style.display = 'none';
        if (searchInput) searchInput.value = '';
        viewName.innerText = ['Live TV', 'Filme', 'Serien'][currentTab];
        displayedCategories = [...rawCategories];
        viewCounter.innerText = rawCategories.length + " Kategorien";
        renderCategories();
    }
}

switchTab(0);