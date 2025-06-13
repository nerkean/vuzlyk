function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach((item, index) => {
        const questionButton = item.querySelector('.faq-question');
        const answerPanel = item.querySelector('.faq-answer');

        questionButton.setAttribute('aria-expanded', 'false');
        answerPanel.classList.remove('is-open');
        questionButton.classList.remove('is-active');


        questionButton.addEventListener('click', () => {
            const isExpanded = questionButton.getAttribute('aria-expanded') === 'true';

            questionButton.setAttribute('aria-expanded', String(!isExpanded));

            questionButton.classList.toggle('is-active'); 
            answerPanel.classList.toggle('is-open');  
        });
    });

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFaqAccordion);
} else {
    initFaqAccordion();
}
