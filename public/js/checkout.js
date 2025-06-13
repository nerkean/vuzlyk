function initCheckoutCustomFields() {
    const fileInput = document.getElementById('customFileCheckout');
    const fileTriggerButton = document.querySelector('.trigger-file-upload-checkout');
    const fileNameSpan = document.querySelector('.file-name-checkout');
    const previewContainer = document.getElementById('imagePreviewContainerCheckout');
    const imagePreview = document.getElementById('imagePreviewCheckout');

    if (!fileInput || !fileTriggerButton || !fileNameSpan || !previewContainer || !imagePreview) {
        return;
    }

    fileTriggerButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', function() {
        const file = this.files[0];
        if (file) {
            fileNameSpan.textContent = file.name;

            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    imagePreview.src = e.target.result;
                    previewContainer.style.display = 'block';
                }
                reader.readAsDataURL(file);
            } else {
                imagePreview.src = '#';
                previewContainer.style.display = 'none';
            }
        } else {
            fileNameSpan.textContent = 'Файл не вибрано';
            imagePreview.src = '#';
            previewContainer.style.display = 'none';
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCheckoutCustomFields);
} else {
    initCheckoutCustomFields();
}
