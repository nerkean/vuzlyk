document.addEventListener('DOMContentLoaded', () => {
    const filterToggleButton = document.getElementById('mobile-filter-toggle');
    const filterSidebar = document.getElementById('filter-sidebar');
    const productGrid = document.getElementById('product-grid-container');
    const paginationContainer = document.getElementById('pagination-container')?.querySelector('ul');
    const filterForm = document.getElementById('filter-form');
    const sortSelect = document.getElementById('sort-by');
    const productCountElement = document.getElementById('product-count-value');
    const loadingIndicator = document.getElementById('loading-indicator');
    const noProductsMessageEl = document.getElementById('no-products-message');
    const activeFiltersContainer = document.getElementById('active-filters-container');
    let selectedCurrency = 'UAH';
    let exchangeRates = { UAH: 1, USD: 1 / 41.0, EUR: 1 / 47.0 };
    let currencySymbols = { UAH: '₴', USD: '$', EUR: '€' };
    let currentPage = 1;
    let currentSort = 'default';
    let currentFilters = {};
    let isUserLoggedIn = false;
let wishlistIds = new Set();

    if (productGrid) {
         isUserLoggedIn = productGrid.dataset.isLoggedIn === 'true';
    try {
        wishlistIds = new Set(JSON.parse(productGrid.dataset.wishlistIds || '[]'));
    } catch(e) { console.error('Error parsing wishlist IDs', e); }
        selectedCurrency = productGrid.dataset.currency || 'UAH';
        try {
            const ratesData = productGrid.dataset.rates;
            const symbolsData = productGrid.dataset.symbols;
            if (ratesData) exchangeRates = JSON.parse(ratesData) || exchangeRates;
            if (symbolsData) currencySymbols = JSON.parse(symbolsData) || currencySymbols;
        } catch (e) {
            console.error("Error parsing currency data from dataset:", e);
        }
    }

    function formatPriceJS(product, targetCurrency, rates, symbols) {
        if (!product || typeof product.price !== 'number') {
            return 'Ціну не вказано';
        }
        const baseAmount = product.price;
        const currency = (targetCurrency && rates[targetCurrency] && symbols[targetCurrency])
                       ? targetCurrency
                       : 'UAH';
        const rate = rates[currency] || 1;
        const symbol = symbols[currency] || '₴';
        const convertedAmount = baseAmount * rate;
        let resultString = '';

        if (currency === 'UAH') {
            resultString = `${convertedAmount.toFixed(2)} ${symbol}`;
        } else {
            resultString = `${symbol}${convertedAmount.toFixed(2)}`;
        }

        if (!product.isPriceNegotiable && typeof product.maxPrice === 'number' && product.maxPrice > baseAmount) {
            const convertedMaxAmount = product.maxPrice * rate;
            if (currency === 'UAH') {
                resultString += ` - ${convertedMaxAmount.toFixed(2)} ${symbol}`;
            } else {
                resultString += ` - ${symbol}${convertedMaxAmount.toFixed(2)}`;
            }
        }
        return resultString;
    }
    
    if (filterToggleButton && filterSidebar) {
        filterToggleButton.addEventListener('click', () => {
            filterSidebar.classList.toggle('filter-sidebar-visible');
            const isVisible = filterSidebar.classList.contains('filter-sidebar-visible');
            filterToggleButton.setAttribute('aria-expanded', String(isVisible));
        });
    }

    async function fetchAndRenderProducts(page = 1, params = {}, scroll = true, updateHistory = true) {
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        if (productGrid) productGrid.innerHTML = ''; 
        if (noProductsMessageEl) noProductsMessageEl.classList.add('is-hidden');
        if (paginationContainer) paginationContainer.innerHTML = '';

        const queryParams = new URLSearchParams();
        queryParams.set('page', page);
        queryParams.set('limit', 12); 

        for (const key in params) {
            if (Array.isArray(params[key])) {
                params[key].forEach(value => queryParams.append(key, value));
            } else if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
                queryParams.set(key, params[key]);
            }
        }
        
        if (updateHistory) {
            const newUrl = `${window.location.pathname}?${queryParams.toString()}`;
            window.history.pushState({path: newUrl}, '', newUrl);
        }

        try {
            const response = await fetch(`/api/products?${queryParams.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            if (productCountElement) {
                productCountElement.textContent = data.totalProducts || 0;
            }

            renderProducts(data.products, data.currentPage); 
            renderPagination(data.currentPage, data.totalPages);
            currentPage = data.currentPage; 

            if (typeof AOS !== 'undefined') { AOS.refresh(); }

            if (scroll) {
                const sortControlsElement = document.querySelector('.sorting-controls');
                if (sortControlsElement) {
                    const headerOffset = document.querySelector('.admin-header')?.offsetHeight || document.querySelector('.site-header')?.offsetHeight || 80;
                    const elementPosition = sortControlsElement.getBoundingClientRect().top + window.pageYOffset;
                    const offsetPosition = elementPosition - headerOffset;
                    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                }
            }
        } catch (error) {
            console.error('Error fetching products:', error);
            if (productGrid) productGrid.innerHTML = '<p style="grid-column: 1 / -1; color: red; text-align:center;">Помилка завантаження товарів. Спробуйте оновити сторінку.</p>';
            if (noProductsMessageEl) noProductsMessageEl.classList.remove('is-hidden');
        } finally {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }

    function renderProducts(products, pageNumForPriority) {
        if (!productGrid) return;
        productGrid.innerHTML = ''; 

        if (!products || products.length === 0) {
            if (noProductsMessageEl) noProductsMessageEl.classList.remove('is-hidden');
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }
        if (noProductsMessageEl) noProductsMessageEl.classList.add('is-hidden');

        let productHTML = '';
        products.forEach((product, index) => {
            const productId = product._id || '';
            const productName = product.name || 'Назва товару';
            
            let staticImgSrc = '/images/placeholder.svg';
            if (product.images && product.images.length > 0) {
                const imgSet = product.images[0];
                if (imgSet.medium && typeof imgSet.medium === 'object' && imgSet.medium.url) {
                    staticImgSrc = imgSet.medium.url;
                } else if (imgSet.thumb && typeof imgSet.thumb === 'object' && imgSet.thumb.url) {
                    staticImgSrc = imgSet.thumb.url;
                } else if (typeof imgSet.medium === 'string' && imgSet.medium.trim() !== '') {
                    staticImgSrc = imgSet.medium;
                } else if (typeof imgSet.thumb === 'string' && imgSet.thumb.trim() !== '') {
                    staticImgSrc = imgSet.thumb;
                }
            }

            const livePhotoUrl = product.livePhotoUrl || '';
            const livePhotoType = livePhotoUrl.endsWith('.gif') ? 'gif' : (livePhotoUrl.endsWith('.mp4') || livePhotoUrl.endsWith('.webm') ? 'video' : 'unknown');
            let priceDisplayHTML = formatPriceJS(product, selectedCurrency, exchangeRates, currencySymbols);

            productHTML += `
                <article class="product-card" 
                         data-static-image-url="${staticImgSrc}"
                         ${livePhotoUrl ? `data-live-photo-url="${livePhotoUrl}" data-live-photo-type="${livePhotoType}"` : ''}
                         data-aos="fade-up" data-aos-delay="${index * 50}" data-aos-once="true">
                    <div class="product-image-wrapper">
                        <a href="/product/${productId}" aria-label="Переглянути деталі товару ${productName}">
                            <img class="product-card-image static-image" 
                                 src="${staticImgSrc}" alt="${productName}"
                                 width="300" height="400"
                                 ${(index === 0 && pageNumForPriority === 1) ? 'fetchpriority="high"' : 'loading="lazy"'}
                                 onerror="this.onerror=null; this.src='/images/placeholder.svg';">
                            
                            ${livePhotoUrl ? `
                            <div class="live-photo-container" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: #fff;">
                                ${livePhotoType === 'gif' ? `
                                    <img class="product-card-image live-image-gif" 
                                         src="" alt="Анімація ${productName}"
                                         style="width: 100%; height: 100%; object-fit: cover;">
                                ` : (livePhotoType === 'video' ? `
                                    <video class="product-card-image live-image-video" 
                                           playsinline autoplay muted loop
                                           style="width: 100%; height: 100%; object-fit: cover;">
                                        <source src="" data-src-video="${livePhotoUrl}" type="${livePhotoUrl.endsWith('.mp4') ? 'video/mp4' : 'video/webm'}">
                                        Ваш браузер не підтримує відео.
                                    </video>
                                ` : '')}
                            </div>
                            ` : ''}
                            <div class="product-overlay"><span class="view-details-btn">Детальніше</span></div>
                        </a>
                    </div>
                    <div class="product-info">
        <button 
            class="wishlist-btn ${ wishlistIds.has(productId) ? 'in-wishlist' : ''}" 
            data-product-id="${productId}" 
            aria-label="Додати в список бажань"
            ${ !isUserLoggedIn ? 'data-redirect-to-login="true"' : '' }
        >
            <i class="fa${ wishlistIds.has(productId) ? 's' : 'r' } fa-heart"></i>
        </button>
                         <a href="/product/${productId}"><h3>${productName}</h3></a>
                         <p class="price">${priceDisplayHTML}</p>
                         <button class="btn btn-tertiary add-to-cart-button" data-product-id="${productId}" aria-label="Додати ${productName} в кошик">
                             <svg class="icon icon-cart-plus" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" fill="currentColor"><path d="M0 24C0 10.7 10.7 0 24 0L69.5 0c22 0 41.5 12.8 50.6 32l411 0c26.3 0 45.5 25 38.6 50.4l-41 152.3c-8.5 31.4-37 53.3-69.5 53.3l-288.5 0 5.4 28.5c2.2 11.3 12.1 19.5 23.6 19.5L488 336c13.3 0 24 10.7 24 24s-10.7 24-24 24l-288.3 0c-34.6 0-64.3-24.6-70.7-58.5L77.4 54.5c-.7-3.8-4-6.5-7.9-6.5L24 48C10.7 48 0 37.3 0 24zM128 464a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zm336-48a48 48 0 1 1 0 96 48 48 0 1 1 0-96zM252 160c0 11 9 20 20 20l44 0 0 44c0 11 9 20 20 20s20-9 20-20l0-44 44 0c11 0 20-9 20-20s-9-20-20-20l-44 0 0-44c0-11-9-20-20-20s-20 9-20 20l0 44-44 0c-11 0-20 9-20 20z"/></svg>
                             В кошик
                         </button>
                     </div>
                </article>
            `;
        });
        productGrid.innerHTML = productHTML;
        addProductCardHoverListeners(); 

        if (typeof AOS !== 'undefined') { AOS.refreshHard ? AOS.refreshHard() : AOS.refresh(); }
    }

    function addProductCardHoverListeners() {
        const productCards = productGrid.querySelectorAll('.product-card');
        productCards.forEach(card => {
            const staticImageEl = card.querySelector('.static-image');
            const livePhotoContainer = card.querySelector('.live-photo-container');
            const livePhotoUrl = card.dataset.livePhotoUrl;
            const livePhotoType = card.dataset.livePhotoType;

            if (livePhotoUrl && livePhotoContainer && staticImageEl) {
                let liveMediaElement = null;
                if (livePhotoType === 'gif') {
                    liveMediaElement = livePhotoContainer.querySelector('.live-image-gif');
                } else if (livePhotoType === 'video') {
                    liveMediaElement = livePhotoContainer.querySelector('.live-image-video video') || livePhotoContainer.querySelector('.live-image-video');
                }

                if (liveMediaElement) {
                    card.addEventListener('mouseenter', () => {
                        if (livePhotoType === 'gif') {
                            if (liveMediaElement.getAttribute('src') !== livePhotoUrl) {
                                liveMediaElement.setAttribute('src', livePhotoUrl);
                            }
                        } else if (livePhotoType === 'video') {
                            const sourceElement = liveMediaElement.querySelector('source');
                            if (sourceElement && sourceElement.getAttribute('src') !== livePhotoUrl) {
                                sourceElement.setAttribute('src', livePhotoUrl);
                                liveMediaElement.load(); 
                            } else if (!sourceElement && liveMediaElement.getAttribute('src') !== livePhotoUrl) { 
                                liveMediaElement.setAttribute('src', livePhotoUrl);
                                liveMediaElement.load();
                            }
                            liveMediaElement.play().catch(e => console.warn("Autoplay for video prevented:", e.message));
                        }
                        staticImageEl.style.opacity = '0'; 
                        livePhotoContainer.style.display = 'block'; 
                    });

                    card.addEventListener('mouseleave', () => {
                        if (livePhotoType === 'video' && liveMediaElement) {
                            liveMediaElement.pause();
                        }
                        livePhotoContainer.style.display = 'none'; 
                        staticImageEl.style.opacity = '1'; 
                    });
                }
            }
        });
    }
    
    function renderPagination(currentPageNum, totalPages) {
        if (!paginationContainer || totalPages <= 1) {
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }
        paginationContainer.innerHTML = '';
        const delta = 1;
        const range = [];
        const rangeWithDots = [];
        range.push(1);
        if (totalPages > 1) {
            let left = Math.max(2, currentPageNum - delta);
            let right = Math.min(totalPages - 1, currentPageNum + delta);
            if (currentPageNum - delta <= 2) right = Math.min(totalPages - 1, 1 + delta * 2);
            if (currentPageNum + delta >= totalPages - 1) left = Math.max(2, totalPages - delta * 2);
            left = Math.min(left, right);
            for (let i = left; i <= right; i++) range.push(i);
            range.push(totalPages);
        }
        const uniqueRange = [...new Set(range)].sort((a, b) => a - b);
        let l;
        uniqueRange.forEach(i => {
            if (l) {
                if (i - l === 2) rangeWithDots.push(l + 1);
                else if (i - l > 1) rangeWithDots.push('...');
            }
            rangeWithDots.push(i);
            l = i;
        });
        const fragment = document.createDocumentFragment();
        const prevLi = document.createElement('li');
        prevLi.className = `page-item ${currentPageNum === 1 ? 'disabled' : ''}`;
        prevLi.innerHTML = `<button type="button" class="page-link prev" data-page="${currentPageNum - 1}" aria-label="Попередня">&laquo;</button>`;
        fragment.appendChild(prevLi);
        rangeWithDots.forEach(page => {
            const li = document.createElement('li');
            li.className = `page-item ${page === currentPageNum ? 'active' : ''} ${page === '...' ? 'disabled' : ''}`;
            li.innerHTML = page === '...' ? `<span class="page-link dots">...</span>` : `<button type="button" class="page-link" data-page="${page}">${page}</button>`;
            fragment.appendChild(li);
        });
        const nextLi = document.createElement('li');
        nextLi.className = `page-item ${currentPageNum === totalPages ? 'disabled' : ''}`;
        nextLi.innerHTML = `<button type="button" class="page-link next" data-page="${currentPageNum + 1}" aria-label="Наступна">&raquo;</button>`;
        fragment.appendChild(nextLi);
        paginationContainer.appendChild(fragment);
    }

    function updateActiveFiltersDisplay() {
        if (!activeFiltersContainer || !filterForm) return;
        activeFiltersContainer.innerHTML = '';
        const checkedTags = filterForm.querySelectorAll('input[name="tags"]:checked');
        let hasActiveTags = false;
        checkedTags.forEach(checkbox => {
            const label = filterForm.querySelector(`label[for="${checkbox.id}"]`);
            const labelText = label ? label.textContent.trim() : checkbox.value;
            const tagValue = checkbox.value;
            if (labelText) {
                const tagElement = document.createElement('span');
                tagElement.className = 'active-filter-tag';
                const textNode = document.createTextNode(labelText + ' ');
                tagElement.appendChild(textNode);
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'remove-tag-btn';
                removeButton.dataset.tagValue = tagValue;
                removeButton.setAttribute('aria-label', `Видалити фільтр ${labelText}`);
                removeButton.innerHTML = '&times;';
                tagElement.appendChild(removeButton);
                activeFiltersContainer.appendChild(tagElement);
                hasActiveTags = true;
            }
        });
        activeFiltersContainer.style.display = hasActiveTags ? 'flex' : 'none';
    }
    
function applyFiltersAndSort(page = 1, scroll = true) {
    const formData = filterForm ? new FormData(filterForm) : new FormData();
    currentFilters = {}; // Скидаємо фільтри

    // --- 👇 ОСНОВНЕ ВИПРАВЛЕННЯ ТУТ 👇 ---
    // Завжди перевіряємо URL на наявність категорії і додаємо її до фільтрів
    const urlParams = new URLSearchParams(window.location.search);
    const categoryFromUrl = urlParams.get('category');
    if (categoryFromUrl) {
        currentFilters.category = categoryFromUrl;
    }
    // --- 👆 КІНЕЦЬ ВИПРАВЛЕННЯ 👆 ---

    // Збираємо решту фільтрів з форми
    const priceFrom = formData.get('price_from');
    const priceTo = formData.get('price_to');
    const statuses = formData.getAll('status');
    const tags = formData.getAll('tags');

    if (priceFrom) currentFilters.price_from = priceFrom;
    if (priceTo) currentFilters.price_to = priceTo;
    if (statuses.length > 0) currentFilters.status = statuses;
    if (tags.length > 0) currentFilters.tags = tags;
    
    // Додаємо сортування
    if (sortSelect && sortSelect.value) {
        currentSort = sortSelect.value;
    }
    currentFilters.sort = currentSort;
    
    // Викликаємо функцію для отримання та відображення продуктів
    fetchAndRenderProducts(page, currentFilters, scroll);
    updateActiveFiltersDisplay();
}

    if (filterForm) {
        filterForm.addEventListener('submit', (event) => { 
            event.preventDefault(); 
            applyFiltersAndSort(1, true);
            if (window.innerWidth <= 992 && filterSidebar?.classList.contains('filter-sidebar-visible')) {
                filterSidebar.classList.remove('filter-sidebar-visible');
                if (filterToggleButton) filterToggleButton.setAttribute('aria-expanded', 'false');
            }
        });
        filterForm.addEventListener('change', (event) => {
            if (event.target.type === 'checkbox' || event.target.type === 'number') {
                 applyFiltersAndSort(1, true);
                 if (window.innerWidth <= 992 && filterSidebar?.classList.contains('filter-sidebar-visible') && event.target.type === 'checkbox') {
                    setTimeout(() => {
                        filterSidebar.classList.remove('filter-sidebar-visible');
                        if (filterToggleButton) filterToggleButton.setAttribute('aria-expanded', 'false');
                    }, 300);
                }
            }
        });

        const clearFiltersButton = filterForm.querySelector('.clear-filters-btn');
        if (clearFiltersButton) {
            clearFiltersButton.addEventListener('click', () => {
                filterForm.reset();
                currentSort = 'default'; 
                if(sortSelect) sortSelect.value = 'default';
                applyFiltersAndSort(1, true);
                if (window.innerWidth <= 992 && filterSidebar?.classList.contains('filter-sidebar-visible')) {
                    filterSidebar.classList.remove('filter-sidebar-visible');
                    if (filterToggleButton) filterToggleButton.setAttribute('aria-expanded', 'false');
                }
            });
        }
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            applyFiltersAndSort(1, true);
        });
    }

    if (paginationContainer) {
        paginationContainer.addEventListener('click', (event) => {
            const targetButton = event.target.closest('.page-link:not(.dots)');
            if (targetButton && !targetButton.closest('.page-item.disabled') && !targetButton.closest('.page-item.active')) {
                event.preventDefault();
                const page = parseInt(targetButton.dataset.page);
                if (!isNaN(page)) {
                    applyFiltersAndSort(page, true); 
                }
            }
        });
    }
    
    if (activeFiltersContainer) {
        activeFiltersContainer.addEventListener('click', (event) => {
            const removeButton = event.target.closest('.remove-tag-btn');
            if (removeButton) {
                const tagValueToRemove = removeButton.dataset.tagValue;
                const checkboxToUncheck = filterForm?.querySelector(`input[name="tags"][value="${CSS.escape(tagValueToRemove)}"]`);
                if (checkboxToUncheck) {
                    checkboxToUncheck.checked = false;
                    applyFiltersAndSort(1, true);
                }
            }
        });
    }

    if (productGrid) {
        productGrid.addEventListener('click', async (event) => {
            const button = event.target.closest('.add-to-cart-button');
            if (!button) return;
        });
    }
    
    function initializeCatalog() {
        const urlParams = new URLSearchParams(window.location.search);
        const initialFilterParams = {};
        let pageFromUrl = 1;

        for(const [key, value] of urlParams.entries()) {
            if (key === 'page') {
                pageFromUrl = parseInt(value) || 1;
            } else if (initialFilterParams[key]) {
                if (!Array.isArray(initialFilterParams[key])) {
                    initialFilterParams[key] = [initialFilterParams[key]];
                }
                initialFilterParams[key].push(value);
            } else {
                initialFilterParams[key] = value;
            }
        }
        currentPage = pageFromUrl;
        currentSort = initialFilterParams.sort || 'default';
        currentFilters = { ...initialFilterParams }; 

        if (filterForm) {
            if (currentFilters.price_from) filterForm.elements.price_from.value = currentFilters.price_from;
            if (currentFilters.price_to) filterForm.elements.price_to.value = currentFilters.price_to;
            if (currentFilters.status) {
                const statuses = Array.isArray(currentFilters.status) ? currentFilters.status : [currentFilters.status];
                statuses.forEach(s => {
                    const cb = filterForm.querySelector(`input[name="status"][value="${s}"]`);
                    if (cb) cb.checked = true;
                });
            }
            if (currentFilters.tags) {
                const tags = Array.isArray(currentFilters.tags) ? currentFilters.tags : [currentFilters.tags];
                tags.forEach(t => {
                    const cb = filterForm.querySelector(`input[name="tags"][value="${CSS.escape(t)}"]`);
                    if (cb) cb.checked = true;
                });
            }
        }
        if (sortSelect) sortSelect.value = currentSort;
        
        updateActiveFiltersDisplay();
        fetchAndRenderProducts(currentPage, currentFilters, false, false); 
    }

    initializeCatalog(); 

    window.addEventListener('popstate', (event) => {
        initializeCatalog();
    });

});
