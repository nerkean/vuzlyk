document.addEventListener('DOMContentLoaded', () => {
    const passwordInput = document.getElementById('password');
    const iconContainer = document.querySelector('.login-icon-container');
    
    if (passwordInput && iconContainer) {

        passwordInput.addEventListener('focus', () => {
            iconContainer.classList.add('eyes-closed');
        });

        passwordInput.addEventListener('blur', () => {
            iconContainer.classList.remove('eyes-closed');
        });
    }
});