document.addEventListener('DOMContentLoaded', () => {
    const passwordInput = document.getElementById('password');
    const needleIcon = document.getElementById('needle-icon');
    const segmentsContainer = document.querySelector('.stitch-segments');
    const strengthText = document.getElementById('password-strength-text');
    const reqLength = document.getElementById('req-length');
    const reqUppercase = document.getElementById('req-uppercase');
    const reqDigit = document.getElementById('req-digit');

    const requirements = [reqLength, reqUppercase, reqDigit];

    function updateRequirement(element, isValid) {
        if (isValid) {
            element.classList.remove('invalid');
            element.classList.add('valid');
        } else {
            element.classList.remove('valid');
            element.classList.add('invalid');
        }
    }

    requirements.forEach(el => updateRequirement(el, false));

    if (!passwordInput || !needleIcon || !segmentsContainer || !strengthText) { return; }
    const segments = segmentsContainer.querySelectorAll('.stitch-segment');
    if (segments.length === 0) { return; }

    let currentScore = 0;

    passwordInput.addEventListener('input', () => {
        const password = passwordInput.value;
        currentScore = calculatePasswordStrength(password);
        updateStrengthUI(currentScore, segments);
    });

    passwordInput.addEventListener('focus', () => {
        if (passwordInput.value) {
            needleIcon.classList.add('is-visible');
            currentScore = calculatePasswordStrength(passwordInput.value);
            updateStrengthUI(currentScore, segments);
        } else {
            updateStrengthUI(0, segments);
        }
    });

    passwordInput.addEventListener('blur', () => {
        if (!passwordInput.value) {
            needleIcon.classList.remove('is-visible');
            updateStrengthUI(0, segments);
        }
    });

    function calculatePasswordStrength(password) {
        let score = 0;
        if (!password) return 0;
        const length = password.length;
        if (length >= 5) score++;
        if (length >= 8) score++;
        if (length >= 12) score++;
        if (password.toLowerCase() !== password && password.toUpperCase() !== password) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9А-Яа-яёЁ]/.test(password)) score++;
        return Math.min(score, 6);
    }

    function updateStrengthUI(score, segmentElements) {
        let strengthState = 'default';
        let text = '';
        let textColorClass = '';
        let targetSegmentIndex = -1;

        if (score === 0) {
            strengthState = 'default';
            text = '';
            targetSegmentIndex = -1;
            textColorClass = '';
        } else if (score <= 1) {
            strengthState = 'weak';
            text = 'Дуже слабкий';
            textColorClass = 'strength-weak';
            targetSegmentIndex = 0;
        } else if (score <= 2) {
            strengthState = 'weak';
            text = 'Слабкий';
            textColorClass = 'strength-weak';
            targetSegmentIndex = 1;
        } else if (score <= 3) {
            strengthState = 'medium';
            text = 'Нормальний';
            textColorClass = 'strength-medium';
            targetSegmentIndex = 2;
        } else if (score <= 4) {
            strengthState = 'medium';
            text = 'Середній';
            textColorClass = 'strength-medium';
            targetSegmentIndex = 3;
        } else {
            strengthState = 'strong';
            text = 'Сильний';
            textColorClass = 'strength-strong';
            targetSegmentIndex = 4;
        }

        strengthText.textContent = text;
        strengthText.className = `form-text text-muted ${textColorClass}`;
        needleIcon.className = `needle-indicator state-${strengthState}`;

        if (targetSegmentIndex >= 0 && targetSegmentIndex < segmentElements.length) {
            needleIcon.classList.add('is-visible');
            const targetSegment = segmentElements[targetSegmentIndex];
            const segmentLeft = targetSegment.offsetLeft;
            const segmentWidth = targetSegment.offsetWidth;
            const rightEdgePx = segmentLeft + segmentWidth;
            needleIcon.style.left = `${rightEdgePx}px`;
        } else {
            needleIcon.classList.remove('is-visible');
            needleIcon.style.left = `-10px`;
        }

        segmentElements.forEach((segment, index) => {
            segment.classList.remove('segment-weak', 'segment-medium', 'segment-strong', 'segment-default');
            if (index <= targetSegmentIndex) {
                segment.classList.add(`segment-${strengthState}`);
            } else {
                segment.classList.add('segment-default');
            }
        });
    }

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            updateStrengthUI(currentScore, segments);
        }, 100);
    });

    updateStrengthUI(0, segments);
});
