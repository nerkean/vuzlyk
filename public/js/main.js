function formatPriceJS(amountUAH, targetCurrency, rates, symbols) {
    const baseAmount = typeof amountUAH === 'number' ? amountUAH : 0;
    const currency = (targetCurrency && rates[targetCurrency] && symbols[targetCurrency])
                   ? targetCurrency
                   : 'UAH';
    const rate = rates[currency] || 1;
    const symbol = symbols[currency] || '₴';

    const convertedAmount = baseAmount * rate;
    const formattedAmount = convertedAmount.toFixed(2);

    if (currency === 'UAH') {
        return `${formattedAmount} ${symbol}`;
    } else {
        return `${symbol}${formattedAmount}`;
    }
}

function updateCartView(data) {
    const cartCountElement = document.querySelector('.header-cart .cart-count');
    const subtotalElement = document.querySelector('.cart-summary .subtotal-amount');
    const totalElement = document.querySelector('.cart-summary .total-amount');

    if (cartCountElement && typeof data.cartItemCount !== 'undefined') {
        cartCountElement.textContent = data.cartItemCount;
    }

    if (subtotalElement && typeof data.subtotal === 'number' && data.selectedCurrency && data.exchangeRates && data.currencySymbols) {
        subtotalElement.textContent = formatPriceJS(data.subtotal, data.selectedCurrency, data.exchangeRates, data.currencySymbols);
    } else if (subtotalElement) {
         subtotalElement.textContent = `${typeof data.subtotal === 'number' ? data.subtotal.toFixed(2) : '?'} грн`;
    }

    if (totalElement && typeof data.total === 'number' && data.selectedCurrency && data.exchangeRates && data.currencySymbols) {
        totalElement.textContent = formatPriceJS(data.total, data.selectedCurrency, data.exchangeRates, data.currencySymbols);
    } else if (totalElement) {
        totalElement.textContent = `${typeof data.total === 'number' ? data.total.toFixed(2) : '?'} грн`;
    }

    if (data.cartItemCount === 0 && window.location.pathname === '/cart') {
        window.location.reload();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const navToggleBtn = document.getElementById('mobile-nav-toggle');
    const mainNavMenu = document.getElementById('main-nav-menu');
    const menuToggleBtn = document.getElementById('mobile-nav-toggle');
    const sideMenu = document.getElementById('side-menu-panel');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    const siteOverlay = document.getElementById('site-overlay');

    if (menuToggleBtn && sideMenu && closeMenuBtn && siteOverlay) {
        const openMenu = () => {
            sideMenu.classList.add('is-open');
            siteOverlay.classList.add('is-visible');
        };

        const closeMenu = () => {
            sideMenu.classList.remove('is-open');
            siteOverlay.classList.remove('is-visible');
        };

        menuToggleBtn.addEventListener('click', openMenu);
        closeMenuBtn.addEventListener('click', closeMenu);
        siteOverlay.addEventListener('click', closeMenu);
    }

    if (navToggleBtn && mainNavMenu) {
        navToggleBtn.addEventListener('click', () => {
            console.log('Toggle button clicked!');
            const isOpen = mainNavMenu.classList.toggle('nav-open');
            navToggleBtn.setAttribute('aria-expanded', isOpen);
        });
    } 

    try {
        const heroSwiperElement = document.querySelector('.hero-swiper');
        if (typeof Swiper !== 'undefined' && heroSwiperElement) {
            const heroSwiper = new Swiper('.hero-swiper', {
                loop: true,
                effect: 'fade',
                fadeEffect: { crossFade: true },
                autoplay: { delay: 5000, disableOnInteraction: false },
                speed: 1000,
                pagination: { el: '.swiper-pagination', clickable: true },
                allowTouchMove: false,
                slidesPerView: 1,
                spaceBetween: 0,
            });
        } 
    } catch (e) {
        console.error('Error initializing Swiper:', e);
    }

    setTimeout(() => {
        try {
            if (typeof AOS !== 'undefined') {
                AOS.init({
                    once: true,
                    duration: 600,
                    easing: 'ease-out-cubic',
                    offset: 50,
                });
            } 
        } catch (e) {
            console.error('Error initializing AOS (delayed):', e);
        }
    }, 300);

    const cartCountElement = document.querySelector('.header-cart .cart-count');

    document.body.addEventListener('click', async (event) => {
    const addToCartButton = event.target.closest('.add-to-cart-button, .btn-tertiary[data-product-id]');
    if (!addToCartButton || addToCartButton.disabled) {
        return;
    }

    if (event.target.closest('.cart-item-quantity') || event.target.closest('.remove-item-btn')) {
         return;
    }

    event.preventDefault();
    const productId = addToCartButton.dataset.productId;
    const quantity = 1;
    const originalButtonText = addToCartButton.innerHTML; 
    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

    console.log(`Add to Cart button clicked for product ${productId}`);

    addToCartButton.classList.add('loading');
    addToCartButton.disabled = true;

    try {
        const response = await fetch('/cart/add', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'CSRF-Token': csrfToken
            },
            body: JSON.stringify({ productId, quantity })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 403) {
                throw new Error('Помилка безпеки. Оновіть сторінку.');
            }
            throw new Error(errorData.message || `Помилка: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            updateCartView(data);
            addToCartButton.classList.remove('loading');
            addToCartButton.classList.add('success');
            addToCartButton.innerHTML = 'Додано ✔';

            setTimeout(() => {
                addToCartButton.classList.remove('success');
                addToCartButton.innerHTML = originalButtonText;
                addToCartButton.disabled = false;
            }, 2000); 

        } else {
            throw new Error(data.message || 'Невідома помилка');
        }
    } catch (error) {
        console.error('Error adding item to cart:', error);
        addToCartButton.classList.remove('loading');
        addToCartButton.classList.add('error');
        addToCartButton.innerHTML = 'Помилка!'; 

        setTimeout(() => {
            addToCartButton.classList.remove('error');
            addToCartButton.innerHTML = originalButtonText;
            addToCartButton.disabled = false;
        }, 3000); 
    }
});

   const cartItemsList = document.querySelector('.cart-items-list');
if (cartItemsList) {
    console.log('Cart page specific listeners attached.');

    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

    cartItemsList.addEventListener('click', async (event) => {
        const target = event.target;
        if (target.classList.contains('quantity-btn')) {
            const quantityInput = target.closest('.cart-item-quantity').querySelector('.quantity-input');
            const productId = quantityInput.dataset.productId;
            if (!productId) return;

            let currentQuantity = parseInt(quantityInput.value);
            if (target.classList.contains('plus-btn')) { currentQuantity++; }
            else if (target.classList.contains('minus-btn')) { currentQuantity--; }
            if (currentQuantity < 1) return;

            console.log(`Updating quantity for ${productId} to ${currentQuantity}`);
            quantityInput.value = currentQuantity;

            try {
                const response = await fetch('/cart/update', {
                     method: 'POST',
                     headers: { 
                         'Content-Type': 'application/json',
                         'CSRF-Token': csrfToken 
                     },
                     body: JSON.stringify({ productId: productId, quantity: currentQuantity })
                });
                if (!response.ok) {
                     const errorData = await response.json().catch(() => ({}));
                     throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                 }
                const data = await response.json();
                if (data.success) {
                    const itemRow = target.closest('.cart-item');
                    const lineTotalElement = itemRow.querySelector('.cart-item-total');
                    
                    if (lineTotalElement && typeof data.itemLineTotal === 'number' && data.selectedCurrency && data.exchangeRates && data.currencySymbols) {
                         lineTotalElement.textContent = formatPriceJS(data.itemLineTotal, data.selectedCurrency, data.exchangeRates, data.currencySymbols);
                    } else if (lineTotalElement) {
                         lineTotalElement.textContent = `${typeof data.itemLineTotal === 'number' ? data.itemLineTotal.toFixed(2) : '?'} грн`;
                    }
                    
                    updateCartView(data);
                } else {
                     alert(`Помилка оновлення: ${data.message || 'Невідома помилка'}`);
                     window.location.reload();
                }
            } catch (error) {
                console.error('Error updating quantity:', error);
                alert(`Помилка оновлення: ${error.message}`);
                window.location.reload();
            }
        }

        if (target.closest('.remove-item-btn')) {
             const removeButton = target.closest('.remove-item-btn');
             const productId = removeButton.dataset.productId;
             const itemRow = removeButton.closest('.cart-item');
             if (!productId || !itemRow) return;
             if (!confirm('Ви впевнені, що хочете видалити цей товар з кошика?')) return;

             console.log(`Removing product ${productId}`);
             try {
                const response = await fetch('/cart/remove', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'CSRF-Token': csrfToken 
                    },
                    body: JSON.stringify({ productId: productId })
                });
                 if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                 if (data.success) {
                    itemRow.remove();
                    updateCartView(data);
                    alert('Товар видалено з кошика.');
                } else {
                     alert(`Помилка видалення: ${data.message || 'Невідома помилка'}`);
                }
             } catch (error) {
                 console.error('Error removing item:', error);
                 alert(`Помилка видалення: ${error.message}`);
             }
        }
    });
    }
});
