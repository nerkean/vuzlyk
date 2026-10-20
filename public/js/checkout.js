document.addEventListener('DOMContentLoaded', function() {
    const shippingRadios = document.querySelectorAll('input[name="shippingMethod"]');
    const shippingOptions = document.querySelectorAll('.shipping-option');
    const addressFieldsContainer = document.getElementById('shipping-address-fields-container');
    
    const cityGroup = document.getElementById('city-group');
    const warehouseGroup = document.getElementById('warehouse-group');
    const addressGroup = document.getElementById('address-group');
    const pickupNote = document.getElementById('pickup-note-container');
    const summaryShippingLabel = document.getElementById('summary-shipping-label');

    const cityInput = document.getElementById('shipping_city');
    const warehouseInput = document.getElementById('shipping_np_warehouse');
    const addressInput = document.getElementById('shipping_address1');

    // 1. Логіка перемикання способів доставки
    function updateShippingFields() {
        const selectedRadio = document.querySelector('input[name="shippingMethod"]:checked');
        const method = selectedRadio ? selectedRadio.value : 'nova_poshta';

        shippingOptions.forEach(opt => {
            const radio = opt.querySelector('input[type="radio"]');
            if (radio && radio.checked) opt.classList.add('selected');
            else opt.classList.remove('selected');
        });

        if (addressFieldsContainer) addressFieldsContainer.style.display = method === 'pickup' ? 'none' : 'block';
        if (pickupNote) pickupNote.style.display = method === 'pickup' ? 'flex' : 'none';

        if (method === 'nova_poshta') {
            if (cityGroup) cityGroup.style.display = 'block';
            if (warehouseGroup) warehouseGroup.style.display = 'block';
            if (addressGroup) addressGroup.style.display = 'none';
            if (cityInput) cityInput.required = true;
            if (warehouseInput) warehouseInput.required = true;
            if (addressInput) addressInput.required = false;
            if (summaryShippingLabel) summaryShippingLabel.textContent = 'Нова Пошта (за тарифами)';
        } else if (method === 'ukrposhta') {
            if (cityGroup) cityGroup.style.display = 'block';
            if (warehouseGroup) warehouseGroup.style.display = 'none';
            if (addressGroup) addressGroup.style.display = 'block';
            if (cityInput) cityInput.required = true;
            if (warehouseInput) warehouseInput.required = false;
            if (addressInput) addressInput.required = true;
            if (summaryShippingLabel) summaryShippingLabel.textContent = 'Укрпошта (за тарифами)';
        } else if (method === 'pickup') {
            if (cityGroup) cityGroup.style.display = 'none';
            if (warehouseGroup) warehouseGroup.style.display = 'none';
            if (addressGroup) addressGroup.style.display = 'none';
            if (cityInput) cityInput.required = false;
            if (warehouseInput) warehouseInput.required = false;
            if (addressInput) addressInput.required = false;
            if (summaryShippingLabel) summaryShippingLabel.textContent = 'Безкоштовно (самовивіз)';
        }
    }

    shippingRadios.forEach(radio => radio.addEventListener('change', updateShippingFields));
    updateShippingFields();

    // ==========================================
    // 2. АВТОЗАПОВНЕННЯ НОВОЇ ПОШТИ ЧЕРЕЗ /api/novaposhta
    // ==========================================
    if (!cityInput || !warehouseInput) return;

    let currentCityRef = '';

    // Вимикаємо стандартні підказки браузера, щоб не перекривали список НП
    cityInput.setAttribute('autocomplete', 'off');
    warehouseInput.setAttribute('autocomplete', 'off');

    const cityDropdown = document.createElement('ul');
    cityDropdown.className = 'autocomplete-dropdown';
    cityInput.parentNode.style.position = 'relative';
    cityInput.parentNode.appendChild(cityDropdown);

    const warehouseDropdown = document.createElement('ul');
    warehouseDropdown.className = 'autocomplete-dropdown';
    warehouseInput.parentNode.style.position = 'relative';
    warehouseInput.parentNode.appendChild(warehouseDropdown);

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Запит іде на наш сервер (/api/novaposhta), який сам бере NP_API_KEY з .env
    async function fetchFromNP(modelName, calledMethod, methodProperties) {
        try {
            const response = await fetch('/api/novaposhta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    modelName,
                    calledMethod,
                    methodProperties
                })
            });
            const data = await response.json();
            return data.success ? data.data : [];
        } catch (error) {
            console.error('Помилка запиту до Нової Пошти:', error);
            return [];
        }
    }

    // Функція завантаження відділень для обраного міста
    async function loadWarehouses(searchQuery = '') {
        if (!currentCityRef) return;

        warehouseDropdown.innerHTML = '';
        warehouseDropdown.classList.remove('active');

        const warehouses = await fetchFromNP('Address', 'getWarehouses', {
            CityRef: currentCityRef,
            FindByString: searchQuery,
            Limit: '30'
        });

        if (warehouses && warehouses.length > 0) {
            warehouseDropdown.classList.add('active');
            warehouses.forEach(wh => {
                const li = document.createElement('li');
                li.textContent = wh.Description;
                li.addEventListener('click', () => {
                    warehouseInput.value = wh.Description;
                    warehouseDropdown.classList.remove('active');
                });
                warehouseDropdown.appendChild(li);
            });
        }
    }

    // Пошук міст при введенні тексту
    cityInput.addEventListener('input', debounce(async (e) => {
        const selectedMethod = document.querySelector('input[name="shippingMethod"]:checked')?.value;
        if (selectedMethod !== 'nova_poshta') return;

        const query = e.target.value.trim();
        cityDropdown.innerHTML = '';
        cityDropdown.classList.remove('active');
        currentCityRef = '';

        if (query.length < 2) return;

        const cities = await fetchFromNP('Address', 'searchSettlements', {
            CityName: query,
            Limit: '15',
            Page: '1'
        });

        if (cities && cities.length > 0 && cities[0].Addresses && cities[0].Addresses.length > 0) {
            cityDropdown.classList.add('active');
            cities[0].Addresses.forEach(city => {
                const li = document.createElement('li');
                li.textContent = city.Present;
                li.addEventListener('click', () => {
                    cityInput.value = city.Present;
                    currentCityRef = city.DeliveryCity;
                    cityDropdown.classList.remove('active');
                    
                    warehouseInput.value = '';
                    warehouseInput.focus();
                    loadWarehouses(''); // Одразу показуємо список відділень обраного міста
                });
                cityDropdown.appendChild(li);
            });
        }
    }, 350));

    // Пошук відділень при введенні тексту або кліку на поле
    warehouseInput.addEventListener('input', debounce((e) => {
        loadWarehouses(e.target.value.trim());
    }, 350));

    warehouseInput.addEventListener('focus', () => {
        if (currentCityRef && warehouseDropdown.children.length === 0) {
            loadWarehouses(warehouseInput.value.trim());
        } else if (currentCityRef && warehouseDropdown.children.length > 0) {
            warehouseDropdown.classList.add('active');
        }
    });

    // Закриття випадаючих списків при кліку поза полем
    document.addEventListener('click', (e) => {
        if (!cityInput.contains(e.target) && !cityDropdown.contains(e.target)) {
            cityDropdown.classList.remove('active');
        }
        if (!warehouseInput.contains(e.target) && !warehouseDropdown.contains(e.target)) {
            warehouseDropdown.classList.remove('active');
        }
    });
});