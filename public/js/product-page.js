document.addEventListener('DOMContentLoaded', () => {
    const mainImage = document.getElementById('mainProductImage');
    const thumbnails = document.querySelectorAll('.thumbnail-item img');
    const thumbnailItems = document.querySelectorAll('.thumbnail-item');
    if (mainImage && thumbnails.length > 0) {
        thumbnails.forEach((thumbnail, index) => {
            thumbnail.addEventListener('click', () => {
                const largeSrc = thumbnail.dataset.large;
                const mediumSrc = thumbnail.dataset.medium;
                const thumbSrc = thumbnail.dataset.thumb;
                if (largeSrc && mediumSrc && thumbSrc) {
                    const newSrcset = `${thumbSrc} 300w, ${mediumSrc} 600w, ${largeSrc} 1000w`;
                    mainImage.srcset = newSrcset; 
                    mainImage.src = mediumSrc;   
                    mainImage.alt = thumbnail.alt.replace('Мініатюра', 'Фото');
                    thumbnailItems.forEach(item => item.classList.remove('active'));
                    if (thumbnailItems[index]) {
                        thumbnailItems[index].classList.add('active');
                    }
                } 
            });
        });
    }

    const customFileInput = document.getElementById('customFile');
    const customFileTriggerButton = document.querySelector('.trigger-file-upload');
    const customFileNameSpan = document.querySelector('.file-name');
    const customPreviewContainer = document.getElementById('imagePreviewContainer');
    const customImagePreview = document.getElementById('imagePreview');

    if(customFileTriggerButton && customFileInput) {
        customFileTriggerButton.addEventListener('click', () => {
            customFileInput.click();
        });
    }

    if(customFileInput && customFileNameSpan && customPreviewContainer && customImagePreview) {
        customFileInput.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                customFileNameSpan.textContent = file.name;
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        customImagePreview.src = e.target.result;
                        customPreviewContainer.style.display = 'block';
                    }
                    reader.readAsDataURL(file);
                } else {
                    customImagePreview.src = '#';
                    customPreviewContainer.style.display = 'none';
                }
            } else {
                customFileNameSpan.textContent = 'Файл не вибрано';
                customImagePreview.src = '#';
                customPreviewContainer.style.display = 'none';
            }
        });
    }

    const reviewForm = document.getElementById('review-form');
    const reviewFormMessage = document.getElementById('review-form-message');

  if (reviewForm) {
    reviewForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!reviewFormMessage) return;

        reviewFormMessage.textContent = '';
        reviewFormMessage.className = 'form-message';

        const formData = new FormData(reviewForm);
        const data = Object.fromEntries(formData.entries());
        const csrfToken = reviewForm.dataset.csrfToken; 

        if (!data.rating) {
            reviewFormMessage.textContent = 'Будь ласка, оберіть оцінку (кількість зірок).';
            reviewFormMessage.classList.add('error');
            return;
        }
        const submitButton = reviewForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        reviewFormMessage.textContent = 'Відправка відгуку...';
        reviewFormMessage.classList.add('loading');

        try {
            const response = await fetch(`/api/products/${data.productId}/reviews`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'CSRF-Token': csrfToken 
                },
                body: JSON.stringify({
                    rating: parseInt(data.rating),
                    text: data.text || ''
                }),
            });

            const result = await response.json();
            reviewFormMessage.classList.remove('loading');

            if (response.ok && result.success) {
                reviewFormMessage.textContent = 'Дякуємо! Ваш відгук успішно додано. Перенаправляємо...';
                reviewFormMessage.classList.add('success');
                window.location.href = `/product/${data.productId}?review=success`;
            } else {
                reviewFormMessage.textContent = result.message || 'Сталася помилка при відправці відгуку.';
                reviewFormMessage.classList.add('error');
            }

        } catch (error) {
            console.error('Помилка відправки відгуку:', error);
            reviewFormMessage.classList.remove('loading');
            reviewFormMessage.textContent = 'Не вдалося відправити відгук. Перевірте з\'єднання.';
            reviewFormMessage.classList.add('error');
        } finally {
             if (submitButton) submitButton.disabled = false;
        }
    });
}

    if (typeof AOS !== 'undefined') {
        AOS.init({ once: true, duration: 600, easing: 'ease-out-cubic', offset: 50 });
    }
});
